# Recent tasks: sidebar section promotion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plugin's own `最近任务` group read as a block-level, independently collapsible section beside the official `工作区` header, and give that header a collapse toggle — entirely inside the plugin, with no official code touched.

**Architecture:** One presentation-layer adapter. It resolves the official nodes from stable attributes (one selector, the rest plain tree walking), tags exactly the nodes it resolved with plugin-owned `data-dsh-rt-*` attributes, and lets plugin CSS do the restyling (repeating the attribute in each selector to outrank the official module rule without `!important`). A single injected `<button>` toggles a class on `<html>` that hides the sibling group blocks. Any missing or unexpected anchor ends in `stop()`: tags and button removed, one warning, no throw.

**Tech Stack:** ESM + esbuild (classic-script client bundle), React only through the official slot service, `node --test` for tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-recent-tasks-section-promotion-design.md` (approved). Every "spec §x" below refers to it.

## Global Constraints

- The client bundle must stay a **classic script**: one top-level `window.__ModuleLoader__.load({ id, factory })`, no ESM statements, `require` only for `ALLOWED_EXTERNALS` (`scripts/build.mjs`); local modules MUST be inlined.
- **No official class hash may appear in any source or in the artifact** — `_7514NG_`, `jJkEga_`, `_3WPZCG_`, `tztITa_`, `F6DNpa_`, `yuWXda_` (they already changed between 0.2.0-rc.1 and 0.2.1-rc.2). Stable anchors only: `data-row-key`, `role`, the inline `--dsh-workspace-indent`, CSS custom properties.
- The adapter never writes plugin or workspace state, never calls the host, never renames anything; the only browser storage it touches is `dsh.recent-tasks.workspaces-collapsed.v1`.
- Beat official module rules by **repeating the plugin attribute** in the selector (specificity 0,2,0 > 0,1,0); never use `!important`.
- Every user-visible string lives in the plugin's own `recentTasks` locale namespace; `zh` is the key source of truth and `en` mirrors it 1:1 (an existing test asserts the key sets match).
- `apply(ctx)` must keep working under the minimal DOM the bundle test provides (no `documentElement`, no `MutationObserver`, `localStorage === null`).
- Finish at version `0.2.0`, with `node scripts/build.mjs && node --test test/*.test.js` green (49 tests pass before this plan starts).

---

### Task 1: The collapse control's two strings

**Files:**
- Modify: `src/locales.js` (the `zh` dict around line 79, the `en` dict around line 120)
- Test: `test/client.test.js` (existing locale parity test, ~line 323)

**Interfaces:**
- Consumes: nothing.
- Produces: locale keys `collapse.workspaces` and `expand.workspaces` in both dictionaries — Task 3/4's adapter calls `t('collapse.workspaces')` / `t('expand.workspaces')`.

- [ ] **Step 1: Add the keys to `zh` only and watch the parity test fail**

In `src/locales.js`, inside `export const zh = {`, after the `guide.*` block:

```js
  'guide.title': '不指定工作区即可开始对话',
  'guide.dismiss': '知道了',
  'collapse.workspaces': '收起工作区列表',
  'expand.workspaces': '展开工作区列表',
```

Run: `node --test test/client.test.js 2>&1 | tail -20`
Expected: FAIL — the zh/en key-set parity assertion reports `expand.workspaces` / `collapse.workspaces` missing from `en`.

- [ ] **Step 2: Add the English mirror**

In the same file, inside `export const en = {`, right after `'guide.dismiss': 'Got it',`:

```js
  'collapse.workspaces': 'Collapse the workspaces list',
  'expand.workspaces': 'Expand the workspaces list',
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `node --test test/*.test.js 2>&1 | tail -8`
Expected: PASS, `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add src/locales.js
git commit -m "Give the workspaces collapse toggle its two strings"
```

---

### Task 2: Pure logic — the collapse flag and the promotion witness

**Files:**
- Modify: `src/client-core.js` (append after `writeGuideSeen`, around line 71)
- Test: `test/client.test.js` (append at the end of the file)

**Interfaces:**
- Consumes: nothing (DOM-free module).
- Produces, all imported by Task 3's adapter and by Task 4:
  - `ADAPTER: Readonly<{ rowAttr, blockAttr, listAttr, subAttr, overflowAttr, rowValue, collapsedHtmlClass, collapseButtonClass }>`
  - `PROMOTE_INDENT: '0px'`
  - `shouldPromoteSection(witness: { rowFound?, indent?, listFound?, headerFound? }) => boolean`
  - `WORKSPACES_COLLAPSED_KEY: 'dsh.recent-tasks.workspaces-collapsed.v1'`
  - `readWorkspacesCollapsed(storage) => boolean`
  - `writeWorkspacesCollapsed(storage, collapsed) => void`

- [ ] **Step 1: Write the failing test**

Append to `test/client.test.js` (it already imports `GUIDE_KEY`, `readGuideSeen`, `writeGuideSeen` from `../src/client-core.js` — extend that import list with the new names):

```js
// --------------------------------------------------------------------------
// sidebar section promotion: the collapse flag (§5.4) and the witness (§5.1)
// --------------------------------------------------------------------------

test('the collapse flag round-trips, and anything odd reads as expanded', () => {
  const storage = fakeStorage();
  assert.equal(readWorkspacesCollapsed(storage), false, 'a missing flag means expanded');
  writeWorkspacesCollapsed(storage, true);
  assert.equal(storage.map.get(WORKSPACES_COLLAPSED_KEY), '1');
  assert.equal(readWorkspacesCollapsed(storage), true);
  writeWorkspacesCollapsed(storage, false);
  assert.equal(readWorkspacesCollapsed(storage), false);

  storage.setItem(WORKSPACES_COLLAPSED_KEY, 'yes');
  assert.equal(readWorkspacesCollapsed(storage), false, 'an unparsable value must not hide the list');
  assert.equal(readWorkspacesCollapsed(null), false, 'no storage at all means expanded');

  const hostile = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(readWorkspacesCollapsed(hostile), false);
  assert.doesNotThrow(() => writeWorkspacesCollapsed(hostile, true));
});

test('the promotion witness needs every anchor, and a root-level group', () => {
  const good = { rowFound: true, indent: PROMOTE_INDENT, listFound: true, headerFound: true };
  assert.equal(shouldPromoteSection(good), true);

  // Single list / search results / rail: the group row is not rendered at all.
  assert.equal(shouldPromoteSection({ ...good, rowFound: false }), false);
  // Flat list, or a list we could not resolve to the header we would inject into.
  assert.equal(shouldPromoteSection({ ...good, listFound: false }), false);
  assert.equal(shouldPromoteSection({ ...good, headerFound: false }), false);
  // Tree mode: the group is nested under another workspace, so it is NOT a peer.
  assert.equal(shouldPromoteSection({ ...good, indent: '12px' }), false);
  assert.equal(shouldPromoteSection({ ...good, indent: '' }), false);
  assert.equal(shouldPromoteSection(undefined), false);
});

test('the adapter vocabulary is frozen and used verbatim by the stylesheet', () => {
  assert.equal(Object.isFrozen(ADAPTER), true);
  assert.equal(ADAPTER.rowAttr, 'data-dsh-rt-row');
  assert.equal(ADAPTER.blockAttr, 'data-dsh-rt-block');
  assert.equal(ADAPTER.listAttr, 'data-dsh-rt-list');
  assert.equal(ADAPTER.subAttr, 'data-dsh-rt-sub');
  assert.equal(ADAPTER.overflowAttr, 'data-dsh-rt-overflow');
  assert.equal(ADAPTER.rowValue, 'recent');
  assert.equal(ADAPTER.collapsedHtmlClass, 'dsh-recent-tasks-workspaces-collapsed');
  assert.equal(ADAPTER.collapseButtonClass, 'dsh-recent-tasks-collapse');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/client.test.js 2>&1 | tail -20`
Expected: FAIL — `shouldPromoteSection is not a function` / the import is undefined.

- [ ] **Step 3: Implement the logic in `src/client-core.js`**

Insert after `writeGuideSeen` (line 71):

```js
/** Browser-local flag: the plugin's own collapse state for the workspace blocks. */
export const WORKSPACES_COLLAPSED_KEY = 'dsh.recent-tasks.workspaces-collapsed.v1';

