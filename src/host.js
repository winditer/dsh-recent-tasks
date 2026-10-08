// dsh-recent-tasks — Host half (`exports["."]` of the package).
//
// The plugin's whole job on this side is: keep ONE real workspace record alive
// for the configured "recent tasks" folder, keep it at the end of the durable
// workspace order, and answer a tiny HTTP API for the client half.
//
// Why a real workspace record (route A of the design): the sidebar's grouping is
// the `workspace` storage domain — `ctx.workspaceRegistry` — and no plugin slot
// can insert a parallel group. Registering the folder as a workspace buys
// collapse/expand, rename, drag ordering, search, archive and pin for free,
// because all of that is the official UI's own behaviour over that record.
//
// Configuration (design §8.6, route A — the official settings surface):
//   `Config` declares the tunables as `.volatile()`, so `dsh-settings` derives a
//   settings form for this plugin AUTOMATICALLY, keyed by this row's loader id
//   (`recent-tasks`), and `dsh-config-editor` persists edits into the active
//   profile's cordis.patch.yml. The loader then hands the new values to the
//   running fiber through the same `Volatile` refs and emits
//   `loader/volatile-update`, so this half reads `.get()` on every call and
//   re-ensures when a value lands. Nothing is ever written by this plugin.
//
// Facts this file depends on (verified against 0.2.0-rc.1):
//   * `workspaceRegistry.create(path, title)` realpaths, REQUIRES an existing
//     directory, is idempotent per canonical path, never rewrites an existing
//     title, and PREPENDS a new record; `resolveByPath`, `get`, `list` are the
//     read side; `insertBefore(id)` with no anchor appends.
//   * `webServer.register({ kind:'prefix', path, handler })` is synchronous,
//     returns a disposer, throws on a duplicate path, and matches the prefix
//     itself plus `prefix + '/'` subpaths.
//   * the record's own `sessionIds` is filtered by realpath(cwd) === path, so a
//     session can never be "moved" between groups (design §6.3, N1).

import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import z from '@deepseek-ai/schemastery';
import {
  API_PREFIX,
  CODES,
  MAX_BODY_BYTES,
  SETTINGS_NAMESPACE,
  expandHome,
  isAbsolutePath,
  isKnownMethod,
  parseApiMethod,
} from './protocol.js';

/** Built-in defaults; the patch row may override any of them. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  recentTasksDir: '~/Documents/DSH 最近任务',
  title: '最近任务',
  pinLast: true,
  autoRepair: true,
  apiPrefix: API_PREFIX,
});

/**
 * Plugin config schema.
 *
 * The fields marked `.volatile()` are exactly the ones the official Settings
 * page will let a user edit live; they are the reason a settings form for this
 * plugin exists at all (`dsh-settings` only derives a section from volatile
 * fields). `enabled` and `apiPrefix` are deliberately NOT volatile: changing
 * either one requires the row to remount, which is what we want for a master
 * switch and for a route path.
 */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULTS.enabled),
  recentTasksDir: z.string().default(DEFAULTS.recentTasksDir).volatile(),
  title: z.string().default(DEFAULTS.title).volatile(),
  pinLast: z.boolean().default(DEFAULTS.pinLast).volatile(),
  autoRepair: z.boolean().default(DEFAULTS.autoRepair).volatile(),
  apiPrefix: z.string().default(DEFAULTS.apiPrefix),
});

/** The settings namespace the official form (and the client half) uses. */
export const NAMESPACE = SETTINGS_NAMESPACE;

/**
 * Read one config field that may be a `Volatile` ref (live, no remount) or a
 * plain value (a unit test, or a field the loader did not wrap).
 */
export function readVolatile(value, fallback = undefined) {
  if (value && typeof value === 'object' && typeof value.get === 'function') {
    const current = value.get();
    return current === undefined ? fallback : current;
  }
  return value === undefined ? fallback : value;
}

/** Resolve `.volatile()` refs into the plain config this plugin works with. */
export function resolveLiveConfig(config, { home = homedir() } = {}) {
  const source = config ?? {};
  return normalizeConfig({
    enabled: readVolatile(source.enabled, DEFAULTS.enabled),
    recentTasksDir: readVolatile(source.recentTasksDir, DEFAULTS.recentTasksDir),
    title: readVolatile(source.title, DEFAULTS.title),
    pinLast: readVolatile(source.pinLast, DEFAULTS.pinLast),
    autoRepair: readVolatile(source.autoRepair, DEFAULTS.autoRepair),
    apiPrefix: readVolatile(source.apiPrefix, DEFAULTS.apiPrefix),
  }, { home });
}

