// Pure protocol helpers (shared by both halves).
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  API_PREFIX,
  CODES,
  SETTINGS_NAMESPACE,
  CODE_MESSAGE_KEYS,
  MAX_BODY_BYTES,
  METHODS,
  READ_ONLY_METHODS,
  codeForStatus,
  expandHome,
  isAbsolutePath,
  isKnownMethod,
  messageKeyForCode,
  normalizeDirPath,
  parseApiMethod,
  readStateResponse,
  resolveWorkspaceId,
  validateStateValue,
} from '../src/protocol.js';

test('API surface is one prefix, two idempotent methods, one settings namespace', () => {
  assert.equal(API_PREFIX, '/dsh-recent-tasks/api');
  assert.equal(SETTINGS_NAMESPACE, 'recent-tasks');
  assert.deepEqual([...METHODS], ['state', 'ensure']);
  assert.deepEqual([...READ_ONLY_METHODS], ['state', 'ensure'], 'allocate writes, so it is not read-only');
  assert.equal(MAX_BODY_BYTES, 64 * 1024);
});

test('parseApiMethod accepts exactly one segment under the prefix', () => {
  assert.equal(parseApiMethod('/dsh-recent-tasks/api/state'), 'state');
  assert.equal(parseApiMethod('/dsh-recent-tasks/api/config.set?v=1'), 'config.set');
  assert.equal(parseApiMethod('/dsh-recent-tasks/api/ensure#x'), 'ensure');
  // Not ours / nested / empty / elsewhere:
  assert.equal(parseApiMethod('/dsh-recent-tasks/api'), '');
  assert.equal(parseApiMethod('/dsh-recent-tasks/api/a/b'), '');
  assert.equal(parseApiMethod('/plugins/x/client.js'), '');
  assert.equal(parseApiMethod(''), '');
  assert.equal(parseApiMethod(undefined), '');
  assert.equal(parseApiMethod('/other/state', '/other'), 'state');
});

test('isKnownMethod refuses everything outside the whitelist', () => {
  assert.equal(isKnownMethod('state'), true);
  assert.equal(isKnownMethod('ensure'), true);
  assert.equal(isKnownMethod('config.set'), false, 'config is the official settings surface, not this API');
  assert.equal(isKnownMethod('delete'), false);
  assert.equal(isKnownMethod('__proto__'), false);
  assert.equal(isKnownMethod(''), false);
});

test('every error code has a locale key', () => {
  for (const code of Object.values(CODES)) {
    assert.equal(typeof CODE_MESSAGE_KEYS[code], 'string', `missing key for ${code}`);
  }
  assert.equal(messageKeyForCode(CODES.disabled), 'state.disabled');
  assert.equal(messageKeyForCode('nonsense'), 'state.internal');
  assert.equal(messageKeyForCode(undefined), 'state.internal');
});

test('expandHome only rewrites a leading tilde', () => {
  assert.equal(expandHome('~/a/b', '/home/me'), '/home/me/a/b');
  assert.equal(expandHome('~', '/home/me'), '/home/me');
  assert.equal(expandHome('~other/x', '/home/me'), '~other/x');
  assert.equal(expandHome('  /abs  ', '/home/me'), '/abs');
  assert.equal(expandHome('', '/home/me'), '');
  assert.equal(expandHome(undefined, '/home/me'), '');
  assert.equal(expandHome('~', undefined), '');
});

test('isAbsolutePath is POSIX + Windows aware', () => {
  assert.equal(isAbsolutePath('/a/b'), true);
  assert.equal(isAbsolutePath('C:\\Users\\me'), true);
  assert.equal(isAbsolutePath('c:/tmp'), true);
  assert.equal(isAbsolutePath('\\\\server\\share'), true);
  assert.equal(isAbsolutePath('relative/dir'), false);
  assert.equal(isAbsolutePath('~/x'), false);
  assert.equal(isAbsolutePath(''), false);
});

test('normalizeDirPath unifies separators and trailing slashes', () => {
  assert.equal(normalizeDirPath('/a/b/'), '/a/b');
  assert.equal(normalizeDirPath('C:\\a\\b\\'), 'C:/a/b');
  assert.equal(normalizeDirPath('/a//b'), '/a/b');
  assert.equal(normalizeDirPath('/'), '/');
  assert.equal(normalizeDirPath(''), '');
});

