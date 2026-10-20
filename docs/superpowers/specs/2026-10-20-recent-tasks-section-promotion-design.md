# 最近任务：把分组提升为与「工作区」同层的折叠区块 — 设计规格（v1 · Draft）

父规格：[`2026-09-29-recent-tasks-plugin-design.md`](../../../dsh-tmp/docs/superpowers/specs/2026-09-29-recent-tasks-plugin-design.md)（v1，已实现）。
同级规格：[`2026-09-29-recent-tasks-isolated-dirs-design.md`](2026-09-29-recent-tasks-isolated-dirs-design.md)（v2，未实现，与本文件无耦合）。
实现笔记：[`.agents/notes/2026-09-29-recent-tasks-implementation.md`](../../.agents/notes/2026-09-29-recent-tasks-implementation.md)。

本文件只写本次增量。v1 已确认的事实（真工作区记录、`state`/`ensure` 只读、设置走官方 `configForms`、标题镜像）不重复论证；本文件与 v1 冲突时以本文件为准。

> 本规格的所有"已核实"结论均取自**正在运行的 0.2.1-rc.2**：从 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 抽出的
> `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`（下称 `ui-workspace`）与
> `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js`（下称 `ui-sidebar`）。
> 仓库内 `.asar/x/` 那份是 0.2.0-rc.1，**不要**拿它做依据（class 哈希已经变过）。

---

## 1. 一句话概述

不改 host 半、不改工作区记录语义，只在客户端加一个**视图适配器**：把「最近任务」那条工作区分组**换装**成与「工作区」同层的折叠区块（用自己的箭头折叠），并给官方「工作区」标题补一个折叠开关（收起它下面的所有工作区分组）。两块**各自独立**；任一前提不满足时适配器整体停用，UI 回到官方原样。

## 2. 目标与非目标

### 2.1 目标

1. 侧边栏读起来是两个同层块：「工作区」（展开 = 现有全部工作区分组）与「最近任务」（展开 = 现有挂在最近任务工作区下的全部对话）。
2. 两块各自独立折叠：收起「工作区」不影响「最近任务」及其对话；反之亦然。
3. 「最近任务」下面的对话行相对它的标题**缩进一级**，「工作区」标题在块外层，层级一眼可辨。
4. 官方行为零丢失：对话行仍是官方行（运行中圆点、待处理红点、悬浮操作、`⋯ 重命名/删除`、`⊕ 新会话`、拖拽排序、「展开其余 N 个会话」、置顶/归档/分叉），官方搜索、视图选项、排序、归档筛选、树模式一律不动。
5. 前提不成立时**整体停用且无残留**：不报错、不留注入节点、不留状态类，外观等于官方默认。

### 2.2 非目标（本次明确不做，写明理由）

| 不做 | 理由 |
|---|---|
| 让「最近任务」块真正移出滚动容器 | 官方 `sidebar.workspaces` 是唯一座位、没有区块级插槽（§3.1）；移出滚动区只能自绘会话行，等于丢掉目标 4。本次接受"它随列表滚动"，需要时按 §9 的叠加方案增量做。 |
| 改官方包 / 上补丁 | 客户端在只读的 `app.asar` 里，且会被升级覆盖；官方若要内置，正确做法是新增区块级插槽 + 给列表一个基缩进变量（见 §9）。 |
| 与官方分组折叠状态做双向同步 | 我们只做"整段隐藏其它分组"，不写官方 `groupExpansion` 存储，避免两套折叠状态互相打架。 |
| 把最近任务的会话改成"无工作区会话" | 会话归属仍由 `cwd` 决定（父规格 §3.1），本设计不碰状态。 |
| 给官方 `workspace` 命名空间加文案/按键 | 沿用 v1 承诺：只动插件自己的 `recent-tasks` 命名空间。 |
| 手风琴互斥（展开一个自动收起另一个） | 用户选择"两个块各自独立"（§2.1-2）。 |
| 把整个工作区列表整体右移 | 被本次"区块提升"取代；对话缩进已由 §5.3 覆盖。 |
| 「工作区」折叠状态与官方搜索/筛选联动 | 折叠只隐藏分组块；搜索态本来就没有分组，见 §5.1 停用条件。 |

