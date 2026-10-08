# 最近任务·每对话独立工作目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「最近任务」从共享一个目录改成每个对话一个独立工作目录，并让侧边栏那条记录的名字跟随会话标题。

**Architecture:** 客户端铸会话 id → Host 的 `allocate` 动词抢占式建 `<root>/<token>/` 并为它注册/复用工作区记录 → 客户端用 `sessions.create({cwd, sessionId})` 建会话、写占位名、`openSession` 导航 → 之后会话列表的 `displayTitle` 单向镜像到工作区名。Host 的 `state` 增补派生出来的 `tasks` 清单（registry 里的直接子目录），不新增任何存储。

**Tech Stack:** 纯 ESM、零运行时依赖（可选 peer `@deepseek-ai/schemastery`）、`node --test`、esbuild 打 `dist/client.js`、官方 `workspaces` / `sessions` / `uiWorkspace` 客户端服务。

**Spec:** [`docs/superpowers/specs/2026-09-29-recent-tasks-isolated-dirs-design.md`](../specs/2026-09-29-recent-tasks-isolated-dirs-design.md)

## Global Constraints

- **无 git 仓库**：本仓库没有 `.git`，「commit」步骤一律替换为「跑测试并确认全绿」这道门禁。不要执行 `git` 命令。
- **构建是交付物**：`dist/client.js` 由 `node scripts/build.mjs` 生成，改完 `src/` 必须重建，且 `test/bundle.test.js` 会重新构建并断言产物契约。
- **工具链**（本机没有全局 node）：
  - `NODE=~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node`
  - 测试：`$NODE --test test/*.test.js`（基线 **49 pass / 0 fail**）
  - 构建：`$NODE scripts/build.mjs`
  - esbuild 已软链进 `node_modules/`（0.25.12），不要重装。
- **两侧共用 `src/protocol.js`**：它不得 import `node:fs` / React / DOM。
- **Host 不下发展示文案**：错误一律是 `protocol.js` 里的 `CODES` 码，文案在 `src/locales.js`。
- **`state` 绝不写盘**：不 mkdir、不 create、不排序（v1 既有承诺，测试 §7.1 也在守）。
- **有副作用的动词只有 `ensure` 与 `allocate`**；两者都必须幂等或可安全重试。
- **编辑既有文件前先读它**（fs-observation 策略要求）。
- 命名与文案：占位名 zh `新任务` / en `New task`；目录 token 形如 `20260929-173312-a1b2`。

---

### Task 1: `src/task-dirs.js` — token 铸造与解析（纯逻辑）

**Files:**
- Create: `src/task-dirs.js`
- Test: `test/task-dirs.test.js`

**Interfaces:**
- Consumes: `./protocol.js` 的 `isUnder` 不在此模块（`isUnder` 在 `host.js`），本模块**自身零依赖**。
- Produces:
  - `SESSION_ID_MAX = 128`
  - `isValidSessionId(value: unknown): boolean`
  - `mintTaskToken({ date?: Date, random?: () => string }): string` — 形如 `20260929-173312-a1b2`
  - `isTaskToken(token: string): boolean`
  - `taskPathFor(root: string, token: string): string`
  - `resolveSessionTask(tasks, sessionId, byId)` — 见下

- [ ] **Step 1: 写失败的测试**

```js
// test/task-dirs.test.js
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  SESSION_ID_MAX,
  isTaskToken,
  isValidSessionId,
  mintTaskToken,
  resolveSessionTask,
  taskPathFor,
} from '../src/task-dirs.js';

test('isValidSessionId accepts a shaped id and refuses anything else', () => {
  assert.equal(isValidSessionId('session-123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(isValidSessionId('abc_123-X'), true);
  assert.equal(isValidSessionId(''), false);
  assert.equal(isValidSessionId('   '), false);
  assert.equal(isValidSessionId('has space'), false);
  assert.equal(isValidSessionId('slash/../escape'), false);
  assert.equal(isValidSessionId('x'.repeat(SESSION_ID_MAX + 1)), false);
  assert.equal(isValidSessionId(undefined), false);
  assert.equal(isValidSessionId(42), false);
});

const FIXED = new Date(2026, 8, 29, 17, 33, 12); // 2026-09-29 17:33:12 local

test('mintTaskToken renders a local timestamp plus a short random suffix', () => {
  assert.equal(mintTaskToken({ date: FIXED, random: () => 'a1b2' }), '20260929-173312-a1b2');
  assert.equal(isTaskToken('20260929-173312-a1b2'), true);
  assert.equal(isTaskToken('20260929-173312'), false);
  assert.equal(isTaskToken('../escape'), false);
  assert.equal(isTaskToken(''), false);
});

test('mintTaskToken never emits a separator or a dot', () => {
  for (const sample of ['0000', 'zzzz', 'aB9x']) {
    const token = mintTaskToken({ date: FIXED, random: () => sample });
    assert.match(token, /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/);
  }
});

test('taskPathFor joins with exactly one separator', () => {
  assert.equal(taskPathFor('/root', 'tok'), '/root/tok');
  assert.equal(taskPathFor('/root/', 'tok'), '/root/tok');
  assert.equal(taskPathFor('/root//', 'tok'), '/root/tok');
});

test('resolveSessionTask prefers the reported list and never guesses outside it', () => {
  const tasks = [
    { token: 't1', path: '/root/t1', workspaceId: 'w1', sessionId: 's1' },
    { token: 't2', path: '/root/t2', workspaceId: 'w2', sessionId: null },
  ];
  assert.equal(resolveSessionTask(tasks, 's1'), 'w1');
  assert.equal(resolveSessionTask(tasks, 's2'), null);
  assert.equal(resolveSessionTask([], 's1'), null);
  assert.equal(resolveSessionTask(undefined, 's1'), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$NODE --test test/task-dirs.test.js`
Expected: FAIL — `Cannot find module '../src/task-dirs.js'`

- [ ] **Step 3: 写最小实现**

```js
// src/task-dirs.js
// Pure helpers for per-conversation task directories. No node:fs, no DOM: both
// halves and the unit tests import this module.

/** Longest session id the allocate endpoint accepts. */
export const SESSION_ID_MAX = 128;

/** Session ids become host-side validation subjects, never path segments. */
const SESSION_ID_SHAPE = /^[A-Za-z0-9_-]+$/;

/** Whether `value` is a session id the host is willing to allocate for. */
export function isValidSessionId(value) {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (!raw || raw.length > SESSION_ID_MAX) return false;
  return SESSION_ID_SHAPE.test(raw);
}

/** `<YYYYMMDD>-<HHmmss>-<4 base36>`: sorts by time, carries no session meaning. */
const TOKEN_SHAPE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/;

function pad(value, width) {
  return String(value).padStart(width, '0');
}

/** A local-time token; `random` is injectable so tests are deterministic. */
export function mintTaskToken({ date = new Date(), random } = {}) {
  const draw = typeof random === 'function' ? random : () => Math.random().toString(36).slice(2, 6);
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`
    + `-${pad(date.getHours(), 2)}${pad(date.getMinutes(), 2)}${pad(date.getSeconds(), 2)}`;
  const suffix = String(draw()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4).padEnd(4, '0');
  return `${stamp}-${suffix}`;
}