/**
 * Validate and normalize a raw config object.
 *
 * Returns `{ config, problem }` where `problem` is a protocol error code (`''`
 * when the configuration is usable). A relative or empty directory is
 * `bad-config` — never silently resolved against the process cwd.
 */
export function normalizeConfig(raw, { home = homedir() } = {}) {
  const merged = { ...DEFAULTS, ...(raw ?? {}) };
  const dir = expandHome(merged.recentTasksDir, home);
  const config = {
    enabled: merged.enabled !== false,
    recentTasksDir: dir,
    title: typeof merged.title === 'string' && merged.title.trim() ? merged.title : DEFAULTS.title,
    pinLast: merged.pinLast !== false,
    autoRepair: merged.autoRepair !== false,
    apiPrefix: typeof merged.apiPrefix === 'string' && merged.apiPrefix.startsWith('/')
      ? merged.apiPrefix
      : API_PREFIX,
  };
  let problem = '';
  if (!config.recentTasksDir) problem = CODES.badConfig;
  else if (!isAbsolutePath(config.recentTasksDir)) problem = CODES.badConfig;
  return { config, problem };
}

/** Error codes the filesystem can raise for a directory the plugin manages. */
export function codeForFsError(error, fallback = CODES.dirNotWritable) {
  const code = error && error.code;
  if (code === 'ENOTDIR' || code === 'EEXIST') return CODES.dirNotDirectory;
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOSPC') {
    return CODES.dirNotWritable;
  }
  return fallback ?? CODES.internal;
}

/** Whether `child` sits strictly below `parent`. */
export function isUnder(child, parent) {
  if (!child || !parent || child === parent) return false;
  const base = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(base);
}

/**
 * The ensure/state machinery, with every external dependency injected so the
 * unit tests can drive it without a live DSH host.
 *
 * @param options.registry - `ctx.workspaceRegistry` (or a test double).
 * @param options.fs - `{ mkdir, realpath, stat }` overrides.
 * @param options.logger - `{ warn }` sink for non-fatal problems.
 * @param options.config - a normalized config, or a function returning the
 *   CURRENT one (the live form, so volatile edits are picked up per call).
 */
