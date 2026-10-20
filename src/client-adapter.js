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
//     `clear()`: tags and toggle removed, one warning at most, nothing thrown.

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
  let scheduled = null;
  let unsubscribe = null;
  let button = null;
  let stopped = false;
  /** The last row we resolved, reused while it is still in the document. */
  let lastRow = null;
  /** Exactly what this adapter put on official nodes (node -> name -> value). */
  let tagged = new Map();

  const raf =
    typeof win?.requestAnimationFrame === 'function'
      ? { set: (fn) => win.requestAnimationFrame(fn), clear: (id) => win.cancelAnimationFrame?.(id) }
      : { set: (fn) => win?.setTimeout?.(fn, 16), clear: (id) => win?.clearTimeout?.(id) };

  const attr = (node, name) =>
    typeof node?.getAttribute === 'function' ? node.getAttribute(name) : null;
  const roleOf = (node) => attr(node, 'role') ?? '';
  const keyOf = (node) => attr(node, 'data-row-key') ?? '';
  const childrenOf = (node) => (node?.children ? [...node.children] : []);
  const hasSvg = (node) =>
    childrenOf(node).some((child) => String(child?.tagName ?? '').toLowerCase() === 'svg');
  const isOurButton = (node) =>
    node?.classList?.contains
      ? node.classList.contains(ADAPTER.collapseButtonClass)
      : node?.className === ADAPTER.collapseButtonClass;

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

  function hasWorkspaceRow(node) {
    for (const child of childrenOf(node)) {
      if (keyOf(child).startsWith('workspace:')) return true;
      if (hasWorkspaceRow(child)) return true;
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
    // Steady state: the same node is still in the document, so skip the
    // document-wide query (an attribute selector scans the whole tree, and this
    // runs up to once per frame while a chat streams). A detached node is never
    // reused, so a React re-render still forces a fresh lookup.
    let row = lastRow;
    if (!row || row.isConnected === false || keyOf(row) !== `workspace:${workspaceId}`) {
      row = findRow(workspaceId);
      lastRow = row;
    }
    if (!row || roleOf(row) !== 'treeitem') return missing;

    // The official row is [folder, chevron, title, actions] and only a group row
    // carries `aria-expanded`. Anything else is a shape we do not understand,
    // and guessing would restyle the wrong node.
    const cells = childrenOf(row);
    if (attr(row, 'aria-expanded') === null) return missing;
    if (cells.length < 3 || !hasSvg(cells[0]) || !hasSvg(cells[1])) return missing;

    // The row is NOT necessarily a DIRECT child of the group container: the
    // official UI wraps every row in a HoverCard <span> (ui-workspace:2043, and
    // the primitive renders `jsxs("span", { className: "_root_38jqx_3" })`), and
    // a later release may nest it deeper still. So walk up to the container that
    // IS a direct child of the list instead of trusting a fixed number of levels.
    const list = ancestorWithRole(row, 'tree');
    let block = row.parentElement ?? null;
    while (block && block.parentElement !== list) block = block.parentElement;
    if (!block || block.parentElement !== list) return missing;
    if (!childrenOf(list).some((group) => hasWorkspaceRow(group))) return missing;

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

  function putAttr(node, name, value) {
    try {
      if (attr(node, name) !== value) node.setAttribute(name, value);
    } catch {
      /* a detached node: nothing to stamp */
    }
  }

  function removeAttr(node, name) {
    try {
      node.removeAttribute(name);
    } catch {
      /* already gone with its subtree */
    }
  }

  /**
   * Apply the wanted attributes and release everything that is no longer wanted.
   *
   * Values that already match are not rewritten, so a pass over an unchanged
   * sidebar touches no DOM at all.
   */
  function applyTags(desired) {
    for (const [node, mine] of [...tagged]) {
      const want = desired.get(node);
      for (const name of mine.keys()) {
        if (!want?.has(name)) removeAttr(node, name);
      }
    }
    for (const [node, want] of desired) {
      for (const [name, value] of want) putAttr(node, name, value);
    }
    tagged = new Map([...desired].map(([node, want]) => [node, new Map(want)]));
  }

  function untagAll() {
    for (const [node, mine] of tagged) {
      for (const name of mine.keys()) removeAttr(node, name);
    }
    tagged = new Map();
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
    node.className = ADAPTER.collapseButtonClass;
    // Our own markup: a plugin bundle cannot reach the official icon package.
    node.innerHTML = CHEVRON_SVG;
    node.setAttribute('type', 'button');
    return activate(node);
  }

  /**
   * Bind the toggle exactly once. A node we did not create (a reused one from a
   * second adapter instance, or a stray) must still work, and must not end up
   * with two listeners. The marker is a plain JS property, so React never sees
   * it and no attribute — hence no style — changes.
   */
  function activate(node) {
    if (node.__dshRtToggle === true) return node;
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
    try {
      node.__dshRtToggle = true;
    } catch {
      /* a frozen node still got the listener */
    }
    return node;
  }

  /** One toggle, ours only; React may have thrown the old one away. */
  function ensureButton(header, collapsed) {
    const mine = childrenOf(header).filter(isOurButton);
    for (const extra of mine.slice(1)) extra.remove?.();
    let node = mine[0] ?? null;
    if (!node) {
      node = createButton();
      if (typeof header.prepend === 'function') header.prepend(node);
      else header.insertBefore?.(node, header.firstChild ?? null);
    }
    activate(node);
    const label = t(collapsed ? 'expand.workspaces' : 'collapse.workspaces');
    for (const [name, value] of [
      ['aria-expanded', collapsed ? 'false' : 'true'],
      ['aria-label', label],
      ['title', label],
      ['data-collapsed', collapsed ? 'true' : 'false'],
    ]) {
      putAttr(node, name, value);
    }
    button = node;
    return node;
  }

  function wanted({ row, block, list, header }, headerValue) {
    const desired = new Map();
    desired.set(row, new Map([[ADAPTER.rowAttr, ADAPTER.rowValue]]));
    desired.set(block, new Map([[ADAPTER.blockAttr, ADAPTER.rowValue]]));
    desired.set(list, new Map([[ADAPTER.listAttr, '']]));
    // The section header carries a MODE, not a flag: the alignment insets differ
    // when the toggle is skipped (`:has()` absent), because the label then has to
    // reach the title column without a glyph in front of it.
    if (header) desired.set(header, new Map([[ADAPTER.headerAttr, headerValue]]));
    // Session rows and the "expand the rest" button sit at whatever depth the
    // official UI chooses (each session row is wrapped in its own HoverCard
    // <span>, ui-workspace:2272), so look for `data-row-key` anywhere inside the
    // block. Two things the walk must NOT touch: a nested child workspace's own
    // rows (their keys are `workspace:`), and anything inside the child-group
    // container `div[role="group"]`, whose rows keep the official indents —
    // stamping those would push a child block's sessions past their own title.
    const walk = (node) => {
      for (const child of childrenOf(node)) {
        if (roleOf(child) === 'group') continue;
        const key = keyOf(child);
        if (key.startsWith('session:')) desired.set(child, new Map([[ADAPTER.subAttr, '']]));
        else if (key.startsWith('overflow:')) desired.set(child, new Map([[ADAPTER.overflowAttr, '']]));
        walk(child);
      }
    };
    walk(block);
    return desired;
  }

  /**
   * Watch the document for child-list changes, so the section heals itself after
   * ANY official re-render — including the ones that arrive while it is not
   * promoted (flat list, search results, the 56px rail), which are exactly the
   * states the user leaves by clicking inside the sidebar.
   *
   * Deliberately anchored on the body rather than on a sidebar node: those nodes
   * are replaced by React (an anchor that goes away is an anchor that never fires
   * again), and the pass is coalesced per animation frame and writes nothing when
   * nothing changed.
   */
  function watch() {
    if (observer || typeof win?.MutationObserver !== 'function') return;
    const scope = doc?.body ?? doc?.documentElement ?? null;
    if (!scope) return;
    try {
      observer = new win.MutationObserver(() => schedule());
      observer.observe(scope, { childList: true, subtree: true });
    } catch (error) {
      observer = null;
      logger.warn('could not watch the sidebar for re-renders:', error);
    }
  }

  /** Take the promotion back without giving up on it: the next pass may re-apply. */
  function clear() {
    dropButton();
    setCollapsedClass(false);
    untagAll();
  }

  function run() {
    if (stopped) return;
    scheduled = null;
    try {
      const snapshot = controller.store.getSnapshot();
      const workspaceId = snapshot?.value?.workspaceId ?? null;
      if (snapshot?.phase !== Phase.ready || !workspaceId) return clear();

      const found = witness(workspaceId);
      if (!shouldPromoteSection(found)) return clear();

      // Without `:has()` the hide rule would match every block, so the toggle
      // would lie: skip it and leave the section read-only (§5.5). The header
      // still gets tagged — with the mode that tells the stylesheet how far the
      // label has to move to reach the title column on its own.
      const toggle = supportsHideRule();
      applyTags(wanted(found, toggle ? ADAPTER.headerToggleValue : ADAPTER.headerPlainValue));
      const collapsed = toggle && readWorkspacesCollapsed(storage);
      setCollapsedClass(collapsed);
      if (toggle) ensureButton(found.header, collapsed);
      else dropButton();
    } catch (error) {
      logger.warn('the sidebar section adapter stopped:', error);
      clear();
    }
  }

  function schedule() {
    if (stopped || scheduled !== null) return;
    try {
      // A harness with neither rAF nor setTimeout returns undefined and queues
      // nothing at all, so the sentinel stays null and the next pass may try
      // again. Storing `undefined` here would compare `!== null` forever and
      // silently swallow every later pass.
      scheduled = raf.set(() => run()) ?? null;
    } catch {
      scheduled = null;
    }
  }

  function stop() {
    // A frame may already be queued (and rAF cannot always be cancelled), so the
    // flag — not the cancelled id — is what keeps a torn-down adapter from
    // writing to the DOM again.
    stopped = true;
    if (scheduled !== null) {
      try {
        raf.clear(scheduled);
      } catch {
        /* nothing to cancel */
      }
      scheduled = null;
    }
    lastRow = null;
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
    clear();
  }

  function start() {
    stopped = false;
    watch();
    run();
    try {
      unsubscribe = controller.store.subscribe(schedule);
    } catch {
      /* a store without subscribe still gets the observer and the pass above */
    }
  }

  return { start, stop, run };
}