/** Whether `token` is safe to use as one path segment. */
export function isTaskToken(token) {
  return typeof token === 'string' && TOKEN_SHAPE.test(token);
}

/** The absolute task directory for `token` under `root`. */
export function taskPathFor(root, token) {
  const base = String(root ?? '').replace(/[\\/]+$/, '');
  return `${base}/${token}`;
}

/**
 * The workspace id owning `sessionId`, from the host-reported task list.
 * Unknown or absent → null; this helper never guesses.
 */
export function resolveSessionTask(tasks, sessionId) {
  if (!sessionId) return null;
  const list = Array.isArray(tasks) ? tasks : [];
  for (const task of list) {
    if (task && task.sessionId === sessionId && typeof task.workspaceId === 'string' && task.workspaceId) {
      return task.workspaceId;
    }
  }
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `$NODE --test test/task-dirs.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: 跑全量测试（门禁）**

Run: `$NODE --test test/*.test.js`
Expected: 54 pass / 0 fail（49 基线 + 5 新增）

---

### Task 2: `src/protocol.js` — `allocate` 动词与响应校验

**Files:**
- Modify: `src/protocol.js:22-26`（METHODS / READ_ONLY_METHODS）、`validateStateValue`（新增 `tasks`）、文末新增两个函数
- Test: `test/protocol.test.js`

**Interfaces:**
- Produces:
  - `METHODS = ['state', 'ensure', 'allocate']`
  - `READ_ONLY_METHODS = ['state', 'ensure']`（不变 —— `allocate` 会写盘）
  - `validateStateValue(value).tasks: Array<{ token, path, workspaceId, sessionId, title }>`
  - `validateAllocateValue(value): { path, token, workspaceId, created } | null`
  - `readAllocateResponse(payload): { ok: true, value } | { ok: false, code, message? }`

- [ ] **Step 1: 写失败的测试**（追加到 `test/protocol.test.js` 末尾）

```js
test('allocate is a known method but not a read-only one', () => {
  assert.equal(isKnownMethod('allocate'), true);
  assert.equal(METHODS.includes('allocate'), true);
  assert.equal(READ_ONLY_METHODS.includes('allocate'), false);
});

test('validateStateValue keeps a well-formed task list and drops junk entries', () => {
  const value = validateStateValue({
    path: '/root',
    tasks: [
      { token: 't1', path: '/root/t1', workspaceId: 'w1', sessionId: 's1', title: 'A' },
      { token: '', path: '/root/t2', workspaceId: 'w2' },
      { path: '/root/t3', workspaceId: 'w3' },
      null,
      'nope',
    ],
  });
  assert.equal(value.tasks.length, 1);
  assert.deepEqual(value.tasks[0], {
    token: 't1', path: '/root/t1', workspaceId: 'w1', sessionId: 's1', title: 'A',
  });
  assert.deepEqual(validateStateValue({ path: '/root' }).tasks, []);
});

test('validateAllocateValue refuses a payload without a usable path', () => {
  assert.deepEqual(
    validateAllocateValue({ path: '/root/t', token: 't', workspaceId: 'w', created: true }),
    { path: '/root/t', token: 't', workspaceId: 'w', created: true },
  );
  assert.equal(validateAllocateValue({ token: 't', workspaceId: 'w' }), null);
  assert.equal(validateAllocateValue({ path: '' }), null);
  assert.equal(validateAllocateValue(null), null);
  assert.equal(validateAllocateValue({ path: '/root/t' }).workspaceId, null);
  assert.equal(validateAllocateValue({ path: '/root/t' }).created, false);
});

test('readAllocateResponse mirrors readStateResponse on both branches', () => {
  const ok = readAllocateResponse({ ok: true, value: { path: '/root/t', token: 't', workspaceId: 'w' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.path, '/root/t');
  const bad = readAllocateResponse({ ok: false, code: 'dir-not-writable' });
  assert.deepEqual(bad, { ok: false, code: 'dir-not-writable', message: undefined });
  assert.equal(readAllocateResponse(null).code, CODES.internal);
  assert.equal(readAllocateResponse({ ok: true, value: {} }).code, CODES.internal);
});
```

同时把 `test/protocol.test.js` 顶部的 import 补齐：`METHODS`、`READ_ONLY_METHODS`、`validateAllocateValue`、`readAllocateResponse`。

- [ ] **Step 2: 跑测试确认失败**

Run: `$NODE --test test/protocol.test.js`
Expected: FAIL — `validateAllocateValue is not a function`

- [ ] **Step 3: 改 `src/protocol.js`**

三处改动：

```js
/** Methods the host half serves. `ensure`/`allocate` are idempotent writers. */
export const METHODS = Object.freeze(['state', 'ensure', 'allocate']);

/** Methods that may never touch the registry or the config file. */
export const READ_ONLY_METHODS = Object.freeze(['state', 'ensure']);
```

在 `validateStateValue` 的 `return` 之前加入任务清单归一化，并在返回值里带上 `tasks`：

```js
function normalizeTasks(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const token = typeof entry.token === 'string' && entry.token ? entry.token : '';
    const path = typeof entry.path === 'string' && entry.path ? entry.path : '';
    if (!token || !path) continue;
    out.push({
      token,
      path,
      workspaceId: typeof entry.workspaceId === 'string' && entry.workspaceId ? entry.workspaceId : null,
      sessionId: typeof entry.sessionId === 'string' && entry.sessionId ? entry.sessionId : null,
      title: typeof entry.title === 'string' && entry.title ? entry.title : null,
    });
  }
  return out;
}
```

```js
    code: typeof value.code === 'string' ? value.code : null,
    tasks: normalizeTasks(value.tasks),
  };
```

文末新增：

```js
/** Validate an `allocate` payload; `null` when it cannot name a directory. */
export function validateAllocateValue(value) {
  if (!value || typeof value !== 'object') return null;
  const path = typeof value.path === 'string' && value.path ? value.path : null;
  if (!path) return null;
  return {
    path,
    token: typeof value.token === 'string' && value.token ? value.token : null,
    workspaceId: typeof value.workspaceId === 'string' && value.workspaceId ? value.workspaceId : null,
    created: value.created === true,
  };
}

