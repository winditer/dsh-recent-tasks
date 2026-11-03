// Host half: config merge/validation (defaults, tilde expansion, volatile live
// refs), ensure/state against a fake workspaceRegistry, and the HTTP handler
// contract. The write path for settings is the OFFICIAL config editor, so there
// is nothing to test here about persisting: this half only reads.
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  Config,
  DEFAULTS,
  NAMESPACE,
  codeForFsError,
  createApiHandler,
  createRecentTasks,
  isUnder,
  normalizeConfig,
  readJsonBody,
  readVolatile,
  resolveLiveConfig,
} from '../src/host.js';
import { API_PREFIX, CODES } from '../src/protocol.js';

const HOME = '/home/tester';

/** A stand-in for `ctx.workspaceRegistry` with the same observable contract. */
function fakeRegistry({ failCreate = null, failMkdir = null, failReorder = null, dirIsDirectory = true } = {}) {
  const records = new Map();
  const order = [];
  const calls = { create: 0, resolveByPath: 0, insertBefore: 0, mkdir: 0 };
  /** Directories this fake filesystem has already created. */
  const madeDirs = new Set();
  let seq = 0;
  return {
    calls,
    records,
    order,
    madeDirs,
    /** A workspace the user registered before this plugin existed. */
    seed(path, title = path) {
      const id = `seed${++seq}`;
      records.set(id, { id, path, title, sessionIds: [], createdAt: '2025-12-01T00:00:00.000Z' });
      order.unshift(id); // the real registry PREPENDS every create
      return id;
    },
    deleteRecord(id) {
      records.delete(id);
      const at = order.indexOf(id);
      if (at >= 0) order.splice(at, 1);
    },
    get: (id) => records.get(id),
    list: () => order.map((id) => records.get(id)).filter(Boolean),
    async create(path, title) {
      calls.create += 1;
      if (failCreate) throw failCreate;
      const existing = [...records.values()].find((record) => record.path === path);
      if (existing) return existing;
      const id = `w${++seq}`;
      const record = { id, path, title, sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z' };
      records.set(id, record);
      order.unshift(id); // the real registry PREPENDS
      return record;
    },
    async resolveByPath(path) {
      calls.resolveByPath += 1;
      if (failMkdir) throw failMkdir;
      return [...records.values()].find((record) => record.path === path);
    },
    async insertBefore(id, beforeId) {
      calls.insertBefore += 1;
      if (failReorder) throw failReorder;
      const at = order.indexOf(id);
      if (at >= 0) order.splice(at, 1);
      if (beforeId === undefined) order.push(id);
      else order.splice(order.indexOf(beforeId), 0, id);
      return [...order];
    },
    markNeedsMkdir() {
      return { mkdir: async () => { calls.mkdir += 1; if (failMkdir) throw failMkdir; } };
    },
    get dirIsDirectory() {
      return dirIsDirectory;
    },
  };
}

function fakeFs(registry) {
  return {
    // `recursive: false` is how `allocate` claims a task directory exclusively,
    // and a second claim of the same name is EEXIST — exactly like the real fs.
    mkdir: async (path, options) => {
      registry.calls.mkdir += 1;
      if (registry.failMkdir) throw registry.failMkdir;
      if (options && options.recursive === false) {
        if (registry.madeDirs.has(path)) {
          const error = new Error(`EEXIST: ${path}`);
          error.code = 'EEXIST';
          throw error;
        }
        registry.madeDirs.add(path);
      }
    },
    realpath: async (path) => path,
    stat: async () => ({ isDirectory: () => registry.dirIsDirectory }),
  };
}

function makeService({ config = {}, registry, fs, live = false, random } = {}) {
  const reg = registry ?? fakeRegistry();
  const read = () => resolveLiveConfig(config, { home: HOME }).config;
  return {
    registry: reg,
    service: createRecentTasks({
      registry: reg,
      fs: fs ?? fakeFs(reg),
      logger: { warn() {} },
      // `live: true` mimics the loader's volatile wiring: a function read per call.
      config: live ? read : read(),
      random,
    }),
  };
}

// --------------------------------------------------------------------------
// configuration
// --------------------------------------------------------------------------

test('normalizeConfig applies defaults and expands a leading tilde', () => {
  const { config, problem } = normalizeConfig(undefined, { home: HOME });
  assert.equal(problem, '');
  assert.equal(config.enabled, true);
  assert.equal(config.autoRepair, true);
  assert.equal(config.title, DEFAULTS.title);
  assert.equal(config.recentTasksDir, DEFAULTS.recentTasksDir.replace('~', HOME));

  const custom = normalizeConfig({ recentTasksDir: '~/Recents', title: '   ' }, { home: HOME });
  assert.equal(custom.problem, '');
  assert.equal(custom.config.recentTasksDir, `${HOME}/Recents`);
  assert.equal(custom.config.title, DEFAULTS.title, 'blank title falls back');
});

test('normalizeConfig refuses a relative or empty directory (never resolves cwd)', () => {
  assert.equal(normalizeConfig({ recentTasksDir: 'relative/dir' }, { home: HOME }).problem, CODES.badConfig);
  assert.equal(normalizeConfig({ recentTasksDir: '' }, { home: HOME }).problem, CODES.badConfig);
  assert.equal(normalizeConfig({ recentTasksDir: '~/', }, { home: HOME }).problem, '');
  assert.equal(normalizeConfig({ recentTasksDir: '~' }, { home: HOME }).problem, '');
});

test('codeForFsError maps filesystem failures onto the shared vocabulary', () => {
  assert.equal(codeForFsError({ code: 'ENOTDIR' }), CODES.dirNotDirectory);
  assert.equal(codeForFsError({ code: 'EEXIST' }), CODES.dirNotDirectory);
  assert.equal(codeForFsError({ code: 'EACCES' }), CODES.dirNotWritable);
  assert.equal(codeForFsError({ code: 'ENOENT' }), CODES.dirNotWritable);
  assert.equal(codeForFsError({ code: 'EROFS' }), CODES.dirNotWritable);
  assert.equal(codeForFsError({ code: 'EWEIRD' }), CODES.dirNotWritable);
  assert.equal(codeForFsError({}, CODES.internal), CODES.internal);
});

test('isUnder is strict and separator aware', () => {
  assert.equal(isUnder('/a/b/c', '/a/b'), true);
  assert.equal(isUnder('/a/b', '/a/b'), false);
  assert.equal(isUnder('/a/bc', '/a/b'), false);
  assert.equal(isUnder('/a/b', ''), false);
});

// --------------------------------------------------------------------------
// ensure / state
// --------------------------------------------------------------------------

test('ensure creates the directory, registers the record, and appends it once', async () => {
  const { service, registry } = makeService({ config: { recentTasksDir: '~/Recents' } });
  const result = await service.ensure();
  assert.equal(result.ok, true);
  assert.equal(result.value.path, `${HOME}/Recents`);
  assert.equal(result.value.workspaceId, 'w1');
  assert.equal(result.value.title, DEFAULTS.title);
  assert.equal(result.value.repaired, false);
  assert.equal(result.value.reusedExisting, false);
  assert.equal(result.value.dirExists, true);
  assert.equal(registry.calls.mkdir, 1);
  assert.equal(registry.calls.create, 1);
  // `create()` PREPENDS, so the plugin asks for the end exactly once — on the
  // creation — and never again. There is no "always last" switch any more: a
  // record that already exists keeps the place it was dragged to.
  assert.equal(registry.calls.insertBefore, 1, 'a newly created record is moved to the end once');
  assert.deepEqual(registry.order, ['w1']);
  assert.equal('pinLast' in result.value, false, 'the state payload has no pinLast');

  const again = await service.ensure();
  assert.equal(again.value.workspaceId, 'w1', 'ensure is idempotent');
  assert.equal(again.value.reusedExisting, true);
  assert.equal(registry.calls.create, 1, 'no duplicate record');
  assert.equal(registry.calls.insertBefore, 1, 'a record that already exists is never re-ordered');
});

test('a fresh install lands below the workspaces the user already had', async () => {
  // The reported bug: `create()` prepends, so an unguarded registration put the
  // 最近任务 block above every existing workspace, newest-first order included.
  const registry = fakeRegistry();
  const older = registry.seed('/Users/me/Documents/alpha', 'alpha');
  const newer = registry.seed('/Users/me/Documents/beta', 'beta');
  assert.deepEqual(registry.order, [newer, older], 'the fake mirrors the real newest-first order');

  const { service } = makeService({ registry, config: { recentTasksDir: '~/Recents' } });
  const result = await service.ensure();
  assert.equal(result.ok, true);

  assert.deepEqual(registry.order, [newer, older, result.value.workspaceId], 'the new block goes last');
  assert.equal(registry.order.at(-1), result.value.workspaceId);
});

test('a record the user dragged elsewhere is left where it was dropped', async () => {
  const registry = fakeRegistry();
  const first = registry.seed('/Users/me/one');
  const { service } = makeService({ registry, config: { recentTasksDir: '~/Recents' } });
  const created = await service.ensure();
  assert.deepEqual(registry.order, [first, created.value.workspaceId]);

  // The user drags the 最近任务 group above the other workspace, then runs a
  // chat (which re-ensures): the plugin must not yank it back.
  await registry.insertBefore(created.value.workspaceId, first);
  registry.calls.insertBefore = 0;
  assert.deepEqual(registry.order, [created.value.workspaceId, first]);

  await service.ensure();
  assert.equal(registry.calls.insertBefore, 0, 'no reorder for an existing record');
  assert.deepEqual(registry.order, [created.value.workspaceId, first], 'the drag survives');
});

test('a failed reorder keeps the group instead of failing the ensure', async () => {
  const registry = fakeRegistry({ failReorder: new Error('registry busy') });
  const { service } = makeService({ registry, config: { recentTasksDir: '~/Recents' } });
  const result = await service.ensure();
  assert.equal(result.ok, true, 'a cosmetic reorder never fails the ensure');
  assert.equal(result.value.workspaceId, 'w1');
  assert.equal(registry.calls.insertBefore, 1);
});

test('a repaired record is appended again after the user deleted it', async () => {
  const registry = fakeRegistry();
  const other = registry.seed('/Users/me/other');
  const { service } = makeService({ registry, config: { recentTasksDir: '~/Recents' } });
  const first = await service.ensure();
  assert.deepEqual(registry.order, [other, first.value.workspaceId]);

  registry.deleteRecord(first.value.workspaceId);
  const rebuilt = await service.ensure();
  assert.equal(rebuilt.value.repaired, true);
  assert.deepEqual(registry.order, [other, rebuilt.value.workspaceId], 'the rebuilt group is last again');
});

test('ensure reports coded failures instead of throwing', async () => {
  const mkdirFail = makeService({ registry: fakeRegistry({ failMkdir: Object.assign(new Error('nope'), { code: 'EACCES' }) }) });
  assert.equal((await mkdirFail.service.ensure()).code, CODES.dirNotWritable);

  const notDir = makeService({ registry: fakeRegistry({ dirIsDirectory: false }) });
  assert.equal((await notDir.service.ensure()).code, CODES.dirNotDirectory);

  const createFail = makeService({ registry: fakeRegistry({ failCreate: Object.assign(new Error('boom'), { code: 'ENOTDIR' }) }) });
  assert.equal((await createFail.service.ensure()).code, CODES.dirNotDirectory);

  const disabled = makeService({ config: { enabled: false } });
  assert.equal((await disabled.service.ensure()).code, CODES.disabled);

  // A relative directory is refused instead of being resolved against the cwd.
  const badConfig = makeService({ live: true, config: { recentTasksDir: 'relative/dir' } });
  assert.equal((await badConfig.service.ensure()).code, CODES.badConfig);
});

test('state never writes, and reports a vanished record as missing-record', async () => {
  const { service, registry } = makeService();
  // Before the first ensure there is no cached record: no code, no id -- the
  // client's cue to call ensure.
  const initial = await service.state();
  assert.equal(initial.ok, true);
  assert.equal(initial.value.workspaceId, null);
  assert.equal(initial.value.code, null);
  assert.equal(registry.calls.create, 0);
  assert.equal(registry.calls.mkdir, 0);
  assert.equal(registry.calls.insertBefore, 0);

  await service.ensure();
  const writes = { ...registry.calls };
  const after = await service.state();
  assert.equal(after.value.workspaceId, 'w1');
  assert.equal(after.value.code, null);
  assert.deepEqual(registry.calls, writes, 'state must not touch the registry order or records');

  // The user deleted the group in the sidebar.
  registry.deleteRecord('w1');
  const gone = await service.state();
  assert.equal(gone.ok, true);
  assert.equal(gone.value.workspaceId, null);
  assert.equal(gone.value.code, CODES.missingRecord);
  assert.deepEqual(registry.calls, writes, 'still read-only');
});

test('autoRepair=false surfaces missing-record; autoRepair=true rebuilds once', async () => {
  const noRepair = makeService({ config: { autoRepair: false } });
  await noRepair.service.ensure();
  noRepair.registry.deleteRecord('w1');
  const refused = await noRepair.service.ensure();
  assert.equal(refused.ok, false);
  assert.equal(refused.code, CODES.missingRecord);
  assert.equal(noRepair.registry.calls.create, 1, 'nothing was recreated');

  const repair = makeService();
  await repair.service.ensure();
  repair.registry.deleteRecord('w1');
  const rebuilt = await repair.service.ensure();
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.value.workspaceId, 'w2');
  assert.equal(rebuilt.value.repaired, true, 'the repair is announced once');
  assert.equal(rebuilt.value.reusedExisting, false);

  const settled = await repair.service.state();
  assert.equal(settled.value.repaired, false, 'the announcement does not repeat');
  assert.equal(settled.value.workspaceId, 'w2');
});

