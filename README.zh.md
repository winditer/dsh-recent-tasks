# dsh-recent-tasks

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.19-339933.svg)](package.json)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.1%2B-4D6BFE.svg)](https://github.com/deepseek-ai/deepseek-harness)

DSH 侧边栏里常驻**最底部、可折叠**的「最近任务」分组：没有工作区的对话归到这里，而不是和归档目录、已删除项目一起堆在**未分组**。这个分组不是插件画出来的仿制品，而是一条**真正的工作区记录**——所以从它开出来的对话，真的属于它。

DSH 按会话 `cwd` 归属的工作区给对话分组。不带工作区开出来的对话压根没有归属，于是落进「未分组」这个兜底桶。本插件为一个专用目录注册**一条真正的工作区记录**，并把它钉在工作区列表末尾——于是「没有工作区」变成一个有正常行为的普通分组：折叠、展开、改名、拖拽排序、置顶、归档、搜索全都可用。

| 部分 | 说明 |
|---|---|
| 分组 | 通过 `ctx.workspaceRegistry` 为 `<recentTasksDir>` 注册的真 `workspace` 记录，并反复钉到持久顺序末尾 |
| 入口 | 侧边栏底部、设置旁的「＋ 最近任务对话」，以及 `Mod+Alt+N` / `Mod+Shift+N` 快捷键，两者都会在该工作区里开会话 |
| 设置 | **设置 → 通用** 里的「最近任务」几行——目录、分组名、常驻末尾、自动重建——由本插件的官方实时配置驱动 |
| Host API | `POST /dsh-recent-tasks/api/state` 与 `/ensure`，只读且幂等；唯一的写入路径是官方设置表单 |

## 效果图

<p align="center">
  <img src="assets/screenshot-1-recent-tasks-group.webp" width="618" height="582" alt="效果图 — DSH 侧边栏底部的「最近任务」分组，列出所有没有工作区的对话">
</p>

分组常驻工作区列表末尾，行为与其他分组完全一致：`GPT-6 特点介绍` 是正在运行的那条对话，其余按使用时间排列，侧边栏底部的「＋ 最近任务对话」在同一个目录里开新对话。

## 为什么要注册真工作区

另一条路——自己画一个分组——走不通：侧边栏的分组**就是** `workspace` 存储域，没有任何插槽能让第三方插件插进一个平行分组。注册记录取代影子侧边栏的好处：

- 那里开的会话就是普通会话，`cwd` 是最近任务目录，分组的 `sessionIds` 走官方路径自己长出来（`Workspace.sessionIds` 按 `realpath(cwd) === path` 过滤，也因此**不可能**把某条对话拖进别的分组）；
- 文件访问边界不变：会话的沙箱根目录就是这个目录，需要越界时在会话内提权，与工作区对话完全一致（设计 §8.7）；
- 不打补丁改官方代码，不动 `workspace` 命名空间的任何文案，「未分组」照旧；插件自己的分组名靠改写**它自己的**那条记录跟随界面语言，绝不碰官方命名空间，也绝不碰别的分组。

## 环境要求

- [DSH](https://github.com/deepseek-ai/deepseek-harness) 的 `web` 或 `desktop` profile，`0.2.0-rc.1` 及以上（开发与验证基于 `0.2.0-rc.2`，cordis `~4.0.4`）
- Node.js `>= 22.19.0`——只在从源码构建时需要
- 装进 profile 时推荐用 [pnpm](https://pnpm.io)
- 无网络访问、无原生模块、无安装脚本、无运行时依赖

## 安装

> bundle 条目（`id: recent-tasks`）由本包自带的 `cordis.patch.yml` 自行声明，**不需要**手写补丁文件。

### 从 GitHub 安装（推荐）

按**仓库身份**安装，插件市场才能把这个包明确对应到 `winditer/dsh-recent-tasks`，卡片上才会显示正确的 GitHub 链接与描述：

```sh
dsh plugin --profile desktop add github:winditer/dsh-recent-tasks
```

Web profile 用 `--profile web`。重启 DSH（完全退出再打开），侧边栏底部就会出现「最近任务」分组。

构建产物 `dist/client.js` 是**特意提交进仓库**的：`github:` 安装不会执行本包的构建（pnpm 默认阻止生命周期脚本），提交进去的 bundle 才能让这条路开箱可用，使用端不需要编译任何东西。

### 从应用内安装

**设置 → 插件 → 安装 bundle**，指向本目录（或一个 `file:` 规格）。`scripts/install-into-profile.sh` 是等价的手工路径：`pnpm add file:<repo>` 外加一条 `dsh.profile.bundles`。

**`dependencies` 那条不能省**——只写进 `dsh.profile.bundles` 的名字会被桌面端崩溃恢复流程抹掉（它按 `dependencies` 重新推导 bundle 列表）。

### 从 npm 安装

```sh
dsh plugin --profile desktop add dsh-recent-tasks
```

> ⚠️ 本包已按 npm 规范准备好，但**尚未发布**——在发布之前请用上面的 `github:` 规格（插件市场读取的也是这个来源）。本 README 不声称任何已发布的版本号。

### 从源码安装（开发）

```sh
git clone https://github.com/winditer/dsh-recent-tasks.git && cd dsh-recent-tasks
npm install
npm run build          # 重新生成 dist/client.js
dsh plugin --profile desktop add .
```

`dist/client.js` 每次启动前由 `node scripts/build.mjs` 重新生成；万一缺失，Host 半边照常加载，应用日志里会出现 `client bundle not found; run \`pnpm run build\` before launch`。

## 设置

四项实时配置就是普通的官方设置：**设置 → 通用**（本插件自己的那一行）和**设置 → 插件**（由插件 `Config` 自动推导）都能看到，且写入同一份文档。

| 键 | 默认 | 含义 |
|---|---|---|
| `recentTasksDir` | `~/Documents/DSH 最近任务` | 分组占用的目录。首次使用时创建；必须是绝对路径。改它会立刻为**新目录**注册/复用记录。 |
| `title` | `最近任务` | 创建记录时使用的分组名。当记录里的标题仍是本插件自己的默认名（`最近任务` / `Recent tasks`）时，它会跟随界面语言；其他任何标题都算你手动定的，永不被改写。 |
| `pinLast` | `true` | 持续把分组钉在工作区列表末尾。 |
| `autoRepair` | `true` | 分组被删除后自动重建。关掉它，删除就变成可见的错误，而不是静默重建。 |
| `enabled` | `true` | 总开关（仅 patch，无表单）。 |
| `apiPrefix` | `/dsh-recent-tasks/api` | Host API 路径（仅 patch）。 |

改动由 `dsh-config-editor` 落盘到**当前 profile** 的 `cordis.patch.yml`（原子写、校验、失败回滚），并对运行中的 Host 实时生效：loader 把新值提交进插件的 `Volatile` 引用并发出 `loader/volatile-update`，Host 半边据此立刻重新 ensure。本插件自己从不写任何配置文件。

优先级：profile patch 层优先于本包内置默认值，所以用户改动能跨升级保留。

## 行为细节

- **绝不静默失败。** 每次拒绝都是一个错误码（`bad-config`、`dir-not-writable`、`dir-not-directory`、`missing-record`、`disabled`、`unavailable` …），由客户端从本插件自己的 locale 命名空间渲染；Host 从不下发展示文案。
- **接口很小、只在本地。** 两个幂等 POST（`state`、`ensure`），且必须带 `content-type: application/json`；这条限制同时也是 CSRF 防线——跨站「简单请求」设不了这个类型，而本路由不响应预检。接口不暴露任何机密，也从不接受浏览器传来的路径或命令。
- **`state` 绝不写盘。** 不 mkdir、不创建、不排序；记录被删就以 `workspaceId: null` + `missing-record` 如实上报，只有 `ensure` 会修复。
- **能复用就不新建。** 配置目录已经是工作区时复用那条记录，且不动它的标题（DSH 的 `create` 按 `realpath` 幂等，复用时会忽略标题）。
- **分组名跟随界面语言。** 侧边栏那一行和右上角工作区切换菜单都是**原样**渲染记录里持久化的 `title`——DSH 只对自己那个 `default-workspace` 哨兵值做本地化，插件也无法往内置 `workspace` 命名空间里加词条。所以只要记录里的标题还是本插件自己的默认名（`最近任务` / `Recent tasks`），客户端半边就会用官方的 `workspaces.rename`（侧边栏自己「重命名」用的同一个调用）把它改成当前语言：两处立刻刷新，且持久化。你自己在侧边栏改过名，或把 `title` 配成别的，插件从此不再碰它。**磁盘目录名永不改动**：路径是会话归属的依据，改名会让已有对话掉回「未分组」。
- **嵌套目录会警告。** 最近任务目录落在别的工作区**内部**时会显示为它的子级，设置行会明说，而不是假装没事。
- **删除是诚实的。** `autoRepair` 关闭时分组被删，入口和快捷键都会报 `missing-record`——绝不把对话悄悄开到别处。
- **快捷键有退路。** `session.new` 已占用 `Mod+N`（桌面）与 `Mod+Alt+N`（Web），而 `shortcuts.register` 拒绝重叠默认值。桌面用 `Mod+Alt+N`；Web/macOS 与 Web/Windows 用 `Mod+Shift+N`；Web/Linux 不绑定。万一仍冲突会被捕获，侧边栏入口始终可用。

## 排查

| 现象 | 原因 / 处理 |
|---|---|
| 侧边栏没有「最近任务」分组 | 看 **设置 → 通用 → 最近任务** 的错误码：`missing-record`（且自动重建关闭）或 `dir-not-writable`。 |
| 分组嵌套在别的工作区下面 | `recentTasksDir` 落在某个已注册工作区内部——换一个不在任何工作区里的目录。 |
| 入口提示 `unavailable` | Host 半边没挂上（行被禁用，或行在 `workspaceRegistry` 之前挂载）。安装后重载一次应用。 |
| 设置行显示只读提示 | 当前组合里没有 `configForms`（即没有官方设置界面）；直接改 profile `cordis.patch.yml` 里的 `recent-tasks` 行。 |
| 对话还是进了「未分组」 | 那些对话的 `cwd` 不是本工作区的目录。**历史对话永不迁移**（设计 §6.3/N3）：本分组只承接通过入口/快捷键新开的对话。 |

## 开发

```bash
node scripts/build.mjs      # 构建 dist/client.js
node --test test/*.test.js  # 49 项测试：协议、Host、客户端逻辑、bundle 契约
node scripts/build.mjs && node --test test/*.test.js   # 即 npm run verify
npm pack --dry-run          # 查看将要发布的文件清单
```

`node_modules/@deepseek-ai/*` 是指向 `.asar/` 下解包出来的 `0.2.0-rc.1` 依赖树的软链接，只为让 `node --test` 能解析 `@deepseek-ai/schemastery`；生产环境走 DSH 自己的 profile 解析拦截，所以包里把它们声明为**可选** peer，不带任何运行时依赖。

## 目录

| 路径 | 作用 |
|---|---|
| `src/host.js` → `lib/index.js` | Host 半边：`Config`、注册逻辑、JSON API、实时配置监听 |
| `src/client.js` → `dist/client.js` | 浏览器半边：侧边栏入口、设置行、轮询、快捷键 |
| `src/client-core.js` | 无 React 的纯逻辑：状态机、`planCreate`、快照 store、快捷键判定 |
| `src/protocol.js` | 共享词表：错误码、方法、路径处理、响应解析 |
| `src/locales.js` | `recentTasks` 中英文词典（扁平键，键集 1:1） |
| `assets/` | 本 README 使用的效果图（插件市场也会抓取） |
| `screenshots.json` | 插件市场读取的效果图清单（约定：放在 `package.json` 旁，路径相对于本仓库） |
| `test/` | `protocol` · `host` · `client` · `bundle` |
| `.agents/notes/` | 本次实现遵循的设计笔记，含与草稿 SPEC 的偏离说明 |

## 许可

[MIT](LICENSE) © 2026 dsh-recent-tasks contributors