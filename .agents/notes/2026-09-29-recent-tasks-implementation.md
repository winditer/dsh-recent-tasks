# dsh-recent-tasks — implementation notes

Source of truth for the design: `/Users/haifeng/Documents/dsh-tmp/docs/superpowers/specs/2026-09-29-recent-tasks-plugin-design.md`
(status: Draft). These notes record what the implementation confirmed, what it
changed, and why — the spec itself is not edited here.

## 1. Route A won over route B for settings (§8.6)

The spec named **route A** (official `Config` + `dsh-settings` /
`dsh-config-editor` / `ctx.configForms`) as the intended settings mechanism and
route B (a plugin-owned JSON file) as the fallback "when the official surface
cannot own a third-party plugin's config". The draft treated route A as
unavailable to a third-party row. **That premise is false**, and route A is what
ships:

- `dsh-settings.describe()` derives one descriptor per active loader row whose
  `Config` has at least one `.volatile()` field, keyed by `entry.options.id` —
  no registration call, no client code, `autoGenerate` defaults to `true`
  (`dsh-settings/lib/index.js` §`describe`/`volatileForm`).
- `dsh-config-editor.entries()` only requires the row to be a direct child of the
  root `include` tree with a UNIQUE id in it. A bundle patch's `insert:` row
  qualifies: the live entry id is `include:recent-tasks` (verified with the
  Cordis `Config` inspect provider against the running app).
- The write path is `configEditor.edit` → atomic `writeFileAtomic` into
  `profileContext.patchPath`, i.e. `~/.dsh/profiles/<name>/cordis.patch.yml`,
  with validation through `resolveConfig` and rollback on a failed reload. The
  plugin writes nothing itself.
- A volatile-only change does NOT remount: the loader commits the new values into
  the running `Volatile` refs and emits `loader/volatile-update`, filtered to
  listeners owned by the entry's own fiber (`Context.filter = owner => owner.fiber === fiber`).

Consequences taken into the implementation:

1. The plugin's config object is read through `resolveLiveConfig`/`readVolatile`
   on **every** `state`/`ensure` call, never captured once in `apply`.
2. `createRecentTasks` drops its cached record when the configured directory
   differs from the cached one, so a live folder change cannot make the client
   start a chat in the previous group (test: "a live settings edit moves the
   group to the new folder on the next call").
3. The host half listens to `loader/volatile-update` and re-ensures immediately;
   the listener is registered on the plugin's own context, because the filter
   above excludes listeners owned by an `inject` child fiber.
4. `enabled` and `apiPrefix` are deliberately NOT volatile — a master switch or a
   route change should remount the row.
5. The client half writes through `ctx.configForms.get('recent-tasks')` and
   degrades to a read-only hint when `configForms` is absent.

Route B survives only as documentation: no private config file exists, and
`POST /dsh-recent-tasks/api/config.set` was removed (methods are `state` and
`ensure`, both idempotent reads). `src/protocol.js` still exports
`SETTINGS_NAMESPACE = 'recent-tasks'` so both halves agree on the namespace.

## 2. Shortcut defaults (§8.4)

`shortcuts.register` rejects a default that overlaps another command on any
runtime/platform, and the official `session.new` already owns:

| runtime:platform | `session.new` | this plugin |
|---|---|---|
| desktop:* | `KeyN` + `primary` | `KeyN` + `primary+alt` |
| web:macos / web:windows | `KeyN` + `primary+alt` | `KeyN` + `primary+shift` |
| web:linux | `KeyN` + `primary+alt` | unbound |

`overlappingBindings` requires the modifier SET to be identical before comparing
codes, so none of these collide. `web:linux` is left unbound because the Web
allow-list only accepts `primary+alt` / `primary+shift` for macOS and Windows.
Registration is wrapped in try/catch: a residual collision degrades to the
sidebar button, which is the guaranteed entry.

## 3. Verified facts that shaped the code

- `workspaceRegistry.create(path, title)` realpaths, REQUIRES an existing
  directory (`create` never mkdirs), is idempotent per canonical path, ignores
  `title` when reusing, and PREPENDS a new record — hence `mkdir` → `resolveByPath`
  → `create` → `insertBefore(id)` with no anchor (append).
- The registry emits no `created`/`changed`/`deleted` event; the change signal is
  `ctx.on('domain/changed', c => c.domain === 'workspace')`. The plugin does not
  need it: `state` re-reads `get(id)` on every poll, which is cheaper than
  reacting to every unrelated workspace mutation.
- `Workspace.sessionIds` is a FILTERED view (`realpath(cwd) === path`), which is
  why a chat can never be "moved" between groups, and why history migration is
  out of scope (N1/N3 of the spec).
- `webServer.register` is synchronous, returns a disposer, throws on a duplicate
  `(kind, path)`, matches the prefix itself plus `prefix + '/'` subpaths, and the
  handler owns the raw `node:http` response.
- `workspace.json` lives at `$DSH_HOME/storages/workspace.json` (domain
  `workspace` v2, single-file layout) — durable across restart, which is what
  makes the "restart durability" acceptance criterion a property of the official
  registry rather than of this plugin.
- The client bundle's `require` resolves ONLY the platform seed words plus other
  plugin packages, so `react` is the artifact's single runtime specifier (asserted
  by `test/bundle.test.js`); every style must be tagged `data-plugin` /
  `data-plugin-css` for HMR eviction.

