// dsh-recent-tasks — shared protocol between the host half (src/host.js) and the
// client half (src/client.js).
//
// Nothing in here touches node:fs, React or the DOM, so both halves AND the unit
// tests import this one module: the API path/method whitelist, the error-code
// vocabulary, and the pure helpers that answer "where does this chat go?".

/**
 * Route prefix registered by the host half.
 *
 * The loader row id in cordis.patch.yml (`recent-tasks`) is ALSO the official
 * settings namespace: `dsh-settings` derives a form from this plugin's volatile
 * `Config` fields keyed by that row id, and the client reaches the same form with
 * `ctx.configForms.get(SETTINGS_NAMESPACE)`. The two must stay in sync.
 */

export const API_PREFIX = '/dsh-recent-tasks/api';

/** Loader row id == official settings namespace for this plugin. */
export const SETTINGS_NAMESPACE = 'recent-tasks';

/**
 * Methods the host half serves. Both are idempotent: `state` never writes, and
 * `ensure` only repairs the managed record it owns.
 */
export const METHODS = Object.freeze(['state', 'ensure']);

/** Methods that may never touch the registry or the config file. */
export const READ_ONLY_METHODS = Object.freeze(['state', 'ensure']);

/** Hard cap on a request body (spec §8.1). */
export const MAX_BODY_BYTES = 64 * 1024;

/** Error vocabulary shared by the host API and the client UI. */
export const CODES = Object.freeze({
  disabled: 'disabled',
  badConfig: 'bad-config',
  dirNotDirectory: 'dir-not-directory',
  dirNotWritable: 'dir-not-writable',
  missingRecord: 'missing-record',
  unknownMethod: 'unknown-method',
  methodNotAllowed: 'method-not-allowed',
  payloadTooLarge: 'payload-too-large',
  badRequest: 'bad-request',
  unavailable: 'unavailable',
  internal: 'internal',
});

/**
 * Every failure the client can show has a human string in the plugin's own
 * locale namespace — the host never ships display text (spec §8.1 "绝不静默失败"
 * plus the single-source-of-truth rule for user-visible copy).
 */
export const CODE_MESSAGE_KEYS = Object.freeze({
  [CODES.disabled]: 'state.disabled',
  [CODES.badConfig]: 'state.badConfig',
  [CODES.dirNotDirectory]: 'state.dirNotDirectory',
  [CODES.dirNotWritable]: 'state.dirNotWritable',
  [CODES.missingRecord]: 'state.missingRecord',
  [CODES.unknownMethod]: 'state.unknownMethod',
  [CODES.methodNotAllowed]: 'state.methodNotAllowed',
  [CODES.payloadTooLarge]: 'state.payloadTooLarge',
  [CODES.badRequest]: 'state.badRequest',
  [CODES.unavailable]: 'state.unavailable',
  [CODES.internal]: 'state.internal',
});

/** Locale key for one error code, falling back to the generic internal error. */
export function messageKeyForCode(code) {
  return CODE_MESSAGE_KEYS[code] ?? CODE_MESSAGE_KEYS[CODES.internal];
}

/**
 * Extract the trailing method segment of a request URL.
 *
 * `parseApiMethod('/dsh-recent-tasks/api/state')` -> `'state'`.
 * Anything that is not exactly `<prefix>/<one-segment>` -> `''` (caller answers
 * unknown-method / not-found). Nested paths and query strings are rejected.
 */
export function parseApiMethod(pathname, prefix = API_PREFIX) {
  const raw = String(pathname ?? '');
  if (!raw.startsWith(prefix + '/')) return '';
  let rest = raw.slice(prefix.length + 1);
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  if (!rest || rest.includes('/')) return '';
  try {
    return decodeURIComponent(rest);
  } catch {
    return '';
  }
}

/** Whether `method` is one the host half serves. */
export function isKnownMethod(method) {
  return METHODS.includes(method);
}

/**
 * Validate a `state` snapshot emitted by the host.
 *
 * Returns a normalized copy, or `null` when the payload cannot describe a
 * workspace (the client then treats the host as unavailable rather than showing
 * a half-broken row).
 */
