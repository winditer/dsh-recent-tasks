// Client half: the pure logic behind the button and the settings row.
//
// Everything here runs in plain Node. `client.js` itself (JSX, React, the slot
// registrations) is exercised by `bundle.test.js` against the BUILT artifact —
// this file covers the decisions that must not depend on React or the DOM.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GUIDE_KEY,
  Phase,
  SHORTCUT_DEFAULTS,
  createRecentTasksController,
  createSnapshotStore,
  planCreate,
  planTitleSync,
  readGuideSeen,
  shortcutResolution,
  writeGuideSeen,
} from '../src/client-core.js';
import { CODES, CODE_MESSAGE_KEYS, messageKeyForCode, readStateResponse } from '../src/protocol.js';
import { AUTO_TITLES, GROUP_TITLES, NS, en, isAutoTitle, zh } from '../src/locales.js';
import { DEFAULTS } from '../src/host.js';

const GROUP = 'w-recent';
const PATH = '/Users/haifeng/Documents/DSH 最近任务';

/** A snapshot in the shape the host's `state` returns. */
function snapshot(overrides = {}) {
  return {
    ok: true,
    value: {
      enabled: true,
      path: PATH,
      title: '最近任务',
      workspaceId: GROUP,
      dirExists: true,
      createdAt: '2026-09-29T00:00:00.000Z',
      pinLast: true,
      autoRepair: true,
      repaired: false,
      reusedExisting: false,
      nestedUnder: null,
      code: null,
      ...overrides,
    },
  };
}

/** A workspace list in the shape the client's `workspaces` service exposes. */
function workspaces(items) {
  return items.map((item) => ({ id: item.id, path: item.path, title: item.title ?? '' }));
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

// --------------------------------------------------------------------------
// planCreate (§8.2 state machine)
// --------------------------------------------------------------------------

test('planCreate creates through the recorded group only when the folder is there', () => {
  const plan = planCreate({ phase: Phase.ready, value: snapshot().value }, workspaces([{ id: GROUP, path: PATH }]));
  assert.deepEqual(plan, { kind: 'ready', workspaceId: GROUP });

  // The record exists but its folder vanished: startSession would fail blind, so
  // this is an ensure (which recreates the folder), not a create.
  const noDir = planCreate({ phase: Phase.ready, value: snapshot({ dirExists: false }).value }, workspaces([{ id: GROUP, path: PATH }]));
  assert.equal(noDir.kind, 'ensure');
});

test('planCreate ensures whenever the live workspace list disagrees with the snapshot', () => {
  // No record at all yet.
  assert.equal(planCreate({ phase: Phase.ready, value: snapshot({ workspaceId: null }).value }, []).kind, 'ensure');
  // The record was deleted or replaced behind our back: the id is not live.
  assert.equal(planCreate({ phase: Phase.ready, value: snapshot().value }, workspaces([{ id: 'other', path: '/tmp' }])).kind, 'ensure');
  // The same id, still on the configured folder: nothing to do.
  assert.deepEqual(
    planCreate({ phase: Phase.ready, value: snapshot().value }, workspaces([{ id: GROUP, path: PATH }])),
    { kind: 'ready', workspaceId: GROUP },
  );
  // A nested group is a DIFFERENT row, so this id no longer owns the folder.
  assert.equal(
    planCreate({ phase: Phase.ready, value: snapshot().value }, workspaces([{ id: 'nested', path: `${PATH}/sub` }])).kind,
    'ensure',
  );
});

test('planCreate reports a reason instead of acting while not ready', () => {
  // Before the first answer: a wait with a "not ready yet" message, not a scare.
  assert.deepEqual(planCreate({ phase: Phase.init }, []), { kind: 'blocked', code: CODES.unavailable, messageKey: 'state.notReady' });
  assert.deepEqual(planCreate({ phase: Phase.fetching }, []), { kind: 'blocked', code: CODES.unavailable, messageKey: 'state.notReady' });

  const unavailable = planCreate({ phase: Phase.unavailable, code: CODES.unavailable }, []);
  assert.equal(unavailable.kind, 'blocked');
  assert.equal(unavailable.code, CODES.unavailable);

  const disabled = planCreate({ phase: Phase.ready, value: snapshot({ enabled: false }).value }, []);
  assert.equal(disabled.kind, 'blocked');
  assert.equal(disabled.code, CODES.disabled);

  const missing = planCreate({ phase: Phase.ready, value: snapshot({ workspaceId: null, code: CODES.missingRecord }).value }, []);
  assert.equal(missing.kind, 'blocked', 'auto-repair off: the user must be told, not routed to a phantom group');
  assert.equal(missing.code, CODES.missingRecord);

  const bad = planCreate({ phase: Phase.ready, value: snapshot({ path: '' }).value }, []);
  assert.equal(bad.kind, 'blocked');
  assert.equal(bad.code, CODES.badConfig);

  // An id we no longer hold is recoverable from the live list by path — no host
  // round trip needed.
  const gone = planCreate({ phase: Phase.ready, value: snapshot({ workspaceId: null }).value }, workspaces([{ id: GROUP, path: PATH }]));
  assert.deepEqual(gone, { kind: 'ready', workspaceId: GROUP });

  // Nothing live at that path either: one ensure, then plan again.
  const nothing = planCreate({ phase: Phase.ready, value: snapshot({ workspaceId: null }).value }, workspaces([{ id: 'other', path: '/tmp' }]));
  assert.equal(nothing.kind, 'ensure');
});

test('planCreate never routes into a live group that owns a different folder', () => {
  // Same id, different path: the cache is stale, so ensure before opening.
  const moved = planCreate({ phase: Phase.ready, value: snapshot().value }, workspaces([{ id: GROUP, path: '/somewhere/else' }]));
  assert.equal(moved.kind, 'ensure');

  // A row without a usable path cannot contradict the id.
  const pathless = planCreate({ phase: Phase.ready, value: snapshot().value }, [{ id: GROUP }]);
  assert.deepEqual(pathless, { kind: 'ready', workspaceId: GROUP });

  // ...and an unavailable list never blocks a valid id.
  const offline = planCreate({ phase: Phase.ready, value: snapshot().value }, []);
  assert.deepEqual(offline, { kind: 'ready', workspaceId: GROUP });
});

// --------------------------------------------------------------------------
// store + controller
// --------------------------------------------------------------------------

test('createSnapshotStore publishes a new frozen snapshot and unsubscribes cleanly', () => {
  const store = createSnapshotStore();
  const seen = [];
  const off = store.subscribe(() => seen.push(store.getSnapshot()));
  store.set({ phase: Phase.fetching });
  store.set({ phase: Phase.ready, value: snapshot().value });
  off();
  store.set({ phase: Phase.unavailable, code: CODES.unavailable });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].phase, Phase.ready);
  assert.equal(store.getSnapshot().phase, Phase.unavailable);
  assert.equal(Object.isFrozen(seen[1]), true);
  // Re-setting an identical phase/value still notifies (the host may have
  // repaired something the caller must re-read).
  const before = store.getSnapshot();
  store.set({ phase: Phase.unavailable, code: CODES.unavailable });
  assert.notEqual(store.getSnapshot(), before, 'a fresh object each time, never a mutated one');
});

