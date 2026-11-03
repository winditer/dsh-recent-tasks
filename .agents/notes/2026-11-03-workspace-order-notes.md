# dsh-recent-tasks — workspace order notes (the 0.3.0 placement bug)

Source of truth: `@deepseek-ai/dsh-workspace/lib/index.js` from the shipped app
(`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`, extracted to
`.asar/x` here), plus `@deepseek-ai/dsh-client-ui-workspace/lib/client.js`.

## 1. `create()` PREPENDS. It never appends.

`WorkspaceRegistry.create` says so in its own docstring:

> A newly created workspace is prepended to the durable registry order.

and `insertBefore(id)` is the only way to move a record ("With an anchor it lands
before that workspace; without one it appends"). The sidebar renders groups in
exactly that durable order (`groupByWorkspace`, "real Workspaces in Host group
order"), so the position is user-visible, not bookkeeping.

## 2. What 0.3.0 got wrong

Commit `03bce6f` ("Remove the dead pinLast setting") deleted the `insertBefore`
call, on the theory that "the group is still appended by `create()`". It is not.
Consequence, reproduced with a registry that behaves like the real one: a fresh
install of 0.3.0 puts the 最近任务 block at index 0, so every workspace the user
already had renders **below** it — the exact report that reopened this.

The switch really did deserve deleting for a different reason: it ran on *every*
`ensure`, so a record the user dragged away was yanked back to the end on the
next chat.

## 3. The rule now

Fixed in **0.3.1**. Append the record **only when this `ensure` just created it**
(`reusedExisting === false`). A record that already exists is never reordered,
so a drag survives; a record rebuilt after deletion (auto-repair) is appended
again, which is what the user expects of a brand-new group. A failed reorder is
logged and never fails the `ensure` — the group exists, and its place is
cosmetic.

## 4. What the tests pin

`test/host.test.js`:

- `a fresh install lands below the workspaces the user already had` — the
  regression itself: seeded newest-first order, assert the new id is last;
- `a record the user dragged elsewhere is left where it was dropped` — the
  reason the call is guarded by `reusedExisting`;
- `a failed reorder keeps the group instead of failing the ensure`;
- `a repaired record is appended again after the user deleted it`;
- the idempotent-ensure test now asserts `insertBefore` runs exactly once.

The fake registry models the real contract (`order.unshift` in `create`,
`order.push` for a no-anchor `insertBefore`) so the guard cannot silently rot.

What no unit test covers: an install that already ran 0.3.0. Its record exists,
so the plugin deliberately leaves it where it is — dragging it once is the cure,
and re-appending automatically would trample a legitimate drag.