---

## 3. 关键约束（已核实，写代码前必须遵守）

### 3.1 侧边栏没有"再加一个区块"的插槽

`ui-sidebar` 渲染的槽位是固定的 8 个：`sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.left.toggle`、`sidebar.toggle.badge`、`sidebar.panellist`、`sidebar.settings`、`sidebar.workspaces`、`sidebar.footer.action`。

`ui-sidebar:392` 把工作区那一整块作为**单个** `renderSlot("sidebar.workspaces", { wide, expandSidebar })` 交给一个 `.regionArea` div；`ui-workspace` 是这个槽位的独占占用者。官方那唯一一个区块标题（`工作区` / `会话`，`section.workspaces` / `section.sessions`）在该占用者内部渲染，**不是**一个可由插件扩展的列表。

⇒ 插件无法"注册第二个区块"。本次只能在官方 DOM 上做表现层重塑。

### 3.2 分组行带着足够用的稳定抓手

`ui-workspace:1965-2035`：分组行是一个 `div`，其属性为

- `data-row-key="workspace:<group.key>"`（`:1967`）
- `role="treeitem"`、`aria-expanded={row.expanded}`、`onClick: onToggle`（`:1968-1970`）
- 直接子元素顺序：`span.slot.folder`（文件夹图标，`:1973`）→ `span.slot.chevron`（箭头，`:1977`）→ `span.projectText > span.title`（`:1981`）→ `span.rowActions`（`⋯` 菜单 + `⊕ 新会话`，`:1988`）

⇒ 「提升成区块头」需要的四件事（折叠、箭头、标题、块级操作）官方行**全都有**；我们只做"换装"，不重绘。

### 3.3 缩进由官方变量给出，且分组容器的内联值标明了层级

`ui-workspace:1741`（rows 模块 CSS）：`.projectRow,.sessionRow { padding-inline-start: calc(8px + var(--dsh-workspace-indent,0px)) }`。
`ui-workspace:3196`：每个分组容器内联 `style="--dsh-workspace-indent: <depth*12>px"`。
同一份 CSS 给「展开其余 N 个」用的偏移是 `calc(28px + var(--dsh-workspace-indent,0px))`。

⇒ 根层分组的内联值恰好是 `0px`，这可以作为"未被树模式嵌套"的可靠判据（§5.1）。

### 3.4 官方 class 哈希随版本变

0.2.0-rc.1 是 `tztITa_root/_listArea/_sectionHeader`、`F6DNpa_projectRow/_sessionRow`、`yuWXda_root`；0.2.1-rc.2 变成 `_7514NG_*`、`jJkEga_*`、`_3WPZCG_root`。

⇒ **禁止**在插件里出现任何官方 class 字面量。允许的抓手只有：官方 `data-row-key` / `role` / `aria-*`、官方 CSS 变量（`--dsh-workspace-indent`、`--dsh-sidebar-inline-padding`、`--dsw-*` token）、以及**插件自己打的 `data-dsh-rt-*` 属性**。§7.2 用一条测试守住这条。

### 3.5 滚动容器有稳定属性，且退出动画会剥离官方抓手

`AnimatedRows`（`ui-workspace:2397`、`render()` 在 `:2524-2541`）渲染一个 **Fragment**，落到 `treeBody` 里的直接子元素是：

1. `<div className={list} role="tree" aria-label={label}>` —— **滚动容器，行就是它的直接子元素**，且带官方稳定属性 `role="tree"`；
2. `<div className={exits} aria-hidden="true">` —— 退出动画的克隆层（`treeBody` 的兄弟，不在 `role="tree"` 里）。

同一处 `getSnapshotBeforeUpdate`（`:2409-2418`）在做退出动画时会 `row.element.cloneNode(true)` 并**显式 `clone.removeAttribute("data-row-key")`**，同时把 `--dsh-workspace-indent` 复制过去。

⇒ 两条结论：① 可以用 `row.closest('[role="tree"]')` 定位滚动容器，不必只靠父链；② **只用官方属性的选择器在退出动画的克隆上会失效**，所以"缩进"这类样式必须挂在我们自己打的 `data-dsh-rt-*` 上（`cloneNode(true)` 会连我们的属性一起复制）。

