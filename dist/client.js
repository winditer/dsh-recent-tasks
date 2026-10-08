window.__ModuleLoader__.load({
  id: "dsh-recent-tasks",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  default: () => client_default,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);

// src/locales.js
var NS = "recentTasks";
var GROUP_TITLES = Object.freeze({
  zh: "\u6700\u8FD1\u4EFB\u52A1",
  en: "Recent tasks"
});
var AUTO_TITLES = Object.freeze([GROUP_TITLES.zh, GROUP_TITLES.en]);
var zh = {
  name: GROUP_TITLES.zh,
  new: "\u6700\u8FD1\u4EFB\u52A1\u5BF9\u8BDD",
  "new.tooltip": "\u4E0D\u6307\u5B9A\u5DE5\u4F5C\u533A\uFF0C\u4F7F\u7528\u6700\u8FD1\u4EFB\u52A1\u76EE\u5F55",
  "settings.title": "\u6700\u8FD1\u4EFB\u52A1",
  "settings.dir": "\u5B58\u653E\u76EE\u5F55",
  "settings.dir.change": "\u66F4\u6539\u2026",
  "settings.title.field": "\u5206\u7EC4\u540D\u79F0\uFF08\u4EC5\u5F71\u54CD\u65B0\u5206\u7EC4\uFF09",
  "settings.pinLast": "\u59CB\u7EC8\u7F6E\u4E8E\u5DE5\u4F5C\u533A\u5217\u8868\u672B\u5C3E",
  "settings.autoRepair": "\u5206\u7EC4\u88AB\u5220\u9664\u540E\u81EA\u52A8\u91CD\u5EFA",
  "settings.saved": "\u6700\u8FD1\u4EFB\u52A1\u8BBE\u7F6E\u5DF2\u4FDD\u5B58",
  "settings.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{0}",
  "settings.hint": "\u8FD9\u4E9B\u9009\u9879\u5C31\u662F\u672C\u63D2\u4EF6\u7684\u5B98\u65B9\u8BBE\u7F6E\u9879\uFF08\u8BBE\u7F6E \u2192 \u63D2\u4EF6 \u2192 dsh-recent-tasks \u540C\u4E00\u4EFD\u8868\u5355\uFF09\uFF1B\u4FEE\u6539\u4F1A\u5199\u5165\u5F53\u524D profile \u7684 cordis.patch.yml \u5E76\u5373\u65F6\u751F\u6548\u3002",
  "settings.nestedWarning": "\u8BE5\u76EE\u5F55\u4F4D\u4E8E\u5DE5\u4F5C\u533A\u300C{0}\u300D\u4E4B\u4E0B\uFF0C\u5206\u7EC4\u4F1A\u4F5C\u4E3A\u5B50\u7EA7\u5D4C\u5957\u663E\u793A\uFF1B\u5EFA\u8BAE\u6539\u5230\u5DE5\u4F5C\u533A\u4E4B\u5916\u7684\u76EE\u5F55\u3002",
  "settings.alreadyWorkspace": "\u8BE5\u76EE\u5F55\u5DF2\u7ECF\u662F\u5DE5\u4F5C\u533A\u300C{0}\u300D\uFF0C\u5C06\u590D\u7528\u8BE5\u5206\u7EC4\uFF08\u4E0D\u4F1A\u6539\u540D\uFF09\u3002",
  "settings.pickFailed": "\u672A\u80FD\u9009\u62E9\u76EE\u5F55\uFF1A{0}",
  "settings.readonly": "\u5F53\u524D\u90E8\u7F72\u6CA1\u6709\u5B98\u65B9\u8BBE\u7F6E\u9762\u677F\uFF0C\u8BF7\u76F4\u63A5\u7F16\u8F91 profile \u7684 cordis.patch.yml \u4E2D\u7684 recent-tasks \u884C\u3002",
  "state.notReady": "\u6700\u8FD1\u4EFB\u52A1\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5",
  "state.dirNotWritable": "\u5B58\u653E\u76EE\u5F55\u4E0D\u53EF\u5199\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u66F4\u6362",
  "state.dirNotDirectory": "\u8BE5\u8DEF\u5F84\u4E0D\u662F\u6587\u4EF6\u5939",
  "state.repaired": '\u6700\u8FD1\u4EFB\u52A1\u5206\u7EC4\u5DF2\u91CD\u5EFA\uFF1B\u539F\u6709\u5BF9\u8BDD\u4ECD\u5728"\u672A\u5206\u7EC4"\u4E0B',
  "state.disabled": "\u6700\u8FD1\u4EFB\u52A1\u63D2\u4EF6\u5DF2\u7981\u7528",
  "state.badConfig": "\u6700\u8FD1\u4EFB\u52A1\u76EE\u5F55\u914D\u7F6E\u65E0\u6548\uFF08\u9700\u8981\u7EDD\u5BF9\u8DEF\u5F84\uFF09",
  "state.missingRecord": "\u6700\u8FD1\u4EFB\u52A1\u5206\u7EC4\u5DF2\u88AB\u5220\u9664\uFF0C\u81EA\u52A8\u91CD\u5EFA\u5DF2\u5173\u95ED",
  "state.unavailable": "\u65E0\u6CD5\u8FDE\u63A5\u6700\u8FD1\u4EFB\u52A1\u670D\u52A1",
  "state.ensureFailed": "\u65E0\u6CD5\u51C6\u5907\u6700\u8FD1\u4EFB\u52A1\u5206\u7EC4",
  "state.unknownMethod": "\u672A\u77E5\u7684\u6700\u8FD1\u4EFB\u52A1\u63A5\u53E3",
  "state.methodNotAllowed": "\u6700\u8FD1\u4EFB\u52A1\u63A5\u53E3\u53EA\u63A5\u53D7 POST",
  "state.payloadTooLarge": "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927",
  "state.badRequest": "\u8BF7\u6C42\u683C\u5F0F\u65E0\u6548",
  "state.internal": "\u6700\u8FD1\u4EFB\u52A1\u5185\u90E8\u9519\u8BEF",
  "guide.title": "\u4E0D\u6307\u5B9A\u5DE5\u4F5C\u533A\u5373\u53EF\u5F00\u59CB\u5BF9\u8BDD",
  "guide.dismiss": "\u77E5\u9053\u4E86",
  retry: "\u91CD\u8BD5",
  "err.hostFail": "\u6700\u8FD1\u4EFB\u52A1 Host \u8BF7\u6C42\u5931\u8D25 ({0})",
  "err.startFailed": "\u65E0\u6CD5\u6253\u5F00\u6700\u8FD1\u4EFB\u52A1\u5BF9\u8BDD\uFF1A{0}"
};
var en = {
  name: GROUP_TITLES.en,
  new: "New chat (no workspace)",
  "new.tooltip": "Start without a workspace, using the recent-tasks folder",
  "settings.title": "Recent tasks",
  "settings.dir": "Storage folder",
  "settings.dir.change": "Change\u2026",
  "settings.title.field": "Group name (new groups only)",
  "settings.pinLast": "Always keep at the end of the workspace list",
  "settings.autoRepair": "Recreate the group if it is deleted",
  "settings.saved": "Recent-tasks settings saved",
  "settings.saveFailed": "Could not save: {0}",
  "settings.hint": "These are this plugin's official settings (the same form as Settings \u2192 Plugins \u2192 dsh-recent-tasks); changes are written to the active profile's cordis.patch.yml and apply immediately.",
  "settings.nestedWarning": 'This folder sits inside workspace "{0}", so the group will render nested beneath it; prefer a folder outside every workspace.',
  "settings.alreadyWorkspace": 'That folder is already workspace "{0}"; the existing group is reused (never renamed).',
  "settings.pickFailed": "Could not pick a folder: {0}",
  "settings.readonly": "No official settings surface here; edit the recent-tasks row in the profile cordis.patch.yml.",
  "state.notReady": "Recent tasks is not ready yet",
  "state.dirNotWritable": "Storage folder is not writable",
  "state.dirNotDirectory": "That path is not a folder",
  "state.repaired": "The group was recreated; existing chats stay under Ungrouped",
  "state.disabled": "The recent-tasks plugin is disabled",
  "state.badConfig": "The recent-tasks folder is misconfigured (an absolute path is required)",
  "state.missingRecord": "The recent-tasks group was deleted and auto-repair is off",
  "state.unavailable": "Recent-tasks service is unreachable",
  "state.ensureFailed": "Could not prepare the recent-tasks group",
  "state.unknownMethod": "Unknown recent-tasks API method",
  "state.methodNotAllowed": "The recent-tasks API accepts POST only",
  "state.payloadTooLarge": "Request body too large",
  "state.badRequest": "Malformed request",
  "state.internal": "Recent-tasks internal error",
  "guide.title": "Start a chat without a workspace",
  "guide.dismiss": "Got it",
  retry: "Retry",
  "err.hostFail": "Recent-tasks host request failed ({0})",
  "err.startFailed": "Could not open a recent-tasks chat: {0}"
};

// src/protocol.js
var API_PREFIX = "/dsh-recent-tasks/api";
var SETTINGS_NAMESPACE = "recent-tasks";
var METHODS = Object.freeze(["state", "ensure"]);
var READ_ONLY_METHODS = Object.freeze(["state", "ensure"]);
var MAX_BODY_BYTES = 64 * 1024;
var CODES = Object.freeze({
  disabled: "disabled",
  badConfig: "bad-config",
  dirNotDirectory: "dir-not-directory",
  dirNotWritable: "dir-not-writable",
  missingRecord: "missing-record",
  unknownMethod: "unknown-method",
  methodNotAllowed: "method-not-allowed",
  payloadTooLarge: "payload-too-large",
  badRequest: "bad-request",
  unavailable: "unavailable",
  internal: "internal"
});
var CODE_MESSAGE_KEYS = Object.freeze({
  [CODES.disabled]: "state.disabled",
  [CODES.badConfig]: "state.badConfig",
  [CODES.dirNotDirectory]: "state.dirNotDirectory",
  [CODES.dirNotWritable]: "state.dirNotWritable",
  [CODES.missingRecord]: "state.missingRecord",
  [CODES.unknownMethod]: "state.unknownMethod",
  [CODES.methodNotAllowed]: "state.methodNotAllowed",
  [CODES.payloadTooLarge]: "state.payloadTooLarge",
  [CODES.badRequest]: "state.badRequest",
  [CODES.unavailable]: "state.unavailable",
  [CODES.internal]: "state.internal"
});
function messageKeyForCode(code) {
  return CODE_MESSAGE_KEYS[code] ?? CODE_MESSAGE_KEYS[CODES.internal];
}
function validateStateValue(value) {
  if (!value || typeof value !== "object") return null;
  const workspaceId = typeof value.workspaceId === "string" && value.workspaceId ? value.workspaceId : null;
  const path = typeof value.path === "string" && value.path ? value.path : null;
  if (!path) return null;
  const nested = value.nestedUnder && typeof value.nestedUnder === "object" ? { id: String(value.nestedUnder.id ?? ""), title: String(value.nestedUnder.title ?? "") } : null;
  return {
    enabled: value.enabled !== false,
    path,
    title: typeof value.title === "string" && value.title ? value.title : null,
    workspaceId,
    dirExists: value.dirExists === true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    pinLast: value.pinLast !== false,
    autoRepair: value.autoRepair !== false,
    repaired: value.repaired === true,
    reusedExisting: value.reusedExisting === true,
    nestedUnder: nested && nested.id ? nested : null,
    code: typeof value.code === "string" ? value.code : null
  };
}
function readStateResponse(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, code: CODES.internal };
  if (payload.ok !== true) {
    const code = typeof payload.code === "string" && payload.code ? payload.code : CODES.internal;
    return { ok: false, code, message: typeof payload.message === "string" ? payload.message : void 0 };
  }
  const value = validateStateValue(payload.value);
  if (!value) return { ok: false, code: CODES.internal };
  return { ok: true, value };
}
function normalizeDirPath(dir) {
  let raw = String(dir ?? "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  raw = raw.replace(/\/{2,}/g, "/");
  if (raw.length > 1) raw = raw.replace(/\/+$/, "");
  if (/^[A-Za-z]:$/.test(raw)) return raw + "/";
  return raw;
}
function resolveWorkspaceId(workspaces, path) {
  const target = normalizeDirPath(path);
  if (!target) return null;
  const list = workspaces ? Array.from(workspaces) : [];
  for (const record of list) {
    if (!record) continue;
    const candidate = normalizeDirPath(record.path);
    if (!candidate) continue;
    if (candidate === target) {
      const id = record.id ?? record.workspaceId;
      return typeof id === "string" && id ? id : null;
    }
    if (candidate.toLowerCase() === target.toLowerCase()) {
      const id = record.id ?? record.workspaceId;
      return typeof id === "string" && id ? id : null;
    }
  }
  return null;
}
function codeForStatus(status, payload) {
  if (payload && typeof payload.code === "string" && payload.code) return payload.code;
  if (status === 405) return CODES.methodNotAllowed;
  if (status === 413) return CODES.payloadTooLarge;
  if (status === 400) return CODES.badRequest;
  if (status === 0 || status === 502 || status === 503 || status === 504) return CODES.unavailable;
  return CODES.internal;
}

// src/client-core.js
var Phase = Object.freeze({
  init: "init",
  fetching: "fetching",
  ready: "ready",
  unavailable: "unavailable"
});
var GUIDE_KEY = "dsh.recent-tasks.guide.v1";
function createSnapshotStore(initial) {
  let snapshot = Object.freeze({ ...initial });
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(patch) {
      const next = Object.freeze({ ...snapshot, ...patch });
      snapshot = next;
      const current = [...listeners];
      for (const listener of current) {
        try {
          listener();
        } catch (error) {
          console.error("[dsh-recent-tasks] store listener failed:", error);
        }
      }
    }
  };
}
function readGuideSeen(storage) {
  if (!storage) return true;
  try {
    return storage.getItem(GUIDE_KEY) === "1";
  } catch {
    return true;
  }
}
function writeGuideSeen(storage) {
  try {
    storage?.setItem(GUIDE_KEY, "1");
  } catch {
  }
}
function creationBlock(snapshot) {
  if (!snapshot || snapshot.phase !== Phase.ready) {
    return { code: snapshot?.code ?? CODES.unavailable, messageKey: snapshot?.code ? null : "state.notReady" };
  }
  const value = snapshot.value;
  if (!value) return { code: CODES.internal, messageKey: null };
  if (value.enabled === false) return { code: CODES.disabled, messageKey: null };
  if (!value.path) return { code: CODES.badConfig, messageKey: null };
  if (!value.workspaceId && value.code === CODES.missingRecord) {
    return { code: CODES.missingRecord, messageKey: null };
  }
  return null;
}
function workspaceIdOf(row) {
  const id = row?.id ?? row?.workspaceId;
  return id === void 0 || id === null ? "" : String(id);
}
function planCreate(snapshot, workspaces) {
  const block = creationBlock(snapshot);
  if (block) return { kind: "blocked", code: block.code, ...block.messageKey ? { messageKey: block.messageKey } : {} };
  const value = snapshot.value;
  const list = workspaces === void 0 || workspaces === null ? [] : Array.isArray(workspaces) ? workspaces : [...workspaces];
  const live = list.map(workspaceIdOf).filter(Boolean);
  if (value.workspaceId) {
    const id = String(value.workspaceId);
    if (live.length === 0) return { kind: "ready", workspaceId: id };
    if (live.includes(id)) {
      const row = list.find((item) => workspaceIdOf(item) === id);
      const rowPath = typeof row?.path === "string" ? row.path : "";
      if (rowPath && normalizeDirPath(rowPath) !== normalizeDirPath(value.path)) return { kind: "ensure" };
      if (value.dirExists === false) return { kind: "ensure" };
      return { kind: "ready", workspaceId: id };
    }
    return { kind: "ensure" };
  }
  const byPath = resolveWorkspaceId(list, value.path);
  if (byPath) return { kind: "ready", workspaceId: byPath };
  return { kind: "ensure" };
}
function planTitleSync({ workspaceId, storedTitle, localizedTitle, titles = AUTO_TITLES } = {}) {
  if (!workspaceId) return null;
  if (typeof localizedTitle !== "string" || localizedTitle === "") return null;
  if (!titles.includes(storedTitle)) return null;
  if (storedTitle === localizedTitle) return null;
  return { workspaceId: String(workspaceId), title: localizedTitle };
}
function shortcutResolution(snapshot, t) {
  const block = creationBlock(snapshot);
  if (!block) return { status: "handled" };
  const key = block.messageKey ?? messageKeyForCode(block.code);
  return { status: "blocked", reason: typeof t === "function" ? t(key) : key };
}
var SHORTCUT_DEFAULTS = Object.freeze({
  "desktop:macos": { code: "KeyN", modifiers: ["primary", "alt"] },
  "desktop:windows": { code: "KeyN", modifiers: ["primary", "alt"] },
  "desktop:linux": { code: "KeyN", modifiers: ["primary", "alt"] },
  "web:macos": { code: "KeyN", modifiers: ["primary", "shift"] },
  "web:windows": { code: "KeyN", modifiers: ["primary", "shift"] }
});
function createRecentTasksController({ request, logger: logger2 = console }) {
  const store = createSnapshotStore({
    phase: Phase.init,
    value: null,
    code: null,
    message: null,
    busy: false,
    flash: null,
    /** Locale key of the "group was recreated" notice, shown once (§8.3). */
    repairNotice: null
  });
  let stateInflight = null;
  let ensureInflight = null;
  async function call(method, args) {
    try {
      return await request(method, args);
    } catch (error) {
      logger2?.warn?.(`dsh-recent-tasks: ${method} failed: ${String(error?.message ?? error)}`);
      return { ok: false, code: CODES.unavailable, message: String(error?.message ?? error) };
    }
  }
  function accept(result, { silent = false } = {}) {
    const current = store.getSnapshot();
    if (result && result.ok) {
      store.set({
        phase: Phase.ready,
        value: result.value,
        code: null,
        message: null,
        repairNotice: result.value?.repaired === true ? "state.repaired" : current.repairNotice,
        flash: null
      });
      return result.value;
    }
    const code = result && result.code || CODES.internal;
    if (silent && current.value) {
      store.set({ code, message: result?.message ?? null });
      return current.value;
    }
    store.set({
      phase: Phase.unavailable,
      code,
      message: result && result.message || null,
      value: current.value
    });
    return null;
  }
  function refresh({ silent = false } = {}) {
    if (stateInflight) return stateInflight;
    const current = store.getSnapshot();
    if (!silent || !current.value) {
      store.set({ phase: current.value ? current.phase : Phase.fetching });
    }
    stateInflight = (async () => {
      accept(await call("state"), { silent });
      return store.getSnapshot();
    })().finally(() => {
      stateInflight = null;
    });
    return stateInflight;
  }
  function ensure() {
    if (ensureInflight) return ensureInflight;
    ensureInflight = (async () => {
      accept(await call("ensure"));
      return store.getSnapshot();
    })().finally(() => {
      ensureInflight = null;
    });
    return ensureInflight;
  }
  function setFlash(text) {
    store.set({ flash: text });
  }
  function dismissRepairNotice() {
    store.set({ repairNotice: null });
  }
  function setBusy(busy) {
    store.set({ busy });
  }
  return { store, refresh, ensure, setFlash, dismissRepairNotice, setBusy };
}

