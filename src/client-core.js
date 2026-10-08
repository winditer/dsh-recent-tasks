// dsh-recent-tasks — client-side pure logic.
//
// Everything here is DOM-free, React-free and fetch-free: the state machine, the
// path -> workspaceId planning, the shortcut resolution and the one-time guide
// flag. src/client.js wires it to React, `fetch`, timers and the official slot
// and shortcut services; test/client.test.js drives it directly.

import { CODES, messageKeyForCode, normalizeDirPath, resolveWorkspaceId } from './protocol.js';
import { AUTO_TITLES } from './locales.js';

/** Client phases (spec §8.5). */
export const Phase = Object.freeze({
  init: 'init',
  fetching: 'fetching',
  ready: 'ready',
  unavailable: 'unavailable',
});

/** Browser-local marker for the one-time onboarding dot (§8.3). */
export const GUIDE_KEY = 'dsh.recent-tasks.guide.v1';

/** Tiny observable store with a stable snapshot reference between writes. */
export function createSnapshotStore(initial) {
  let snapshot = Object.freeze({ ...initial });
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(patch) {
      const next = Object.freeze({ ...snapshot, ...patch });
      snapshot = next;
      const current = [...listeners];
      for (const listener of current) {
        try {
          listener();
        } catch (error) {
          console.error('[dsh-recent-tasks] store listener failed:', error);
        }
      }
    },
  };
}

/**
 * Read the one-time guide flag.
 *
 * A missing or blocked `localStorage` reads as "seen": an unmemorable hint
 * would otherwise reappear on every single launch.
 */
export function readGuideSeen(storage) {
  if (!storage) return true;
  try {
    return storage.getItem(GUIDE_KEY) === '1';
  } catch {
    return true;
  }
}

/** Persist the one-time guide flag. */
export function writeGuideSeen(storage) {
  try {
    storage?.setItem(GUIDE_KEY, '1');
  } catch {
    /* private mode / storage disabled: the dot is cosmetic, never fatal */
  }
}

/**
 * The failure that stops the action outright, or `null` when it may proceed.
 *
 * Shared by the button, the shortcut and the kick-off plan so all three give the
 * same answer for the same snapshot. `unavailable` is the phase used before the
 * first answer arrives, which is a "wait", not a failure of the host.
 */
export function creationBlock(snapshot) {
  if (!snapshot || snapshot.phase !== Phase.ready) {
    return { code: snapshot?.code ?? CODES.unavailable, messageKey: snapshot?.code ? null : 'state.notReady' };
  }
  const value = snapshot.value;
  if (!value) return { code: CODES.internal, messageKey: null };
  if (value.enabled === false) return { code: CODES.disabled, messageKey: null };
  if (!value.path) return { code: CODES.badConfig, messageKey: null };
  // The group was deleted while auto-repair is off: there is nothing to open,
  // and silently landing the chat in "未分组" would be the exact failure this
  // plugin exists to remove.
  if (!value.workspaceId && value.code === CODES.missingRecord) {
    return { code: CODES.missingRecord, messageKey: null };
  }
  return null;
}

/** Normalize one workspace row from the official client list. */
function workspaceIdOf(row) {
  const id = row?.id ?? row?.workspaceId;
  return id === undefined || id === null ? '' : String(id);
}

/**
 * Decide what the "new recent task" action must do (spec §8.2 `create()`).
 *
 * `snapshot` is the controller snapshot; `workspaces` is any iterable of
 * `{ id|workspaceId, path }` — the official client workspace list, i.e. the
 * authority on which workspace ids the sidebar can actually mount.
 *
 *   ready    -> call uiWorkspace.startSession(workspaceId)
 *   ensure   -> no usable id: run one ensure, then plan again
 *   blocked  -> show the reason and do nothing
 */
