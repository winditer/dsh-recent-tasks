// The sidebar section adapter, driven against a DOM small enough to hold in
// your head.
//
// The adapter promises to search the document with exactly ONE selector
// (`[data-row-key="workspace:<id>"]`) and to reach everything else through
// `children` / `parentElement` / `getAttribute`; this fake therefore implements
// that one selector shape instead of a CSS engine. A fake that mirrored a real
// engine would only prove the fake works.
//
// Faithfulness that matters (spec §3.2): the official UI wraps EVERY row in a
// HoverCard `<span>` (ui-workspace:2043 and :2272 render
// `jsx(HoverCard, { anchor: <row> })`, and the primitive returns
// `jsxs("span", { className: "_root_38jqx_3", … })`). So the group row is NOT a
// direct child of the group container, and session rows are NOT direct children
// either. A fake that hangs them directly off the container lets an adapter that
// only walks direct children look correct — which is exactly the bug this file
// now pins down.

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

  /** What the adapter uses to skip its document-wide query on a quiet sidebar. */
  get isConnected() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node.tagName === '#DOCUMENT';
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
    const event = {
      type,
      preventDefault() {
        this.prevented = (this.prevented ?? 0) + 1;
      },
      stopPropagation() {
        this.stopped = (this.stopped ?? 0) + 1;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  /** The one selector the adapter is allowed to use. */
  querySelector(selector) {
    const exact = /^\[data-row-key="(.*)"\]$/.exec(selector);
    if (exact) return findByRowKey(this, exact[1]);
    throw new Error(`fake DOM asked for an unsupported selector: ${selector}`);
  }

  createElement(tag) {
    return new FakeNode(tag);
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
  return {
    win,
    flush: () => {
      for (const fn of queue.splice(0)) fn();
    },
  };
}

const el = (tag, attrs) => new FakeNode(tag, attrs);
const svg = () => el('svg');

/** The official HoverCard wrapper: a block-level `<span>` around the row. */
function hoverCard(child) {
  const span = el('span', { class: '_root_38jqx_3' });
  span.appendChild(child);
  return span;
}

/** A group row exactly shaped like the official one (spec §3.2). */
function groupRow(key) {
  const row = el('div', { 'data-row-key': `workspace:${key}`, role: 'treeitem', 'aria-expanded': 'true' });
  row.appendChild(el('span', { class: 'slot' })).appendChild(svg());
  row.appendChild(el('span', { class: 'slot' })).appendChild(svg());
  row.appendChild(el('span', { class: 'projectText' })).appendChild(el('span', { class: 'title' }));
  row.appendChild(el('span', { class: 'rowActions' }));
  return row;
}

function sessionRow(id) {
  return el('div', { 'data-row-key': `session:${id}`, role: 'treeitem' });
}

function overflowRow(key) {
  return el('button', { 'data-row-key': `overflow:${key}` });
}

/**
 * A group container, with the rows wrapped exactly like the official UI does
 * (unless `wrapped: false` asks for the bare shape, which must keep working).
 */
function group(key, { sessions = 2, overflow = true, wrapped = true, wrappers = 1 } = {}) {
  const block = el('div', { class: 'groupSection' });
  block.style.setProperty('--dsh-workspace-indent', '0px');
  const mount = (node) => {
    if (!wrapped) {
      block.appendChild(node);
      return;
    }
    let top = node;
    for (let layer = 0; layer < wrappers; layer += 1) top = hoverCard(top);
    block.appendChild(top);
  };
  const row = groupRow(key);
  mount(row);
  const rows = [];
  for (let index = 0; index < sessions; index += 1) {
    const session = sessionRow(`${key}-${index}`);
    rows.push(session);
    mount(session);
  }
  let overflowNode = null;
  if (overflow) {
    // The "expand the rest" button is a direct child of the container.
    overflowNode = overflowRow(key);
    block.appendChild(overflowNode);
  }
  return { block, row, rows, overflow: overflowNode, wrapper: wrapped ? block.children[0] : null };
}

/**
 * The official sidebar shape (spec §5.2), with every knob a test needs:
 * `indent: '12px'` is a group nested in tree mode, `row: false` is the single
 * list / search / rail case, `documentElement: false` is a DOM-less harness.
 */
function sidebar({
  workspaceId = 'w-recent',
  indent = '0px',
  row = true,
  header = true,
  documentElement = true,
  observer = true,
  hasHas = true,
  wrapped = true,
  wrappers = 1,
} = {}) {
  const doc = new FakeNode('#document');
  if (documentElement) doc.documentElement = el('html');
  const root = el('div', { class: 'root' });
  let headerNode = null;
  if (header) {
    headerNode = el('div', { class: 'sectionHeader' });
    headerNode.appendChild(el('span', { class: 'sectionLabel' })).appendChild(el('#text'));
    root.appendChild(headerNode);
  }
  const listArea = el('div', { class: 'listArea' });
  const treeBody = el('div', { class: 'treeBody' });
  const list = el('div', { class: 'list', role: 'tree' });
  const recent = group(workspaceId, { wrapped, wrappers });
  recent.block.style.setProperty('--dsh-workspace-indent', indent);
  if (row) list.appendChild(recent.block);
  list.appendChild(group('other', { wrapped, wrappers }).block);
  treeBody.appendChild(list);
  listArea.appendChild(treeBody);
  root.appendChild(listArea);
  const body = el('body');
  body.appendChild(root);
  doc.appendChild(body);
  doc.body = body;
  const { win, flush } = fakeWindow({ observer, hasHas });
  return {
    doc,
    win,
    flush,
    root,
    body,
    listArea,
    treeBody,
    list,
    recent: recent.block,
    wrapper: recent.wrapper,
    rowNode: row ? recent.row : null,
    sessions: recent.rows,
    overflow: recent.overflow,
    header: headerNode,
  };
}

const READY = { phase: Phase.ready, value: { workspaceId: 'w-recent' } };

function adapterFor(env, { storage = null, controller, t = T } = {}) {
  const log = [];
  const adapter = createSectionAdapter({
    controller: controller ?? {
      store: { getSnapshot: () => READY, subscribe: () => () => {} },
    },
    t,
    storage,
    logger: { warn: (...args) => log.push(args) },
    doc: env.doc,
    win: env.win,
  });
  return { adapter, log };
}

const buttonOf = (env) =>
  env.header?.children.find((child) => child.className === ADAPTER.collapseButtonClass) ?? null;

const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
};

test('a root-level group is promoted: tagged, indented, and given one toggle', () => {
  const env = sidebar();
  const { adapter, log } = adapterFor(env);
  adapter.run();

  assert.equal(log.length, 0);
  // The container BEHIND the HoverCard wrapper is the block, and the wrapper
  // itself stays untouched (it is not ours).
  assert.equal(env.recent.getAttribute(ADAPTER.blockAttr), ADAPTER.rowValue);
  assert.equal(env.wrapper.getAttribute(ADAPTER.blockAttr), null);
  assert.equal(env.wrapper.tagName, 'SPAN');
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
  assert.equal(env.list.getAttribute(ADAPTER.listAttr), '');
  // Session rows sit inside their own HoverCard wrapper and are found anyway.
  assert.equal(env.sessions[0].getAttribute(ADAPTER.subAttr), '');
  assert.equal(env.sessions[1].getAttribute(ADAPTER.subAttr), '');
  assert.equal(env.overflow.getAttribute(ADAPTER.overflowAttr), '');
  assert.equal(env.overflow.getAttribute(ADAPTER.subAttr), null);
  // Nothing else in the document is stamped.
  assert.equal(env.list.children[1].getAttribute(ADAPTER.blockAttr), null);

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

test('the bare, unwrapped row shape keeps working too', () => {
  const env = sidebar({ wrapped: false });
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(env.recent.getAttribute(ADAPTER.blockAttr), ADAPTER.rowValue);
  assert.equal(env.sessions[0].getAttribute(ADAPTER.subAttr), '');
  assert.notEqual(buttonOf(env), null);
  adapter.stop();
});

test('clicking the toggle flips the flag, the class and the aria state', () => {
  const storage = memoryStorage();
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
  const env = sidebar();
  const { adapter } = adapterFor(env, { storage: memoryStorage({ [WORKSPACES_COLLAPSED_KEY]: '1' }) });
  adapter.start();
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), true);
  assert.equal(buttonOf(env).getAttribute('aria-expanded'), 'false');

  adapter.stop();
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);
  assert.equal(buttonOf(env), null);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), null);
  assert.equal(env.recent.getAttribute(ADAPTER.blockAttr), null);
  assert.equal(env.list.getAttribute(ADAPTER.listAttr), null);
  assert.equal(env.sessions[0].getAttribute(ADAPTER.subAttr), null);
  assert.equal(env.overflow.getAttribute(ADAPTER.overflowAttr), null);
});