test('a group nested under another workspace is reported for the warning UI', async () => {
  const registry = fakeRegistry();
  const parent = await registry.create('/home/tester', 'Home');
  const { service } = makeService({ config: { recentTasksDir: '/home/tester/Recents' }, registry });
  const result = await service.ensure();
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.nestedUnder, { id: parent.id, title: 'Home' });
});

// --------------------------------------------------------------------------
// HTTP API
// --------------------------------------------------------------------------

function makeReq(method, url, payload, headers = { 'content-type': 'application/json' }) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text, 'utf8');
    },
  };
}

function makeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(text) {
      this.body = String(text ?? '');
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

function apiFixture({ config = {} } = {}) {
  const { service, registry } = makeService({ config });
  const handler = createApiHandler({ service, logger: { warn() {} } });
  return { handler, service, registry };
}

test('the API answers POST only, and only for known methods', async () => {
  const { handler } = apiFixture();
  const get = makeRes();
  await handler(makeReq('GET', '/dsh-recent-tasks/api/state'), get);
  assert.equal(get.status, 405);
  assert.equal(get.json().code, CODES.methodNotAllowed);

  const unknown = makeRes();
  await handler(makeReq('POST', '/dsh-recent-tasks/api/nope'), unknown);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json().code, CODES.unknownMethod);

  const malformed = makeRes();
  await handler(makeReq('POST', '/dsh-recent-tasks/api/state', 'not json'), malformed);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json().code, CODES.badRequest);

  const huge = makeRes();
  await handler(makeReq('POST', '/dsh-recent-tasks/api/state', 'x'.repeat(64 * 1024 + 10)), huge);
  assert.equal(huge.status, 413);
  assert.equal(huge.json().code, CODES.payloadTooLarge);
});