test('refresh maps host answers onto phases and never downgrades silently', async () => {
  const calls = [];
  const controller = createRecentTasksController({
    request: async (method, args) => {
      calls.push([method, args]);
      return snapshot();
    },
    logger: { warn() {} },
  });

  await controller.refresh();
  assert.deepEqual(calls, [['state', undefined]]);
  assert.equal(controller.store.getSnapshot().phase, Phase.ready);
  assert.equal(controller.store.getSnapshot().value.workspaceId, GROUP);
  assert.equal((await controller.refresh({ silent: true })).phase, Phase.ready, 'refresh resolves to the snapshot');

  // A late failure must not blank a usable row...
  let answer = async () => snapshot();
  const failing = createRecentTasksController({
    request: (method, args) => answer(method, args),
    logger: { warn() {} },
  });
  await failing.refresh();
  answer = async () => ({ ok: false, code: CODES.internal });
  await failing.refresh({ silent: true });
  assert.equal(failing.store.getSnapshot().phase, Phase.ready, 'silent failure keeps the last good value');

  // ...but a non-silent one surfaces the reason.
  await failing.refresh();
  assert.equal(failing.store.getSnapshot().phase, Phase.unavailable);
  assert.equal(failing.store.getSnapshot().code, CODES.internal);
});

test('ensure is single-flight and reports the host code when it refuses', async () => {
  let inFlight = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const controller = createRecentTasksController({
    request: async (method) => {
      assert.equal(method, 'ensure');
      inFlight += 1;
      await gate;
      return snapshot();
    },
    logger: { warn() {} },
  });
  const first = controller.ensure();
  const second = controller.ensure();
  assert.equal(inFlight, 1, 'a double click must not race the host');
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.phase, Phase.ready);
  assert.equal(a, b, 'both callers observe the same snapshot object');
  assert.equal(inFlight, 1);

  const refusing = createRecentTasksController({
    request: async () => ({ ok: false, code: CODES.dirNotWritable, message: 'nope' }),
    logger: { warn() {} },
  });
  const refused = await refusing.ensure();
  assert.equal(refused.phase, Phase.unavailable);
  assert.equal(refused.code, CODES.dirNotWritable);
});