test('a nested group in tree mode is left completely alone', () => {
  const env = sidebar({ indent: '12px' });
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), null);
  assert.equal(buttonOf(env), null);
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);
});

test('a missing group row (single list / search / rail) disables the adapter', () => {
  const env = sidebar({ row: false });
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(buttonOf(env), null);
  assert.equal(env.list.getAttribute(ADAPTER.listAttr), null);
});

test('a header that carries rows of its own is not an injection point', () => {
  const env = sidebar();
  env.header.appendChild(el('div', { 'data-row-key': 'workspace:stray', role: 'treeitem' }));
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(buttonOf(env), null, 'no row lookup may mistake this header for the list');
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), null);
});

test('a row that is not the official group shape is left alone', () => {
  const env = sidebar();
  // A row whose second cell is not a chevron: not something we understand well
  // enough to restyle.
  env.wrapper.children[0].children.splice(1, 1);
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(buttonOf(env), null);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), null);
});

test('a state snapshot that is not ready yet disables the adapter', () => {
  const env = sidebar();
  const { adapter } = adapterFor(env, {
    controller: { store: { getSnapshot: () => ({ phase: Phase.fetching }), subscribe: () => () => {} } },
  });
  adapter.run();
  assert.equal(buttonOf(env), null);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), null);
});

