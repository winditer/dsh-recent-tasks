// The BUILT client artifact: the contract with DSH's web-module loader.
//
// The loader is unforgiving, and every one of these rules has bitten a real
// plugin — so each one gets an assertion against the artifact that actually
// ships, not against the sources:
//
//   1. one top-level `window.__ModuleLoader__.load({ id, factory })` call;
//   2. `id` exactly the package name (only a `/client` suffix is normalized);
//   3. classic script: no ESM syntax anywhere, because it is evaluated as a
//      plain <script>;
//   4. `require` only for platform seed words (react, …) and other plugin
//      packages — local modules MUST be inlined, or the factory throws at load;
//   5. no side effects at script scope (styles/effects are installed in `apply`,
//      and every style tag carries the `data-plugin` markers HMR evicts by);
//   6. `apply(ctx)` registers both slots, the shortcut, and both locales, and
//      survives a ctx that is missing every optional service.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALLOWED_EXTERNALS, buildClientBundle } from '../scripts/build.mjs';
import { ADAPTER } from '../src/client-core.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

// Built once for the whole file: the assertions below all inspect this text.
const bundle = await buildClientBundle();

/** A minimal DOM good enough for `apply` (a style tag and a timer sink). */
function fakeDom() {
  const tags = [];
  const document = {
    head: {
      appendChild(tag) {
        tags.push(tag);
      },
    },
    querySelector: () => null,
    createElement: () => ({
      dataset: {},
      textContent: '',
      remove() {
        this.removed = true;
      },
    }),
  };
  return { document, tags };
}

/** Minimal React: enough for the JSX factory and the hooks `apply` reaches. */
function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: Symbol('Fragment'),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  };
}

/**
 * Evaluate the built bundle the way the loader does: a classic script that calls
 * `window.__ModuleLoader__.load`, then the factory with a `require` that only
 * knows the platform seed words.
 *
 * `fetch` is injectable so a test can feed the host's `state` answer; the default
 * has no network at all, which is what the loader-tolerance tests want.
 */