test('a transport failure is reported with a code the locale can explain', async () => {
  const controller = createRecentTasksController({
    request: async () => {
      throw new Error('boom');
    },
    logger: { warn() {} },
  });
  const state = await controller.refresh();
  assert.equal(state.phase, Phase.unavailable);
  assert.equal(state.code, CODES.unavailable);
});

// --------------------------------------------------------------------------
// guide flag
// --------------------------------------------------------------------------

test('the guide flag is per-browser, forgiving, and never throws', () => {
  const storage = fakeStorage();
  assert.equal(readGuideSeen(storage), false);
  writeGuideSeen(storage);
  assert.equal(readGuideSeen(storage), true);
  assert.equal(storage.map.get(GUIDE_KEY), '1');

  // Private mode / partitioned storage: an unmemorable hint reads as already
  // seen (otherwise the dot would reappear on every launch) and writes are safe.
  const hostile = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(readGuideSeen(hostile), true);
  assert.equal(readGuideSeen(null), true);
  assert.doesNotThrow(() => writeGuideSeen(hostile));
  assert.doesNotThrow(() => writeGuideSeen(undefined));
});

// --------------------------------------------------------------------------
// shortcut resolution
// --------------------------------------------------------------------------

test('shortcutResolution only handles a usable snapshot', () => {
  const t = (key) => key;
  assert.deepEqual(shortcutResolution({ phase: Phase.ready, value: snapshot().value }, t), { status: 'handled' });

  const blocked = shortcutResolution({ phase: Phase.fetching }, t);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'state.notReady');

  const disabled = shortcutResolution({ phase: Phase.ready, value: snapshot({ enabled: false }).value }, t);
  assert.equal(disabled.status, 'blocked');
  assert.equal(disabled.reason, 'state.disabled');

  const missing = shortcutResolution({ phase: Phase.ready, value: snapshot({ workspaceId: null, code: CODES.missingRecord }).value }, t);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.reason, 'state.missingRecord');
  // The not-ready case carries its own copy instead of the generic failure.
  assert.equal(shortcutResolution({ phase: Phase.init }, t).reason, 'state.notReady');
});

test('shortcut defaults never collide with the official session.new binding', () => {
  const official = {
    'desktop:macos': { code: 'KeyN', modifiers: ['primary'] },
    'desktop:windows': { code: 'KeyN', modifiers: ['primary'] },
    'desktop:linux': { code: 'KeyN', modifiers: ['primary'] },
    'web:macos': { code: 'KeyN', modifiers: ['primary', 'alt'] },
    'web:windows': { code: 'KeyN', modifiers: ['primary', 'alt'] },
  };
  for (const [platform, binding] of Object.entries(SHORTCUT_DEFAULTS)) {
    const clash = official[platform];
    assert.equal(
      binding.code === clash.code && binding.modifiers.join('+') === clash.modifiers.join('+'),
      false,
      `${platform} must not shadow session.new`,
    );
    // Web bindings must satisfy the allow-list: exactly two modifiers, one of
    // which is `primary`, with alt or shift as the other.
    if (platform.startsWith('web:')) {
      const set = new Set(binding.modifiers);
      assert.equal(set.size, 2, `${platform} must use two modifiers`);
      assert.equal(set.has('primary'), true, `${platform} must use the primary modifier`);
      assert.equal(set.has('alt') || set.has('shift'), true, `${platform} needs alt or shift`);
    }
  }
  assert.equal(SHORTCUT_DEFAULTS['web:linux'], undefined, 'web/linux has no collision-free 2-modifier binding');
  assert.equal(SHORTCUT_DEFAULTS['desktop:macos'].code, 'KeyN');
  assert.equal(SHORTCUT_DEFAULTS['desktop:macos'].modifiers.join('+'), 'primary+alt');
});

// --------------------------------------------------------------------------
// locale + config defaults parity
// --------------------------------------------------------------------------

