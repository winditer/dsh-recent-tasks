# dsh-recent-tasks 0.2.0 — sidebar section-promotion notes

Source of truth for this change: `docs/superpowers/specs/2026-10-20-recent-tasks-section-promotion-design.md`
(Approved) and `docs/superpowers/plans/2026-10-20-recent-tasks-section-promotion.md`.
These notes record what the implementation CONFIRMED against the shipped
0.2.1-rc.2 client, what the spec got wrong, and what a future reader must not
re-derive. Line numbers are `dsh-client-ui-workspace/lib/client.js` (=
`/tmp/dsh-live/workspace-client.js`, md5 `ff90b31390a15b5edb97d2dae40b520a`), or
`dsh-web-frontend/dist/assets/index-CN7NIWNw.js` for the primitives.

## 1. Every row is wrapped in a HoverCard `<span>` (this broke v0.2.0's first cut)

`ProjectRowItem` returns `jsx(HoverCard, { anchor: ownRow, … })` (`:2043`) unless
`row.createdAt === void 0` — and every REAL workspace has one
(`buildGroup(…, Date.parse(workspace.createdAt), …)`, `:1041`; even a missing
`createdAt` yields `NaN`, which is `!== undefined`). Only the 未分组 pseudo-group
(`:1044`) skips the wrapper. Session rows are wrapped unconditionally (`:2272`).
`HoverCard` (= `$_` in the primitives) renders
`jsxs("span", { className: cn(Gn.root, inline) })` with
`Gn.root = _root_38jqx_3 { position: relative; display: block }`.

```
div.groupSection[style="--dsh-workspace-indent:0px"]
└── span._root_38jqx_3            ← HoverCard, NOT ours to tag
    └── div.projectRow[data-row-key="workspace:<id>"]
```

Consequences, all load-bearing:

1. `row.parentElement` is **not** the group container. The adapter walks up from
   `row.parentElement` until `parentElement === list`, and requires that step to
   land on a direct child of the `role="tree"` list. Assuming one level (or two)
   silently disables the whole feature on the real machine.
2. Session rows and the "expand the rest" button are not direct children of the
   container: tagging them must **recurse** for `data-row-key` inside the block.
3. The "this list holds a workspace row" check must recurse too.

`test/adapter.test.js` models the wrapper (`hoverCard()`), plus a `wrapped: false`
and a `wrappers: 2` case: with rows hung straight off the container, an adapter
that only looked at direct children stayed green — that is exactly how the first
cut shipped broken, and the faithful fake is the regression test.

## 2. Hooks that are safe, and the one that is not

Safe and used: official `data-row-key` (`workspace:` / `session:` / `overflow:`),
`role` (`treeitem` / `group` / `tree`), `aria-expanded` (present only on a group
row), and the inline `--dsh-workspace-indent` (every group container, `:3196`).

Forbidden: official class names. They are build hashes —
`tztITa_`/`F6DNpa_`/`yuWXda_` in 0.2.0-rc.1 versus `_7514NG_`/`jJkEga_`/`_3WPZCG_`
in 0.2.1-rc.2. `test/bundle.test.js` fails the build if any of the six appears in
the artifact or the sources.

The adapter searches the document with exactly **one** selector
(`[data-row-key="workspace:<id>"]`, id escaped) and reaches everything else
through `children` / `parentElement` / `getAttribute`, remembering which nodes it
tagged so `clear()` can only ever remove its own attributes. Nothing else in the
official client renders a `workspace:` key, so the lookup is unambiguous.

## 3. CSS: how the plugin beats the official rules

The official rows rule is
`.jJkEga_projectRow,.jJkEga_sessionRow{… padding-inline-start: calc(8px + var(--dsh-workspace-indent,0px))}`
(`:1741`, specificity 0,1,0); the overflow button uses
`calc(28px + var(--dsh-workspace-indent,0px))` (0,1,0); the header is
`._7514NG_sectionHeader{… padding-left:4px; gap:4px; justify-content:flex-end}`.

- Repeating the plugin attribute twice (`[data-dsh-rt-row][data-dsh-rt-row]`,
  0,2,0) wins against every one of those without `!important`, in either
  stylesheet order. The `>span:nth-child(1|2)` rules (0,3,1 / 0,3,0) also beat
  the official chevron rules — `.projectRow .chevron{display:none}` (0,2,0) and
  `:hover .chevron{display:inline-flex}` (0,3,0) — which is what keeps the
  official toggle reachable instead of hover-only.
- **One exception:** the block rule needs the attribute THREE times.
  `._7514NG_groupSection+._7514NG_groupSection{margin-top:4px}` is 0,2,0, so
  a doubled attribute is a tie decided by document order; `(0,3,0)` settles it.