// src/client.js
var REFRESH_MS = 3e4;
var FLASH_MS = 6e3;
var STYLE_ID = "dsh-recent-tasks";
var logger = { warn: (...args) => console.warn("[dsh-recent-tasks]", ...args) };
async function callHost(method, args, prefix = API_PREFIX) {
  let response;
  try {
    response = await fetch(`${prefix}/${encodeURIComponent(method)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args ?? {})
    });
  } catch (error) {
    return { ok: false, code: CODES.unavailable, message: String(error?.message ?? error) };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, code: codeForStatus(response.status, payload), message: payload?.message };
  }
  return readStateResponse(payload);
}
function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
var CSS = `
.dsh-recent-tasks-btn{position:relative;display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:36px;padding:0 10px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-recent-tasks-btn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-recent-tasks-btn:disabled{opacity:.5;cursor:default}
.dsh-recent-tasks-btn.is-narrow{justify-content:center;width:36px;padding:0}
.dsh-recent-tasks-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;font-size:16px;line-height:1}
.dsh-recent-tasks-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-recent-tasks-dot{position:absolute;top:6px;left:22px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsh-recent-tasks-toast{position:fixed;left:16px;bottom:96px;z-index:40;max-width:320px;padding:8px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 6px 24px rgba(0,0,0,.16);font-size:12px;line-height:18px}
.dsh-recent-tasks-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}
.dsh-recent-tasks-row:last-child{border-bottom:none}
.dsh-recent-tasks-main{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.dsh-recent-tasks-title{color:var(--dsw-alias-label-primary,#1f2329);font-size:14px;line-height:22px}
.dsh-recent-tasks-desc{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsh-recent-tasks-hint{color:var(--dsw-alias-label-tertiary,#8f959e);font-size:12px;line-height:18px}
.dsh-recent-tasks-warn{color:var(--dsw-alias-state-error-primary,#d83931);font-size:12px;line-height:18px}
.dsh-recent-tasks-status{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;line-height:18px;padding-top:8px}
.dsh-recent-tasks-controls{display:flex;align-items:center;gap:8px;flex:none}
.dsh-recent-tasks-input{height:32px;min-width:200px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px}
.dsh-recent-tasks-action{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;cursor:pointer}
.dsh-recent-tasks-action:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-recent-tasks-action:disabled{opacity:.5;cursor:default}
.dsh-recent-tasks-switch{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px;cursor:pointer}
`;
function installStyles(ctx) {
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-recent-tasks";
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
  ctx.effect(() => () => tag.remove(), "dsh-recent-tasks: styles");
}
function useController(controller) {
  return import_react.default.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
}
var NO_FORM = Object.freeze({
  subscribe: () => () => {
  },
  getSnapshot: () => null,
  set: async () => false
});
function useForm(form) {
  const source = form ?? NO_FORM;
  return import_react.default.useSyncExternalStore(source.subscribe, source.getSnapshot);
}
function reasonKey(snapshot) {
  if (snapshot.code) return messageKeyForCode(snapshot.code);
  return "state.notReady";
}
function NewRecentTaskButton({ wide, t, controller, create }) {
  const snapshot = useController(controller);
  const [guideSeen, setGuideSeen] = import_react.default.useState(() => readGuideSeen(safeStorage()));
  import_react.default.useEffect(() => {
    if (!snapshot.repairNotice) return;
    controller.setFlash(t(snapshot.repairNotice));
    controller.dismissRepairNotice();
  }, [snapshot.repairNotice, controller, t]);
  import_react.default.useEffect(() => {
    if (!snapshot.flash) return void 0;
    const timer = window.setTimeout(() => controller.setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot.flash, controller]);
  const ready = snapshot.phase === Phase.ready && snapshot.value && snapshot.value.enabled !== false;
  const disabled = !ready || snapshot.busy === true;
  const tooltip = ready ? t("new.tooltip") : t(reasonKey(snapshot));
  const onClick = () => {
    if (!guideSeen) {
      writeGuideSeen(safeStorage());
      setGuideSeen(true);
    }
    create();
  };
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      type: "button",
      className: wide ? "dsh-recent-tasks-btn" : "dsh-recent-tasks-btn is-narrow",
      title: tooltip,
      "aria-label": t("new"),
      "aria-disabled": disabled ? "true" : void 0,
      disabled,
      onClick
    },
    /* @__PURE__ */ import_react.default.createElement("span", { className: "dsh-recent-tasks-icon", "aria-hidden": "true" }, "\uFF0B"),
    wide ? /* @__PURE__ */ import_react.default.createElement("span", { className: "dsh-recent-tasks-label" }, t("new")) : null,
    guideSeen ? null : /* @__PURE__ */ import_react.default.createElement("span", { className: "dsh-recent-tasks-dot", "aria-hidden": "true" })
  ), snapshot.flash ? /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-toast", role: "status" }, snapshot.flash) : null);
}
function SettingsRow({ title, children, control }) {
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-row" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-main" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-title" }, title), children), /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-controls" }, control));
}
function RecentTasksSettingsRow({ t, controller, pickDirectory, form }) {
  const snapshot = useController(controller);
  const value = snapshot.value;
  const config = useForm(form);
  const ready = snapshot.phase === Phase.ready && value;
  const live = config?.status === "ready" ? config.value ?? {} : null;
  const editable = config?.writable === true && config?.status === "ready";
  const [title, setTitle] = import_react.default.useState("");
  const [pending, setPending] = import_react.default.useState(false);
  const [flash, setFlash] = import_react.default.useState(null);
  import_react.default.useEffect(() => {
    setTitle(live?.title ?? "");
  }, [live?.title]);
  import_react.default.useEffect(() => {
    if (!flash) return void 0;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);
  import_react.default.useEffect(() => {
    if (snapshot.repairNotice) {
      setFlash(t(snapshot.repairNotice));
      controller.dismissRepairNotice();
    }
  }, [snapshot.repairNotice, controller, t]);
  const save = import_react.default.useCallback(async (field, next, successKey) => {
    setPending(true);
    try {
      const accepted = await form.set(field, next);
      setFlash(t(accepted ? successKey ?? "settings.saved" : "settings.saveFailed"));
    } catch (error) {
      setFlash(t("settings.saveFailed", { 0: String(error?.message ?? error) }));
    } finally {
      setPending(false);
    }
  }, [form, t]);
  if (!ready) {
    return /* @__PURE__ */ import_react.default.createElement(
      SettingsRow,
      {
        title: t("settings.title"),
        control: /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "dsh-recent-tasks-action", onClick: () => controller.refresh() }, t("retry"))
      },
      /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-warn", role: "alert" }, t(reasonKey(snapshot)))
    );
  }
  const onChangeDir = async () => {
    try {
      const path = await pickDirectory();
      if (!path) return;
      await save("recentTasksDir", path);
    } catch (error) {
      setFlash(t("settings.pickFailed", { 0: String(error?.message ?? error) }));
    }
  };
  const commitTitle = () => {
    const next = String(title ?? "").trim();
    if (!next || next === (live?.title ?? "")) return;
    save("title", next);
  };
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement(
    SettingsRow,
    {
      title: t("settings.title"),
      control: /* @__PURE__ */ import_react.default.createElement(
        "button",
        {
          type: "button",
          className: "dsh-recent-tasks-action",
          disabled: !editable || pending,
          onClick: onChangeDir
        },
        t("settings.dir.change")
      )
    },
    /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-desc" }, t("settings.dir"), ": ", value.path),
    value.reusedExisting ? /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-desc" }, t("settings.alreadyWorkspace", { 0: value.title ?? "" })) : null,
    value.nestedUnder ? /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-warn", role: "alert" }, t("settings.nestedWarning", { 0: value.nestedUnder.title })) : null,
    /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-hint" }, t("settings.hint"))
  ), /* @__PURE__ */ import_react.default.createElement(
    SettingsRow,
    {
      title: t("settings.title.field"),
      control: /* @__PURE__ */ import_react.default.createElement(
        "input",
        {
          type: "text",
          className: "dsh-recent-tasks-input",
          value: title,
          disabled: !editable || pending,
          onChange: (event) => setTitle(event.target.value),
          onBlur: commitTitle,
          onKeyDown: (event) => {
            if (event.key === "Enter") commitTitle();
          }
        }
      )
    }
  ), /* @__PURE__ */ import_react.default.createElement(
    SettingsRow,
    {
      title: t("settings.pinLast"),
      control: /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-recent-tasks-switch" }, /* @__PURE__ */ import_react.default.createElement(
        "input",
        {
          type: "checkbox",
          role: "switch",
          checked: live?.pinLast !== false,
          disabled: !editable || pending,
          onChange: (event) => save("pinLast", event.target.checked)
        }
      ))
    }
  ), /* @__PURE__ */ import_react.default.createElement(
    SettingsRow,
    {
      title: t("settings.autoRepair"),
      control: /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-recent-tasks-switch" }, /* @__PURE__ */ import_react.default.createElement(
        "input",
        {
          type: "checkbox",
          role: "switch",
          checked: live?.autoRepair !== false,
          disabled: !editable || pending,
          onChange: (event) => save("autoRepair", event.target.checked)
        }
      ))
    }
  ), editable ? null : /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-status" }, t("settings.readonly")), flash ? /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-status", role: "status" }, flash) : null, snapshot.code ? /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-recent-tasks-status", role: "alert" }, t(messageKeyForCode(snapshot.code))) : null);
}
var plugin = {
  inject: ["slots", "locale", "uiWorkspace", "workspaces"],
  apply(ctx) {
    const locale = ctx.locale;
    const t = locale.bind(NS);
    ctx.effect(() => locale.register(NS, { zh, en }), "dsh-recent-tasks: dictionaries");
    installStyles(ctx);
    const controller = createRecentTasksController({
      request: (method, args) => callHost(method, args),
      logger
    });
    let form = null;
    const formFacade = {
      subscribe: (listener) => form ? form.subscribe(listener) : () => {
      },
      getSnapshot: () => form ? form.getSnapshot() : null,
      set: (field, value) => form ? form.set(field, value) : Promise.resolve(false)
    };
    const workspaceList = () => {
      try {
        return ctx.get("workspaces")?.list?.getSnapshot()?.items ?? [];
      } catch (error) {
        logger.warn("cannot read the workspace list:", error);
        return [];
      }
    };
    let workspaceServiceMissing = false;
    const workspaceService = () => {
      try {
        const service = ctx.get("workspaces") ?? null;
        if (!service && !workspaceServiceMissing) {
          workspaceServiceMissing = true;
          logger.warn("no workspace service: the group name cannot follow the UI language");
        }
        return service;
      } catch (error) {
        logger.warn("cannot reach the workspace service:", error);
        return null;
      }
    };
    function liveWorkspaceRow(workspaceId) {
      const id = String(workspaceId);
      return workspaceList().find((row) => String(row?.workspaceId ?? row?.id ?? "") === id) ?? null;
    }
    let titleSyncing = false;
    let titleConflict = null;
    function syncGroupTitle() {
      if (titleSyncing) return;
      const snapshot = controller.store.getSnapshot();
      const value = snapshot.value;
      if (snapshot.phase !== Phase.ready || !value || value.enabled === false) return;
      if (!value.workspaceId) return;
      const workspaces = workspaceService();
      if (typeof workspaces?.rename !== "function") return;
      const plan = planTitleSync({
        workspaceId: value.workspaceId,
        storedTitle: liveWorkspaceRow(value.workspaceId)?.title ?? value.title,
        localizedTitle: t("name")
      });
      if (!plan) return;
      const key = `${plan.workspaceId}\0${plan.title}`;
      if (key === titleConflict) return;
      titleSyncing = true;
      Promise.resolve(workspaces.rename(plan.workspaceId, plan.title)).catch((error) => {
        const message = String(error?.message ?? error);
        if (message.includes("name-conflict")) titleConflict = key;
        logger.warn("could not localize the group name:", error);
      }).finally(() => {
        titleSyncing = false;
      });
    }
    async function create() {
      const snapshot = controller.store.getSnapshot();
      if (snapshot.busy) return;
      controller.setBusy(true);
      try {
        let plan = planCreate(snapshot, workspaceList());
        if (plan.kind === "ensure") {
          await controller.ensure();
          plan = planCreate(controller.store.getSnapshot(), workspaceList());
        }
        if (plan.kind !== "ready") {
          controller.setFlash(t(plan.messageKey ?? messageKeyForCode(plan.code)));
          return;
        }
        ctx.uiWorkspace.startSession(plan.workspaceId);
      } catch (error) {
        logger.warn("could not start a recent task:", error);
        controller.setFlash(t("err.startFailed", { 0: String(error?.message ?? error) }));
      } finally {
        controller.setBusy(false);
      }
    }
    ctx.effect(
      () => controller.store.subscribe(syncGroupTitle),
      "dsh-recent-tasks: group title follows the state snapshot"
    );
    ctx.effect(() => {
      if (typeof locale?.subscribe !== "function") return () => {
      };
      return locale.subscribe(() => {
        titleConflict = null;
        syncGroupTitle();
      });
    }, "dsh-recent-tasks: group title follows the language");
    controller.refresh();
    ctx.effect(() => {
      const timer = window.setInterval(() => controller.refresh({ silent: true }), REFRESH_MS);
      const onFocus = () => controller.refresh({ silent: true });
      window.addEventListener("focus", onFocus);
      return () => {
        window.clearInterval(timer);
        window.removeEventListener("focus", onFocus);
      };
    }, "dsh-recent-tasks: refresh loop");
    ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
      name: "sidebar.footer.action",
      id: "recent-tasks.new",
      order: 60,
      locale: NS,
      inject: () => ({ controller, create })
    }, NewRecentTaskButton));
    ctx.slots.inject("settings.general.item", () => ctx.slots.register({
      name: "settings.general.item",
      id: "recent-tasks",
      order: 30,
      locale: NS,
      inject: () => ({
        controller,
        form: formFacade,
        pickDirectory: () => ctx.uiWorkspace.pickDirectory()
      })
    }, RecentTasksSettingsRow));
    ctx.inject(["configForms"], (scope) => {
      form = scope.configForms.get(SETTINGS_NAMESPACE);
      scope.effect(() => () => {
        form = null;
      }, "dsh-recent-tasks: live config form");
    });
    ctx.inject(["shortcuts"], (scope) => {
      let dispose;
      try {
        dispose = scope.shortcuts.register({
          id: "recentTasks.new",
          label: () => t("new"),
          aliases: ["new recent task", "new chat without workspace"],
          defaults: SHORTCUT_DEFAULTS,
          regions: ["page", "editable"],
          modals: [],
          resolve: () => {
            const resolution = shortcutResolution(controller.store.getSnapshot(), t);
            if (resolution.status !== "handled") return resolution;
            return {
              status: "handled",
              run: () => {
                create();
              }
            };
          }
        });
      } catch (error) {
        logger.warn("shortcut registration rejected; use the sidebar button:", error);
      }
      scope.effect(() => () => dispose?.(), "dsh-recent-tasks: shortcut");
    });
  }
};
var inject = plugin.inject;
var apply = plugin.apply;
var client_default = plugin;

    return module.exports;
  }
});
