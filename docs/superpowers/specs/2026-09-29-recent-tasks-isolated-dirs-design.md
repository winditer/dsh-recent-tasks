# 最近任务：每对话独立工作目录 — 设计规格（v2 · Draft）

父规格：[`2026-09-29-recent-tasks-plugin-design.md`](../../../dsh-tmp/docs/superpowers/specs/2026-09-29-recent-tasks-plugin-design.md)（v1，已实现）。
实现笔记：[`.agents/notes/2026-09-29-recent-tasks-implementation.md`](../../.agents/notes/2026-09-29-recent-tasks-implementation.md)。
本文件只写 v2 的增量与偏离，v1 已确认的事实不再重复论证；v1 与本文件冲突时以本文件为准。

---

## 1. 一句话概述

把「最近任务」从**共享一个目录**改造成**每个对话一个独立工作目录**：新建对话时由 Host 分配 `<recentTasksDir>/<时间戳>-<短码>/`，为该目录注册一条工作区记录并钉到分组末尾，侧边栏行名跟随该会话标题（空白期显示占位名「新任务」）。

## 2. 目标与非目标

### 2.1 目标

1. 任意两个「最近任务」对话的默认沙箱根目录、`cwd`、文件访问边界互不相同；一个对话的 `write`/`build`/`git add` 不落在另一个对话的目录里。
2. 隔离是**默认保证**：不需要用户每次手工建目录或加 `cd`。
3. 侧边栏仍可用：原有「最近任务」分组照常存在，每条对话在其下呈现为一行**可读**的名字（跟随会话标题）。
4. 不打断既有行为：折叠/展开、改名、拖拽排序、置顶、归档、搜索、快捷键、设置表单、`state`/`ensure` 语义全部保留。

### 2.2 非目标（v2 明确不做，写明理由）

| 不做 | 理由 |
|---|---|
| 自动清理/删除任务目录 | 用户选择 A。归档/删除会话都不动 cwd，目录与日志是两份独立的东西；误删代价高于收益。改为可见提示（§5.4）。 |
| 历史对话迁移到独立目录 | 技术不可能：`cwd` 写在 header 且不可变（父规格 §6.3）。根目录里的旧对话永久留在根目录。 |
| 根目录继续开新对话 | 用户选择 A：根只当容器。一律开子目录，行为单一。 |
| 会话改名反向同步到工作区名 | 单向：工作区跟随会话标题。避免双写回环，也避免把工作区名当成会话标题的真源。 |
| 目录名用会话标题 | 目录名必须在建会话前定死（不可变），而标题要等首条消息才生成。用词表化命名 §3.2。 |
| 每个对话一条独立 git 仓库/worktree | 与「沙箱根目录不同」是两件事；目录隔离已满足目标 1，仓库结构交给用户在对话里自行决定。 |

---

## 3. 关键约束（已核实，写代码前必须遵守）

### 3.1 会话归属由 `cwd` 决定，`cwd` 创建后不可变

- `session.create` 的 `cwd` 解析顺序：`workspace?.path ?? request.cwd ?? defaultCwd`；且 `workspaceId` 与 `cwd` **互斥**（同时传是 `gateway/bad-request`）。
  证据：`dsh-api-session-controller/lib/index.js:686-694`（本机解包副本 `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/`）
- `cwd` 不同 ⇒ 必然落在不同工作区记录的 `sessionIds` 里；没有任何插件插槽能让一个分组收容不同 `cwd` 的会话。
  证据：父规格 §6.1；`dsh-workspace/lib/index.js:102,111`
- ⇒ **每对话独立目录，必然等价于每对话一条工作区记录。** 这是 v2 全部代价的来源，也是 §2.1-3 必须补偿的UX。

### 3.2 目录名必须在建会话之前确定

标题要等首条人类消息（`dsh-session-title`）。因此目录名只能是时间戳/随机码这类**会话语义无关**的值。

- 目录名：`YYYYMMDD-HHmmss-<4 位 base36 随机>`，例如 `20260929-173312-a1b2`。按名排序即时序；同日同秒碰撞由随机码兜底，且 `allocate` 抢占式 `mkdir` 保证唯一。
- 目录名不含会话 id，避免把内部 id 暴露成用户会看到的路径段。

### 3.3 客户端已具备所需能力（v1 只用了其中一条）