export function planCreate(snapshot, workspaces) {
  const block = creationBlock(snapshot);
  if (block) return { kind: 'blocked', code: block.code, ...(block.messageKey ? { messageKey: block.messageKey } : {}) };
  const value = snapshot.value;
  const list = workspaces === undefined || workspaces === null
    ? []
    : (Array.isArray(workspaces) ? workspaces : [...workspaces]);
  const live = list.map(workspaceIdOf).filter(Boolean);

  if (value.workspaceId) {
    const id = String(value.workspaceId);
    // Trust a cached id unless the live list positively contradicts it: an id
    // the sidebar cannot mount would be dropped into "未分组", the very failure
    // this plugin removes. An EMPTY list means the list is not available (or not
    // loaded yet) — never a reason to distrust the id.
    if (live.length === 0) return { kind: 'ready', workspaceId: id };
    if (live.includes(id)) {
      const row = list.find((item) => workspaceIdOf(item) === id);
      const rowPath = typeof row?.path === 'string' ? row.path : '';
      // A mountable id whose row points at a DIFFERENT folder is a stale cache
      // (the settings folder changed moments ago): ensure first, so the chat
      // lands in the right group instead of the previous one.
      if (rowPath && normalizeDirPath(rowPath) !== normalizeDirPath(value.path)) return { kind: 'ensure' };
      // The folder is gone: `ensure` is what recreates it, and opening a chat in
      // a workspace whose folder cannot hold it would strand the session.
      if (value.dirExists === false) return { kind: 'ensure' };
      return { kind: 'ready', workspaceId: id };
    }
    return { kind: 'ensure' };
  }
  const byPath = resolveWorkspaceId(list, value.path);
  if (byPath) return { kind: 'ready', workspaceId: byPath };
  return { kind: 'ensure' };
}

/**
 * The rename that keeps the managed group's STORED title in step with the UI
 * language, or `null` when the stored title must stay exactly as it is.
 *
 * Why this exists at all: the group is a real Workspace record, and both label
 * surfaces (the sidebar row and the workspace switcher menu) render the record's
 * durable `title` verbatim — the official `workspaceDisplayTitle` localizes only
 * the `default-workspace` sentinel, and the `workspace` locale namespace cannot
 * be extended by a plugin. A group created under Chinese therefore stays Chinese
 * under English until the record itself is renamed.
 *
 * The rule is deliberately narrow. A stored title outside `titles` is durable
 * user intent — a sidebar rename, or the operator's own configured `title` — and
 * is never rewritten. Only a title that is still one of the plugin's OWN default
 * names, in either language, follows the active language.
 *
 * @param options.workspaceId - the managed record; `null`/empty means "not ready".
 * @param options.storedTitle - the record's current title (live list first).
 * @param options.localizedTitle - this plugin's name in the active language.
 * @param options.titles - the plugin's own default names (defaults to both).
 * @returns `{ workspaceId, title }` to write, or `null` for "leave it alone".
 */
export function planTitleSync({ workspaceId, storedTitle, localizedTitle, titles = AUTO_TITLES } = {}) {
  if (!workspaceId) return null;
  if (typeof localizedTitle !== 'string' || localizedTitle === '') return null;
  if (!titles.includes(storedTitle)) return null;
  if (storedTitle === localizedTitle) return null;
  return { workspaceId: String(workspaceId), title: localizedTitle };
}

/**
 * Shortcut `resolve()` core: handled while the host is ready, blocked with the
 * localized reason otherwise (spec §8.2 entry 2).
 */
export function shortcutResolution(snapshot, t) {
  const block = creationBlock(snapshot);
  if (!block) return { status: 'handled' };
  const key = block.messageKey ?? messageKeyForCode(block.code);
  return { status: 'blocked', reason: typeof t === 'function' ? t(key) : key };
}