test('the API serves state/ensure and never exposes a destructive method', async () => {
  const { handler, registry } = apiFixture();
  const state = makeRes();
  await handler(makeReq('POST', '/dsh-recent-tasks/api/state'), state);
  assert.equal(state.status, 200);
  assert.equal(state.json().ok, true);
  assert.equal(state.json().value.workspaceId, null);
  assert.equal(registry.calls.create, 0);

  const ensure = makeRes();
  await handler(makeReq('POST', '/dsh-recent-tasks/api/ensure'), ensure);
  assert.equal(ensure.status, 200);
  assert.equal(ensure.json().value.workspaceId, 'w1');

  // There is no delete method at all.
  const del = makeRes();
  await handler(makeReq('POST', '/dsh-recent-tasks/api/delete'), del);
  assert.equal(del.status, 404);
});

test('a live settings edit moves the group to the new folder on the next call', async () => {
  // The loader hands volatile edits to the SAME refs; a live read must notice.
  const live = { recentTasksDir: { get: () => `${HOME}/First` } };
  const { service, registry } = makeService({ live: true, config: live });
  const first = await service.ensure();
  assert.equal(first.ok, true);
  assert.equal(first.value.path, `${HOME}/First`);
  assert.equal(first.value.workspaceId, 'w1');

  // Settings -> Plugins writes the new folder; nothing remounts.
  live.recentTasksDir = { get: () => `${HOME}/Second` };
  const moved = await service.state();
  assert.equal(moved.value.path, `${HOME}/Second`);
  assert.equal(moved.value.workspaceId, null, 'the stale record must not be reused for the new path');
  assert.equal(moved.value.code, null, 'no code: the client is expected to ensure');

  const ensured = await service.ensure();
  assert.equal(ensured.value.path, `${HOME}/Second`);
  assert.equal(ensured.value.workspaceId, 'w2', 'a second group is registered');
  assert.equal(ensured.value.repaired, false, 'a deliberate move is not a repair');
  assert.equal(registry.calls.create, 2);
});