test('re-running is idempotent: one tag per node, one button', () => {
  const env = sidebar();
  const { adapter } = adapterFor(env);
  adapter.run();
  adapter.run();
  adapter.run();
  assert.equal(
    env.header.children.filter((child) => child.className === ADAPTER.collapseButtonClass).length,
    1,
  );
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
  assert.equal(env.sessions[0].getAttribute(ADAPTER.subAttr), '');
  assert.equal(env.overflow.getAttribute(ADAPTER.overflowAttr), '');
});

test('a stray duplicate of our toggle is collapsed to one working toggle', () => {
  const env = sidebar();
  const storage = memoryStorage();
  // Nothing official clones the header, so this cannot happen today — but the
  // adapter must not stack toggles or reuse a dead one if it ever did.
  env.header.prepend(el('button', { class: ADAPTER.collapseButtonClass }));
  env.header.prepend(el('button', { class: ADAPTER.collapseButtonClass }));
  const { adapter } = adapterFor(env, { storage });
  adapter.run();

  const mine = env.header.children.filter((child) => child.className === ADAPTER.collapseButtonClass);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].getAttribute('aria-expanded'), 'true', 'the surviving toggle is wired up');
  mine[0].dispatch('click');
  assert.equal(storage.map.get(WORKSPACES_COLLAPSED_KEY), '1');

  adapter.stop();
  assert.equal(buttonOf(env), null);
});

test('a row without aria-expanded is not a group row we understand', () => {
  const env = sidebar();
  // Only the official group row carries `aria-expanded`; a session row does not,
  // and a row that lost it is a shape we refuse to restyle.
  env.rowNode.removeAttribute('aria-expanded');
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(buttonOf(env), null);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), null);
});

test('a row nested anywhere inside the header disqualifies it', () => {
  const env = sidebar();
  // Depth matters: the check looks for a row ANYWHERE inside the header, not just
  // among its direct children.
  const wrapper = el('span');
  wrapper.appendChild(el('div', { 'data-row-key': 'workspace:stray', role: 'treeitem' }));
  env.header.appendChild(wrapper);
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(buttonOf(env), null);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), null);
});

test('a nested child workspace keeps the official indents', () => {
  const env = sidebar();
  // In tree mode a group can hold child workspaces in `div[role="group"]`, and
  // those sessions are `session:` keys too. They must not get our extra step, or
  // a child block's chats would sit deeper than its own title.
  const nested = el('div', { role: 'group' });
  const childRow = groupRow('child');
  nested.appendChild(hoverCard(childRow));
  const childSession = sessionRow('child-0');
  nested.appendChild(hoverCard(childSession));
  const childOverflow = overflowRow('child');
  nested.appendChild(childOverflow);
  env.recent.appendChild(nested);

  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(env.recent.getAttribute(ADAPTER.blockAttr), ADAPTER.rowValue);
  assert.equal(childRow.getAttribute(ADAPTER.rowAttr), null);
  assert.equal(childSession.getAttribute(ADAPTER.subAttr), null);
  assert.equal(childOverflow.getAttribute(ADAPTER.overflowAttr), null);
  assert.equal(env.sessions[0].getAttribute(ADAPTER.subAttr), '', 'our own rows are still stamped');
});

