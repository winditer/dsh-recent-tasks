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
