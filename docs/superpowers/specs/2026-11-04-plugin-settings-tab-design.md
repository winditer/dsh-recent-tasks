# 最近任务：把插件设置移到「设置 → 插件 → 最近任务」页签 — 设计规格（v1 · 已实现）

父规格：[`2026-09-29-recent-tasks-plugin-design.md`](../../../dsh-tmp/docs/superpowers/specs/2026-09-29-recent-tasks-plugin-design.md)（v1，已实现）。
本文件只写本次增量：**设置界面搬家**。凡父规格已确认的事实（`state`/`ensure`、`configForms` 是官方配置通道、标题镜像）不重复论证；冲突时以本文件为准。

> 本规格的"已核实"结论取自**正在运行的 0.2.1-rc.5**，从 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 抽出的
> `dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`（下称 `plugin-manager`）、
> `.../dsh-experimental-plugin-market-bundle/cordis.patch.yml`（下称 `market-bundle`）以及
> `dsh/desktop-runtime.json` 的 `sharedPackages` 清单。

---

## 1. 一句话概述

插件不再往 `settings.general.item` 塞一行，而是往「设置 → 插件」页注册自己的 **`plugins.tab` 页签「最近任务」**；三行设置（目录 / 分组名 / 自动重建）保持原样，只是换了个家。旧的「设置 → 通用」入口删除。

## 2. 目标与非目标

### 2.1 目标

1. `设置 → 插件` 顶部页签从 `已安装 | 发现` 变成 `已安装 | 发现 | 最近任务`。
2. 页签里就是本插件三项设置的完整表单，行为与旧版设置行**逐项一致**：目录 + 更改…、规范化路径 / 嵌套警告、分组名（仅新分组）、被删后自动重建、保存反馈与错误码。
3. `设置 → 通用` 里不再有本插件的行；本插件设置只有**一个**入口。
4. 仍走官方 `configForms`（写当前 profile 的 `cordis.patch.yml` 并即时生效），不新增自有配置文件。

### 2.2 非目标

| 不做 | 理由 |
|---|---|
| 保留通用页那一行作为快捷入口 | 同一份配置两处可改，容易出现"改了一处另一处看着没变"的错觉；用户明确选择"移动"而非"复制"。 |
| 借 `plugins.item` 卡片或 `plugins.row.config` 详情页 | 用户要的是页签；卡片要点两次才看到设置，详情页藏在「已安装 → 本包 → 行 → 配置」三层之后。 |
| 接管 `plugins.tab` 的其它页签 | 只加自己的一个页签，不动「已安装」「发现」。 |
| 改 host 半 / 改 `Config` 字段 | 本次纯客户端搬家。 |

## 3. 事实（已核实）

1. `plugin-manager` 声明了 `children["plugins.tab"] = { kind: "list", scope: "root" }`；list 槽位**必须**带 `id`，且槽位未声明时 `register()` 直接抛错 —— 所以只能用 `ctx.slots.inject('plugins.tab', …)` 注册。
2. 页签投影 `tabLedgerSource` 直接吃 `ctx.slots.entries("plugins.tab")`，**不按 `order` 重排**；而 `ctx.slots.register` 的 spec 里 list 槽位也不需要 `order`。⇒ 页签顺序 = 注册顺序。本插件作为 bundle 在组合内置页面之后加载，因此天然排在最后。
3. `plugins.tab` 的标签经 `resolveSlotLabel(entry.options.label)` 解析，写成 `() => t('settings.title')` 即可随语言切换（`market` 的「发现」页签就是这个写法）。
4. 页签容器 `.tabPanel` 是 `display:flex; flex-direction:column; gap:24px`，官方页自身负责横向内边距；插件内容只需自带列布局。
5. `@deepseek-ai/dsh-client-ui-plugin-manager` 在 `desktop-runtime.json` 的 `sharedPackages` 里（基础分发包，不是靠 `market-bundle` 才有的）；`market-bundle` 只额外加 `plugin-market` + `ui-plugin-market`。⇒ 在标准安装里「插件」页一定存在。
6. 旧实现注册的是 `settings.general.item`（`order: 30`），而 `locales` 里的 `settings.hint` 却宣称"与 设置→插件 同一份表单"——**那句是错的**：本插件从未在插件页注册任何入口，官方派生表单只服务于 `plugins.item` 这类条目。

## 4. 设计

### 4.1 注册（`src/client.js`）

```js
ctx.slots.inject('plugins.tab', () => ctx.slots.register({
  name: 'plugins.tab',
  id: 'recent-tasks',
  label: () => t('settings.title'),   // 最近任务 / Recent tasks
  locale: NS,
  inject: () => ({
    controller,
    form: formFacade,
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
  }),
}, RecentTasksTab));
```