function evaluate(code, { fetch = () => Promise.reject(new Error('no network')) } = {}) {
  const { document, tags } = fakeDom();
  let registration = null;
  const window = {
    __ModuleLoader__: {
      load(entry) {
        registration = entry;
      },
    },
    localStorage: null,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: (fn) => {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const requested = [];
  const intervals = [];
  const require = (specifier) => {
    requested.push(specifier);
    assert.equal(
      ALLOWED_EXTERNALS.includes(specifier),
      true,
      `factory required a specifier the browser module table cannot resolve: ${specifier}`,
    );
    if (specifier === 'react') return fakeReact();
    throw new Error(`unexpected external: ${specifier}`);
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'fetch', 'console', code)(window, document, fetch, {
    warn() {},
    error() {},
    log() {},
  });
  assert.notEqual(registration, null, 'the script must register with __ModuleLoader__');
  return { registration, exports: registration.factory(require), tags, requested, intervals };
}

test('the artifact is one loader registration with the exact package name', () => {
  assert.equal(typeof bundle, 'string');
  assert.equal(bundle.trimStart().startsWith('window.__ModuleLoader__.load('), true);
  const { registration } = evaluate(bundle);
  assert.equal(registration.id, pkg.name);
  assert.equal(typeof registration.factory, 'function');
  // The loader matches factories by the package name; a `/client` variant is the
  // only suffix it normalizes, and we must not rely on it.
  assert.match(registration.id, /^[a-z0-9][a-z0-9-]*$/);
});

test('the factory inlines every local module and stays a classic script', () => {
  // No ESM syntax: a single stray `export` makes the whole script a syntax error.
  assert.equal(/^\s*(export|import)\s/m.test(bundle), false, 'no ESM statements may survive bundling');
  // Only relative/local specifiers are forbidden — a bare specifier for another
  // plugin package is legal, and every one of them must be in the allow-list.
  const requires = [...bundle.matchAll(/require\((["'])([^"']+)\1\)/g)].map((match) => match[2]);
  assert.notEqual(requires.length, 0, 'the bundle must still require react');
  for (const specifier of new Set(requires)) {
    // A relative path here would throw at load time: the loader resolves only
    // package names, never plugin-internal files.
    assert.equal(specifier.startsWith('.'), false, `local module left unbundled: ${specifier}`);
    assert.equal(specifier.startsWith('/'), false, `absolute path left unbundled: ${specifier}`);
    assert.equal(ALLOWED_EXTERNALS.includes(specifier), true, `not a resolvable specifier: ${specifier}`);
  }
  assert.deepEqual([...new Set(requires)], ['react'], 'react is the only runtime dependency');
});

test('the script has no side effects outside apply', () => {
  // Loading the factory must not touch the DOM: the loader evicts plugins by
  // removing what `apply` registered, and a script-scope tag would leak forever.
  const { tags, exports } = evaluate(bundle);
  assert.equal(tags.length, 0, 'no style may be installed at script scope');
  assert.equal(typeof exports.apply, 'function');
  // `inject` must be the client-side service list (the manifest's `dsh.client.inject`
  // is a PACKAGE graph, a different thing entirely). `workspaces` is requested so
  // the group name can follow the language; the button path needs no other service.
  assert.deepEqual([...exports.inject].sort(), ['locale', 'slots', 'uiWorkspace', 'workspaces']);
});

test('apply registers both slots, the shortcut and the locales, and tolerates absence', () => {
  const { exports, tags } = evaluate(bundle);

  const registrations = [];
  const effects = [];
  const listeners = [];
  const locales = new Map();
  const shortcuts = [];
  const childCalls = [];
  const fakeCtx = {
    logger: { warn() {} },
    effect(fn, label) {
      effects.push(label);
      const dispose = fn();
      if (typeof dispose === 'function') effects.push(dispose);
    },
    on(event, listener) {
      listeners.push([event, listener]);
    },
    get(name) {
      if (name === 'workspaces') return undefined;
      return undefined;
    },
    inject(names, callback) {
      childCalls.push(names.join(','));
      // Deliberately NOT available: configForms/shortcuts/webServer. The client
      // half must keep working (button + settings row) without them.
      if (names.includes('configForms') || names.includes('shortcuts') || names.includes('workspaces')) return undefined;
      callback(fakeCtx);
    },
    locale: {
      bind: (ns) => (key) => `${ns}:${key}`,
      register(ns, dict) {
        assert.equal(locales.has(`${ns}:${Object.keys(dict)[0]}`), false, 'duplicate locale registration');
        locales.set(ns, dict);
      },
    },
    slots: {
      inject(key, callback) {
        callback();
      },
      register(spec, component) {
        registrations.push({ spec, component });
        return () => {};
      },
    },
    uiWorkspace: {
      startSession() {},
      pickDirectory: async () => null,
    },
  };

  exports.apply(fakeCtx);

  assert.deepEqual(effects.filter((entry) => typeof entry === 'string'), expectLabels());
  assert.deepEqual(
    registrations.map((entry) => [entry.spec.name, entry.spec.id]).sort(),
    [['settings.general.item', 'recent-tasks'], ['sidebar.footer.action', 'recent-tasks.new']],
  );
  // The settings row must be reachable from the general settings page, and the
  // button must be a list item rooted at the sidebar bottom.
  const settings = registrations.find((entry) => entry.spec.name === 'settings.general.item');
  const button = registrations.find((entry) => entry.spec.name === 'sidebar.footer.action');
  assert.equal(typeof settings.component, 'function');
  assert.equal(typeof button.component, 'function');
  assert.equal(typeof button.spec.inject, 'function');
  const face = button.spec.inject();
  assert.equal(typeof face.create, 'function');
  assert.equal(typeof face.controller.refresh, 'function');
  const settingsFace = settings.spec.inject();
  assert.equal(typeof settingsFace.pickDirectory, 'function');
  assert.equal(typeof settingsFace.form.set, 'function', 'the settings row writes through the official form facade');

  // The locale namespace is registered once, with BOTH dictionaries in one call
  // (`register(ns, { zh, en })` throws on a second call for the same pair).
  assert.deepEqual([...locales.keys()], ['recentTasks']);
  assert.deepEqual(Object.keys(locales.get('recentTasks')).sort(), ['en', 'zh']);

  // The optional services are requested through inject() so the plugin still
  // loads in a composition that has none of them.
  assert.deepEqual([...new Set(childCalls)].sort(), ['configForms', 'shortcuts']);

  // Styles were installed in apply, tagged for HMR eviction.
  assert.equal(tags.length, 1);
  assert.equal(tags[0].dataset.plugin, 'dsh-recent-tasks');
  assert.equal(tags[0].dataset.pluginCss, 'dsh-recent-tasks');

  // No shortcut service: registration is skipped, the button remains.
  assert.deepEqual(shortcuts, []);
  // No global listener side effects beyond the refresh loop's cleanup.
  assert.deepEqual(listeners, []);
});

/** The effect labels `apply` must register, in order. */
function expectLabels() {
  return [
    'dsh-recent-tasks: dictionaries',
    'dsh-recent-tasks: styles',
    'dsh-recent-tasks: sidebar section adapter',
    'dsh-recent-tasks: group title follows the state snapshot',
    'dsh-recent-tasks: group title follows the language',
    'dsh-recent-tasks: refresh loop',
  ];
}

// --------------------------------------------------------------------------
// the stored group title follows the UI language (both label surfaces render it)
// --------------------------------------------------------------------------

const GROUP_ID = 'w-recent';
const GROUP_PATH = '/Users/haifeng/Documents/DSH 最近任务';

/** Let the controller's fetch -> state -> store -> rename chain settle. */
async function flush() {
  for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * An `apply` harness with the official workspace service and a real zh/en locale
 * fake: `t('name')` resolves through the dictionaries the plugin registers, so
 * the test sees the same strings a user sees.
 */
function languageHarness({ language = 'en', storedTitle = '最近任务', renameFails = false } = {}) {
  const rows = [{ workspaceId: GROUP_ID, path: GROUP_PATH, title: storedTitle }];
  const renames = [];
  const dictionaries = new Map();
  const localeListeners = new Set();
  const state = { active: language };

  const workspaces = {
    list: { getSnapshot: () => ({ items: rows }) },
    rename: async (workspaceId, title) => {
      // Every ATTEMPT lands here, so a test can assert how often the plugin tried.
      renames.push([workspaceId, title]);
      if (renameFails) {
        throw new Error('workspace rename failed: workspace/name-conflict: Workspace name is already in use');
      }
      rows[0].title = title;
      return { workspaceId, title };
    },
  };

  const fakeCtx = {
    logger: { warn() {} },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') dispose;
    },
    on() {},
    get: (name) => (name === 'workspaces' ? workspaces : undefined),
    inject: () => undefined,
    locale: {
      bind: (ns) => (key) => dictionaries.get(ns)?.[state.active]?.[key] ?? key,
      register(ns, dict) {
        dictionaries.set(ns, dict);
      },
      subscribe(fn) {
        localeListeners.add(fn);
        return () => localeListeners.delete(fn);
      },
    },
    slots: { inject: (key, callback) => callback(), register: () => () => {} },
    uiWorkspace: { startSession() {}, pickDirectory: async () => null },
  };

  const fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      value: { path: GROUP_PATH, title: rows[0].title, workspaceId: GROUP_ID },
    }),
  });

  const { exports, intervals } = evaluate(bundle, { fetch });
  exports.apply(fakeCtx);

  return {
    rows,
    renames,
    /** Switch the active language the way the official selector does. */
    switchTo(next) {
      state.active = next;
      for (const listener of [...localeListeners]) listener();
    },
    /** Fire the plugin's 30s background re-sync, then let it settle. */
    async poll() {
      for (const tick of intervals) tick();
      await flush();
    },
  };
}

test('the managed group title follows the language while it is still a plugin default', async () => {
  const harness = languageHarness({ language: 'en', storedTitle: '最近任务' });

  // The reported bug: a group created under Chinese, read under English. Both the
  // sidebar row and the workspace switcher render this stored title, so the first
  // state answer must rewrite it through the official rename.
  await flush();
  assert.deepEqual(harness.renames, [[GROUP_ID, 'Recent tasks']]);

  // Idempotent: the next state answer (30s poll / focus) has nothing to write.
  harness.switchTo('en');
  await flush();
  assert.deepEqual(harness.renames, [[GROUP_ID, 'Recent tasks']]);

  // Switching back is symmetric.
  harness.switchTo('zh');
  await flush();
  assert.deepEqual(harness.renames, [
    [GROUP_ID, 'Recent tasks'],
    [GROUP_ID, '最近任务'],
  ]);

  // A sidebar rename is durable user intent: from then on the plugin never
  // touches the title again, in either language.
  harness.rows[0].title = 'Inbox';
  harness.switchTo('en');
  await flush();
  harness.switchTo('zh');
  await flush();
  assert.deepEqual(harness.renames, [
    [GROUP_ID, 'Recent tasks'],
    [GROUP_ID, '最近任务'],
  ]);
});

test('a name conflict is attempted once, then only on an explicit language switch', async () => {
  // Another group already owns the target name: the Host answers
  // `workspace/name-conflict`, and the plugin must neither break the sidebar nor
  // warn on every 30s poll for the rest of the session.
  const harness = languageHarness({ language: 'en', storedTitle: '最近任务', renameFails: true });

  await flush();
  assert.deepEqual(harness.renames, [[GROUP_ID, 'Recent tasks']], 'the first attempt still happens');

  await harness.poll();
  assert.equal(harness.renames.length, 1, 'the background poll must not hammer the Host');

  // zh is a no-op (the stored title is already that language), and picking en
  // again is the explicit retry.
  harness.switchTo('zh');
  await flush();
  assert.equal(harness.renames.length, 1);
  harness.switchTo('en');
  await flush();
  assert.deepEqual(harness.renames, [
    [GROUP_ID, 'Recent tasks'],
    [GROUP_ID, 'Recent tasks'],
  ]);
});

test('apply registers the shortcut with non-conflicting defaults when available', () => {
  const { exports } = evaluate(bundle);
  const registered = [];
  const fakeCtx = {
    logger: { warn() {} },
    effect(fn) {
      fn();
    },
    on() {},
    get: () => undefined,
    inject(names, callback) {
      if (names.includes('shortcuts')) {
        callback({
          shortcuts: {
            register(command) {
              registered.push(command);
              return () => {};
            },
          },
          effect() {},
        });
        return;
      }
      if (names.includes('configForms')) return undefined;
      callback(fakeCtx);
    },
    locale: { bind: () => (key) => key, register() {} },
    slots: { inject: (key, callback) => callback(), register: () => () => {} },
    uiWorkspace: { startSession() {}, pickDirectory: async () => null },
  };
  exports.apply(fakeCtx);
  assert.equal(registered.length, 1);
  const command = registered[0];
  assert.equal(command.id, 'recentTasks.new');
  assert.equal(typeof command.resolve, 'function');
  assert.deepEqual([...command.regions].sort(), ['editable', 'page']);
  // Before the first host answer the shortcut is blocked with the localized
  // "not ready yet" copy rather than silently doing nothing.
  const blocked = command.resolve();
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'state.notReady');
  assert.equal(command.defaults['web:linux'], undefined);
  assert.equal(command.defaults['desktop:macos'].code, 'KeyN');
});

test('the artifact styles the promoted section without naming an official class', () => {
  // Whole `selector{declaration}` rules, not just selectors: swapping the two
  // `nth-child` declarations, or the insets, leaves a selector-only check green
  // while the browser renders the folder icon and hides the chevron, or puts a
  // child block's chats deeper than its own title.
  //
  // The alignment numbers are the owner's columns, all measured from the sidebar
  // root's left edge (verified in a browser against the shipped CSS): the global
  // panel rows above the section give a 10px inset and an 8px gap around a 16px
  // glyph — root padding 12px + 2px margin + 8px padding = the GLYPH column at
  // 22px; + a 16px glyph + an 8px gap = the TITLE column at 46px. So: the header
  // inset is 10px (34px when there is no toggle to stand in the glyph column), the
  // promoted row repeats 10px + 8px, a child group takes 34px (= 46 − 12, folder
  // glyph on the title column), its sessions 36px (= 68 − 12 − 16 − 4, a name on
  // that group's own title), this block's sessions 14px (= 46 − 12 − 16 − 4, a name
  // on 46px, the owner's rule 3), and the "expand the rest" row lands on the same
  // column as the names it follows.
  for (const rule of [
    '[data-dsh-rt-header="toggle"][data-dsh-rt-header="toggle"]{padding-left:10px;gap:8px}',
    '[data-dsh-rt-header="plain"][data-dsh-rt-header="plain"]{padding-left:34px}',
    '[data-dsh-rt-row][data-dsh-rt-row]{padding-inline-start:10px;gap:8px;height:36px;color:var(--dsw-alias-label-tertiary,#8f959e)}',
    '[data-dsh-rt-row][data-dsh-rt-row]>span:nth-child(1){display:none}',
    '[data-dsh-rt-row][data-dsh-rt-row]>span:nth-child(2){display:inline-flex}',
    '[data-dsh-rt-block][data-dsh-rt-block][data-dsh-rt-block]{margin-top:0}',
    '[data-row-key^="workspace:"][data-row-key^="workspace:"]:not([data-dsh-rt-row]){padding-inline-start:calc(34px + var(--dsh-workspace-indent,0px))}',
    '[data-row-key^="session:"][data-row-key^="session:"]:not([data-dsh-rt-sub]){padding-inline-start:calc(36px + var(--dsh-workspace-indent,0px))}',
    '[data-row-key^="overflow:"][data-row-key^="overflow:"]:not([data-dsh-rt-overflow]){padding-left:calc(56px + var(--dsh-workspace-indent,0px))}',
    '[data-dsh-rt-sub][data-dsh-rt-sub]{padding-inline-start:calc(14px + var(--dsh-workspace-indent,0px))}',
    '[data-dsh-rt-overflow][data-dsh-rt-overflow]{padding-left:calc(34px + var(--dsh-workspace-indent,0px))}',
    // The hide rule is only safe with BOTH halves: the `:has()` gate keeps it from
    // hiding the whole list, and the `>div:not(...)` part keeps it from hiding the
    // promoted block itself.
    'html.dsh-recent-tasks-workspaces-collapsed [data-dsh-rt-list][data-dsh-rt-list]:has([data-dsh-rt-block])>div:not([data-dsh-rt-block]){display:none}',
  ]) {
    assert.equal(bundle.includes(rule), true, `the artifact is missing ${rule}`);
  }
  // The toggle's BOX is what stands in the glyph column — 16px, the size of the
  // official icon slot — with the 10px triangle centred inside it, so it lines up
  // with the panel icons above and the official chevron in the row below.
  assert.match(bundle, /\.dsh-recent-tasks-collapse\{[^}]*box-sizing:border-box;width:16px;height:16px/,
    'the toggle box must be 16px, the official icon-slot size');
  assert.equal(bundle.includes('.dsh-recent-tasks-collapse{'), true);
  assert.equal(bundle.includes('!important'), false, 'specificity, not !important');
});

test('the stylesheet selects exactly the attributes the adapter stamps', () => {
  // A rename in ADAPTER would otherwise leave the stylesheet selecting nothing:
  // the feature would die silently while every other test stayed green.
  const source = readFileSync(resolve(ROOT, 'src/client.js'), 'utf8');
  for (const attr of [
    ADAPTER.rowAttr,
    ADAPTER.blockAttr,
    ADAPTER.listAttr,
    ADAPTER.subAttr,
    ADAPTER.overflowAttr,
  ]) {
    assert.equal(source.includes(`${attr}][${attr}]`), true, `the stylesheet misses ${attr}`);
    assert.equal(bundle.includes(`${attr}][${attr}]`), true, `the artifact misses ${attr}`);
  }
  // The header's attribute carries a mode, so its selectors are the value form.
  for (const value of [ADAPTER.headerToggleValue, ADAPTER.headerPlainValue]) {
    const form = `${ADAPTER.headerAttr}="${value}"][${ADAPTER.headerAttr}="${value}"`;
    assert.equal(source.includes(form), true, `the stylesheet misses ${form}`);
    assert.equal(bundle.includes(form), true, `the artifact misses ${form}`);
  }
  assert.equal(source.includes(ADAPTER.collapsedHtmlClass), true);
  assert.equal(bundle.includes(ADAPTER.collapsedHtmlClass), true);
  assert.equal(bundle.includes(ADAPTER.collapseButtonClass), true);
});

test('no official class hash is hard-coded anywhere', () => {
  // These prefixes changed between 0.2.0-rc.1 and 0.2.1-rc.2; a plugin that
  // pinned one would break on the next DSH update.
  const hashes = ['_7514NG_', 'jJkEga_', '_3WPZCG_', 'tztITa_', 'F6DNpa_', 'yuWXda_'];
  const sources = [
    'src/client.js',
    'src/client-adapter.js',
    'src/client-core.js',
    'src/locales.js',
    'src/host.js',
    'src/protocol.js',
  ].map((file) => readFileSync(resolve(ROOT, file), 'utf8'));
  for (const hash of hashes) {
    assert.equal(bundle.includes(hash), false, `the artifact names the official class ${hash}`);
    for (const source of sources) {
      assert.equal(source.includes(hash), false, `a source file names the official class ${hash}`);
    }
  }
});