/** Normalize an `allocate` response body, same contract as `readStateResponse`. */
export function readAllocateResponse(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, code: CODES.internal };
  if (payload.ok !== true) {
    const code = typeof payload.code === 'string' && payload.code ? payload.code : CODES.internal;
    return { ok: false, code, message: typeof payload.message === 'string' ? payload.message : undefined };
  }
  const value = validateAllocateValue(payload.value);
  if (!value) return { ok: false, code: CODES.internal };
  return { ok: true, value };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `$NODE --test test/protocol.test.js`
Expected: PASS（原 8 + 新增 4 = 12）

- [ ] **Step 5: 门禁**

Run: `$NODE --test test/*.test.js`
Expected: 58 pass / 0 fail

---

### Task 3: Host 半边 — `allocate` 服务与 `state.tasks`

**Files:**
- Modify: `src/host.js`（`createRecentTasks` 增加 `allocate`、`snapshot` 增加 `tasks`、导出 `taskPathFor` 复用）
- Test: `test/host.test.js`

**Interfaces:**
- Consumes: `mintTaskToken` / `isTaskToken` / `isValidSessionId` / `taskPathFor`（Task 1）
- Produces:
  - `createRecentTasks({..., fs: { mkdir, realpath, stat } })` 返回值新增 `allocate({ sessionId }): Promise<Result>`
  - `Result.value: { path, token, workspaceId, groupWorkspaceId, created }`
  - `snapshot.value.tasks: Array<{ token, path, workspaceId, sessionId, title }>` — `sessionId` 在 Host 侧恒为 `null`（Host 不读会话日志，映射由客户端持有）
  - `taskTokenOf(path, root): string | null`（导出，供测试）

**实现要点（必须遵守）：**

1. `allocate` 先 `ensure()` 根分组（复用现有逻辑与它的错误码），再铸 token。
2. 建目录用 `mkdir(fn, { recursive: false })`；`EEXIST` → 换 token 重试，上限 **8** 次 → `dir-not-writable`。
3. `registry.resolveByPath(canonical)` 命中即复用（`created: false`），否则 `create`（`created: true`）。
4. 排序：**先** `insertBefore(groupId)`，**再** `insertBefore(taskId)`，保证根分组在末尾、新任务紧随其前。
5. `tasks` 清单从 `registry.list()` **派生**：`isUnder(record.path, root)` 即为任务（不新增存储、不新增 fs 调用）。
6. `state` 保持只读：只读 registry，不 mkdir、不 create、不 insertBefore。

- [ ] **Step 1: 写失败的测试**（追加到 `test/host.test.js` 末尾）

```js
test('allocate creates one directory, registers it and pins the group after it', async () => {
  const { service, registry } = makeService({ config: {}, random: () => 'a1b2' });
  await service.ensure();
  const groupId = service.getCachedId();

  const result = await service.allocate({ sessionId: 'session-abc' });
  assert.equal(result.ok, true);
  assert.equal(result.value.token.length, 20);
  assert.equal(result.value.created, true);
  assert.ok(result.value.workspaceId);
  assert.equal(result.value.groupWorkspaceId, groupId);
  assert.equal(result.value.path.endsWith(`/${result.value.token}`), true);

  // The group stays last, the task sits directly before it.
  assert.deepEqual(registry.order, [result.value.workspaceId, groupId]);

  // state reports the derived task list.
  const snapshot = await service.state();
  assert.equal(snapshot.value.tasks.length, 1);
  assert.equal(snapshot.value.tasks[0].workspaceId, result.value.workspaceId);
  assert.equal(snapshot.value.tasks[0].path, result.value.path);
});

test('allocate is idempotent for an existing directory and reports created:false', async () => {
  const { service, registry } = makeService({ config: {}, random: () => 'a1b2' });
  await service.ensure();
  const once = await service.allocate({ sessionId: 'session-abc' });
  const twice = await service.allocate({ sessionId: 'session-abc' });
  assert.equal(twice.ok, true);
  assert.equal(twice.value.workspaceId, once.value.workspaceId);
  assert.equal(twice.value.created, false);
  assert.equal(registry.records.size, 2, 'group + one task, never a third record');
});

test('allocate refuses a malformed session id without writing anything', async () => {
  const { service, registry } = makeService({ config: {} });
  const result = await service.allocate({ sessionId: '../escape' });
  assert.equal(result.ok, false);
  assert.equal(result.code, CODES.badRequest);
  assert.equal(registry.records.size, 0);
  assert.equal(registry.calls.mkdir, 0);
});

test('allocate reports dir-not-writable when the task directory cannot be made', async () => {
  const registry = fakeRegistry();
  const { service } = makeService({
    config: {}, registry,
    fs: {
      mkdir: async (_path, options) => {
        if (options && options.recursive === false) {
          const error = new Error('nope'); error.code = 'EACCES'; throw error;
        }
      },
      realpath: async (p) => p,
      stat: async () => ({ isDirectory: () => true }),
    },
  });
  const result = await service.allocate({ sessionId: 'session-abc' });
  assert.equal(result.ok, false);
  assert.equal(result.code, CODES.dirNotWritable);
});

test('allocate retries past a token collision', async () => {
  const draws = ['a1b2', 'a1b2', 'c3d4'];
  const registry = fakeRegistry();
  let attempts = 0;
  const { service } = makeService({
    config: {}, registry,
    random: () => draws[Math.min(attempts++, draws.length - 1)],
    fs: {
      mkdir: async (_path, options) => {
        if (options && options.recursive === false) {
          const error = new Error('exists'); error.code = 'EEXIST'; throw error;
        }
      },
      realpath: async (p) => p,
      stat: async () => ({ isDirectory: () => true }),
    },
  });
  const result = await service.allocate({ sessionId: 'session-abc' });
  assert.equal(result.ok, true);
  assert.equal(result.value.token.endsWith('c3d4'), true, 'the third draw is used');
});

test('a task whose record vanished is reported with workspaceId null and missing-record', async () => {
  const { service, registry } = makeService({ config: {} });
  await service.ensure();
  const task = await service.allocate({ sessionId: 'session-abc' });
  registry.deleteRecord(task.value.workspaceId);
  const snapshot = await service.state();
  assert.equal(snapshot.value.code, CODES.missingRecord);
  assert.equal(snapshot.value.tasks[0].workspaceId, null);
});
```

`makeService` 需要多传一个 `random` 与可覆盖的 `fs`；把测试文件的 `makeService` 改成：

