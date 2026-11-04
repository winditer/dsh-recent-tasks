# 2026-11-04 — 设置界面搬到「设置 → 插件 → 最近任务」页签

规格：[`docs/superpowers/specs/2026-11-04-plugin-settings-tab-design.md`](../../docs/superpowers/specs/2026-11-04-plugin-settings-tab-design.md)

## 为什么要搬

旧实现把三行设置注册在 `settings.general.item`（`order: 30`），但 `locales` 的 `settings.hint` 却写着"与 设置→插件 同一份表单"。**那句是错的**：官方派生表单只服务 `plugins.item` 这类条目，本插件从未在插件页注册任何入口，所以插件页从来没出现过这些设置。用户要求把设置挪到插件页，并选择了"新增一个页签"。

## 已核实的事实（0.2.1-rc.5，从 `app.asar` 抽出）

1. `@deepseek-ai/dsh-client-ui-plugin-manager` 把「设置 → 插件」这一页画成：`已安装` 固定页签 + `plugins.tab` 清单里的页签，`plugins.tab` 的 children 声明是 `{ kind: "list", scope: "root" }`。
2. 页签标签走 `resolveSlotLabel(options.label)`，所以 `label: () => t('settings.title')` 能跟语言走（official `plugin-market` 的「发现」页签就是这么写的）。
3. `tabLedgerSource` 用 `ctx.slots.entries("plugins.tab")` **原样**投影，不按 `order` 排序；注册顺序 = 显示顺序。bundle 在组合内置页之后加载 ⇒ 新页签自然排在最后。别指望 `order`。
4. list 槽位必须带 `id`，槽位未声明时 `register()` 直接抛 `slot "…" is not declared`——所以只能走 `ctx.slots.inject`。
5. `plugins.tab` 的渲染是 `renderSlot("plugins.tab", { install, openPackage }, { only: tab })`，外层是 `role="tabpanel"` + `.tabPanel{display:flex;flex-direction:column;gap:24px}`；官方页自己负责横向内边距。
6. `@deepseek-ai/dsh-client-ui-plugin-manager` 在 `desktop-runtime.json` 的 `sharedPackages` 里（基础分发），`plugin-market` bundle 只额外加 host `plugin-market` + client `ui-plugin-market`。「插件」页不是装市场插件才有的。
7. 通用设置页那一行已经删掉；`dsh.client.inject` 相应地把 `@deepseek-ai/dsh-client-ui-settings-general` 换成 `@deepseek-ai/dsh-client-ui-plugin-manager`（保证 slot 声明早于本插件 apply）。

## 这次的改动面

- `src/client.js`：`RecentTasksSettingsRow` → `RecentTasksTab`，外层包 `.dsh-recent-tasks-panel`；注册 `plugins.tab`（id `recent-tasks`）；删除 `settings.general.item`。
- `src/locales.js`：`settings.hint` 改成不再指向"插件页同一份表单"的说法（zh/en）。
- `package.json`：`dsh.client.inject` 换 `ui-plugin-manager`。
- `test/bundle.test.js`：槽位期望改成 `plugins.tab`，并加一条"渲染页签组件得到三行设置"的断言。
- README / README.zh：能力表、设置章节、故障排查里"设置 → 通用"的说法全部改成"设置 → 插件 → 最近任务"。

## 留个心眼

- 新页签是"整页"粒度：即使某项设置在别的部署里只读，页签也会显示（面板内部再显示只读提示）。
- 如果以后要区分"最近任务"页签标题与第一行的"最近任务"标题，需要新增一个 locale 键，别复用 `settings.title`。
- 页签顺序没有任何排序保证，想插到前面必须换机制（`priority` 影响的是同一 id 的遮盖，不是顺序）。