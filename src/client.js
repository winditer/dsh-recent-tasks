// dsh-recent-tasks — Client half (the bundle discovered through
// `dsh.client` + `exports["./client"]`; built into `dist/client.js` by
// scripts/build.mjs).
//
// What it contributes to the official UI (design §8.2, none of it shadowing a
// shipped slot):
//   1. `sidebar.footer.action` (list, root): one `＋ 最近任务` button that starts
//      a blank session in the managed workspace — the only entry a plugin can add
//      without rewriting the sidebar.
//   2. shortcut `recentTasks.new` (via `ctx.shortcuts.register`, optional service).
//   3. `settings.general.item` (list, root): the storage folder / group name /
//      pin-last / auto-repair row. The values it edits are the OFFICIAL live
//      config (`configForms.get('recent-tasks')`), so the same form also shows
//      up under Settings -> Plugins and persists in the profile's patch.
//   4. no slot at all: it keeps the managed group's STORED title in step with the
//      UI language. Both label surfaces render the durable Workspace title
//      verbatim, so the plugin renames its own record through the official
//      `workspaces.rename` while that title is still one of its default names.
//
// Verified contracts this file codes against (DSH 0.2.0-rc.1):
//   * a bundle client half receives NO config: `apply(ctx)` only. Every tunable
//     comes from our own host half over `POST /dsh-recent-tasks/api/<method>`.
//   * `ctx.slots.inject(key, () => ctx.slots.register(spec, Component))` is
//     mandatory for slots declared by other packages; `spec.inject` returns the
//     props the component receives (`hooks: {...}` entries become `use<Name>`),
//     and `locale: NS` gives the component a stable `t`.
//   * `sidebar.footer.action` renders `{ wide }`; `settings.general.item` renders `{}`.
//   * `ctx.shortcuts.register` THROWS on a duplicate id, a reserved default, or a
//     default that overlaps another command on ANY runtime/platform — so the
//     registration is guarded and degrades to the button.
//   * the browser module loader only resolves seed words (react, …) and other
//     plugin packages; local sources must be bundled in.
import React from 'react';
import { NS, zh, en } from './locales.js';
import {
  API_PREFIX,
  CODES,
  SETTINGS_NAMESPACE,
  codeForStatus,
  messageKeyForCode,
  readStateResponse,
} from './protocol.js';
import {
  Phase,
  SHORTCUT_DEFAULTS,
  createRecentTasksController,
  planCreate,
  planTitleSync,
  readGuideSeen,
  shortcutResolution,
  writeGuideSeen,
} from './client-core.js';

/** Background re-sync cadence (§8.5); explicit refresh still wins. */
const REFRESH_MS = 30_000;
/** How long a transient inline message stays on screen. */
const FLASH_MS = 6_000;
const STYLE_ID = 'dsh-recent-tasks';

const logger = { warn: (...args) => console.warn('[dsh-recent-tasks]', ...args) };