/**
 * Read the collapse flag.
 *
 * Missing, unparsable or blocked storage reads as expanded: hiding the whole
 * workspace list because storage misbehaved would be worse than forgetting one
 * click.
 */
export function readWorkspacesCollapsed(storage) {
  if (!storage) return false;
  try {
    return storage.getItem(WORKSPACES_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the collapse flag. Cosmetic state only, so failures stay silent. */
export function writeWorkspacesCollapsed(storage, collapsed) {
  try {
    storage?.setItem(WORKSPACES_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* private mode / storage disabled: the toggle still works for this session */
  }
}

/**
 * The vocabulary the sidebar section adapter speaks (spec §5.3).
 *
 * These are attributes on OFFICIAL nodes, so they are namespaced to this plugin
 * and never collide with anything official; the selectors in src/client.js
 * repeat them to outweigh the official module rules without `!important`.
 */
export const ADAPTER = Object.freeze({
  rowAttr: 'data-dsh-rt-row',
  blockAttr: 'data-dsh-rt-block',
  listAttr: 'data-dsh-rt-list',
  subAttr: 'data-dsh-rt-sub',
  overflowAttr: 'data-dsh-rt-overflow',
  rowValue: 'recent',
  collapsedHtmlClass: 'dsh-recent-tasks-workspaces-collapsed',
  collapseButtonClass: 'dsh-recent-tasks-collapse',
});

/** The inline indent a ROOT-level group carries (`depth * 12px`, depth 0). */
export const PROMOTE_INDENT = '0px';

/**
 * May the adapter touch the official DOM? (spec §5.1, §5.2)
 *
 * `witness` is what src/client-adapter.js found: the group row itself, the
 * group being at the root of the tree, the row's list, and the section header
 * the collapse toggle is injected into. Every one of them has to be there —
 * anything else (single list, search results, the 56px rail, a group nested in
 * tree mode, a DSH upgrade that moved the anchors) means "hands off", and the
 * sidebar simply stays official.
 */
export function shouldPromoteSection(witness) {
  if (!witness || typeof witness !== 'object') return false;
  return (
    witness.rowFound === true &&
    witness.indent === PROMOTE_INDENT &&
    witness.listFound === true &&
    witness.headerFound === true
  );
}
```

Extend the import at the top of `test/client.test.js` so the new names are in scope:

```js
import {
  ADAPTER,
  GUIDE_KEY,
  PROMOTE_INDENT,
  WORKSPACES_COLLAPSED_KEY,
  readGuideSeen,
  readWorkspacesCollapsed,
  shouldPromoteSection,
  writeGuideSeen,
  writeWorkspacesCollapsed,
} from '../src/client-core.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/*.test.js 2>&1 | tail -8`
Expected: PASS, `# fail 0` (52 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client-core.js test/client.test.js
git commit -m "Decide the promotion from a witness, and remember one collapse flag"
```

---

### Task 3: `src/client-adapter.js` — resolve, tag, toggle, self-heal

**Files:**
- Create: `src/client-adapter.js`
- Create: `test/adapter.test.js`

**Interfaces:**
- Consumes: `ADAPTER`, `Phase`, `PROMOTE_INDENT`, `readWorkspacesCollapsed`, `shouldPromoteSection`, `writeWorkspacesCollapsed` from `./client-core.js`.
- Produces: `createSectionAdapter({ controller, t, storage, logger, doc, win }) => { start, stop, run }` where
  - `controller` is Task 2/`client.js`'s controller (`store.getSnapshot()` → `{ phase, value: { workspaceId, … } }`, `store.subscribe(fn)` → unsubscribe),
  - `t` is the locale-bound translator for the plugin's namespace,
  - `storage` is `window.localStorage` or `null`,
  - `logger` is the console wrapper `client.js` already uses,
  - `doc` / `win` default to `globalThis.document` / `globalThis.window` and exist so tests can inject a fake DOM.

- [ ] **Step 1: Write the failing test (a fake DOM plus the nine behaviours)**

Create `test/adapter.test.js`:

```js
// The sidebar section adapter, driven against a DOM small enough to hold in your
// head.
//
// The adapter promises to search the document with exactly ONE selector
// (`[data-row-key="workspace:<id>"]`) and to reach everything else through
// `children` / `parentElement` / `getAttribute`; this fake therefore implements
// that one selector shape instead of a CSS engine. A fake that mirrored a real
// engine would only prove the fake works.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSectionAdapter } from '../src/client-adapter.js';
import { ADAPTER, Phase, WORKSPACES_COLLAPSED_KEY } from '../src/client-core.js';

const T = (key) => `t:${key}`;

class FakeClassList {
  constructor(names = []) {
    this.set = new Set(names);
  }

  add(...names) {
    for (const name of names) this.set.add(name);
  }

  remove(...names) {
    for (const name of names) this.set.delete(name);
  }

  contains(name) {
    return this.set.has(name);
  }

  get value() {
    return [...this.set].join(' ');
  }
}

class FakeNode {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map(Object.entries(attrs));
    this.classList = new FakeClassList(String(attrs.class ?? '').split(/\s+/).filter(Boolean));
    this.listeners = new Map();
    this.style = {
      props: new Map(),
      setProperty: (name, value) => this.style.props.set(name, value),
      getPropertyValue: (name) => this.style.props.get(name) ?? '',
    };
  }

  get className() {
    return this.classList.value;
  }

  set className(value) {
    this.classList = new FakeClassList(String(value).split(/\s+/).filter(Boolean));
  }

  get firstElementChild() {
    return this.children[0] ?? null;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  prepend(node) {
    node.parentElement = this;
    this.children.unshift(node);
    return node;
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentElement = null;
    return node;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type) {
    const event = { type, defaultPrevented: false, prevented: 0, stopped: 0, preventDefault() { this.prevented += 1; }, stopPropagation() { this.stopped += 1; } };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  /** The one selector the adapter is allowed to use, plus `svg` probes. */
  querySelector(selector) {
    const exact = /^\[data-row-key="(.*)"\]$/.exec(selector);
    if (exact) return findByRowKey(this, exact[1]);
    throw new Error(`fake DOM asked for an unsupported selector: ${selector}`);
  }
}

function findByRowKey(node, value) {
  for (const child of node.children) {
    if (child.getAttribute('data-row-key') === value) return child;
    const deeper = findByRowKey(child, value);
    if (deeper) return deeper;
  }
  return null;
}

class FakeMutationObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observed = null;
    FakeMutationObserver.instances.push(this);
  }

  observe(node, options) {
    this.observed = node;
    this.options = options;
  }

  disconnect() {
    this.observed = null;
  }

  trigger() {
    if (this.observed) this.callback([]);
  }
}

function fakeWindow({ observer = true, hasHas = true } = {}) {
  const queue = [];
  const win = {
    requestAnimationFrame: (fn) => queue.push(fn),
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    CSS: { supports: () => hasHas },
  };
  if (observer) win.MutationObserver = FakeMutationObserver;
  return { win, flush: () => { for (const fn of queue.splice(0)) fn(); } };
}

const el = (tag, attrs) => new FakeNode(tag, attrs);
const svg = () => el('svg');

/** A group row exactly shaped like the official one (spec §3.2). */
function groupRow(key) {
  const row = el('div', { 'data-row-key': `workspace:${key}`, role: 'treeitem' });
  row.appendChild(el('span', { class: 'slot' })).appendChild(svg());
  row.appendChild(el('span', { class: 'slot' })).appendChild(svg());
  row.appendChild(el('span', { class: 'projectText' })).appendChild(el('span', { class: 'title' }));
  row.appendChild(el('span', { class: 'rowActions' }));
  return row;
}

function sessionRow(id) {
  return el('div', { 'data-row-key': `session:${id}` });
}

function overflowRow(key) {
  return el('button', { 'data-row-key': `overflow:${key}` });
}

function group(key, { expanded = true, sessions = 2 } = {}) {
  const block = el('div', { class: 'groupSection' });
  block.style.setProperty('--dsh-workspace-indent', '0px');
  block.appendChild(groupRow(key));
  for (let index = 0; index < sessions; index += 1) block.appendChild(sessionRow(`${key}-${index}`));
  if (expanded) block.appendChild(overflowRow(key));
  return block;
}

/**
 * The official sidebar shape (spec §5.2), with every knob a test needs:
 * `indent: '12px'` is a group nested in tree mode, `row: false` is the single
 * list / search / rail case, `documentElement: false` is a DOM-less harness.
 */
function sidebar({ workspaceId = 'w-recent', indent = '0px', row = true, header = true, documentElement = true, observer = true, hasHas = true } = {}) {
  const doc = new FakeNode('#document');
  if (documentElement) doc.documentElement = el('html');
  const root = el('div', { class: 'root' });
  if (header) {
    const headerNode = el('div', { class: 'sectionHeader' });
    headerNode.appendChild(el('span', { class: 'sectionLabel' })).appendChild(el('#text'));
    root.appendChild(headerNode);
  }
  const listArea = el('div', { class: 'listArea' });
  const treeBody = el('div', { class: 'treeBody' });
  const list = el('div', { class: 'list', role: 'tree' });
  const recent = group(workspaceId);
  recent.style.setProperty('--dsh-workspace-indent', indent);
  if (row) list.appendChild(recent);
  list.appendChild(group('other'));
  treeBody.appendChild(list);
  listArea.appendChild(treeBody);
  root.appendChild(listArea);
  doc.appendChild(root);
  const { win, flush } = fakeWindow({ observer, hasHas });
  return { doc, win, flush, root, listArea, treeBody, list, recent, header: header ? root.children[0] : null, rowNode: row ? recent.children[0] : null };
}

function adapterFor(env, { storage = null, controller } = {}) {
  const log = [];
  const adapter = createSectionAdapter({
    controller: controller ?? { store: { getSnapshot: () => ({ phase: Phase.ready, value: { workspaceId: 'w-recent' } }), subscribe: () => () => {} } },
    t: T,
    storage,
    logger: { warn: (...args) => log.push(args) },
    doc: env.doc,
    win: env.win,
  });
  return { adapter, log };
}

const attrsOf = (node) => [...node.attributes.keys()].sort();
const buttonOf = (env) => env.header?.children.find((child) => child.className === ADAPTER.collapseButtonClass) ?? null;

test('a root-level group is promoted: tagged, indented, and given one toggle', () => {
  const env = sidebar();
  const { adapter } = adapterFor(env);
  adapter.run();

  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
  assert.equal(env.recent.getAttribute(ADAPTER.blockAttr), ADAPTER.rowValue);
  assert.equal(env.list.getAttribute(ADAPTER.listAttr), '');
  assert.equal(env.recent.children[1].hasAttribute(ADAPTER.subAttr), true);
  assert.equal(env.recent.children[2].hasAttribute(ADAPTER.subAttr), true);
  assert.equal(env.recent.children[3].hasAttribute(ADAPTER.overflowAttr), true);
  assert.equal(env.recent.children[1].hasAttribute(ADAPTER.overflowAttr), false);
  assert.equal(env.recent.children[3].hasAttribute(ADAPTER.subAttr), false);

  const button = buttonOf(env);
  assert.notEqual(button, null, 'the toggle is the header’s first child');
  assert.equal(env.header.children[0], button);
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('type'), 'button');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-label'), T('collapse.workspaces'));
  assert.equal(button.getAttribute('data-collapsed'), 'false');
  assert.equal(button.innerHTML.includes('<svg'), true);
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);

  adapter.stop();
});

test('clicking the toggle flips the flag, the class and the aria state', () => {
  const storage = { map: new Map(), getItem(key) { return this.map.get(key) ?? null; }, setItem(key, value) { this.map.set(key, String(value)); } };
  const env = sidebar();
  const { adapter } = adapterFor(env, { storage });
  adapter.run();

  const button = buttonOf(env);
  const first = button.dispatch('click');
  assert.equal(first.stopped, 1, 'the click must not reach the official header');
  assert.equal(storage.map.get(WORKSPACES_COLLAPSED_KEY), '1');
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('data-collapsed'), 'true');
  assert.equal(button.getAttribute('aria-label'), T('expand.workspaces'));

  button.dispatch('click');
  assert.equal(storage.map.get(WORKSPACES_COLLAPSED_KEY), '0');
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');

  adapter.stop();
});

test('a remembered collapse is applied on start, and released on stop', () => {
  const storage = { getItem: () => '1', setItem: () => {} };
  const env = sidebar();
  const { adapter } = adapterFor(env, { storage });
  adapter.start();
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), true);
  assert.equal(buttonOf(env).getAttribute('aria-expanded'), 'false');

  adapter.stop();
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);
  assert.equal(buttonOf(env), null);
  assert.equal(env.rowNode.hasAttribute(ADAPTER.rowAttr), false);
  assert.equal(env.recent.hasAttribute(ADAPTER.blockAttr), false);
  assert.equal(env.list.hasAttribute(ADAPTER.listAttr), false);
  assert.equal(env.recent.children[1].hasAttribute(ADAPTER.subAttr), false);
});