export function createRecentTasks({ registry, fs = {}, logger, config, random }) {
  const mkdirFn = fs.mkdir ?? mkdir;
  const realpathFn = fs.realpath ?? realpath;
  const statFn = fs.stat ?? stat;
  const readConfig = typeof config === 'function' ? config : () => config;
  /** Last successfully ensured record: `{ id, path, configured, createdAt, reusedExisting }`. */
  let cache = null;
  /** Set for exactly one returned snapshot after an auto-repair. */
  let repaired = false;

  const fail = (code, message) => ({ ok: false, code, message });

  /**
   * Drop the cached record when the configured directory moved (a live settings
   * edit): otherwise `state()` would report the OLD group for the new path and
   * the client would open a chat in the wrong workspace.
   */
  function syncConfig(current) {
    if (cache && cache.configured !== current.recentTasksDir) {
      cache = null;
      repaired = false;
    }
  }

  async function dirExists(path) {
    if (!path) return false;
    try {
      return (await statFn(path)).isDirectory();
    } catch {
      return false;
    }
  }

  function lookupCached() {
    if (!cache) return null;
    try {
      return registry.get(cache.id) ?? null;
    } catch {
      return null;
    }
  }

  function safeList() {
    try {
      return registry.list ? registry.list() : [];
    } catch (error) {
      logger?.warn?.(`dsh-recent-tasks: cannot inspect the workspace order: ${String(error)}`);
      return [];
    }
  }

  /** Whether another registered workspace owns an ancestor of `path` (§8.8). */
  function nestedUnder(path) {
    for (const record of safeList()) {
      if (!record || record.path === path) continue;
      if (isUnder(path, record.path)) return { id: record.id, title: record.title ?? '' };
    }
    return null;
  }

  async function snapshot(current, { code = null } = {}) {
    // Once a record exists, report the CANONICAL folder the registry owns (it is
    // what the live workspace list shows, and what the client compares against);
    // before that, the configured spelling.
    const path = cache?.path ?? current.recentTasksDir;
    const record = cache ? lookupCached() : null;
    // One-shot announcement (§8.3): the repair is reported by exactly one
    // snapshot, so the client's toast cannot repeat on the next poll.
    const announcedRepair = repaired;
    repaired = false;
    return {
      ok: true,
      value: {
        enabled: current.enabled,
        path,
        title: record?.title ?? current.title,
        workspaceId: record?.id ?? null,
        dirExists: await dirExists(path),
        createdAt: cache?.createdAt ?? record?.createdAt ?? null,
        pinLast: current.pinLast,
        autoRepair: current.autoRepair,
        repaired: announcedRepair,
        reusedExisting: cache?.reusedExisting === true,
        nestedUnder: nestedUnder(cache?.path ?? path),
        code,
      },
    };
  }

  /**
   * Idempotent ensure (spec §8.1): mkdir -> realpath -> resolve/create ->
   * pin last. Never throws; every failure is a coded result the client can show.
   */
  async function ensure() {
    repaired = false;
    const current = readConfig();
    syncConfig(current);
    if (!current.enabled) return fail(CODES.disabled);
    if (!current.recentTasksDir || !isAbsolutePath(current.recentTasksDir)) {
      logger?.warn?.(`dsh-recent-tasks: recentTasksDir is not an absolute path: ${JSON.stringify(current.recentTasksDir)}`);
      return fail(CODES.badConfig);
    }
    // A record that was deleted in the sidebar is rebuilt only when autoRepair
    // is on; otherwise the client must be told, never silently ignored (§9).
    if (cache && !lookupCached() && !current.autoRepair) return fail(CODES.missingRecord);

    const configured = current.recentTasksDir;
    // `create` never creates the directory, so step 3/4 must come first.
    try {
      await mkdirFn(configured, { recursive: true });
    } catch (error) {
      logger?.warn?.(`dsh-recent-tasks: cannot create '${configured}': ${String(error)}`);
      return fail(codeForFsError(error));
    }

    let canonical;
    try {
      canonical = await realpathFn(configured);
    } catch (error) {
      logger?.warn?.(`dsh-recent-tasks: cannot resolve '${configured}': ${String(error)}`);
      return fail(codeForFsError(error));
    }
    if (!(await dirExists(canonical))) return fail(CODES.dirNotDirectory);

    const previousId = cache?.id ?? null;
    let record;
    let reusedExisting = false;
    try {
      record = await registry.resolveByPath(canonical);
      if (record) {
        reusedExisting = true;
      } else {
        record = await registry.create(canonical, current.title);
      }
    } catch (error) {
      logger?.warn?.(`dsh-recent-tasks: cannot register '${canonical}': ${String(error)}`);
      return fail(codeForFsError(error, CODES.internal), String(error?.message ?? error));
    }
    if (!record || !record.id) return fail(CODES.internal, 'workspace registry returned no record');

    if (current.pinLast) {
      try {
        await registry.insertBefore(record.id);
      } catch (error) {
        // A failed reorder must not fail the whole ensure: the group exists.
        logger?.warn?.(`dsh-recent-tasks: cannot move the group to the end: ${String(error)}`);
      }
    }

    // An id that changed (delete + recreate) means the old sessions stayed
    // behind under "未分组" — surface that exactly once.
    repaired = previousId !== null && previousId !== record.id;
    cache = {
      id: record.id,
      path: canonical,
      configured,
      createdAt: record.createdAt ?? null,
      reusedExisting,
    };
    return snapshot(current);
  }

  /**
   * Read-only snapshot: never mkdir, never create, never reorder (§8.1, test 7).
   * A vanished record is reported as `workspaceId: null` plus `missing-record`,
   * which is exactly the client's cue to call `ensure`.
   */
  async function state() {
    const current = readConfig();
    syncConfig(current);
    if (!current.enabled) return snapshot(current, { code: CODES.disabled });
    if (!current.recentTasksDir || !isAbsolutePath(current.recentTasksDir)) {
      return fail(CODES.badConfig);
    }
    const cached = lookupCached();
    return snapshot(current, { code: cached ? null : (cache ? CODES.missingRecord : null) });
  }

  return {
    ensure,
    state,
    currentConfig: () => ({ ...readConfig() }),
    getCachedId: () => cache?.id ?? null,
  };
}