/** One POST to the host half; transport faults surface as coded failures. */
async function callHost(method, args, prefix = API_PREFIX) {
  let response;
  try {
    response = await fetch(`${prefix}/${encodeURIComponent(method)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });
  } catch (error) {
    return { ok: false, code: CODES.unavailable, message: String(error?.message ?? error) };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, code: codeForStatus(response.status, payload), message: payload?.message };
  }
  return readStateResponse(payload);
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const CSS = `
.dsh-recent-tasks-btn{position:relative;display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:36px;padding:0 10px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-recent-tasks-btn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-recent-tasks-btn:disabled{opacity:.5;cursor:default}
.dsh-recent-tasks-btn.is-narrow{justify-content:center;width:36px;padding:0}
.dsh-recent-tasks-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;font-size:16px;line-height:1}
.dsh-recent-tasks-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-recent-tasks-dot{position:absolute;top:6px;left:22px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsh-recent-tasks-toast{position:fixed;left:16px;bottom:96px;z-index:40;max-width:320px;padding:8px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 6px 24px rgba(0,0,0,.16);font-size:12px;line-height:18px}
.dsh-recent-tasks-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}
.dsh-recent-tasks-row:last-child{border-bottom:none}
.dsh-recent-tasks-main{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.dsh-recent-tasks-title{color:var(--dsw-alias-label-primary,#1f2329);font-size:14px;line-height:22px}
.dsh-recent-tasks-desc{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsh-recent-tasks-hint{color:var(--dsw-alias-label-tertiary,#8f959e);font-size:12px;line-height:18px}
.dsh-recent-tasks-warn{color:var(--dsw-alias-state-error-primary,#d83931);font-size:12px;line-height:18px}
.dsh-recent-tasks-status{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;line-height:18px;padding-top:8px}
.dsh-recent-tasks-controls{display:flex;align-items:center;gap:8px;flex:none}
.dsh-recent-tasks-input{height:32px;min-width:200px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px}
.dsh-recent-tasks-action{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;cursor:pointer}
.dsh-recent-tasks-action:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-recent-tasks-action:disabled{opacity:.5;cursor:default}
.dsh-recent-tasks-switch{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px;cursor:pointer}
`;

/** Insert the one plugin stylesheet, tagged so the module loader can evict it. */
function installStyles(ctx) {
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-recent-tasks';
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
  ctx.effect(() => () => tag.remove(), 'dsh-recent-tasks: styles');
}

function useController(controller) {
  return React.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
}

/**
 * Stand-in for a composition without the official settings surface, so the
 * settings row can call hooks unconditionally.
 */
const NO_FORM = Object.freeze({
  subscribe: () => () => {},
  getSnapshot: () => null,
  set: async () => false,
});

/** Subscribe to this plugin's official live-config form (may be absent). */
function useForm(form) {
  const source = form ?? NO_FORM;
  return React.useSyncExternalStore(source.subscribe, source.getSnapshot);
}

/** Reason key for whatever currently blocks the action. */
function reasonKey(snapshot) {
  if (snapshot.code) return messageKeyForCode(snapshot.code);
  return 'state.notReady';
}

/**
 * `sidebar.footer.action` entry: the always-available "new recent task" button.
 * Props: `{ wide }` (owner) + `{ t }` (our `locale: NS`) + our inject face.
 */
function NewRecentTaskButton({ wide, t, controller, create }) {
  const snapshot = useController(controller);
  const [guideSeen, setGuideSeen] = React.useState(() => readGuideSeen(safeStorage()));

  // A recreated group is announced exactly once (§8.4).
  React.useEffect(() => {
    if (!snapshot.repairNotice) return;
    controller.setFlash(t(snapshot.repairNotice));
    controller.dismissRepairNotice();
  }, [snapshot.repairNotice, controller, t]);

  React.useEffect(() => {
    if (!snapshot.flash) return undefined;
    const timer = window.setTimeout(() => controller.setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot.flash, controller]);

  const ready = snapshot.phase === Phase.ready && snapshot.value && snapshot.value.enabled !== false;
  const disabled = !ready || snapshot.busy === true;
  const tooltip = ready ? t('new.tooltip') : t(reasonKey(snapshot));

  const onClick = () => {
    if (!guideSeen) {
      writeGuideSeen(safeStorage());
      setGuideSeen(true);
    }
    create();
  };

  return (
    <React.Fragment>
      <button
        type="button"
        className={wide ? 'dsh-recent-tasks-btn' : 'dsh-recent-tasks-btn is-narrow'}
        title={tooltip}
        aria-label={t('new')}
        aria-disabled={disabled ? 'true' : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="dsh-recent-tasks-icon" aria-hidden="true">＋</span>
        {wide ? <span className="dsh-recent-tasks-label">{t('new')}</span> : null}
        {guideSeen ? null : <span className="dsh-recent-tasks-dot" aria-hidden="true" />}
      </button>
      {snapshot.flash ? (
        <div className="dsh-recent-tasks-toast" role="status">{snapshot.flash}</div>
      ) : null}
    </React.Fragment>
  );
}

/** One settings row: title/description on the left, the control on the right. */
function SettingsRow({ title, children, control }) {
  return (
    <div className="dsh-recent-tasks-row">
      <div className="dsh-recent-tasks-main">
        <div className="dsh-recent-tasks-title">{title}</div>
        {children}
      </div>
      <div className="dsh-recent-tasks-controls">{control}</div>
    </div>
  );
}

/**
 * `settings.general.item` entry: storage folder, group name, pin-last and
 * auto-repair.
 *
 * The values are the OFFICIAL live config (design §8.6 route A): the host half
 * declares them `.volatile()`, `dsh-settings` serves them under this plugin's row
 * id, and the writes below go through the official `configForms` transport —
 * which persists into the active profile's cordis.patch.yml and hot-applies to
 * the running host. The same form is also reachable from Settings -> Plugins.
 *
 * The path/title/warnings shown here come from our own state snapshot, which
 * knows the CANONICAL path and the two situations the official form cannot
 * report (a pre-existing workspace record, a folder nested under one).
 */
function RecentTasksSettingsRow({ t, controller, pickDirectory, form }) {
  const snapshot = useController(controller);
  const value = snapshot.value;
  const config = useForm(form);
  const ready = snapshot.phase === Phase.ready && value;
  const live = config?.status === 'ready' ? config.value ?? {} : null;
  const editable = config?.writable === true && config?.status === 'ready';
  const [title, setTitle] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [flash, setFlash] = React.useState(null);

  React.useEffect(() => {
    setTitle(live?.title ?? '');
  }, [live?.title]);

  React.useEffect(() => {
    if (!flash) return undefined;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  React.useEffect(() => {
    if (snapshot.repairNotice) {
      setFlash(t(snapshot.repairNotice));
      controller.dismissRepairNotice();
    }
  }, [snapshot.repairNotice, controller, t]);

  const save = React.useCallback(async (field, next, successKey) => {
    setPending(true);
    try {
      const accepted = await form.set(field, next);
      // The official transport answers false after its own recovery read; the
      // new value (or the old one) arrives through the form snapshot.
      setFlash(t(accepted ? (successKey ?? 'settings.saved') : 'settings.saveFailed'));
    } catch (error) {
      setFlash(t('settings.saveFailed', { 0: String(error?.message ?? error) }));
    } finally {
      setPending(false);
    }
  }, [form, t]);

  if (!ready) {
    return (
      <SettingsRow
        title={t('settings.title')}
        control={
          <button type="button" className="dsh-recent-tasks-action" onClick={() => controller.refresh()}>
            {t('retry')}
          </button>
        }
      >
        <div className="dsh-recent-tasks-warn" role="alert">{t(reasonKey(snapshot))}</div>
      </SettingsRow>
    );
  }

  const onChangeDir = async () => {
    try {
      const path = await pickDirectory();
      if (!path) return;
      await save('recentTasksDir', path);
    } catch (error) {
      setFlash(t('settings.pickFailed', { 0: String(error?.message ?? error) }));
    }
  };

  const commitTitle = () => {
    const next = String(title ?? '').trim();
    if (!next || next === (live?.title ?? '')) return;
    save('title', next);
  };

  return (
    <React.Fragment>
      <SettingsRow
        title={t('settings.title')}
        control={
          <button
            type="button"
            className="dsh-recent-tasks-action"
            disabled={!editable || pending}
            onClick={onChangeDir}
          >
            {t('settings.dir.change')}
          </button>
        }
      >
        <div className="dsh-recent-tasks-desc">{t('settings.dir')}: {value.path}</div>
        {value.reusedExisting ? (
          <div className="dsh-recent-tasks-desc">{t('settings.alreadyWorkspace', { 0: value.title ?? '' })}</div>
        ) : null}
        {value.nestedUnder ? (
          <div className="dsh-recent-tasks-warn" role="alert">
            {t('settings.nestedWarning', { 0: value.nestedUnder.title })}
          </div>
        ) : null}
        <div className="dsh-recent-tasks-hint">{t('settings.hint')}</div>
      </SettingsRow>

      <SettingsRow
        title={t('settings.title.field')}
        control={
          <input
            type="text"
            className="dsh-recent-tasks-input"
            value={title}
            disabled={!editable || pending}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle();
            }}
          />
        }
      />

      <SettingsRow
        title={t('settings.pinLast')}
        control={
          <label className="dsh-recent-tasks-switch">
            <input
              type="checkbox"
              role="switch"
              checked={live?.pinLast !== false}
              disabled={!editable || pending}
              onChange={(event) => save('pinLast', event.target.checked)}
            />
          </label>
        }
      />

      <SettingsRow
        title={t('settings.autoRepair')}
        control={
          <label className="dsh-recent-tasks-switch">
            <input
              type="checkbox"
              role="switch"
              checked={live?.autoRepair !== false}
              disabled={!editable || pending}
              onChange={(event) => save('autoRepair', event.target.checked)}
            />
          </label>
        }
      />

      {editable ? null : <div className="dsh-recent-tasks-status">{t('settings.readonly')}</div>}
      {flash ? <div className="dsh-recent-tasks-status" role="status">{flash}</div> : null}
      {snapshot.code ? (
        <div className="dsh-recent-tasks-status" role="alert">{t(messageKeyForCode(snapshot.code))}</div>
      ) : null}
    </React.Fragment>
  );
}


const plugin = {
  inject: ['slots', 'locale', 'uiWorkspace', 'workspaces'],
  apply(ctx) {
    const locale = ctx.locale;
    const t = locale.bind(NS);
    ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-recent-tasks: dictionaries');
    installStyles(ctx);

    const controller = createRecentTasksController({
      request: (method, args) => callHost(method, args),
      logger,
    });

    // The official live-config form for this plugin's settings namespace. The
    // facade keeps a stable identity (useSyncExternalStore needs that) while the
    // underlying form service appears and disappears with the settings surface.
    let form = null;
    const formFacade = {
      subscribe: (listener) => (form ? form.subscribe(listener) : () => {}),
      getSnapshot: () => (form ? form.getSnapshot() : null),
      set: (field, value) => (form ? form.set(field, value) : Promise.resolve(false)),
    };

    // The current workspace list is the client-side path -> id authority; the
    // `workspaces` service is a peer of uiWorkspace, so it may not exist in a
    // trimmed composition (the button then trusts the host snapshot alone).
    const workspaceList = () => {
      try {
        return ctx.get('workspaces')?.list?.getSnapshot()?.items ?? [];
      } catch (error) {
        logger.warn('cannot read the workspace list:', error);
        return [];
      }
    };

    /** The official client Workspace service (rename/create/delete), if mounted. */
    let workspaceServiceMissing = false;
    const workspaceService = () => {
      try {
        const service = ctx.get('workspaces') ?? null;
        if (!service && !workspaceServiceMissing) {
          // Said once, in the console: without this service the group name cannot
          // follow the language (the trimmed-composition fallback is to keep the
          // stored title, which is what the sidebar shows either way).
          workspaceServiceMissing = true;
          logger.warn('no workspace service: the group name cannot follow the UI language');
        }
        return service;
      } catch (error) {
        logger.warn('cannot reach the workspace service:', error);
        return null;
      }
    };

    /** One live workspace row by id; the official list is the display authority. */
    function liveWorkspaceRow(workspaceId) {
      const id = String(workspaceId);
      return workspaceList().find((row) => String(row?.workspaceId ?? row?.id ?? '') === id) ?? null;
    }

    /**
     * Keep the managed group's STORED title in step with the UI language.
     *
     * Both label surfaces — the sidebar group row and the workspace switcher menu
     * — render the durable Workspace `title` verbatim, so a group created under
     * Chinese keeps reading "最近任务" after the UI switches to English. While the
     * stored title is still one of this plugin's OWN default names (in either
     * language) the plugin owns it and rewrites it to the active language through
     * the official rename the UI's own rename dialog uses; a title the user typed,
     * or a `title` the operator configured, is never touched.
     *
     * The live official row is preferred over our 30s state snapshot: a rename the
     * user just made in the sidebar must never be clobbered by a stale read.
     */
    let titleSyncing = false;
    /** One plan that already failed with a permanent name conflict. */
    let titleConflict = null;
    function syncGroupTitle() {
      if (titleSyncing) return;
      const snapshot = controller.store.getSnapshot();
      const value = snapshot.value;
      if (snapshot.phase !== Phase.ready || !value || value.enabled === false) return;
      if (!value.workspaceId) return;
      const workspaces = workspaceService();
      if (typeof workspaces?.rename !== 'function') return;
      const plan = planTitleSync({
        workspaceId: value.workspaceId,
        storedTitle: liveWorkspaceRow(value.workspaceId)?.title ?? value.title,
        localizedTitle: t('name'),
      });
      if (!plan) return;
      const key = `${plan.workspaceId}\u0000${plan.title}`;
      if (key === titleConflict) return;
      titleSyncing = true;
      Promise.resolve(workspaces.rename(plan.workspaceId, plan.title))
        .catch((error) => {
          const message = String(error?.message ?? error);
          // Another group already owns this language's default name: the Host
          // refuses with `workspace/name-conflict`, and there is nothing the
          // plugin can do about it — remember it so the 30s poll does not warn
          // forever. A transient failure stays retryable on the next answer.
          if (message.includes('name-conflict')) titleConflict = key;
          // Cosmetic only: a failed rename must never break the sidebar or the
          // button.
          logger.warn('could not localize the group name:', error);
        })
        .finally(() => {
          titleSyncing = false;
        });
    }

    async function create() {
      const snapshot = controller.store.getSnapshot();
      if (snapshot.busy) return;
      controller.setBusy(true);
      try {
        let plan = planCreate(snapshot, workspaceList());
        if (plan.kind === 'ensure') {
          await controller.ensure();
          plan = planCreate(controller.store.getSnapshot(), workspaceList());
        }
        if (plan.kind !== 'ready') {
          controller.setFlash(t(plan.messageKey ?? messageKeyForCode(plan.code)));
          return;
        }
        ctx.uiWorkspace.startSession(plan.workspaceId);
      } catch (error) {
        logger.warn('could not start a recent task:', error);
        controller.setFlash(t('err.startFailed', { 0: String(error?.message ?? error) }));
      } finally {
        controller.setBusy(false);
      }
    }


    // The group's stored title follows the UI language: on every state answer
    // (which also heals a fresh install created under the other language) and on
    // every locale change. Registered before the first refresh so that answer is
    // already covered.
    ctx.effect(
      () => controller.store.subscribe(syncGroupTitle),
      'dsh-recent-tasks: group title follows the state snapshot',
    );
    ctx.effect(() => {
      if (typeof locale?.subscribe !== 'function') return () => {};
      return locale.subscribe(() => {
        // An explicit language switch is the one moment a name conflict deserves
        // another attempt: the colliding group may have been renamed meanwhile.
        titleConflict = null;
        syncGroupTitle();
      });
    }, 'dsh-recent-tasks: group title follows the language');


    // Initial fetch, then a silent 30s / focus re-sync (§8.5). A background
    // failure never downgrades a usable UI.
    controller.refresh();
    ctx.effect(() => {
      const timer = window.setInterval(() => controller.refresh({ silent: true }), REFRESH_MS);
      const onFocus = () => controller.refresh({ silent: true });
      window.addEventListener('focus', onFocus);
      return () => {
        window.clearInterval(timer);
        window.removeEventListener('focus', onFocus);
      };
    }, 'dsh-recent-tasks: refresh loop');

    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'recent-tasks.new',
      order: 60,
      locale: NS,
      inject: () => ({ controller, create }),
    }, NewRecentTaskButton));

    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'recent-tasks',
      order: 30,
      locale: NS,
      inject: () => ({
        controller,
        form: formFacade,
        pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
      }),
    }, RecentTasksSettingsRow));

    // `configForms` is optional: without the official settings surface the row
    // degrades to a read-only status display instead of disappearing.
    ctx.inject(['configForms'], (scope) => {
      form = scope.configForms.get(SETTINGS_NAMESPACE);
      scope.effect(() => () => {
        form = null;
      }, 'dsh-recent-tasks: live config form');
    });

    // `shortcuts` is optional: a composition without it still gets the button.
    ctx.inject(['shortcuts'], (scope) => {
      let dispose;
      try {
        dispose = scope.shortcuts.register({
          id: 'recentTasks.new',
          label: () => t('new'),
          aliases: ['new recent task', 'new chat without workspace'],
          defaults: SHORTCUT_DEFAULTS,
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => {
            const resolution = shortcutResolution(controller.store.getSnapshot(), t);
            if (resolution.status !== 'handled') return resolution;
            return {
              status: 'handled',
              run: () => {
                create();
              },
            };
          },
        });
      } catch (error) {
        // Duplicate id / reserved or overlapping default: keep the button.
        logger.warn('shortcut registration rejected; use the sidebar button:', error);
      }
      scope.effect(() => () => dispose?.(), 'dsh-recent-tasks: shortcut');
    });
  },
};

export const inject = plugin.inject;
export const apply = plugin.apply;
export default plugin;