其余几何事实（`ui-workspace:2720`）：`.listArea { margin-left:-4px; padding-left:4px; margin-right:-edge-inset; overflow:visible }`；`.list { … overflow-y:auto }` 是滚动容器；`.treeBody { position:relative }` 承载落点指示线与底部渐隐。
- rail 复位：`.rail .listArea { margin-left:0; margin-right:0; padding-left:0 }`；`ui-sidebar:91` 侧边栏根 `--dsh-sidebar-inline-padding:12px`，`.root { padding:6px var(…) }`。
- rail（宽栏关闭）时 `listArea` 内容整体不渲染 ⇒ "找不到分组行"天然覆盖 rail，无需单独判分支（§5.1）。

### 3.6 插件现有可复用能力

| 用途 | 现状 |
|---|---|
| 注入样式 | `src/client.js` `installStyles()`：`<style data-plugin-css="dsh-recent-tasks">` + `ctx.effect` 卸载移除 |
| 本地持久化 | `src/client-core.js` `readGuideSeen/writeGuideSeen` + `GUIDE_KEY`（本次沿用同一模式） |
| 文案 | 自有命名空间 `NS = 'recent-tasks'`（`src/locales.js`，zh 为键集真源） |
| 拿工作区 id | 既有 `state` 接口（`workspaceId` 字段），客户端 controller 已缓存 |
| 官方服务 | `ui-workspace` 暴露 `uiWorkspace` 服务（`ui-workspace:1380` `super(ctx,"uiWorkspace")`）。**本次不需要**：适配器不建会话、不开会话 |

---

## 4. 设计总览

```
▾ 工作区                     ← 官方标题行 + 我们注入的折叠按钮
    ▸ tide
    ▸ lark2codex
    ▸ HA_RedbackTech
    ▸ Mole
    ▸ 未分组
▾ 最近任务                   ← 官方分组行换装（箭头常显、无文件夹图标、与上方标题同左基线）
    询问模型身份
    模型身份说明
    superpower与gstack区别
    本周AI GitHub热榜         ← 官方行原样：运行中点 / 待处理红点 / 悬浮操作 / 右键菜单 / 拖拽
```

三个角色的分工：

| 角色 | 职责 |
|---|---|
| 适配器（本次新增，客户端表现层） | 定位官方行、打 `data-dsh-rt-*` 标签、注入折叠按钮、维护折叠状态、在任何重渲染后幂等重放 |
| 官方 UI | 分组渲染、折叠状态、会话行行为、搜索/视图选项/树模式/拖拽 —— 全部不动 |
| host 半 + 工作区记录 | 完全不动（本次零改动） |

---

## 5. 详细设计

### 5.1 启用条件（单一判据）与停用清单

适配器只在**同时**满足下列三条时启用：

| 条件 | 取值来源 | 说明 |
|---|---|---|
| 能找到最近任务分组行 | `document.querySelector('[data-row-key="workspace:' + CSS.escape(workspaceId) + '"]')` | 行存在 ⇔ 官方正在渲染分组浏览宽栏视图 |
| 该分组在根层 | 行的父元素 `el.style.getPropertyValue('--dsh-workspace-indent')` 严格等于 `'0px'` | 树模式下被嵌套时不为 `0px` |
| 能找到官方标题行 | 沿父链定位（§5.2）并校验其内不含任何 `[data-row-key]` | 标题行是注入锚点 |

任一不满足 ⇒ **停用**：移除注入按钮、移除 `<html>` 状态类、清除全部 `data-dsh-rt-*` 标签、断开观察器。停用是无副作用的幂等操作，可反复调用。

由此自然覆盖的场景（无需额外分支）：**单列表**（没有分组容器）、**搜索态**（列表被结果列表替换）、**rail 细栏**（`listArea` 不渲染）、**树模式下被嵌套**（内联缩进不为 `0px`）、**官方升级改了结构**（找不到抓手）。

### 5.2 定位链与校验

从分组行出发，只走官方属性与"父/兄"关系，不依赖任何 class：