```js
function makeService({ config = {}, registry, fs, live = false, random } = {}) {
  const reg = registry ?? fakeRegistry();
  const read = () => resolveLiveConfig(config, { home: HOME }).config;
  return {
    registry: reg,
    service: createRecentTasks({
      registry: reg,
      fs: fs ?? fakeFs(reg),
      logger: { warn() {} },
      config: live ? read : read(),
      random,
    }),
  };
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$NODE --test test/host.test.js`
Expected: FAIL — `service.allocate is not a function`

- [ ] **Step 3: 改 `src/host.js`**

imports：

```js
import { isTaskToken, isValidSessionId, mintTaskToken, taskPathFor } from './task-dirs.js';
```

`createRecentTasks` 的签名与内部新增：

```js
export function createRecentTasks({ registry, fs = {}, logger, config, random }) {
  const mkdirFn = fs.mkdir ?? mkdir;
  const realpathFn = fs.realpath ?? realpath;
  const statFn = fs.stat ?? stat;
  const readConfig = typeof config === 'function' ? config : () => config;
  const MAX_TOKEN_ATTEMPTS = 8;
```

`snapshot` 里 `tasks` 的派生（放在 `return` 前）：

```js
  /** Tasks = registered records that are direct children of the group folder. */
  function derivedTasks(root, groupId) {
    const out = [];
    for (const record of safeList()) {
      if (!record || !record.id || record.id === groupId) continue;
      if (!record.path || !isUnder(record.path, root)) continue;
      const token = record.path.slice(root.replace(/[\\/]+$/, '').length + 1);
      if (!isTaskToken(token)) continue;
      out.push({
        token,
        path: record.path,
        workspaceId: record.id,
        sessionId: null, // the client owns the session↔task mapping
        title: record.title ?? null,
      });
    }
    return out;
  }
```

```js
        tasks: derivedTasks(cache?.path ?? path, cache?.id ?? null),
      },
    };
  }
```

`allocate` 本体（放在 `ensure` 之后、`state` 之前）：

```js
  /**
   * Allocate ONE per-conversation directory plus its workspace record.
   *
   * Writes (mkdir + registry create + reorder), so it is deliberately NOT part of
   * `state`. Idempotent for an unchanged root: the same session re-allocated gets
   * `created: false` and the same record, because the token is minted from the
   * clock and a repeated call within the same second simply collides and is
   * reused by path.
   */
  async function allocate(request = {}) {
    repaired = false;
    const current = readConfig();
    syncConfig(current);
    if (!current.enabled) return fail(CODES.disabled);
    if (!isValidSessionId(request.sessionId)) return fail(CODES.badRequest, 'invalid session id');

    const root = await ensure();
    if (!root.ok) return root;
    const rootValue = root.value;
    const canonicalRoot = rootValue.path;
    const groupId = rootValue.workspaceId;

    let token = '';
    let canonical = '';
    let createdDir = false;
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
      const candidate = mintTaskToken({ random });
      const dir = taskPathFor(canonicalRoot, candidate);
      try {
        await mkdirFn(dir, { recursive: false });
        // The injected test mkdir may not report EEXIST; a real one does.
        token = candidate;
        canonical = dir;
        createdDir = true;
        break;
      } catch (error) {
        if (error && error.code === 'EEXIST') { token = candidate; canonical = dir; createdDir = false; break; }
        logger?.warn?.(`dsh-recent-tasks: cannot create '${dir}': ${String(error)}`);
        return fail(codeForFsError(error));
      }
    }
    if (!token) return fail(CODES.dirNotWritable, 'could not mint a unique task directory');

    try {
      canonical = await realpathFn(canonical);
    } catch (error) {
      return fail(codeForFsError(error));
    }

    let record;
    let createdRecord = false;
    try {
      record = await registry.resolveByPath(canonical);
      if (!record) {
        record = await registry.create(canonical, current.title);
        createdRecord = true;
      }
    } catch (error) {
      logger?.warn?.(`dsh-recent-tasks: cannot register '${canonical}': ${String(error)}`);
      return fail(codeForFsError(error, CODES.internal), String(error?.message ?? error));
    }
    if (!record || !record.id) return fail(CODES.internal, 'workspace registry returned no record');

    if (current.pinLast) {
      try {
        if (groupId) await registry.insertBefore(groupId);   // group last
        await registry.insertBefore(record.id);              // task right before it
      } catch (error) {
        logger?.warn?.(`dsh-recent-tasks: cannot order the task group: ${String(error)}`);
      }
    }

    return {
      ok: true,
      value: {
        path: canonical,
        token,
        workspaceId: record.id,
        groupWorkspaceId: groupId ?? null,
        created: createdDir || createdRecord,
      },
    };
  }
```

返回值新增 `allocate`：