- `RecentTasksSettingsRow` 更名 `RecentTasksTab`，内部布局不变（三行 `SettingsRow` + 提示/错误），外层包 `.dsh-recent-tasks-panel`；`!ready` 分支同样包进面板，保证两种状态视觉一致。
- 删除 `settings.general.item` 的注册与相关注释。

### 4.2 依赖声明（`package.json`）

`dsh.client.inject` 里把 `@deepseek-ai/dsh-client-ui-settings-general` 换成 `@deepseek-ai/dsh-client-ui-plugin-manager`：`plugins.tab` 由后者声明，这样槽位在本插件 `apply` 之前一定存在（与旧版强制注入通用设置页是同一手法）。

代价：某个原本没有「插件」设置页的精简部署会被连带装载该页面。接受，因为本插件此后的设置只住在那里。

### 4.3 样式

`.dsh-recent-tasks-panel{display:flex;flex-direction:column;gap:8px;max-width:760px;min-width:0}`：列布局 + 与相邻区块同样的阅读宽度，不为页签容器另起一套外观。

### 4.4 文案（`src/locales.js`）

`settings.hint` 去掉"设置 → 插件 → dsh-recent-tasks 同一份表单"这句错话，改为："这三项就是本插件的官方设置项，修改会写入当前 profile 的 cordis.patch.yml 并即时生效。"（en 同步）。`settings.title` 同时充当页签标签，不再新增键。

### 4.5 测试

- `test/bundle.test.js`：槽位期望改为 `[['plugins.tab','recent-tasks'], ['sidebar.footer.action','recent-tasks.new']]`；断言 `spec.label()` 解析到本插件字典、`inject()` 面含 `pickDirectory` / `form.set`；并用一份 ready 快照渲染页签组件，断言面板类名与三行标题顺序。
- 其余 69 条客户端/主机逻辑测试不受影响。

## 5. 验收

1. `npm test` 全绿（79 条）。
2. 重建 `dist/client.js`，产物里只有 `plugins.tab`，不再出现 `settings.general.item`。
3. 重启 DSH（profile 是 `link:` 安装）后：`设置 → 插件` 出现「最近任务」页签，三行设置可读可改；`设置 → 通用` 不再有本插件的行。
4. README / README.zh 的「设置」章节、能力表、故障排查不再宣称"通用页有入口"或"两处同源"。

## 6. 回滚

单点回滚：把 §4.1 的注册换回 `settings.general.item`（`order: 30`），`package.json` 的 inject 换回 `ui-settings-general`，删掉 `.dsh-recent-tasks-panel` 包裹。host 半与数据结构未动，无需迁移。
## 7. 更正（0.4.1）：页签注册在了错的那一页

0.4.0 把页签注册进了 **`plugins.tab`**，那是 `dsh-client-ui-plugin-manager` 那页（内部 tab 值 `installed` / `discover`）的插槽；而 Settings 导航里真正显示「内置插件」的，是 `dsh-client-ui-settings-plugins` 注册的 `settings.section`（id `plugins`，`order: 15`）。两者是不同的包、不同的插槽。结果：0.4.0 的页签落进了一个不在导航里的页面，用户既看不到它，「通用设置」那行又已经删掉——设置等于没有入口。

正确的事实（以用户 0.2.1-rc.x 运行实例为准）：

1. 「内置插件」页 = `settings.section` id `plugins`，标题/简介来自 `dsh-client-ui-settings-plugins` 的字典（`title: 内置插件`、`intro: 查看内置部署的插件列表`）。
2. 它的页签插槽是**该 section 条目的子槽位**：`children: { "settings.plugins.tab": { kind: "list", scope: "root" } }`。
3. 页签按 `entry.options.order` 升序排（不是注册顺序）：`插件列表` = 10，`插件市场`（`dshmarket`）= 60，`粘贴折叠`（`dsh-paste-spill`）= 60。→ 本插件取 **70**，排在最后。
4. 页签面板渲染是 `renderSlot("settings.plugins.tab", {}, { only: row.id })`：**不传任何 owner props**，组件只靠自己的 `inject` 面（`controller` / `form` / `pickDirectory`）和 `locale: NS`。
5. 只有一个页签时该页不画页签条、直接铺开内容（`rows.length === 1` 分支），所以顺序和"只有一个 tab"的形态都要能成立。

对应改动：注册名换 `settings.plugins.tab` + `order: 70`；`dsh.client.inject` 从 `ui-plugin-manager` 换成 `dsh-client-ui-settings-plugins`（声明该 section 与其子槽位的包）。组件、样式、文案、host 半均不变。