```
row        = [data-row-key="workspace:<id>"][role="treeitem"]
block      = row.parentElement                       // 分组容器
list       = row.closest('[role="tree"]')            // 滚动容器（官方稳定属性；§3.5）
             └ 校验：list === block.parentElement
treeBody   = list.parentElement                      // 落点指示线/渐隐所在
listArea   = treeBody.parentElement                  // margin/padding 那层
root       = listArea.parentElement                  // ui-workspace 根
header     = root.firstElementChild                  // 唯一兄弟：区块标题行
```

校验（全部通过才启用）：
1. `list` 至少有一个直接子元素含 `> [data-row-key^="workspace:"]`；
2. `listArea` 内不再含更外层的分组（防止把 `block` 认成 `list`）；
3. `header !== listArea`、`header` 内 `querySelector('[data-row-key]') === null`。

任一条不成立 ⇒ 按 §5.1 停用。

### 5.3 「最近任务」换装（纯 CSS，靠自己打的标签）

标签（只在启用时打，停用时清除；退出动画的克隆会带着这些属性，所以动画期间样式不跳变）：

| 元素 | 标签 |
|---|---|
| 分组行（块标题行） | `data-dsh-rt-row="recent"` |
| 分组容器 | `data-dsh-rt-block="recent"` |
| 滚动容器（`role="tree"`） | `data-dsh-rt-list` |
| 块内的会话行 | `data-dsh-rt-sub` |
| 块内的「展开其余 N 个会话」按钮 | `data-dsh-rt-overflow` |

CSS（写进现有插件样式表；**每条选择器重复一次标签属性**，用 0,2,0 特异性压过官方 0,1,0 的模块规则，从而不依赖样式注入顺序、也不需要用 `!important`）：

```css
[data-dsh-rt-row][data-dsh-rt-row]{padding-inline-start:4px;color:var(--dsw-alias-label-tertiary);height:36px}
[data-dsh-rt-row][data-dsh-rt-row]>span:nth-child(1){display:none}          /* 文件夹图标 */
[data-dsh-rt-row][data-dsh-rt-row]>span:nth-child(2){display:inline-flex}   /* 箭头常显 */
[data-dsh-rt-block][data-dsh-rt-block]{margin-top:12px}                     /* 块间距 */
[data-dsh-rt-sub][data-dsh-rt-sub]{
  padding-inline-start:calc(8px + 12px + var(--dsh-workspace-indent,0px))}
[data-dsh-rt-overflow][data-dsh-rt-overflow]{
  padding-left:calc(28px + 12px + var(--dsh-workspace-indent,0px))}
```

要点：

- 左基线对齐：官方标题行 `padding-left:4px` + 我们注入的按钮（18px 盒 + 官方 `gap:4px`）⇒ 标题文字在 26px；分组行 `padding-inline-start:4px` + 官方 `gap:6px` + 官方箭头 `span.slot` 16px ⇒ 文字同样在 26px。
- 会话行用 `data-dsh-rt-sub` 而不是 `[data-row-key^="session:"]`，因为退出动画的克隆被官方剥掉了 `data-row-key`（§3.5）；「展开其余 N 个」按钮单独一条规则，保留官方 28px 基线再加一档。
- 两个 `--dsh-workspace-indent` 都原样保留，树模式叠加语义不变（本适配器只在根层启用，见 §5.1）。
- 结构选择器 `> span:nth-child(1|2)` 是**结构性**的，不含 class；实现时额外做一次运行时校验（行有 ≥3 个直接子元素，且第 1、2 个子元素都含 `<svg>`），校验失败按 §5.1 停用。
- 是否在块间距之上再加一条分隔细线：见 §9 待确认。

### 5.4 「工作区」折叠开关（本次唯一的 DOM 注入）