- **The alignment columns (owner request 2026-10-20, measured in a real
  browser).** The global panel rows above the section are the reference:
  `margin:0 2px; padding:7px 8px; gap:8px` around a 16px glyph, so inside the
  root's own 12px padding the GLYPH column is `12+2+8 = 22px` and the TITLE column
  `22+16+8 = 46px`. The plugin reproduces those numbers: the header takes a 10px
  inset with an 8px gap around our 16px toggle box (glyph centred on 22, label on
  46 — the toggle is a 10px triangle centred in its slot, exactly like the official
  `IconTriangleRightFillRegular` in the row below it, both centred at 30), the
  promoted row repeats 10px + 8px, a child group takes `calc(34px + indent)`
  (folder glyph on 46, its own title on 68), this block's sessions
  `calc(14px + indent)` (names on 46, the section label's own column), a child
  group's sessions `calc(36px + indent)` (names on that group's own title, 68), and
  the "expand the rest" rows take `calc(34px|56px + indent)`, landing on whichever
  column their names use. Every one of them keeps the official 12px-per-depth step
  through `--dsh-workspace-indent`, and the `:not([data-dsh-rt-*])` guards keep the
  generic child rules off our own promoted nodes (so those two rules can never
  fight over order). Verified in headless Chrome against the shipped stylesheet:
  16/16 values hit at 0.00px, no horizontal spill (list 270/270 in a 280px
  sidebar). Re-run it with `python3 measure.py harness.html` in `/tmp/geometry`.
- Without `:has()` there is no toggle to stand in the glyph column, and the
  stamped header attribute says which case we are in: `data-dsh-rt-header="toggle"`
  means the 16px glyph + 8px gap carry the label to 46px, `="plain"` means the
  header itself gets 34px of padding to reach it without a glyph.
- `--dsh-workspace-indent` is inline and does not inherit, so reading it with
  `getPropertyValue` distinguishes a root-level group (`0px`, promotable) from a
  group nested by tree mode (`12px`, not promotable).

## 4. The collapse toggle, and why the hide rule is shaped that way

One element is injected into the official DOM: a 16×16 `<button>` prepended to
the section header (the same chain `list → treeBody → listArea → root`, whose
first element child is `div.sectionHeader`). It carries `aria-expanded`,
`aria-label`, `title` and `data-collapsed`, and its click stops propagation so the
official header never sees it.

Collapsing sets a class on `document.documentElement` and relies on
`html.… [data-dsh-rt-list][data-dsh-rt-list]:has([data-dsh-rt-block])>div:not([data-dsh-rt-block]){display:none}`.
Both halves matter: the list's direct children are only group containers (the
empty state exists only with zero groups, the drop indicator and the exit-animation
overlay live in `treeBody`), and the `:has()` gate means "if my tag is not in the
tree right now, hide nothing". If `CSS.supports('selector(:has(*))')` is false the
toggle is skipped entirely and the restyle still applies — an inert-looking
control would be worse than none.

State: `dsh.recent-tasks.workspaces-collapsed.v1` in `localStorage` (`'1'` /
`'0'`), and any unreadable value means expanded. Nothing else is ever written.

## 5. Invariants: when it disables, and how it comes back

The pass is skipped (and anything it tagged is removed) when: the snapshot is not
`ready`, there is no `workspaceId`, the row is missing (flat list, search, rail),
the row lacks `aria-expanded` or its `[folder, chevron, …]` shape, the group is
nested (`--dsh-workspace-indent !== 0px`), or the header chain does not resolve.
Every path ends in `clear()` — attributes and button removed, no throw, at most a
`console.warn`.

Revival is deliberate: `clear()` keeps the observer and the snapshot subscription,
`stop()` (composition disposal) tears them down, and a `stopped` flag makes a frame
that was queued before disposal harmless. The observer watches `document.body`
rather than a sidebar node — the states that need healing are exactly the states in
which the official UI renders no list at all — coalesces to one pass per animation
frame, and writes nothing when nothing changed. The last resolved row is reused
while it is still `isConnected`, which skips the document-wide query in the steady
state.

## 6. A nested child workspace keeps the official indents

`div[role="group"]` inside a group container holds child workspaces and their own
sessions (`:3201-3203`). Those sessions are `session:` keys too, so the tagging
walk must NOT descend into that container: stamping them would push a child
block's chats one step past their own title. Their own workspace row is skipped by
key prefix.

## 7. What the tests pin, and what they cannot

`test/adapter.test.js` (hand-rolled DOM): promotion, the wrapper and bare shapes,
two-level wrapping, disabled paths, idempotence, the toggle's three surfaces,
the remembered flag, re-render healing through the observer, flat→grouped revival,
the pre-disposal frame, nested child workspaces, the duplicate-toggle safety net,
and a bare harness with no `MutationObserver` / `documentElement` / storage.
`test/bundle.test.js`: the artifact is a loadable classic script registering both
slots, whole `selector{declaration}` rules for the promotion (a selector-only
check passes while the browser renders it wrong), the `ADAPTER` vocabulary the
stylesheet must name, and the absence of official class hashes.

Six behaviours were additionally verified by mutation (revert the guard, watch a
test fail): the `stopped` early return, the `role="group"` skip, the recursive
header check, the `aria-expanded` guard, the ancestry climb, and the two
`nth-child` declarations.

What no test can establish here: the real geometry, drag/hover behaviour while
collapsed, and the cost of one O(sidebar) read per frame during a streaming
response. Those stay on the acceptance list.

## 8. Accepted trade-offs (owner's call, not oversights)

No divider line — the block keeps the list's own 4px rhythm, the same 4px the panel
rows above use (the first cut added a 12px break on top of it, and the owner asked
for the panel spacing); the 12px indent step is hard-coded; the toggle
is always visible; the block scrolls with the workspace list; while the other
groups are collapsed a chat's highlight inside them is invisible until expanded;
and one frame can show the groups again while React replaces the container before
the replay runs. Each is one line of CSS or JS away if the owner wants it
different.