## 4. Deliberate open questions (§14) and the choices made

| Spec open question | Shipped choice |
|---|---|
| Default folder name | `~/Documents/DSH 最近任务` |
| Shortcut | Desktop `Mod+Alt+N`; Web `Mod+Shift+N` (web/Linux unbound) |
| Session-row "open containing folder" action | not implemented in v1 |
| Distinct group icon | not implemented (a workspace record has no icon field) |
| `autoRepair` default | `true` |
| History migration | never (mechanically impossible: session `cwd` is immutable) |

## 5. The group name follows the UI language (bug report: "切换到 english 时侧边栏/下拉里的「最近任务」没有英文化")

The reported surfaces are the sidebar group row and the workspace switcher menu.
Both render the durable Workspace record `title` **verbatim**: the official
`workspaceDisplayTitle(title, localizedDefault)` localizes only its own
`default-workspace` sentinel, and `ctx.locale.register('workspace', …)` throws for
a namespace that already owns the `(ns, locale)` pair — so the plugin's own
`name` key could never reach those two labels. The stored title was the only
lever, and it is durable data (`~/.dsh/storages/workspace.json`).

Shipped semantics (chosen by the user over "creation-time only" and "always
force"): the plugin keeps the stored title in step with the active language
**while that title is still one of its own default names** (`最近任务` /
`Recent tasks`, i.e. `AUTO_TITLES`); any other title — a sidebar rename, or a
`title` the operator configured — is durable user intent and is never rewritten.

Implementation:

- `src/locales.js` owns `GROUP_TITLES` (the one source for `zh.name` / `en.name`)
  and `AUTO_TITLES` / `isAutoTitle()`; a unit test asserts the set equals the two
  dictionary names, so the rule cannot drift from the copy.
- `planTitleSync()` in `src/client-core.js` is the pure decision: no `workspaceId`,
  a non-auto stored title, or an already-matching title all answer `null`.
- The client half runs it on every state answer and on every
  `ctx.locale.subscribe` change, and writes through the OFFICIAL
  `ctx.get('workspaces').rename(id, title)` — the same unary call the sidebar's
  rename dialog uses, which merges the returned row into the client model (both
  surfaces update live) and persists through
  `workspaceController.rename` → `Workspace.setTitle`.
- The stored title is read from the official **live** list first
  (`workspaces.list.getSnapshot().items`), not from our 30s state snapshot: a
  rename the user just made must not be clobbered by a stale read.
- `workspaceController.rename` refuses a title another group already owns
  (`workspace/name-conflict`), so that failure is memoized per
  `(workspaceId, target)` and only retried on an explicit language switch; every
  other failure stays retryable and is a `console.warn` — never a user-facing
  error, never a broken sidebar.
- The **folder on disk is never renamed**: the path is the session-grouping key
  (`Workspace.sessionIds` filters on `realpath(cwd) === path`), so moving it would
  strand existing chats in 未分组.
- A fresh install under English still creates the record as `最近任务` (the host
  half has no locale) and heals on the first client state answer. Accepted
  trade-off: it avoids giving the plugin's own API a title parameter, which would
  have let a client override the operator's configured `title`.

Coverage: `test/client.test.js` (the planner's five non-actions plus both
directions, `AUTO_TITLES` drift guard) and `test/bundle.test.js` (the BUILT
artifact driven through `apply` with the official workspace service and a real
zh/en dictionary fake: zh→en, en→zh, a user rename that stops all further writes,
and the name-conflict retry policy).