- 注入物：`<button type="button" class="dsh-recent-tasks-collapse" data-dsh-rt-collapse aria-expanded="true|false">`，内含插件自绘的 16px 三角 SVG（旋转 90° 表示展开），按钮盒 `18px × 18px; flex:none`（配合官方 `gap:4px` 让标题文字落在 26px，与分组行文字对齐）。作为 `header` 的**第一个子元素**插入。
- `aria-label` 来自插件自己的命名空间：`collapse.workspaces`（收起工作区列表）/ `expand.workspaces`（展开工作区列表），zh 为键集真源，en 1:1 镜像（既有单测断言两个键集相同）。
- 交互：`click` → `stopPropagation()` → 读状态取反 → 写 localStorage → 应用（§5.5）→ 更新 `aria-expanded`。原生 `<button>` 自带 Enter/Space 支持。
- 幂等：`ensureButton(header)` 先清掉 `header` 下所有 `.dsh-recent-tasks-collapse` 再按需插入一个（避免官方重建后遗留多个）。
- 状态键：`dsh-recent-tasks:workspaces-collapsed`，值 `'1'` / 缺失即展开（与 `GUIDE_KEY` 的读写风格一致，容错解析非法值 ⇒ 展开）。

### 5.5 折叠的生效方式

状态放在 `document.documentElement`（React 不管这个元素的 class）：

```css
html.dsh-recent-tasks-workspaces-collapsed
  [data-dsh-rt-list][data-dsh-rt-list]:has([data-dsh-rt-block])
  > div:not([data-dsh-rt-block]){display:none}
```

即：列表里除最近任务块以外的直接子元素（各工作区分组、未分组）全部隐藏。`:has([data-dsh-rt-block])` 是一道防误伤闸门——官方重渲染后、我们的重放跑到之前，标签可能短暂不在，此时 `:not([data-dsh-rt-block])` 会匹配到**所有**子元素；闸门保证"没有已打标签的块时什么都不隐藏"。启动时用 `CSS.supports('selector(:has(*))')` 探一次：不支持就退化成不带闸门的同一条规则（当前运行环境是 Chromium 新版，正常走带闸门的版本）。

因为隐藏的是"兄弟块"，两块**各自独立**（§2.1-2），且最近任务块的展开/折叠仍由官方箭头与官方 `groupExpansion` 存储负责。

已知取舍（写进 README）：折叠期间，位于被隐藏分组里的当前会话高亮不可见；展开即恢复。

### 5.6 重新应用（重渲染后的自愈）

官方在加/删工作区、切换分组方式、折叠/展开侧边栏、切换归档筛选时都会重建 DOM。适配器：

1. 每轮先跑一次 §5.1 的判据（停用/启用）；
2. 启用时幂等重放：重打 §5.3 的五个标签、`ensureButton`、应用 `<html>` 状态类；
3. 触发时机：`MutationObserver`（只观察 `root` 子树，`childList` + `subtree`）+ 现有 30s 轮询 + 状态 `state` 变更时各跑一次；所有回调做 250ms 内的合并（同一帧只跑一次）；
4. 卸载：`ctx.effect(() => () => stopAdapter(), 'dsh-recent-tasks: adapter')`，与现有样式注入同一模式。

### 5.7 与官方功能的相互影响

| 官方行为 | 影响 |
|---|---|
| 点击分组行 / 官方箭头折叠 | 不变（我们只换装，不改事件） |
| `⋯ 重命名 / 删除工作区`、`⊕ 新会话` | 不变（`rowActions` 只是常显/hover 显的差别） |
| 拖拽排序（工作区之间、会话之间） | 不变；落点指示线与 hover 底色跟着我们打的标签所在容器，不额外偏移 |
| 视图选项（分组方式/排序/筛选） | 切换后重放；切到"单列表"或"树模式下被嵌套"⇒ 停用 |
| 搜索 | 搜索态无分组 ⇒ 停用；清空搜索后自动重放 |
| rail 细栏 | 不渲染分组 ⇒ 停用 |
| 官方标题文案（`工作区`/`会话`） | 只读取，绝不改写 |

---

## 6. 边界与错误处理

- 适配器全部动作包在 try/catch 内，失败只 `console.warn('[dsh-recent-tasks]', …)`（沿用现有 logger），绝不冒泡到 React 渲染路径。
- 任何一步失败都走 §5.1 的停用路径：移除按钮、移除 `<html>` 类、清除标签 ⇒ 用户看到官方默认外观，功能无损。
- 适配器**不写盘、不联网、不调 host**、不碰会话/工作区存储；localStorage 只写折叠状态这一个键。
- 官方在 `header` 上重建 DOM 会带走我们注入的按钮（父节点被 React 整体移除时按钮随之消失）——这正是重放机制存在的原因；按钮丢失期间只是"少一个开关"，不影响其它功能。
- 若 `state` 尚未返回 `workspaceId`，判据不成立 ⇒ 停用；拿到后自动启用。