test('a nested group in tree mode is left completely alone', () => {
  const env = sidebar({ indent: '12px' });
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(env.rowNode.hasAttribute(ADAPTER.rowAttr), false);
  assert.equal(buttonOf(env), null);
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);
});

test('a missing group row (single list / search / rail) disables the adapter', () => {
  const env = sidebar({ row: false });
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(buttonOf(env), null);
  assert.equal(env.list.hasAttribute(ADAPTER.listAttr), false);
});

test('a header that carries rows of its own is not an injection point', () => {
  const env = sidebar();
  env.header.appendChild(el('div', { 'data-row-key': 'workspace:stray' }));
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(buttonOf(env), null, 'no row lookup may mistake this header for the list');
  assert.equal(env.rowNode.hasAttribute(ADAPTER.rowAttr), false);
});

test('re-running is idempotent: one tag per node, one button', () => {
  const env = sidebar();
  const { adapter } = adapterFor(env);
  adapter.run();
  adapter.run();
  adapter.run();
  assert.equal(env.header.children.filter((child) => child.className === ADAPTER.collapseButtonClass).length, 1);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
  assert.equal(attrsOf(env.rowNode).filter((name) => name === ADAPTER.rowAttr).length, 1);
});

test('an official re-render is healed on the next pass', () => {
  const env = sidebar();
  const { adapter } = adapterFor(env);
  adapter.start();

  // React rebuilt the list: new nodes, our attributes gone, our button gone.
  const rebuilt = group('w-recent');
  env.list.children[0] = rebuilt;
  rebuilt.parentElement = env.list;
  env.header.removeChild(buttonOf(env));

  adapter.run();
  assert.equal(rebuilt.children[0].getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
  assert.equal(buttonOf(env).getAttribute('aria-expanded'), 'true');
  assert.equal(rebuilt.children[1].hasAttribute(ADAPTER.subAttr), true);

  // …and the observer schedules that pass without being called by hand.
  FakeMutationObserver.instances.at(-1).trigger();
  env.flush();
  assert.equal(buttonOf(env).getAttribute('aria-expanded'), 'true');
  adapter.stop();
});

test('without :has() the toggle is skipped but the restyle still happens', () => {
  const env = sidebar({ hasHas: false });
  const { adapter } = adapterFor(env, { storage: { getItem: () => '1', setItem: () => {} } });
  adapter.run();
  assert.equal(buttonOf(env), null, 'an unsafe hide rule would lie, so there is no toggle at all');
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
});

test('a harness with no MutationObserver, no documentElement and no storage survives', () => {
  const doc = new FakeNode('#document');
  const env = sidebar({ documentElement: false, observer: false });
  env.doc = doc; // nothing but an empty document: every lookup misses
  const { adapter, log } = adapterFor(env);
  assert.doesNotThrow(() => adapter.run());
  assert.doesNotThrow(() => adapter.stop());
  assert.equal(log.length, 0, 'missing anchors are a normal state, not a warning');

  const { adapter: adapter2, log: log2 } = adapterFor(sidebar({ observer: false }));
  assert.doesNotThrow(() => adapter2.start());
  adapter2.run();
  assert.equal(log2.length, 0);
  adapter2.stop();
});
```

Run: `node --test test/adapter.test.js 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../src/client-adapter.js'`.

- [ ] **Step 2: Write `src/client-adapter.js`**

```js
// dsh-recent-tasks — the sidebar section adapter.
//
// Promotes the plugin's own Workspace group into a block-level section beside the
// official "工作区"/"会话" header, and adds a collapse toggle for that header.
// Design: docs/superpowers/specs/2026-10-20-recent-tasks-section-promotion-design.md
//
// Invariants (spec §5.1, §5.2, §6):
//   * it never writes plugin or workspace state, never calls the host, and the
//     only storage it touches is its own collapse flag;
//   * it resolves its anchors from official STABLE attributes — `data-row-key`,
//     `role`, the inline `--dsh-workspace-indent` — never from official class
//     names, which are build hashes that already changed once;
//   * it searches the document with exactly ONE selector and tags exactly the
//     nodes it resolved, so it can never restyle an unrelated official node;
//   * any surprise (missing anchor, unexpected shape, a DOM without
//     MutationObserver, the minimal DOM the bundle test provides) ends in
//     `stop()`: tags and toggle removed, one warning at most, nothing thrown.

import {
  ADAPTER,
  Phase,
  readWorkspacesCollapsed,
  shouldPromoteSection,
  writeWorkspacesCollapsed,
} from './client-core.js';

/** The plugin's own chevron: no icon package is reachable from a plugin bundle. */
const CHEVRON_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M3 1.4 7.6 5 3 8.6z" fill="currentColor"/></svg>';

/** Escape a workspace id for the one attribute selector this module uses. */
function attrValue(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}

/**
 * @param {object} options
 * @param {{ store: { getSnapshot: Function, subscribe: Function } }} options.controller
 * @param {(key: string) => string} options.t locale-bound translator
 * @param {Storage|null} options.storage `window.localStorage`, or null
 * @param {{ warn: Function }} options.logger
 * @param {Document} [options.doc] injectable for tests
 * @param {Window} [options.win] injectable for tests
 * @returns {{ start: () => void, stop: () => void, run: () => void }}
 */
export function createSectionAdapter({
  controller,
  t,
  storage,
  logger,
  doc = globalThis.document,
  win = globalThis.window,
}) {
  let observer = null;
  let observed = null;
  let scheduled = null;
  let unsubscribe = null;
  let button = null;
  /** Exactly what this adapter put on official nodes, so it can take it back. */
  let tagged = [];

  const raf =
    typeof win?.requestAnimationFrame === 'function'
      ? { set: (fn) => win.requestAnimationFrame(fn), clear: (id) => win.cancelAnimationFrame?.(id) }
      : { set: (fn) => win?.setTimeout?.(fn, 16), clear: (id) => win?.clearTimeout?.(id) };

  const attr = (node, name) => (typeof node?.getAttribute === 'function' ? node.getAttribute(name) : null);
  const roleOf = (node) => attr(node, 'role') ?? '';
  const keyOf = (node) => attr(node, 'data-row-key') ?? '';
  const childrenOf = (node) => (node?.children ? [...node.children] : []);
  const hasSvg = (node) => childrenOf(node).some((child) => String(child?.tagName ?? '').toLowerCase() === 'svg');

  /** Walk up to the nearest ancestor with the given role (the list carries `tree`). */
  function ancestorWithRole(node, role) {
    let current = node;
    while (current) {
      if (roleOf(current) === role) return current;
      current = current.parentElement ?? null;
    }
    return null;
  }

  function hasRowDescendant(node) {
    for (const child of childrenOf(node)) {
      if (keyOf(child)) return true;
      if (hasRowDescendant(child)) return true;
    }
    return false;
  }

  /** The one document-wide selector this module is allowed (spec §5.3). */
  function findRow(workspaceId) {
    try {
      return doc?.querySelector?.(`[data-row-key="workspace:${attrValue(workspaceId)}"]`) ?? null;
    } catch {
      return null;
    }
  }

  /** What the DOM currently offers, in the shape `shouldPromoteSection` reads. */
  function witness(workspaceId) {
    const missing = { rowFound: false, indent: '', listFound: false, headerFound: false };
    const row = findRow(workspaceId);
    if (!row || roleOf(row) !== 'treeitem') return missing;

    // The official row is [folder, chevron, title, actions]. Anything else is a
    // shape we do not understand, and guessing would restyle the wrong node.
    const cells = childrenOf(row);
    if (cells.length < 3 || !hasSvg(cells[0]) || !hasSvg(cells[1])) return missing;

    const block = row.parentElement ?? null;
    const list = ancestorWithRole(block, 'tree');
    if (!block || !list || block.parentElement !== list) return missing;
    if (!childrenOf(list).some((group) => childrenOf(group).some((child) => keyOf(child).startsWith('workspace:')))) return missing;

    // list -> treeBody -> listArea -> the ui-workspace root, whose only sibling
    // beside the list is the section header.
    const listArea = list.parentElement?.parentElement ?? null;
    const root = listArea?.parentElement ?? null;
    const header = root?.firstElementChild ?? null;
    if (!header || header === listArea || hasRowDescendant(header)) return missing;

    return {
      rowFound: true,
      indent: (block.style?.getPropertyValue?.('--dsh-workspace-indent') ?? '').trim(),
      listFound: true,
      headerFound: true,
      row,
      block,
      list,
      header,
    };
  }

  function put(node, name, value) {
    if (typeof node?.setAttribute !== 'function') return;
    try {
      if (attr(node, name) !== value) node.setAttribute(name, value);
      tagged.push({ node, name });
    } catch {
      /* a detached node: nothing to stamp */
    }
  }

  function untagAll() {
    for (const { node, name } of tagged) {
      try {
        node.removeAttribute(name);
      } catch {
        /* already gone with its subtree */
      }
    }
    tagged = [];
  }

  function setCollapsedClass(collapsed) {
    try {
      const list = doc?.documentElement?.classList;
      if (!list) return;
      if (collapsed) list.add(ADAPTER.collapsedHtmlClass);
      else list.remove(ADAPTER.collapsedHtmlClass);
    } catch {
      /* a harness without a documentElement: nothing to mark */
    }
  }

  function supportsHideRule() {
    try {
      return typeof win?.CSS?.supports === 'function' ? win.CSS.supports('selector(:has(*))') : false;
    } catch {
      return false;
    }
  }

  function dropButton() {
    try {
      button?.remove?.();
    } catch {
      /* already removed with the header */
    }
    button = null;
  }

  function createButton() {
    const node = doc.createElement('button');
    node.type = 'button';
    node.className = ADAPTER.collapseButtonClass;
    // Our own markup: a plugin bundle cannot reach the official icon package.
    node.innerHTML = CHEVRON_SVG;
    node.addEventListener('click', (event) => {
      try {
        event.preventDefault?.();
        event.stopPropagation?.();
        writeWorkspacesCollapsed(storage, !readWorkspacesCollapsed(storage));
        run();
      } catch (error) {
        logger.warn('the workspaces collapse toggle failed:', error);
      }
    });
    return node;
  }

  /** One toggle, ours only; React may have thrown the old one away. */
  function ensureButton(header, collapsed) {
    const mine = childrenOf(header).filter((child) => child.className === ADAPTER.collapseButtonClass);
    for (const extra of mine.slice(1)) extra.remove?.();
    let node = mine[0] ?? null;
    if (!node) {
      node = createButton();
      if (typeof header.prepend === 'function') header.prepend(node);
      else header.insertBefore?.(node, header.firstChild ?? null);
    }
    const label = t(collapsed ? 'expand.workspaces' : 'collapse.workspaces');
    node.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    node.setAttribute('aria-label', label);
    node.setAttribute('title', label);
    node.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    button = node;
    return node;
  }

  function tagNodes({ row, block, list }) {
    untagAll();
    put(row, ADAPTER.rowAttr, ADAPTER.rowValue);
    put(block, ADAPTER.blockAttr, ADAPTER.rowValue);
    put(list, ADAPTER.listAttr, '');
    for (const child of childrenOf(block)) {
      const key = keyOf(child);
      if (key.startsWith('session:')) put(child, ADAPTER.subAttr, '');
      else if (key.startsWith('overflow:')) put(child, ADAPTER.overflowAttr, '');
    }
  }

  /** Watch the ui-workspace root so an official re-render heals itself. */
  function watch(list) {
    if (typeof win?.MutationObserver !== 'function') return;
    const root = list?.parentElement?.parentElement?.parentElement ?? null;
    if (!root || observed === root) return;
    try {
      observer?.disconnect();
    } catch {
      /* the previous root went away with its subtree */
    }
    observed = root;
    observer = new win.MutationObserver(() => schedule());
    observer.observe(root, { childList: true, subtree: true });
  }

  function run() {
    scheduled = null;
    try {
      const snapshot = controller.store.getSnapshot();
      const workspaceId = snapshot?.value?.workspaceId ?? null;
      if (snapshot?.phase !== Phase.ready || !workspaceId) return stop();

      const found = witness(workspaceId);
      if (!shouldPromoteSection(found)) return stop();

      tagNodes(found);
      // Without `:has()` the hide rule would match every block, so the toggle
      // would lie: skip it and leave the section read-only (§5.5).
      const collapsed = supportsHideRule() && readWorkspacesCollapsed(storage);
      setCollapsedClass(collapsed);
      if (supportsHideRule()) ensureButton(found.header, collapsed);
      else dropButton();
      watch(found.list);
    } catch (error) {
      logger.warn('the sidebar section adapter stopped:', error);
      stop();
    }
  }

  function schedule() {
    if (scheduled !== null) return;
    try {
      scheduled = raf.set(() => run());
    } catch {
      scheduled = null;
    }
  }

  function stop() {
    if (scheduled !== null) {
      try {
        raf.clear(scheduled);
      } catch {
        /* nothing to cancel */
      }
      scheduled = null;
    }
    try {
      unsubscribe?.();
    } catch {
      /* the store went away with the composition */
    }
    unsubscribe = null;
    try {
      observer?.disconnect();
    } catch {
      /* nothing observed */
    }
    observer = null;
    observed = null;
    dropButton();
    setCollapsedClass(false);
    untagAll();
  }

  function start() {
    run();
    try {
      unsubscribe = controller.store.subscribe(schedule);
    } catch {
      /* a store without subscribe still gets the single pass above */
    }
  }

  return { start, stop, run };
}
```

- [ ] **Step 3: Run the adapter tests to verify they pass**

Run: `node --test test/adapter.test.js 2>&1 | tail -30`
Expected: PASS, `# fail 0`, 10 tests. If a test fails, fix `src/client-adapter.js` — never the assertions, unless the fake DOM is wrong about the official shape, in which case fix the fake and say why in the commit message.

- [ ] **Step 4: Run the whole suite**

Run: `node --test test/*.test.js 2>&1 | tail -8`
Expected: PASS, `# fail 0` (62 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client-adapter.js test/adapter.test.js
git commit -m "Add the sidebar section adapter: resolve, tag, toggle, self-heal"
```

---

### Task 4: Wire it into the client half, and put the look in the stylesheet

**Files:**
- Modify: `src/client.js` (the `CSS` template at lines 89-112; the import block at the top; `apply()` after `installStyles(ctx)` around line 396)
- Modify: `test/bundle.test.js` (append two contract tests)

**Interfaces:**
- Consumes: `createSectionAdapter` (Task 3), `ADAPTER` (Task 2), and the locale keys (Task 1).
- Produces: the shipped artifact — same `apply(ctx)` contract, plus the adapter registered through `ctx.effect` so it dies with the composition.

- [ ] **Step 1: Write the failing contract tests**

Append to `test/bundle.test.js`:

```js
test('the artifact styles the promoted section without naming an official class', () => {
  // Every selector below is keyed on an attribute THIS plugin puts on the node.
  for (const rule of [
    '[data-dsh-rt-row][data-dsh-rt-row]',
    '[data-dsh-rt-row][data-dsh-rt-row]>span:nth-child(1)',
    '[data-dsh-rt-row][data-dsh-rt-row]>span:nth-child(2)',
    '[data-dsh-rt-block][data-dsh-rt-block]',
    '[data-dsh-rt-sub][data-dsh-rt-sub]',
    '[data-dsh-rt-overflow][data-dsh-rt-overflow]',
    'dsh-recent-tasks-workspaces-collapsed',
    'dsh-recent-tasks-collapse',
    'calc(8px + 12px + var(--dsh-workspace-indent,0px))',
    'calc(28px + 12px + var(--dsh-workspace-indent,0px))',
    ':has([data-dsh-rt-block])',
  ]) {
    assert.equal(bundle.includes(rule), true, `the artifact is missing ${rule}`);
  }
  assert.equal(bundle.includes('!important'), false, 'specificity, not !important');
});

test('no official class hash is hard-coded anywhere', () => {
  // These prefixes changed between 0.2.0-rc.1 and 0.2.1-rc.2; a plugin that
  // pinned one would break on the next DSH update.
  const hashes = ['_7514NG_', 'jJkEga_', '_3WPZCG_', 'tztITa_', 'F6DNpa_', 'yuWXda_'];
  const sources = ['src/client.js', 'src/client-core.js', 'src/client-adapter.js', 'src/locales.js', 'src/host.js', 'src/protocol.js']
    .map((file) => readFileSync(resolve(ROOT, file), 'utf8'));
  for (const hash of hashes) {
    assert.equal(bundle.includes(hash), false, `the artifact names the official class ${hash}`);
    for (const source of sources) {
      assert.equal(source.includes(hash), false, `a source file names the official class ${hash}`);
    }
  }
});
```

Run: `node --test test/bundle.test.js 2>&1 | tail -20`
Expected: FAIL — the artifact is missing `[data-dsh-rt-row][data-dsh-rt-row]`.

- [ ] **Step 2: Add the adapter rules to the stylesheet**

In `src/client.js`, inside the `CSS` template literal, after the `.dsh-recent-tasks-switch{…}` line (line 111) and before the closing backtick:

```css
/* ---- Sidebar section promotion (spec 2026-10-20 §5) ----------------------
   Keyed on attributes THIS plugin stamps on the official nodes, never on
   official class names: those are build hashes that already changed once. Each
   selector repeats its attribute so the plugin rule (0,2,0) outranks the
   official module rule (0,1,0) without !important, whatever the injection order.
   The indent steps are 12px, the official tree step (spec §9-2). */
.dsh-recent-tasks-collapse{display:inline-flex;flex:none;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary,#8f959e);cursor:pointer}
.dsh-recent-tasks-collapse:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-recent-tasks-collapse:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:-2px}
.dsh-recent-tasks-collapse svg{transition:transform .15s ease-in-out}
.dsh-recent-tasks-collapse[data-collapsed="true"] svg{transform:none}
.dsh-recent-tasks-collapse[data-collapsed="false"] svg{transform:rotate(90deg)}
[data-dsh-rt-row][data-dsh-rt-row]{padding-inline-start:4px;height:36px;color:var(--dsw-alias-label-tertiary,#8f959e)}
[data-dsh-rt-row][data-dsh-rt-row]>span:nth-child(1){display:none}
[data-dsh-rt-row][data-dsh-rt-row]>span:nth-child(2){display:inline-flex}
[data-dsh-rt-block][data-dsh-rt-block]{margin-top:12px}
[data-dsh-rt-sub][data-dsh-rt-sub]{padding-inline-start:calc(8px + 12px + var(--dsh-workspace-indent,0px))}
[data-dsh-rt-overflow][data-dsh-rt-overflow]{padding-left:calc(28px + 12px + var(--dsh-workspace-indent,0px))}
html.dsh-recent-tasks-workspaces-collapsed [data-dsh-rt-list][data-dsh-rt-list]:has([data-dsh-rt-block])>div:not([data-dsh-rt-block]){display:none}
```

- [ ] **Step 3: Register the adapter in `apply()`**

In `src/client.js`, extend the import at the top of the file:

```js
import { createSectionAdapter } from './client-adapter.js';
```

and in `apply(ctx)`, right after `installStyles(ctx);` (line 396):

```js
    // Sidebar section promotion (spec 2026-10-20): the managed group reads as a
    // block-level section beside the official header, whose own heading gets a
    // collapse toggle for the groups below it. Presentation only: it writes no
    // state, calls no host method, and disables itself when the official DOM
    // does not offer the anchors it needs.
    const adapter = createSectionAdapter({ controller, t, storage: safeStorage(), logger });
    ctx.effect(() => {
      adapter.start();
      return () => adapter.stop();
    }, 'dsh-recent-tasks: sidebar section adapter');
```

`adapter` is created *after* the controller exists — if the surrounding code orders it differently, put the two blocks immediately after the `const controller = createRecentTasksController({…})` statement instead.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/build.mjs && node --test test/*.test.js 2>&1 | tail -10`
Expected: build silently writes `dist/client.js`; PASS, `# fail 0` (64 tests). The pre-existing "apply … tolerates absence" test must still pass: it runs `apply` with a DOM that has no `documentElement`, no `MutationObserver` and `localStorage === null`.

- [ ] **Step 5: Commit**

```bash
git add src/client.js dist/client.js test/bundle.test.js
git commit -m "Wire the section adapter in, and give the promoted block its look"
```

---

### Task 5: Say it in the READMEs, bump the version, and verify the whole thing

**Files:**
- Modify: `README.md`, `README.zh.md` (a new subsection next to the existing group/sidebar material)
- Modify: `package.json` (`version`)
- Modify: `dist/client.js` (rebuilt)

**Interfaces:**
- Consumes: everything above.
- Produces: the release-ready state: docs describe the promotion, its anchors, its off switches, and its two known trade-offs.

- [ ] **Step 1: Document the promotion**

In `README.zh.md` add (matching that file's heading level and voice):

```markdown
### 侧边栏层级：最近任务是一个独立区块

「最近任务」在侧边栏读作与「工作区」同层的区块，两块各自折叠：点「工作区」前面的箭头会收起**其它**工作区分组（最近任务不受影响），点「最近任务」前的箭头收起它自己那组对话。

- 这是**表现层适配**，不是新功能：仍然是一条真工作区记录、仍然钉在列表末尾，插件没有改任何官方代码、也没有改工作区数据。
- 它只认官方稳定属性（`data-row-key`、`role`、内联的 `--dsh-workspace-indent`），不认官方 class（那些是构建哈希，版本一更新就变）。DSH 升级若改了结构，这个提升会**自动停用**，侧边栏回到官方原样——不会报错、不会留残留。
- 自动停用的场景：切成「单列表」、搜索中、把侧边栏收成 56px 细栏、以及树模式下「最近任务」被嵌套在别的目录下（此时它不是同层）。
- 已知取舍：这个区块随工作区列表一起滚动；「工作区」折叠期间，位于被隐藏分组里的当前会话高亮看不到，展开即恢复。
- 折叠状态记在浏览器本地（`dsh.recent-tasks.workspaces-collapsed.v1`），只影响你自己的界面。
```

and the English mirror in `README.md`:

```markdown
### Sidebar hierarchy: Recent tasks is its own block

`Recent tasks` reads as a block-level section beside the official workspaces heading, and the two collapse independently: the arrow in front of "Workspaces" hides the *other* workspace groups (Recent tasks stays), while the arrow in front of "Recent tasks" collapses its own chats.

- This is presentation only: the group is still one real workspace record pinned last, no official file is patched and no workspace data is rewritten.
- It keys on official *stable* attributes (`data-row-key`, `role`, the inline `--dsh-workspace-indent`) and never on official class names, which are build hashes that change between releases. If a DSH update moves those anchors, the promotion **disables itself** and the sidebar falls back to the stock look, with nothing left behind.
- It also stands down for the flat list, while searching, in the 56px rail, and in tree mode when the folder is nested under another workspace (then it is not a peer).
- Known trade-offs: the block scrolls with the workspace list, and while "Workspaces" is collapsed the highlight of a chat inside a hidden group is not visible until you expand it again.
- The collapse flag lives in browser storage (`dsh.recent-tasks.workspaces-collapsed.v1`) and only affects your own UI.
```

- [ ] **Step 2: Bump the version**

In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 3: Run the full verification**

Run: `npm run verify 2>&1 | tail -12`
Expected: `node scripts/build.mjs` writes the artifact, then `# fail 0` with 64 tests.

- [ ] **Step 4: Confirm the artifact really carries the feature**

Run:

```bash
grep -c "data-dsh-rt-row" dist/client.js
grep -c "dsh-recent-tasks-workspaces-collapsed" dist/client.js
grep -c "_7514NG_\|jJkEga_\|_3WPZCG_" dist/client.js || true
```

Expected: a non-zero count for the first two; `0` for the official hashes (grep exits 1 there, hence `|| true`).

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh.md package.json dist/client.js
git commit -m "dsh-recent-tasks 0.2.0: Recent tasks as a section-level block"
```

- [ ] **Step 6: Hand the manual acceptance list to the operator**

The spec's §7.3 list is the acceptance test; paste it into the summary and ask the operator to run it in the live app (the adapter only exists in a real sidebar):

1. two blocks collapse/expand independently;
2. collapse, reload the page, the state is remembered;
3. switch to the flat list ⇒ no leftover toggle, nothing hidden; switch back ⇒ restored;
4. search ⇒ no leftovers; clear ⇒ restored;
5. collapse the sidebar to the 56px rail and expand again ⇒ still exactly one toggle;
6. rename the group from the sidebar ⇒ the restyle survives;
7. `⋯ rename/delete`, `⊕ new chat`, dragging workspaces and chats, the running dot and the pending badge, archive/pin, search hit scrolling;
8. add and delete a workspace ⇒ still applied afterwards.

---

## Self-Review

**1. Spec coverage**

| Spec section | Where |
|---|---|
| §5.1 enable conditions + disable list | Task 2 `shouldPromoteSection`, Task 3 `witness`/`stop` |
| §5.2 resolve chain + validations | Task 3 `witness`, `ancestorWithRole`, `hasRowDescendant` |
| §5.3 tags + restyle CSS, 12px step, 26px baseline | Task 4 Step 2, Task 2 `ADAPTER` |
| §5.4 injected toggle, aria, storage key | Task 3 `createButton`/`ensureButton`, Task 1 keys |
| §5.5 hide rule + `:has()` gate | Task 4 Step 2, Task 3 `supportsHideRule` |
| §5.6 replay + observer + `ctx.effect` | Task 3 `watch`/`schedule`, Task 4 Step 3 |
| §5.7 official interactions | Task 4 Step 2 (no event/state touched), Task 5 acceptance list |
| §6 error handling | Task 3 `run`/`stop` try-catch + Task 3 minimal-DOM test |
| §7.1 pure logic tests | Tasks 1, 2 |
| §7.2 artifact contract + hash guard | Task 4 Step 1 |
| §7.3 manual acceptance | Task 5 Step 6 |
| §8 write scope | Tasks 1-5 (host/protocol untouched) |
| §9-2 12px step hard-coded | Task 4 Step 2 comment |

**2. Placeholder scan** — no TBD/TODO; every code step carries the whole block; every command has its expected result.

**3. Type consistency** — `createSectionAdapter({ controller, t, storage, logger, doc, win })` is used identically in Task 3's tests and Task 4's wiring; `ADAPTER` field names are the ones Task 4's contract test greps for; `Phase` and `shouldPromoteSection` come from `client-core.js` in both Tasks 2 and 3.