| 用途 | API | 证据 |
|---|---|---|
| 用自带 id + 自带 cwd 建会话 | `ctx.sessions.create({ cwd, sessionId })`（客户端会自己 `mkdir -p` cwd） | `dsh-api-session-controller/lib/client.js:2673-2710`；Host 侧 `lib/index.js:445` |
| 建会话后直接切过去 | `ctx.uiWorkspace.openSession(sessionId)` | `dsh-client-ui-workspace/lib/client.js:821-823` |
| 建/改名工作区（客户端官方服务） | `ctx.workspaces.create(input)` / `ctx.workspaces.rename(id, title)` | `dsh-client-ui-workspace/lib/client.js:4266-4272`、`4187-4190` |
| 会话标题 | `sessions.list` 行的 `displayTitle`（列表投影已带，`blank` 亦在行上） | `dsh-api-session-controller/lib/client.js:3507`；blank：`dsh-client-ui-workspace/lib/client.js:799-804` |

会话 id 由客户端铸造：`session-` + `randomUUID()`（`crypto.randomUUID`，与官方 `randomUUID()` 同源实现）。**必须同时传给 `session.create`**，否则 Host 自己生成的 id 与目录名映射不上。

### 3.4 工作区注册表的两条既有行为

- `create(path, title)` 要求目录**已存在**（它从不 mkdir），按 `realpath` 幂等，且**已存在的记录不会被改标题**。
  证据：`dsh-workspace/lib/index.js:406-412`、`630-650`
- 新建记录**前插**到持久顺序头部；`insertBefore(id)` 无锚点即追加到末尾。
  证据：`dsh-workspace/lib/index.js:660-680`；父规格 §6.6

---

## 4. 设计总览

```
<recentTasksDir>/                     ← 分组根（既有「最近任务」记录；旧对话仍在根里）
├─ 20260929-173312-a1b2/             ← 对话 A 的工作目录 + 一条工作区记录（钉在分组末尾）
├─ 20260929-173355-c9d0/             ← 对话 B 的工作目录 + 一条工作区记录
└─ …

侧边栏（默认 WorkSpace 分组视图）
  最近任务
    任务A的标题            ← 标题镜像后
    新任务                 ← 首条消息之前的占位名
  其他工作区…
```

三个角色分工：

| 角色 | 职责 |
|---|---|
| 客户端 | 铸会话 id、决定何时开新任务、调用三个官方服务、维护 `sessionId → workspaceId` 映射、镜像标题 |
| Host 半边 | 周期/时序短：分配唯一目录、建/复用该目录的工作区记录、钉到末尾、在 `state` 里报告任务清单 |
| 官方服务 | 会话创建、导航、工作区 CRUD、标题生成 —— 插件不碰 |

---

## 5. 详细设计

### 5.1 Host：新增 `allocate` 动词

现有 API 是 POST-only + JSON + 动词白名单（`state` / `ensure`）。新增第三个动词，保持同一处理器与同一套加固。

**请求**：`POST <apiPrefix>/allocate`，body `{ "sessionId": "session-<uuid>" }`

**响应**：

```json
{ "ok": true, "value": {
  "path": "/Users/…/DSH 最近任务/20260929-173312-a1b2",
  "token": "20260929-173312-a1b2",
  "workspaceId": "…",
  "groupWorkspaceId": "…",
  "created": true
} }
```

**语义**：

1. `sessionId` 校验：非空字符串、长度 ≤ 128、只含 `[A-Za-z0-9_-]`；不合法 → `bad-request`。
2. 目录名铸造与抢占：`mkdir(<root>/<token>/, { recursive: false })`；已存在则换一个随机码重试（上限 8 次）→ 仍失败则 `dir-not-writable`。
3. 记录：`realpath` → `registry.resolveByPath` → 命中则复用；否则 `registry.create(canonical, placeholderTitle)`。
4. 排序：与根分组**同一个批次**追加到末尾 —— 先钉根分组，再钉本次记录，保证「最近任务」始终在列表末尾、根在最后。
5. `allocate` **不是** `state`：它会写盘。这与 v1「`state` 绝不写盘」的承诺不冲突（该承诺只约束 `state`），但必须在 README 里写明。

### 5.2 Host：`state` 增补 `tasks` 清单

为了让客户端在重载后仍能把「哪条对话 ↔ 哪个目录」对上，`state.value` 增补：

```json
"tasks": [ { "token": "20260929-173312-a1b2", "path": "/…/20260929-173312-a1b2", "workspaceId": "…", "title": "修复登录重定向" } ]
```