---

## 7. 测试计划

### 7.1 纯逻辑（`test/client.test.js` 扩写，Node 内跑）

- `readWorkspacesCollapsed/writeWorkspacesCollapsed`：缺失键 ⇒ 展开；`'1'` ⇒ 收起；非法值 ⇒ 展开；写入用 `fakeStorage` fixture 断言只写一个键。
- `shouldPromoteSection({ rowFound, indent, listFound, headerFound })`：逐条断言停用条件（含 `indent: '12px'` 的树嵌套、`rowFound: false` 的单列表/搜索/rail）。
- locale 新增键在 zh/en 都存在且非空（沿用现有 locales 测试模式）。

### 7.2 制品契约（`test/bundle.test.js` 扩写）

- 构建产物里存在三条新规则（换装、块间距、折叠隐藏）与折叠按钮的 class。
- **守卫测试**：`src/*.js` 与 `dist/client.js` 中不得出现官方 class 哈希前缀（`_7514NG_`、`jJkEga_`、`_3WPZCG_`、`tztITa_`、`F6DNpa_`、`yuWXda_`）。这条专门守住 §3.4。

### 7.3 真机验收（手动，一次即可；我会交付清单）

按顺序跑：① 两个块各自折叠/展开，互不影响；② 折叠后刷新页面，状态保持；③ 切"单列表" ⇒ 无残留按钮/无隐藏异常，切回 ⇒ 恢复；④ 搜索态 ⇒ 无残留，清空 ⇒ 恢复；⑤ 收成 56px 细栏再展开 ⇒ 无重复按钮；⑥ 重命名最近任务分组标题 ⇒ 换装仍生效；⑦ `⋯ 重命名/删除`、`⊕ 新会话`、拖拽工作区与会话、运行中圆点、待处理红点、归档/置顶、搜索命中滚动定位；⑧ 添加/删除一个工作区 ⇒ 重放后仍生效。

---

## 8. 代码组织与写入范围

| 文件 | 改动 |
|---|---|
| `src/client-core.js` | 新增纯逻辑：折叠状态读写、`shouldPromoteSection`、（可选）标签/键常量 |
| `src/client.js` | 新增适配器（定位链、打标签、注入按钮、折叠应用、MutationObserver、卸载），并扩写现有 `CSS` 常量 |
| `src/locales.js` | 新增 2 个键（折叠/展开工作区的 `aria-label`），zh 为键集真源 |
| `test/client.test.js`、`test/bundle.test.js` | §7.1、§7.2 |
| `README.md`、`README.zh.md` | 新增一节：这次提升是表现层适配、依赖哪些官方属性、何时停用、已知取舍（跟随滚动、隐藏块的当前会话高亮不可见） |
| `package.json` | 版本 0.1.0 → 0.2.0（新增行为） |
| `dist/client.js` | 构建产物（`node scripts/build.mjs`） |
| **不动** | `src/host.js`、`src/protocol.js`、`cordis.patch.yml`、工作区记录语义、任何官方包 |

---

## 9. 待确认问题

1. 块间距 12px 是否再加一条分隔细线（默认：只加间距，不加线）。
2. 对话行的 12px 缩进步长是写死还是走设置项（默认写死；若要可调，加一个 `volatile` 字段 + 现有 `settings.general.item` 行，属增量）。
3. 折叠按钮是否常显（默认常显，作为区块头的可视提示；也可改成 hover 才显，像官方箭头）。
4. 如果之后不接受"最近任务块随列表滚动"，按叠加方案做：给最近任务块 `position: sticky; bottom: 0` + 自带背景/滚动（保住官方行行为，代价是 CSS 更绕）。
5. 上游建议（不在本次范围）：官方为区块级扩展新增插槽，或给列表一个基缩进变量（例如 `--dsh-workspace-list-indent`），插件即可退化为一行 CSS。