/**
 * Shortcut defaults.
 *
 * The official `session.new` already owns `Mod+N` on Desktop and `Mod+Alt+N` on
 * Web, and `shortcuts.register` throws when two commands overlap on ANY
 * runtime/platform. Desktop therefore takes the design's `Mod+Alt+N`, while Web
 * takes `Mod+Shift+N` (a legal two-modifier Web binding); `web:linux` stays
 * unbound because the Web allow-list rejects it. Any residual conflict throws and
 * is caught below — the sidebar button remains the guaranteed entry.
 */
export const SHORTCUT_DEFAULTS = Object.freeze({
  'desktop:macos': { code: 'KeyN', modifiers: ['primary', 'alt'] },
  'desktop:windows': { code: 'KeyN', modifiers: ['primary', 'alt'] },
  'desktop:linux': { code: 'KeyN', modifiers: ['primary', 'alt'] },
  'web:macos': { code: 'KeyN', modifiers: ['primary', 'shift'] },
  'web:windows': { code: 'KeyN', modifiers: ['primary', 'shift'] },
});

/**
 * The state machine plus every host call the client half needs.
 *
 * @param options.request - `async (method, args) => { ok:true, value } | { ok:false, code, message }`.
 * @param options.logger - console-like sink for unexpected failures.
 */
export function createRecentTasksController({ request, logger = console }) {
  const store = createSnapshotStore({
    phase: Phase.init,
    value: null,
    code: null,
    message: null,
    busy: false,
    flash: null,
    /** Locale key of the "group was recreated" notice, shown once (§8.3). */
    repairNotice: null,
  });
  let stateInflight = null;
  let ensureInflight = null;

  async function call(method, args) {
    try {
      return await request(method, args);
    } catch (error) {
      // The host answers coded failures; a thrown request is a transport fault,
      // which is "cannot reach the service", not an internal plugin bug.
      logger?.warn?.(`dsh-recent-tasks: ${method} failed: ${String(error?.message ?? error)}`);
      return { ok: false, code: CODES.unavailable, message: String(error?.message ?? error) };
    }
  }

  function accept(result, { silent = false } = {}) {
    const current = store.getSnapshot();
    if (result && result.ok) {
      store.set({
        phase: Phase.ready,
        value: result.value,
        code: null,
        message: null,
        repairNotice: result.value?.repaired === true ? 'state.repaired' : current.repairNotice,
        flash: null,
      });
      return result.value;
    }
    const code = (result && result.code) || CODES.internal;
    if (silent && current.value) {
      // A background refresh must not downgrade a usable UI (§8.5).
      store.set({ code, message: result?.message ?? null });
      return current.value;
    }
    store.set({
      phase: Phase.unavailable,
      code,
      message: (result && result.message) || null,
      value: current.value,
    });
    return null;
  }

  /**
   * Silent-capable `state` fetch; single-flight. Resolves to the resulting
   * snapshot (never a bare value), so callers can re-plan without re-reading.
   */
  function refresh({ silent = false } = {}) {
    if (stateInflight) return stateInflight;
    const current = store.getSnapshot();
    if (!silent || !current.value) {
      store.set({ phase: current.value ? current.phase : Phase.fetching });
    }
    stateInflight = (async () => {
      accept(await call('state'), { silent });
      return store.getSnapshot();
    })()
      .finally(() => {
        stateInflight = null;
      });
    return stateInflight;
  }

  /** `ensure`; single-flight so parallel button clicks / tabs rebuild once. */
  function ensure() {
    if (ensureInflight) return ensureInflight;
    ensureInflight = (async () => {
      accept(await call('ensure'));
      return store.getSnapshot();
    })()
      .finally(() => {
        ensureInflight = null;
      });
    return ensureInflight;
  }

  function setFlash(text) {
    store.set({ flash: text });
  }

  function dismissRepairNotice() {
    store.set({ repairNotice: null });
  }

  function setBusy(busy) {
    store.set({ busy });
  }

  return { store, refresh, ensure, setFlash, dismissRepairNotice, setBusy };
}