test('resolveWorkspaceId matches the managed path and falls back on case', () => {
  const list = [
    { id: 'w1', path: '/Users/me/Work' },
    { id: 'w2', path: '/Users/me/DSH 最近任务/' },
    { workspaceId: 'w3', path: 'C:\\Users\\me\\Other' },
  ];
  assert.equal(resolveWorkspaceId(list, '/Users/me/DSH 最近任务'), 'w2');
  assert.equal(resolveWorkspaceId(list, 'C:/Users/me/Other'), 'w3');
  assert.equal(resolveWorkspaceId(list, 'c:/users/me/other'), 'w3');
  assert.equal(resolveWorkspaceId(list, '/Users/me/Nope'), null);
  assert.equal(resolveWorkspaceId([], '/Users/me/Work'), null);
  assert.equal(resolveWorkspaceId(null, '/Users/me/Work'), null);
  assert.equal(resolveWorkspaceId(list, ''), null);
  // A record without an id is skipped rather than returned as undefined.
  assert.equal(resolveWorkspaceId([{ path: '/x' }], '/x'), null);
});

test('validateStateValue rejects unusable payloads and normalizes the rest', () => {
  assert.equal(validateStateValue(null), null);
  assert.equal(validateStateValue('nope'), null);
  assert.equal(validateStateValue({ path: '' }), null);
  const value = validateStateValue({
    enabled: false,
    path: '/tmp/rt',
    title: '最近任务',
    workspaceId: 'w1',
    dirExists: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    pinLast: false,
    autoRepair: false,
    repaired: true,
    reusedExisting: true,
    nestedUnder: { id: 'w0', title: 'Home' },
    code: 'missing-record',
  });
  assert.deepEqual(value, {
    enabled: false,
    path: '/tmp/rt',
    title: '最近任务',
    workspaceId: 'w1',
    dirExists: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    pinLast: false,
    autoRepair: false,
    repaired: true,
    reusedExisting: true,
    nestedUnder: { id: 'w0', title: 'Home' },
    code: 'missing-record',
  });
  // Missing optionals become explicit defaults, never undefined.
  const bare = validateStateValue({ path: '/tmp/rt' });
  assert.equal(bare.workspaceId, null);
  assert.equal(bare.title, null);
  assert.equal(bare.enabled, true);
  assert.equal(bare.pinLast, true);
  assert.equal(bare.autoRepair, true);
  assert.equal(bare.repaired, false);
  assert.equal(bare.reusedExisting, false);
  assert.equal(bare.nestedUnder, null);
  // A nested marker without an id is meaningless and is dropped.
  assert.equal(validateStateValue({ path: '/x', nestedUnder: { title: 'y' } }).nestedUnder, null);
});

test('readStateResponse maps every body onto ok/code', () => {
  assert.deepEqual(readStateResponse(null), { ok: false, code: CODES.internal });
  assert.deepEqual(readStateResponse({ ok: false, code: CODES.disabled }), { ok: false, code: CODES.disabled, message: undefined });
  assert.deepEqual(readStateResponse({ ok: false }), { ok: false, code: CODES.internal, message: undefined });
  assert.deepEqual(readStateResponse({ ok: true }), { ok: false, code: CODES.internal });
  const ok = readStateResponse({ ok: true, value: { path: '/x', workspaceId: 'w' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.path, '/x');
  assert.equal(ok.value.workspaceId, 'w');
});

test('codeForStatus prefers the body code and maps bare statuses', () => {
  assert.equal(codeForStatus(400, { code: CODES.payloadTooLarge }), CODES.payloadTooLarge);
  assert.equal(codeForStatus(405, null), CODES.methodNotAllowed);
  assert.equal(codeForStatus(413, null), CODES.payloadTooLarge);
  assert.equal(codeForStatus(400, null), CODES.badRequest);
  assert.equal(codeForStatus(500, null), CODES.internal);
  assert.equal(codeForStatus(200, {}), CODES.internal);
});