清单来源是**派生**的，不新增存储：列 `<root>` 的直接子目录（跳过点开头）→ 与 `registry.list()` 按 `realpath` 对齐 → 记录不在则 `workspaceId: null`。`state` 依旧不 mkdir、不 create、不排序。

### 5.3 客户端：新建流程（`planCreate` 扩写）

```
create()
 ├─ planCreate(snapshot, workspaces)  ⇒ blocked | ensure | allocate
 ├─ (allocate) sessionId = mint(); token 由 Host 铸 → POST allocate
 ├─ sessions.create({ cwd: value.path, sessionId })   // Host 也会 mkdir -p
 ├─ workspaces.rename(value.workspaceId, t('row.placeholder'))   // 占位名，失败仅告警
 ├─ 记映射 sessionWorkspace.set(sessionId, value.workspaceId)
 └─ uiWorkspace.openSession(sessionId)
```

`planCreate` 的语义变化：v1 的 `ready` 分支（`startSession(workspaceId)`）在 v2 里**只用于旧入口之外的回退**；正常路径返回 `{ kind: 'allocate' }`。判定条件与 v1 一致（`phase==='ready'`、`enabled`、`path` 非空、`dirExists`、`missingRecord` 拦截），只是终点不同。

`ensure` 仍然存在且语义不变：它只保证**根分组**记录在那里。

### 5.4 客户端：标题镜像（单向、可撤回）

状态：`sessionWorkspace: Map<sessionId, { workspaceId, appliedTitles: Set<string> }>`，记录「插件写过的名字」。

触发：会话列表快照变化（已是订阅源）。

```
for (sessionId, entry) of sessionWorkspace:
  row = sessionsList.byId[sessionId]
  row 不存在或 blank            → 不动作（保持占位名）
  title = row.displayTitle 去空白；为空 → 不动作
  ws = workspaceRow(entry.workspaceId)
  ws 不存在                      → 记为失效，不动作（用户删了记录，且不自动重建）
  ws.title 已被用户改过
     （即 ws.title ∉ entry.appliedTitles 且 ≠ 占位名） → 停止镜像，从映射移除
  ws.title === title             → 无动作
  否则 workspaces.rename(entry.workspaceId, title)；成功则 appliedTitles.add(title)
```

要点：

- **只写一次名字**：把写过的值记进 `appliedTitles`，用户随后在侧边栏改名就落在集合外，镜像自动让位 —— 复用 v1 `planTitleSync` 的同一原则。
- **占位名跟随语言**：占位名本身仍按 v1 的 locale 规则处理（记录名等于插件默认名之一时才随语言改写）；一旦镜像成会话标题，就不再随语言变化。
- 失败只 `logger.warn` 并在下一次列表变化时重试，绝不阻塞 UI。

### 5.5 陈旧任务的提示（替代自动清理）

会话归档或删除后，工作区记录与目录都保留。插件在设置行与侧边栏按钮的 hover 文案里说明：**目录保留在 `<recentTasksDir>/<token>/`，可手动删除**。v2 不提供删除动作，也不扫描目录内容判断「是否可删」。

### 5.6 与官方功能的相互影响

- **树形视图**：官方「按工作区树」会把每个子目录工作区自动嵌到最近的已注册祖先（即根分组）之下，无需插件做任何事。
  证据：`dsh-client-ui-workspace/README.md`「Workspace hierarchy」。
- **搜索**：任务行的工作区名可被搜索命中的是工作区标题；会话内容搜索走官方路径，不受影响。
- **删除根分组**：`autoRepair` 行为不变（重建根记录）；子记录不重建，其会话落回「未分组」，与 v1 的诚实失败原则一致。
- **沙箱边界**：每个对话的沙箱根是它自己的目录（v1 §8.7 的规则按新 `cwd` 生效），越界仍需会话内提权 —— 这正是目标 1 的实现方式。

---

## 6. 边界与错误处理