test('the block is found however deeply the row is wrapped', () => {
  const env = sidebar({ wrappers: 2 });
  const { adapter } = adapterFor(env);
  adapter.run();
  assert.equal(env.recent.getAttribute(ADAPTER.blockAttr), ADAPTER.rowValue);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
  assert.equal(env.sessions[0].getAttribute(ADAPTER.subAttr), '');
  adapter.stop();
});

test('an official re-render is healed on the next pass, and by the observer', () => {
  const env = sidebar();
  const { adapter } = adapterFor(env);
  adapter.start();

  // React rebuilt the list: it detaches the old nodes (which is what makes the
  // cached row unusable) and renders fresh ones without our attributes.
  env.list.removeChild(env.list.children[0]);
  const rebuilt = group('w-recent');
  env.list.prepend(rebuilt.block);
  env.header.removeChild(buttonOf(env));

  adapter.run();
  assert.equal(rebuilt.row.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
  assert.equal(rebuilt.block.getAttribute(ADAPTER.blockAttr), ADAPTER.rowValue);
  assert.equal(rebuilt.rows[0].getAttribute(ADAPTER.subAttr), '');
  assert.equal(buttonOf(env).getAttribute('aria-expanded'), 'true');

  // …and the observer schedules that pass without being called by hand.
  FakeMutationObserver.instances.at(-1).trigger();
  env.flush();
  assert.equal(buttonOf(env).getAttribute('aria-expanded'), 'true');
  adapter.stop();
});

test('promotion resumes when the group row comes back (flat list -> grouped)', () => {
  const env = sidebar({ row: false });
  const { adapter } = adapterFor(env);
  adapter.start();
  assert.equal(env.rowNode, null);
  assert.equal(buttonOf(env), null);

  // The user picked "group by workspace" again: the official list re-renders
  // with the group row, and nothing else tells us about it.
  const recent = group('w-recent');
  env.list.children.unshift(recent.block);
  recent.block.parentElement = env.list;
  FakeMutationObserver.instances.at(-1).trigger();
  env.flush();
  env.flush();

  assert.notEqual(buttonOf(env), null, 'the toggle is back');
  assert.equal(recent.row.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
  assert.equal(recent.rows[0].getAttribute(ADAPTER.subAttr), '');
  adapter.stop();
});

test('a slowed-down pass cannot re-apply the promotion after stop', () => {
  const env = sidebar();
  const { adapter } = adapterFor(env);
  adapter.start();
  assert.notEqual(buttonOf(env), null);

  // A frame must be genuinely QUEUED for this to prove anything: the observer
  // fires, the pass is deferred, and the composition is torn down before it runs.
  FakeMutationObserver.instances.at(-1).trigger();
  adapter.stop();
  env.flush();
  assert.equal(buttonOf(env), null, 'a queued pass must not resurrect the toggle');
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), null);
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);
});

test('without :has() the toggle is skipped but the restyle still happens', () => {
  const env = sidebar({ hasHas: false });
  const { adapter } = adapterFor(env, { storage: memoryStorage({ [WORKSPACES_COLLAPSED_KEY]: '1' }) });
  adapter.run();
  assert.equal(buttonOf(env), null, 'an unsafe hide rule would lie, so there is no toggle at all');
  assert.equal(env.doc.documentElement.classList.contains(ADAPTER.collapsedHtmlClass), false);
  assert.equal(env.rowNode.getAttribute(ADAPTER.rowAttr), ADAPTER.rowValue);
});

test('a harness with no MutationObserver, no documentElement and no storage survives', () => {
  const env = sidebar({ documentElement: false, observer: false });
  const { adapter, log } = adapterFor(env);
  assert.doesNotThrow(() => adapter.run());
  assert.doesNotThrow(() => adapter.stop());
  assert.equal(log.length, 0, 'missing anchors are a normal state, not a warning');

  const empty = new FakeNode('#document');
  const bare = adapterFor({ doc: empty, win: fakeWindow({ observer: false }).win });
  assert.doesNotThrow(() => bare.adapter.start());
  assert.equal(bare.log.length, 0);
  bare.adapter.stop();
});