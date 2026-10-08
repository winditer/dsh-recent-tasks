// dsh-recent-tasks — zh/en dictionaries for the plugin-owned `recentTasks`
// locale namespace.
//
// The official `workspace` namespace ("未分组"/Ungrouped) CANNOT be extended or
// overridden: `ctx.locale.register(ns, dict)` throws
// `locale namespace "workspace" already has locale "zh"` for any (ns, locale)
// pair the namespace already owns. Hence every string this plugin shows lives in
// its own namespace. zh is the source of truth; en mirrors it 1:1 (a unit test
// asserts the key sets are identical).
//
// Keys are flat: the locale service looks up `dicts.get(ns)[key]` verbatim, so
// dotted keys such as `new.tooltip` are ordinary keys, not nested paths.

export const NS = 'recentTasks';

/**
 * The plugin's own group name, per shipped language — the ONE source both
 * dictionaries and the stored-title reconciliation read.
 *
 * The group is a real Workspace record, and the sidebar row and the workspace
 * switcher render that record's durable title verbatim (the official
 * `workspaceDisplayTitle` localizes only the `default-workspace` sentinel). So
 * the localized `name` below cannot reach those two surfaces on its own: the
 * RECORD has to be renamed, which is what `planTitleSync` decides.
 */
export const GROUP_TITLES = Object.freeze({
  zh: '最近任务',
  en: 'Recent tasks',
});

/**
 * Stored group titles that mean "this group still carries the plugin's own
 * default name", in either language.
 *
 * Any title outside this set is durable user intent — a sidebar rename, or a
 * `title` the operator configured — and is never rewritten.
 */
export const AUTO_TITLES = Object.freeze([GROUP_TITLES.zh, GROUP_TITLES.en]);

/** Whether a stored Workspace title is one of this plugin's own default names. */
export function isAutoTitle(title) {
  return typeof title === 'string' && AUTO_TITLES.includes(title);
}

export const zh = {
  name: GROUP_TITLES.zh,
  new: '最近任务对话',
  'new.tooltip': '不指定工作区，使用最近任务目录',

  'settings.title': '最近任务',
  'settings.dir': '存放目录',
  'settings.dir.change': '更改…',
  'settings.title.field': '分组名称（仅影响新分组）',
  'settings.pinLast': '始终置于工作区列表末尾',
  'settings.autoRepair': '分组被删除后自动重建',
  'settings.saved': '最近任务设置已保存',
  'settings.saveFailed': '保存失败：{0}',
  'settings.hint': '这些选项就是本插件的官方设置项（设置 → 插件 → dsh-recent-tasks 同一份表单）；修改会写入当前 profile 的 cordis.patch.yml 并即时生效。',
  'settings.nestedWarning': '该目录位于工作区「{0}」之下，分组会作为子级嵌套显示；建议改到工作区之外的目录。',
  'settings.alreadyWorkspace': '该目录已经是工作区「{0}」，将复用该分组（不会改名）。',
  'settings.pickFailed': '未能选择目录：{0}',
  'settings.readonly': '当前部署没有官方设置面板，请直接编辑 profile 的 cordis.patch.yml 中的 recent-tasks 行。',

  'state.notReady': '最近任务尚未就绪，请稍后重试',
  'state.dirNotWritable': '存放目录不可写，请在设置中更换',
  'state.dirNotDirectory': '该路径不是文件夹',
  'state.repaired': '最近任务分组已重建；原有对话仍在"未分组"下',
  'state.disabled': '最近任务插件已禁用',
  'state.badConfig': '最近任务目录配置无效（需要绝对路径）',
  'state.missingRecord': '最近任务分组已被删除，自动重建已关闭',
  'state.unavailable': '无法连接最近任务服务',
  'state.ensureFailed': '无法准备最近任务分组',
  'state.unknownMethod': '未知的最近任务接口',
  'state.methodNotAllowed': '最近任务接口只接受 POST',
  'state.payloadTooLarge': '请求内容过大',
  'state.badRequest': '请求格式无效',
  'state.internal': '最近任务内部错误',

  'guide.title': '不指定工作区即可开始对话',
  'guide.dismiss': '知道了',
  retry: '重试',
  'err.hostFail': '最近任务 Host 请求失败 ({0})',
  'err.startFailed': '无法打开最近任务对话：{0}',
};

export const en = {
  name: GROUP_TITLES.en,
  new: 'New chat (no workspace)',
  'new.tooltip': 'Start without a workspace, using the recent-tasks folder',

  'settings.title': 'Recent tasks',
  'settings.dir': 'Storage folder',
  'settings.dir.change': 'Change…',
  'settings.title.field': 'Group name (new groups only)',
  'settings.pinLast': 'Always keep at the end of the workspace list',
  'settings.autoRepair': 'Recreate the group if it is deleted',
  'settings.saved': 'Recent-tasks settings saved',
  'settings.saveFailed': 'Could not save: {0}',
  'settings.hint': 'These are this plugin\'s official settings (the same form as Settings → Plugins → dsh-recent-tasks); changes are written to the active profile\'s cordis.patch.yml and apply immediately.',
  'settings.nestedWarning': 'This folder sits inside workspace "{0}", so the group will render nested beneath it; prefer a folder outside every workspace.',
  'settings.alreadyWorkspace': 'That folder is already workspace "{0}"; the existing group is reused (never renamed).',
  'settings.pickFailed': 'Could not pick a folder: {0}',
  'settings.readonly': 'No official settings surface here; edit the recent-tasks row in the profile cordis.patch.yml.',

  'state.notReady': 'Recent tasks is not ready yet',
  'state.dirNotWritable': 'Storage folder is not writable',
  'state.dirNotDirectory': 'That path is not a folder',
  'state.repaired': 'The group was recreated; existing chats stay under Ungrouped',
  'state.disabled': 'The recent-tasks plugin is disabled',
  'state.badConfig': 'The recent-tasks folder is misconfigured (an absolute path is required)',
  'state.missingRecord': 'The recent-tasks group was deleted and auto-repair is off',
  'state.unavailable': 'Recent-tasks service is unreachable',
  'state.ensureFailed': 'Could not prepare the recent-tasks group',
  'state.unknownMethod': 'Unknown recent-tasks API method',
  'state.methodNotAllowed': 'The recent-tasks API accepts POST only',
  'state.payloadTooLarge': 'Request body too large',
  'state.badRequest': 'Malformed request',
  'state.internal': 'Recent-tasks internal error',

  'guide.title': 'Start a chat without a workspace',
  'guide.dismiss': 'Got it',
  retry: 'Retry',
  'err.hostFail': 'Recent-tasks host request failed ({0})',
  'err.startFailed': 'Could not open a recent-tasks chat: {0}',
};