| 场景 | 行为 | 码/文案 |
|---|---|---|
| `allocate` 前根目录不可写 | 不建目录、不建记录 | `dir-not-writable` / `dir-not-directory` |
| `sessionId` 不合法 | 拒绝，不留目录 | `bad-request` |
| `allocate` 成功但 `sessions.create` 失败 | 不报「任务已创建」；提示失败原因，并**不**回退到根目录开对话（那会静默失去隔离） | `err.startFailed` |
| `allocate` 成功但 `openSession` 失败 | 目录与记录已存在，下次列表变化自然显示该行 | 仅 `logger.warn` |
| 记录被用户在侧边栏删除 | 下次 `state` 报 `missing-record`；不自动重建子记录 | 既有 `state` 语义 |
| 标题重复导致改名被拒 | 忽略并下次重试；不改变会话标题 | 仅 `logger.warn` |
| 同名占位名多行 | 允许（官方按 workspaceId 判重，不同路径可同名） | — |
| Host 半边不可用 | 与 v1 一致：`unavailable`，按钮/快捷键给出原因 | 既有 |

---

## 7. 测试计划

### 7.1 Host（`test/host.test.js` 扩写）

- `allocate` 在根下创建 `<token>/` 并返回 `path` + `workspaceId`；`state.value.tasks` 随后包含该条。
- 同一 `sessionId` 重复 `allocate` 幂等：不新建第二个目录，`created: false`，复用同一记录。
- 坏 `sessionId` → `bad-request`，且根目录下**没有**任何新条目。
- 根不可写（注入 fs 抛 `EACCES`）→ `dir-not-writable`，无记录产生。
- 记录被删（测试替身抹掉）后 `state` 报 `missing-record`，`tasks[i].workspaceId === null`。
- 钉子顺序：`allocate` 后根分组仍在末尾、新任务紧随其后。
- 端点契约：新动词纳入 POST-only + `content-type: application/json` + 未知名词 404。

### 7.2 客户端（`test/client.test.js` 扩写）

- `planCreate` 正常路径返回 `{ kind: 'allocate' }`；`missingRecord`/`enabled:false`/`dirExists:false` 仍被拦截（v1 既有断言必须保持通过）。
- `create()` 顺序断言：先 `allocate`、再 `sessions.create({cwd, sessionId})`、再 `rename`、最后 `openSession`；任一步失败不执行后续步骤。
- 会话 id 一次铸造、两处一致（`allocate` 的 body 与 `create` 的 `sessionId` 相同）。
- 标题镜像：空白会话不改名；有标题改名一次；用户改过名后停止镜像；改名失败重试且不抛。
- `tasks` 清单 → `sessionId ↔ workspaceId` 映射在重载后可从列表重建。

### 7.3 真机验收（手动，一次即可）

1. 连点两次「＋ 最近任务对话」→ 侧边栏出现两行；两行读起来可区分（第二行先是「新任务」）。
2. 在对话 A 里 `pwd` → 是它自己的 `<token>` 目录；对话 B 里 `ls` 看不到 A 的文件。
3. 在 A 发出第一条消息 → A 那行的名字变成标题。
4. 在侧边栏手动改 A 那行的名字 → 再发消息，名字**不再**被覆盖。
5. 切到「按工作区树」视图 → 两个任务目录嵌在「最近任务」之下。
6. 重启应用 → 分组仍在末尾，映射仍在，标题不丢。

---

## 8. 代码组织与写入范围

新增小而专的模块，避免把 `host.js` / `client.js` 继续堆大：

| 文件 | 角色 | 依赖 |
|---|---|---|
| `src/task-dirs.js`（新） | 纯逻辑：token 铸造/校验、任务清单派生、目录名解析 | 无（可被两端共用） |
| `src/protocol.js` | 增补 `allocate` 动词与响应校验 | — |
| `src/host.js` | `allocate` 服务 + `state.tasks` | `task-dirs.js` |
| `src/client-core.js` | `planCreate` 三分支、订单式 create 步骤计划（纯函数，便于断言顺序） | `protocol.js` |
| `src/client.js` | 映射表、标题镜像、locale、样式 | `client-core.js` |
| `src/locales.js` | 占位名、清理提示、新错误文案 | — |
| `test/*` | §7 各条 | — |

`dist/client.js` 是构建产物，改完必须 `node scripts/build.mjs` 重新生成并跑 `node --test test/*.test.js`。

---

## 9. 待确认问题

1. 占位名的中英取值：`新任务` / `New task`（当前提案）还是复用 `最近任务` 的构词。
2. 是否需要在设置里给「任务目录命名」留一个模板项（v2 提议：不做，固定格式）。
3. 根分组在没有旧对话的新机器上会是空行——是保留（结构清晰）还是隐藏（少一行噪音）。v2 提议：保留。