test('zh and en expose exactly the same keys', () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, zhKeys);
  for (const key of zhKeys) {
    assert.equal(typeof zh[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zh[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
    // Interpolation placeholders must match across locales, or one language
    // silently renders a literal {0}.
    const placeholders = (text) => (text.match(/\{\d+\}/g) ?? []).sort().join(',');
    assert.equal(placeholders(en[key]), placeholders(zh[key]), `placeholder mismatch in '${key}'`);
  }
  assert.equal(NS, 'recentTasks');
});

// --------------------------------------------------------------------------
// stored group title follows the UI language
// --------------------------------------------------------------------------

test('AUTO_TITLES is exactly the plugin name in every shipped language', () => {
  // Drift guard: the reconciliation may only rewrite titles it recognizes as its
  // OWN defaults, so the set must be derived from the dictionaries, not guessed.
  assert.deepEqual([...AUTO_TITLES].sort(), [zh.name, en.name].sort());
  assert.equal(GROUP_TITLES.zh, zh.name);
  assert.equal(GROUP_TITLES.en, en.name);
  assert.equal(isAutoTitle(zh.name), true);
  assert.equal(isAutoTitle(en.name), true);
  assert.equal(isAutoTitle('Inbox'), false);
  assert.equal(isAutoTitle(undefined), false);
  assert.equal(isAutoTitle(''), false);
});

test('planTitleSync only rewrites a title that is still a plugin default', () => {
  const zhTitle = zh.name;
  const enTitle = en.name;

  // The two real fixes: an untouched Chinese group under English, and back.
  assert.deepEqual(
    planTitleSync({ workspaceId: GROUP, storedTitle: zhTitle, localizedTitle: enTitle }),
    { workspaceId: GROUP, title: enTitle },
  );
  assert.deepEqual(
    planTitleSync({ workspaceId: GROUP, storedTitle: enTitle, localizedTitle: zhTitle }),
    { workspaceId: GROUP, title: zhTitle },
  );

  // Already in step: no write.
  assert.equal(planTitleSync({ workspaceId: GROUP, storedTitle: enTitle, localizedTitle: enTitle }), null);

  // Durable user intent is never touched: a sidebar rename, or the operator's
  // own configured `title`.
  assert.equal(planTitleSync({ workspaceId: GROUP, storedTitle: 'Inbox', localizedTitle: enTitle }), null);
  assert.equal(planTitleSync({ workspaceId: GROUP, storedTitle: '', localizedTitle: enTitle }), null);
  assert.equal(planTitleSync({ workspaceId: GROUP, storedTitle: undefined, localizedTitle: enTitle }), null);

  // Not ready / no usable target.
  assert.equal(planTitleSync({ workspaceId: null, storedTitle: zhTitle, localizedTitle: enTitle }), null);
  assert.equal(planTitleSync({ workspaceId: '', storedTitle: zhTitle, localizedTitle: enTitle }), null);
  assert.equal(planTitleSync({ workspaceId: GROUP, storedTitle: zhTitle, localizedTitle: '' }), null);
  assert.equal(planTitleSync({ workspaceId: GROUP, storedTitle: zhTitle, localizedTitle: undefined }), null);
  // A numeric id is normalized the way the official API expects (a string).
  assert.deepEqual(
    planTitleSync({ workspaceId: 7, storedTitle: zhTitle, localizedTitle: enTitle }),
    { workspaceId: '7', title: enTitle },
  );
  // A language pack (say ja) falling back to English lands on the en default,
  // which is itself an auto title — so switching back to zh still works.
  assert.deepEqual(
    planTitleSync({ workspaceId: GROUP, storedTitle: zhTitle, localizedTitle: enTitle, titles: AUTO_TITLES }),
    { workspaceId: GROUP, title: enTitle },
  );
});

test('every protocol code has a message key, and every message key exists', () => {
  for (const [name, code] of Object.entries(CODES)) {
    const key = messageKeyForCode(code);
    assert.equal(typeof key, 'string');
    assert.notEqual(key, '');
    assert.equal(zh[key] === undefined, false, `no zh copy for ${name} (${code})`);
    assert.equal(en[key] === undefined, false, `no en copy for ${name} (${code})`);
  }
  assert.equal(Object.keys(CODE_MESSAGE_KEYS).length, Object.keys(CODES).length);
});

test('the client and host halves agree on the default folder and title', () => {
  assert.equal(DEFAULTS.title, zh.name);
  assert.equal(DEFAULTS.recentTasksDir, '~/Documents/DSH 最近任务');
  // readStateResponse fills the optional fields a host may omit.
  const loose = readStateResponse({ ok: true, value: { path: PATH } });
  assert.equal(loose.ok, true);
  assert.equal(loose.value.path, PATH);
  assert.equal(loose.value.dirExists, false);
});