/** Minimal JSON body reader with a hard size cap. */
export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) {
      const error = new Error('payload too large');
      error.status = 413;
      error.code = CODES.payloadTooLarge;
      throw error;
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('malformed JSON');
    error.status = 400;
    error.code = CODES.badRequest;
    throw error;
  }
}

/** Write a JSON response with no caching. */
export function writeJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

/**
 * Build the `webServer` prefix handler.
 *
 * Contract (§8.1): POST only, body-capped, method whitelist, and no ability to
 * delete or reconfigure anything. Both methods are idempotent reads; the write
 * path is the official settings surface, not this API.
 */
export function createApiHandler({ service, logger, apiPrefix = API_PREFIX }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, code: CODES.methodNotAllowed, message: 'POST only' });
      return;
    }
    // Cross-site hardening. This route has no browser session of its own (the
    // official `/api` routes authenticate), so a plain-text POST from any page
    // the user visits could otherwise reach it as a "simple request" with no
    // preflight. Requiring JSON forces a preflight, which fails because this
    // route sends no CORS headers — while a same-origin fetch is unaffected.
    const contentType = String(req.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      writeJson(res, 400, { ok: false, code: CODES.badRequest, message: 'content-type must be application/json' });
      return;
    }
    try {
      await readJsonBody(req);
    } catch (error) {
      writeJson(res, error.status ?? 400, { ok: false, code: error.code ?? CODES.badRequest, message: String(error.message) });
      return;
    }
    const method = parseApiMethod(new URL(req.url || '/', 'http://dsh.internal').pathname, apiPrefix);
    if (!method || !isKnownMethod(method)) {
      writeJson(res, 404, { ok: false, code: CODES.unknownMethod, message: `unknown method '${method}'` });
      return;
    }
    try {
      const result = method === 'state' ? await service.state() : await service.ensure();
      writeJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      logger?.warn?.(`dsh-recent-tasks: API '${method}' failed: ${String(error)}`);
      writeJson(res, 500, { ok: false, code: CODES.internal, message: String(error?.message ?? error) });
    }
  };
}

/**
 * Cordis plugin entry (host half). `config` is the loader-validated row config;
 * its volatile fields are live refs, so every read goes through `.get()`.
 */
export function apply(ctx, config) {
  const logger = ctx.logger ?? {};
  const readConfig = () => resolveLiveConfig(config, { home: homedir() });
  const apiPrefix = readConfig().config.apiPrefix;
  let service = null;

  const settle = (label, result) => {
    if (result && result.ok) return;
    logger.warn?.(`dsh-recent-tasks: ${label} failed (${result?.code ?? 'unknown'})`);
  };

  ctx.inject(['workspaceRegistry'], (scope) => {
    service = createRecentTasks({
      registry: scope.workspaceRegistry,
      logger,
      config: () => readConfig().config,
    });
    scope.effect(() => () => {
      service = null;
    }, 'dsh-recent-tasks: managed workspace');

    // Best-effort first ensure so the group exists without waiting for a client.
    service.ensure().then((result) => settle('initial ensure', result), (error) => {
      logger.warn?.(`dsh-recent-tasks: initial ensure crashed: ${String(error)}`);
    });
  });

  // A live settings edit (volatile-only change, no remount) lands here: follow
  // the new directory immediately instead of waiting for the client's poll.
  // Registered on the plugin's own fiber — the loader's event filter only
  // delivers to listeners owned by this entry's fiber.
  ctx.on('loader/volatile-update', () => {
    if (!service) return;
    service.ensure().then((result) => settle('ensure after a settings change', result), (error) => {
      logger.warn?.(`dsh-recent-tasks: ensure after a settings change crashed: ${String(error)}`);
    });
  });

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: apiPrefix,
      handler: (req, res) => {
        if (!service) {
          // Honest failure instead of a hung request (§9): the client shows the
          // reason and retries on focus / the next 30s tick.
          writeJson(res, 503, { ok: false, code: CODES.internal, message: 'workspace registry unavailable' });
          return;
        }
        createApiHandler({ service, logger, apiPrefix })(req, res).catch((error) => {
          logger.warn?.(`dsh-recent-tasks: API dispatch failed: ${String(error)}`);
          writeJson(res, 500, { ok: false, code: CODES.internal, message: String(error?.message ?? error) });
        });
      },
    }), 'dsh-recent-tasks: state API route');
  });
}

export const name = 'dsh-recent-tasks';
export const inject = ['workspaceRegistry'];