```js
  return {
    ensure,
    allocate,
    state,
    currentConfig: () => ({ ...readConfig() }),
    getCachedId: () => cache?.id ?? null,
  };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `$NODE --test test/host.test.js`
Expected: PASS（原 15 + 新增 6 = 21）

- [ ] **Step 5: 门禁**

Run: `$NODE --test test/*.test.js`
Expected: 64 pass / 0 fail

---

### Task 4: Host 端点接线 — `allocate` 走同一个加固处理器

**Files:**
- Modify: `src/host.js`（`createApiHandler` 的动词分发）
- Test: `test/host.test.js`

**Interfaces:**
- Consumes: `service.allocate`（Task 3）
- Produces: `POST <apiPrefix>/allocate` → 200 `{ok:true,value}` / 400 `{ok:false,code}`；沿用 POST-only、`application/json`、body 上限、未知名词 404

- [ ] **Step 1: 写失败的测试**（追加到 `test/host.test.js`）

```js
test('the API dispatches allocate and still refuses other verbs', async () => {
  const { service } = makeService({ config: {} });
  const handler = createApiHandler({ service, logger: { warn() {} } });
  const call = (method, body) => new Promise((resolve) => {
    const res = { writeHead: (status, headers) => resolve({ status, headers }), end: (text) => resolve({ status: res.status, body: text }) };
    const req = { method, headers: { 'content-type': 'application/json' }, url: `${API_PREFIX}/${method}`, [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body ?? {})); } };
    // capture status from writeHead
    let status = 0;
    res.writeHead = (code) => { status = code; };
    res.end = (text) => resolve({ status, body: text });
    res.getStatus = () => status;
    handler(req, res);
  });

  const ok = await call('allocate', { sessionId: 'session-abc' });
  assert.equal(ok.status, 200);
  const parsed = JSON.parse(ok.body);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.value.path);

  const bad = await call('allocate', { sessionId: 'nope/../x' });
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(bad.body).code, CODES.badRequest);

  const unknown = await call('destroy', {});
  assert.equal(unknown.status, 404);
  assert.equal(JSON.parse(unknown.body).code, CODES.unknownMethod);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$NODE --test test/host.test.js`
Expected: FAIL — 404 / `unknown-method`（分发里还没有 `allocate`）

- [ ] **Step 3: 改 `createApiHandler` 的分发**

```js
      const result = method === 'state'
        ? await service.state()
        : method === 'allocate'
          ? await service.allocate(await readJsonBody(req))
          : await service.ensure();
```

注意：body 已被读掉一次用于 CSRF/大小校验，这里需要复用解析结果 —— 把处理器上半段改成保留解析值：

```js
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (error) { /* 原样保留 */ }
```

然后把 `await readJsonBody(req)` 换成 `body`。

- [ ] **Step 4: 跑测试确认通过**

Run: `$NODE --test test/host.test.js`
Expected: PASS（22 tests）

- [ ] **Step 5: 门禁**

Run: `$NODE --test test/*.test.js`
Expected: 65 pass / 0 fail

---

### Task 5: 客户端计划器 — `planCreate` 返回 `allocate`

**Files:**
- Modify: `src/client-core.js`（`planCreate` 的 ready 分支 + 新增 `mintSessionId`）
- Test: `test/client.test.js`

**Interfaces:**
- Produces:
  - `planCreate(snapshot, workspaces)` → `{ kind: 'allocate' }`（v2 正常路径；不再返回 `ready`）
  - `mintSessionId(random?)` → `session-<uuid>`
  - `creationBlock` 语义不变

- [ ] **Step 1: 写失败的测试**（追加到 `test/client.test.js`）

```js
test('planCreate allocates instead of reusing the group folder', () => {
  const plan = planCreate({ phase: Phase.ready, value: snapshot().value }, workspaces([{ id: GROUP, path: PATH }]));
  assert.deepEqual(plan, { kind: 'allocate' });
});

test('planCreate still blocks every v1 failure before allocating', () => {
  assert.equal(planCreate({ phase: Phase.init }, []).kind, 'blocked');
  assert.equal(planCreate({ phase: Phase.ready, value: snapshot({ enabled: false }).value }, []).code, CODES.disabled);
  assert.equal(planCreate({ phase: Phase.ready, value: snapshot({ workspaceId: null, code: CODES.missingRecord }).value }, []).code, CODES.missingRecord);
  assert.equal(planCreate({ phase: Phase.ready, value: snapshot({ path: '' }).value }, []).code, CODES.badConfig);
});

test('planCreate ensures when the folder or record is stale', () => {
  assert.equal(planCreate({ phase: Phase.ready, value: snapshot({ workspaceId: null }).value }, []).kind, 'ensure');
  assert.equal(planCreate({ phase: Phase.ready, value: snapshot({ dirExists: false }).value }, workspaces([{ id: GROUP, path: PATH }])).kind, 'ensure');
  assert.equal(planCreate({ phase: Phase.ready, value: snapshot().value }, workspaces([{ id: GROUP, path: '/somewhere/else' }])).kind, 'ensure');
});

test('mintSessionId yields a shaped, unique id', () => {
  const id = mintSessionId(() => 0);
  assert.match(id, /^session-[0-9a-f-]{36}$/);
  assert.notEqual(mintSessionId(), mintSessionId());
});
```

import 补齐 `mintSessionId`。

- [ ] **Step 2: 跑测试确认失败**

Run: `$NODE --test test/client.test.js`
Expected: FAIL — `deepEqual: expected { kind: 'ready' … }`

- [ ] **Step 3: 改 `src/client-core.js`**

`planCreate` 的 `ready` 分支全部换成 `allocate`：

```js
/**
 * Decide what the "new recent task" action must do (spec v2 §5.3).
 *
 * v2 never reuses the group folder as a conversation directory: every new
 * conversation gets its own directory from the host. The stale-folder and
 * missing-record cases still end in `ensure`, so the group record is repaired
 * before a task is allocated under it.
 */
export function planCreate(snapshot, workspaces) {
  const block = creationBlock(snapshot);
  if (block) return { kind: 'blocked', code: block.code, ...(block.messageKey ? { messageKey: block.messageKey } : {}) };
  const value = snapshot.value;
  const list = workspaces === undefined || workspaces === null
    ? []
    : (Array.isArray(workspaces) ? workspaces : [...workspaces]);

  if (!value.workspaceId) return { kind: 'ensure' };
  const id = String(value.workspaceId);
  const live = list.map(workspaceIdOf).filter(Boolean);
  if (live.length === 0) return value.dirExists === false ? { kind: 'ensure' } : { kind: 'allocate' };
  const row = list.find((item) => workspaceIdOf(item) === id);
  if (!row) return { kind: 'ensure' };
  const rowPath = typeof row.path === 'string' ? row.path : '';
  if (rowPath && normalizeDirPath(rowPath) !== normalizeDirPath(value.path)) return { kind: 'ensure' };
  if (value.dirExists === false) return { kind: 'ensure' };
  return { kind: 'allocate' };
}
```

新增 id 铸造：

```js
/**
 * Mint the caller-owned session id.
 *
 * `allocate` and `session.create` must see the SAME id, so the plugin owns it
 * instead of letting the host generate one the task directory could not know.
 */