test('the API refuses a non-JSON content type, so no cross-site simple POST lands', async () => {
  const { handler } = apiFixture();
  // A form/text POST is a CORS "simple request": the browser sends it without a
  // preflight, so the content type is the only line of defence this route has.
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
    const res = makeRes();
    await handler(makeReq('POST', `${API_PREFIX}/ensure`, {}, { 'content-type': contentType }), res);
    assert.equal(res.status, 400, `content-type ${JSON.stringify(contentType)} must be refused`);
    assert.equal(res.json().code, CODES.badRequest);
  }
  // The client half's own request (JSON) still works.
  const ok = makeRes();
  await handler(makeReq('POST', `${API_PREFIX}/state`, {}), ok);
  assert.equal(ok.status, 200);
  assert.equal(ok.json().ok, true);
});

test('readJsonBody rejects a body over the cap and empty bodies read as {}', async () => {
  assert.deepEqual(await readJsonBody(makeReq('POST', '/x', '')), {});
  assert.deepEqual(await readJsonBody(makeReq('POST', '/x', { a: 1 })), { a: 1 });
  await assert.rejects(() => readJsonBody(makeReq('POST', '/x', 'y'.repeat(200)), 100), (error) => {
    assert.equal(error.code, CODES.payloadTooLarge);
    assert.equal(error.status, 413);
    return true;
  });
});
// --------------------------------------------------------------------------
// per-conversation allocation (v2)
// --------------------------------------------------------------------------