export function validateStateValue(value) {
  if (!value || typeof value !== 'object') return null;
  const workspaceId = typeof value.workspaceId === 'string' && value.workspaceId ? value.workspaceId : null;
  const path = typeof value.path === 'string' && value.path ? value.path : null;
  if (!path) return null;
  const nested = value.nestedUnder && typeof value.nestedUnder === 'object'
    ? { id: String(value.nestedUnder.id ?? ''), title: String(value.nestedUnder.title ?? '') }
    : null;
  return {
    enabled: value.enabled !== false,
    path,
    title: typeof value.title === 'string' && value.title ? value.title : null,
    workspaceId,
    dirExists: value.dirExists === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
    pinLast: value.pinLast !== false,
    autoRepair: value.autoRepair !== false,
    repaired: value.repaired === true,
    reusedExisting: value.reusedExisting === true,
    nestedUnder: nested && nested.id ? nested : null,
    code: typeof value.code === 'string' ? value.code : null,
  };
}

/**
 * Normalize a host response body into `{ ok: true, value }` / `{ ok:false, code }`.
 *
 * The host answers `{ ok:true, value }` on success and `{ ok:false, code, message }`
 * on failure; an unexpected body (or a non-JSON page) becomes `internal` so the
 * caller never has to distinguish "no answer" from "bad answer".
 */
export function readStateResponse(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, code: CODES.internal };
  if (payload.ok !== true) {
    const code = typeof payload.code === 'string' && payload.code ? payload.code : CODES.internal;
    return { ok: false, code, message: typeof payload.message === 'string' ? payload.message : undefined };
  }
  const value = validateStateValue(payload.value);
  if (!value) return { ok: false, code: CODES.internal };
  return { ok: true, value };
}

/** Expand a leading `~` / `~/` against `home`. Pure; never touches the disk. */
export function expandHome(dir, home) {
  const raw = String(dir ?? '').trim();
  if (!raw) return '';
  if (raw === '~') return home ? String(home) : '';
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return home ? String(home) + raw.slice(1) : '';
  return raw;
}

/**
 * Whether a path is absolute in the POSIX or Windows sense. The host half
 * refuses relative configuration (spec §9 `bad-config`) instead of silently
 * resolving it against the process cwd.
 */
export function isAbsolutePath(dir) {
  const raw = String(dir ?? '');
  if (!raw) return false;
  if (raw.startsWith('/')) return true;
  if (raw.startsWith('\\\\')) return true; // UNC
  return /^[A-Za-z]:[\\/]/.test(raw);
}

/**
 * Comparison spelling of a client-visible directory path.
 *
 * The browser cannot `realpath`, so path -> workspace matching is a best-effort
 * string comparison: unify separators, drop trailing separators (but keep the
 * root) and collapse duplicates. The host's `workspaceId` is always the
 * authority; this helper only backstops a stale snapshot (spec §9 "host 进程
 * 重启后 workspaceId 变化").
 */
export function normalizeDirPath(dir) {
  let raw = String(dir ?? '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  raw = raw.replace(/\/{2,}/g, '/');
  if (raw.length > 1) raw = raw.replace(/\/+$/, '');
  if (/^[A-Za-z]:$/.test(raw)) return raw + '/';
  return raw;
}

/**
 * Resolve the managed workspace id for `path` from a client-side workspace list.
 *
 * `workspaces` is any iterable of `{ id, path }` (the official workspace
 * snapshot). Returns the matching id or `null`. Case is significant except on
 * the drive letter, which is lower-cased so `C:/x` matches `c:/x`.
 */
export function resolveWorkspaceId(workspaces, path) {
  const target = normalizeDirPath(path);
  if (!target) return null;
  const list = workspaces ? Array.from(workspaces) : [];
  for (const record of list) {
    if (!record) continue;
    const candidate = normalizeDirPath(record.path);
    if (!candidate) continue;
    if (candidate === target) {
      const id = record.id ?? record.workspaceId;
      return typeof id === 'string' && id ? id : null;
    }
    if (candidate.toLowerCase() === target.toLowerCase()) {
      const id = record.id ?? record.workspaceId;
      return typeof id === 'string' && id ? id : null;
    }
  }
  return null;
}

/** Map an HTTP status plus parsed body onto the shared error vocabulary. */
export function codeForStatus(status, payload) {
  if (payload && typeof payload.code === 'string' && payload.code) return payload.code;
  if (status === 405) return CODES.methodNotAllowed;
  if (status === 413) return CODES.payloadTooLarge;
  if (status === 400) return CODES.badRequest;
  // 502/503/504 are the host's own "not up yet" answers (our route answers 503
  // while the workspace registry is missing); 0 means no HTTP answer at all.
  if (status === 0 || status === 502 || status === 503 || status === 504) return CODES.unavailable;
  return CODES.internal;
}