export function mintSessionId(random) {
  const draw = typeof random === 'function' ? random : () => {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, (byte, index) => (
      index === 6 ? (byte & 15) | 64 : index === 8 ? (byte & 63) | 128 : byte
    ).toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  return `session-${draw()}`;
}
```

> `mintSessionId(() => 0)` 必须落在 `mintSessionId(() => 0) === mintSessionId(() => 0)` 的反面 —— 测试里的注入函数只在**唯一性**断言之外使用；唯一性断言走真实 `crypto`，因此不要给 `random` 传常量再断言不等。

- [ ] **Step 4: 跑测试确认通过**

Run: `$NODE --test test/client.test.js`
Expected: PASS

- [ ] **Step 5: 门禁**

Run: `$NODE --test test/*.test.js`
Expected: 69 pass / 0 fail

---

### Task 6: 客户端编排 — 分配 → 建会话 → 占位名 → 导航

**Files:**
- Modify: `src/client.js`（`create()` 重写；新增 `callAllocate`）
- Test: `test/client.test.js`（顺序与失败短路，用注入的 fake 服务）

**Interfaces:**
- Consumes: `mintSessionId`、`ctx.sessions.create`、`ctx.workspaces.rename`、`ctx.uiWorkspace.openSession`、`callHost('allocate', {sessionId})`
- Produces: 一个可注入的编排函数，签名固定为
  `runCreate({ plan, services, mintSessionId, allocate, t }): Promise<{ ok, code?, value? }>`

- [ ] **Step 1: 写失败的测试**（追加到 `test/client.test.js`）

```js
test('create allocates, creates the session with that cwd, names the row, then navigates', async () => {
  const calls = [];
  const result = await runCreate({
    plan: { kind: 'allocate' },
    mintSessionId: () => 'session-fixed',
    allocate: async (sessionId) => {
      calls.push(['allocate', sessionId]);
      return { ok: true, value: { path: '/root/tok', token: 'tok', workspaceId: 'w1', created: true } };
    },
    services: {
      createSession: async (input) => { calls.push(['create', input.cwd, input.sessionId]); return { sessionId: input.sessionId }; },
      renameWorkspace: async (id, title) => { calls.push(['rename', id, title]); },
      openSession: (id) => { calls.push(['open', id]); },
    },
    t: (key) => key,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['allocate', 'session-fixed'],
    ['create', '/root/tok', 'session-fixed'],
    ['rename', 'w1', 'row.placeholder'],
    ['open', 'session-fixed'],
  ]);
});

test('create stops at the first failure and never opens a session', async () => {
  const calls = [];
  const result = await runCreate({
    plan: { kind: 'allocate' },
    mintSessionId: () => 'session-fixed',
    allocate: async () => ({ ok: false, code: CODES.dirNotWritable }),
    services: {
      createSession: async () => { calls.push('create'); },
      renameWorkspace: async () => { calls.push('rename'); },
      openSession: () => { calls.push('open'); },
    },
    t: (key) => key,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, CODES.dirNotWritable);
  assert.deepEqual(calls, []);
});

test('create survives a failed placeholder rename but still opens the session', async () => {
  const calls = [];
  const result = await runCreate({
    plan: { kind: 'allocate' },
    mintSessionId: () => 'session-fixed',
    allocate: async () => ({ ok: true, value: { path: '/root/tok', workspaceId: 'w1' } }),
    services: {
      createSession: async (input) => ({ sessionId: input.sessionId }),
      renameWorkspace: async () => { throw new Error('rename refused'); },
      openSession: (id) => { calls.push(['open', id]); },
    },
    t: (key) => key,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['open', 'session-fixed']]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$NODE --test test/client.test.js`
Expected: FAIL — `runCreate is not defined`

- [ ] **Step 3: 实现编排**

在 `src/client-core.js` 里加纯编排（便于测试，不碰 React/fetch）：

```js
/**
 * The ordered create pipeline (spec v2 §5.3). Every external effect is injected,
 * so the ORDER and the short-circuiting are unit-testable without React.
 */
export async function runCreate({ plan, services, mintSessionId, allocate, t }) {
  if (!plan || plan.kind !== 'allocate') return { ok: false, code: plan?.code ?? CODES.internal, phase: plan?.kind ?? 'blocked' };
  const sessionId = mintSessionId();
  const allocated = await allocate(sessionId);
  if (!allocated || !allocated.ok) return { ok: false, code: allocated?.code ?? CODES.internal };
  const value = allocated.value;
  try {
    await services.createSession({ cwd: value.path, sessionId });
  } catch (error) {
    return { ok: false, code: CODES.internal, message: String(error?.message ?? error) };
  }
  try {
    await services.renameWorkspace(value.workspaceId, t('row.placeholder'));
  } catch (error) {
    // Cosmetic: the row is readable later; the conversation must still open.
    services.warn?.('placeholder rename failed', error);
  }
  services.openSession(sessionId);
  return { ok: true, value: { sessionId, workspaceId: value.workspaceId, path: value.path } };
}
```

`src/client.js` 的 `create()` 改为：

```js
    async function create() {
      const snapshot = controller.store.getSnapshot();
      if (snapshot.busy) return;
      controller.setBusy(true);
      try {
        let plan = planCreate(snapshot, workspaceList());
        if (plan.kind === 'ensure') {
          await controller.ensure();
          plan = planCreate(controller.store.getSnapshot(), workspaceList());
        }
        if (plan.kind !== 'allocate') {
          controller.setFlash(t(plan.messageKey ?? messageKeyForCode(plan.code)));
          return;
        }
        const result = await runCreate({
          plan,
          mintSessionId,
          allocate: (sessionId) => callHost('allocate', { sessionId }),
          t,
          services: {
            createSession: (input) => {
              const sessions = ctx.get('sessions');
              if (!sessions?.create) throw new Error('sessions service unavailable');
              return sessions.create(input);
            },
            renameWorkspace: (id, title) => {
              const workspaces = workspaceService();
              if (!workspaces?.rename) throw new Error('workspaces service unavailable');
              return workspaces.rename(id, title);
            },
            openSession: (id) => ctx.uiWorkspace.openSession(id),
            warn: (...args) => logger.warn(...args),
          },
        });
        if (!result.ok) controller.setFlash(t(messageKeyForCode(result.code)));
      } catch (error) {
        logger.warn('could not start a recent task:', error);
        controller.setFlash(t('err.startFailed', { 0: String(error?.message ?? error) }));
      } finally {
        controller.setBusy(false);
      }
    }
```

同步把 `plugin.inject` 加上 `'sessions'`、`'workspaces'`（两者已是官方客户端服务；缺失时 `create()` 会走上面那条 throw 分支给出可见失败）。

- [ ] **Step 4: 跑测试确认通过**

Run: `$NODE --test test/client.test.js`
Expected: PASS

- [ ] **Step 5: 门禁 + 重建产物**

Run: `$NODE --test test/*.test.js && $NODE scripts/build.mjs`
Expected: 72 pass / 0 fail，`✓ built dist/client.js`

---

### Task 7: 客户端 — 标题镜像与失效处理

**Files:**
- Modify: `src/client-core.js`（纯函数 `planTitleMirror`）、`src/client.js`（订阅会话列表）
- Test: `test/client.test.js`

**Interfaces:**
- Produces: `planTitleMirror({ entry, row, workspace }) → { action: 'none' } | { action: 'rename', workspaceId, title } | { action: 'forget', workspaceId }`
  - `entry = { workspaceId, appliedTitles: string[] }`
  - `row = { displayTitle, blank } | null`
  - `workspace = { workspaceId, title } | null`

- [ ] **Step 1: 写失败的测试**（追加到 `test/client.test.js`）

```js
test('planTitleMirror waits for a real title and never renames a blank row', () => {
  const entry = { workspaceId: 'w1', appliedTitles: [] };
  assert.equal(planTitleMirror({ entry, row: null, workspace: { workspaceId: 'w1', title: '新任务' } }).action, 'none');
  assert.equal(planTitleMirror({ entry, row: { displayTitle: '   ', blank: true }, workspace: { workspaceId: 'w1', title: '新任务' } }).action, 'none');
  assert.equal(planTitleMirror({ entry, row: { displayTitle: '修复登录', blank: false }, workspace: { workspaceId: 'w1', title: '新任务' } }).action, 'rename');
});

test('planTitleMirror stops the moment the user renames the workspace', () => {
  const entry = { workspaceId: 'w1', appliedTitles: ['修复登录'] };
  assert.equal(planTitleMirror({ entry, row: { displayTitle: '修复登录' }, workspace: { workspaceId: 'w1', title: '修复登录' } }).action, 'none');
  assert.equal(planTitleMirror({ entry, row: { displayTitle: '修复登录' }, workspace: { workspaceId: 'w1', title: '用户自己改的名字' } }).action, 'forget');
  assert.equal(planTitleMirror({ entry, row: { displayTitle: '修复登录' }, workspace: null }).action, 'forget');
});

test('planTitleMirror emits the new title once, then goes quiet', () => {
  const entry = { workspaceId: 'w1', appliedTitles: [] };
  const first = planTitleMirror({ entry, row: { displayTitle: 'A' }, workspace: { workspaceId: 'w1', title: '新任务' } });
  assert.deepEqual(first, { action: 'rename', workspaceId: 'w1', title: 'A' });
  const second = planTitleMirror({ entry: { workspaceId: 'w1', appliedTitles: ['A'] }, row: { displayTitle: 'A' }, workspace: { workspaceId: 'w1', title: 'A' } });
  assert.equal(second.action, 'none');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$NODE --test test/client.test.js`
Expected: FAIL — `planTitleMirror is not defined`

- [ ] **Step 3: 实现**

`src/client-core.js`：

```js
/**
 * One-way mirror: the workspace row follows the session title (spec v2 §5.4).
 *
 * `appliedTitles` records what THIS plugin wrote, so a title the user typed in
 * the sidebar is never overwritten — the same rule `planTitleSync` uses for the
 * group name. A vanished workspace means the user deleted the record: forget it,
 * never rebuild it.
 */
export function planTitleMirror({ entry, row, workspace } = {}) {
  if (!entry || !entry.workspaceId) return { action: 'none' };
  if (!workspace) return { action: 'forget', workspaceId: entry.workspaceId };
  const title = typeof row?.displayTitle === 'string' ? row.displayTitle.trim() : '';
  if (!title || row?.blank === true) return { action: 'none' };
  if (workspace.title === title) return { action: 'none' };
  const applied = Array.isArray(entry.appliedTitles) ? entry.appliedTitles : [];
  if (applied.length > 0 && !applied.includes(workspace.title)) {
    return { action: 'forget', workspaceId: entry.workspaceId };
  }
  return { action: 'rename', workspaceId: entry.workspaceId, title };
}
```

`src/client.js`：维护 `const sessionTasks = new Map()`；`runCreate` 成功后 `sessionTasks.set(result.value.sessionId, { workspaceId: result.value.workspaceId, appliedTitles: [] })`；并订阅会话列表：

```js
    function mirrorTitles() {
      const sessions = ctx.get('sessions')?.list?.getSnapshot?.();
      if (!sessions?.byId) return;
      for (const [sessionId, entry] of [...sessionTasks]) {
        const plan = planTitleMirror({
          entry,
          row: sessions.byId[sessionId] ?? null,
          workspace: liveWorkspaceRow(entry.workspaceId),
        });
        if (plan.action === 'forget') { sessionTasks.delete(sessionId); continue; }
        if (plan.action !== 'rename') continue;
        workspaceService()?.rename?.(plan.workspaceId, plan.title).then(() => {
          const current = sessionTasks.get(sessionId);
          if (current) current.appliedTitles.push(plan.title);
        }).catch((error) => logger.warn('could not mirror the session title:', error));
      }
    }
```

在 `apply` 里挂上：`ctx.effect(() => ctx.get('sessions')?.list?.subscribe?.(mirrorTitles) ?? (() => {}), 'dsh-recent-tasks: task row titles follow session titles')`，并在每次 `state` 应答后也调一次 `mirrorTitles()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `$NODE --test test/client.test.js`
Expected: PASS

- [ ] **Step 5: 门禁 + 重建**

Run: `$NODE --test test/*.test.js && $NODE scripts/build.mjs`
Expected: 75 pass / 0 fail

---

### Task 8: 文案、README、设置说明

**Files:**
- Modify: `src/locales.js`（`row.placeholder` 与清理提示）、`README.md`、`README.zh.md`
- Test: `test/client.test.js`（键集 1:1 断言已有，新增键必须两侧都有）

**Interfaces:**
- Produces: locale 键 `row.placeholder`（zh `新任务` / en `New task`）、`settings.tasksHint`、`state.badRequest` 文案若缺失则补

- [ ] **Step 1: 写失败的测试**

既有测试已断言 zh/en 键集 1:1；再补一条：

```js
test('the task-directory copy exists in both languages', () => {
  assert.equal(zh['row.placeholder'], '新任务');
  assert.equal(en['row.placeholder'], 'New task');
  assert.ok(zh['settings.tasksHint']);
  assert.ok(en['settings.tasksHint']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$NODE --test test/client.test.js`
Expected: FAIL — `undefined !== '新任务'`

- [ ] **Step 3: 改 `src/locales.js` 与两个 README**

- `zh`：`'row.placeholder': '新任务'`、`'settings.tasksHint': '每个对话在自己的目录里工作；目录按时间戳命名，用完不会自动删除，可手动清理。'`
- `en`：`'row.placeholder': 'New task'`、`'settings.tasksHint': 'Each conversation works in its own timestamped folder; folders are kept after archiving and can be removed by hand.'`
- 两个 README 增补：**每对话独立目录**的行为说明、`allocate` 是新动词且**会写盘**（`state` 仍不写盘）、目录保留策略、树形视图下任务目录会自动嵌在分组下。

- [ ] **Step 4: 跑测试确认通过**

Run: `$NODE --test test/*.test.js`
Expected: 76 pass / 0 fail

- [ ] **Step 5: 门禁 + 重建产物**

Run: `$NODE --test test/*.test.js && $NODE scripts/build.mjs`
Expected: 全绿 + 构建成功

---

## 真机验收（实现完成后的最后一道门）

按 spec §7.3 六条逐条走；其中第 6 条（重启后映射与标题不丢）依赖 `state.tasks` + `sessions` 列表重建，是本计划里唯一**无法**被单测完全覆盖的行为，必须手工确认。

## Self-Review 记录

- **Spec 覆盖**：§5.1→Task 3、§5.2→Task 3、§5.3→Task 5+6、§5.4→Task 7、§5.5/§5.6→Task 8、§6 错误码→Task 3+4、§7.1→Task 3+4、§7.2→Task 5+6+7、§8 文件布局→Task 1 新增模块。
- **偏离**：spec §5.2 原写 `tasks` 由「列目录」派生，计划改为**从 registry 派生**（直接子目录 + token 形状）。理由：不新增 fs 调用、`state` 仍然零写盘、与「记录即归属」的既有真源一致。
- **类型一致性**：`planTitleMirror` 的返回在 Task 7 的测试与实现中一致；`runCreate` 的 `services` 形状在 Task 6 的测试与 `client.js` 接线中一致；`allocate` 返回的 `value.created` 在 Task 3/4 与 `validateAllocateValue` 中一致。
- **无 git**：所有「提交」步骤已替换为测试门禁。
---

## 实现完成记录（2026-09-29）

全部 8 个任务完成，门禁 `node --test test/*.test.js` = **78 pass / 0 fail**，
`node scripts/build.mjs` 产物 `dist/client.js` 44.0 KB。

### 与 SPEC 的偏离（实现中发现 SPEC 写法不可行或不准确）

1. **`allocate` 不按 `sessionId` 幂等**（SPEC §5.1 / §7.1 第 2 条）。
   token 含时间戳 + 4 位噪声，两次调用必然是两条任务——这正是「一秒内开两个对话
   也有各自目录」的实现方式。真正保证的是：**绝不占用不是自己创建的目录**（EEXIST
   时若该目录已由本插件注册则原样复用并 `created: false`，否则重新抽取）；
   真机脚本已确认两次调用产生两个不同目录、注册表顺序正确、`state` 只读。
2. **记录被删不再报 `missing-record` + `tasks[i].workspaceId: null`**（SPEC §7.1 第 5 条）。
   `state.tasks` 由注册表派生（`derivedTasks`，刻意不用 `readdir`，保持 `state` 零 fs
   注入、纯读），记录被删后该任务直接从清单消失，客户端也就不再提供它。
   分组记录本身丢失时仍按 v1 语义报 `workspaceId: null` + `missing-record`。
3. **`planCreate` 的「按路径找回 id」分支删除**（SPEC §5.3）。
   `allocate` 由 Host 自行 `ensure` 并派生分组记录，客户端不需要事先认领 id；
   凡是 id 与实时列表不一致的情形统一走 `ensure`，健康路径直接返回 `{ kind: 'allocate' }`。
4. **标题镜像只认 `row.title`，不认 `displayTitle`**（SPEC §5.4 未写明此处陷阱）。
   官方 `displayTitle` 在会话无标题时会退化：先取 `cwd` 的目录名、再取 sessionId。
   若照抄它，空白对话会把**时间戳目录名**写到工作区行上。因此 `planTitleMirror`
   要求 `blank !== true` 且 `row.title` 非空。
5. **导航用 `sessions.create` 返回的 id**，而非本地铸造的 id。官方 `create` 接受调用方
   提供的 `sessionId`，但以响应值为准更安全（实测返回值与请求值一致）。
6. **客户端 `inject` 增加 `sessions` / `workspaces`**：`sessions.create({cwd, sessionId})`
   与 `workspaces.rename` 是（A）方案的必要依赖。manifest 的 `dsh.client.inject` 无需改动——
   两个服务由 `dsh-client-ui-workspace`（已在依赖列表中）提供。
7. **设置行新增 `settings.tasksHint` 文案**：作为（A）方案「v1 不自动清理、只给可见提示」
   的落点，中文说明「目录不会自动删除，可手动清理」。

### 未做（保持 SPEC 边界）

- 无自动清理、无目录命名模板设置、无云同步；旧对话不迁移（`cwd` 不可变）。
- 真机验收 §7.3 的 6 条需要用户在 DSH 应用内刷新后逐条确认（我无法代替点击侧边栏、
  发消息、重启应用）。Host 侧的真实文件系统行为已用临时目录脚本验证完毕。

---

## 决定回退（2026-09-29 19:0x，用户裁定）

用户真机试用后否决了本方案：

> 点击 + 最近任务对话，新建了工作区，但我希望这个工作区显示为一个独立的会话，且展示在最近任务下

### 为什么二者不可兼得（已核到源码）

| 位置 | 代码 | 后果 |
|---|---|---|
| `@deepseek-ai/dsh-workspace/lib/index.js:104` | `get sessionIds() { return this.record.sessionIds.filter((id) => this.host.sessionPath(id) === this.record.path) }` | 会话归属工作区**只按 cwd 严格相等** |
| 同上 `:112-124` | `attachSession` → `if (cwd !== this.record.path) throw` | 无法手动把会话挂到别的分组 |
| `@deepseek-ai/dsh-client-ui-workspace/lib/client.js` | 可渲染插槽仅 `sidebar.session.row.*` / `sidebar.workspaces.directoryFlow` | **没有自定义工作区行渲染的插槽** |
| 同上 `:3288` | `nestWorkspaces: groupBy === "workspace-tree"` | 嵌套只在树形分组模式；默认「按工作区」是平铺 |

因此「每个对话独立工作目录」（⇒ 独立 `cwd` ⇒ 独立工作区记录）与「会话直接显示在最近任务下」（⇒ `cwd` 必须等于分组目录）在 DSH 里互斥。

### 回退范围（已完成，基线 49 pass / 0 fail）

- 删除：`src/task-dirs.js`、`test/task-dirs.test.js`。
- `src/protocol.js`：`METHODS` 回到 `['state','ensure']`；删除 `validateAllocateValue` / `readAllocateResponse` / `normalizeTasks` / `state.tasks`。
- `src/host.js`：删除 `allocate`、`derivedTasks`、task-dirs 导入、`MAX_TOKEN_ATTEMPTS`、API 里的 allocate 分发；`state` 回到只读快照。
- `src/client-core.js`：`planCreate` 回到 `ready/ensure/blocked`；删除 `mintSessionId` / `runCreate` / `planTitleMirror`。
- `src/client.js`：`create()` 回到 `uiWorkspace.startSession(workspaceId)`；删除 sessionTasks 映射、标题镜像与两个 effect；`callHost` 回到单一 `readStateResponse`；`inject` 保留 `workspaces`（v1 即有）。
- `src/locales.js`：删除 `row.placeholder` / `settings.tasksHint`。
- 两份 README 回到 v1 行为描述；删除目录里的临时说明便条。

### 遗留物（未删，等用户处置）

5 个空的按对话目录（`20260929-183555-1deq`、`-183700-uoox`、`-184705-nqvf`、`-185617-txtx`、`-185625-as35`）及其空会话（其中一个含 27KB 日志）。指向已删目录的两条工作区残留记录（`336ba3c9`、`9570b319`）已连同 `workspace.json` 时间戳备份一并清理。
