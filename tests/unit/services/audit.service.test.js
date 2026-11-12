const mongoose = require('mongoose');
const AuditLog = require('../../../models/audit-log.model');
const audit = require('../../../services/audit.service');
const logger = require('../../../utils/logger.utils');
const tick = () => new Promise(resolve => setImmediate(resolve));
const oid = () => new mongoose.Types.ObjectId();
let insert;
beforeEach(() => { insert = jest.spyOn(AuditLog, 'create').mockResolvedValue({}); });
const req = () => ({ requestId: 'audit-request', ip: '127.0.0.1', method: 'PUT', baseUrl: '/api/users', route: { path: '/:id' },
  headers: { 'user-agent': 'test' }, user: { _id: oid(), role: 'hr_manager', email: 'hr@example.com', profile: { fullName: 'HR' } } });

test('shutdown flush includes queued and in-flight audit writes', async () => {
  let release;
  insert.mockReturnValue(new Promise(resolve => { release = resolve; }));
  audit.record(req(), { action: 'user.updated' });
  let flushed = false;
  const pending = audit.flush().then(() => { flushed = true; });
  await tick(); expect(flushed).toBe(false);
  expect(insert).toHaveBeenCalledTimes(1);
  release({}); await pending;
  expect(flushed).toBe(true);
});

test('failed DB write and synchronous insert failure never escape or create an unhandled rejection', async () => {
  const error = jest.spyOn(logger, 'error').mockImplementation(() => {});
  insert.mockRejectedValueOnce(new Error('database offline')).mockImplementationOnce(() => { throw new Error('sync failure'); });
  for (let i = 0; i < 2; i++) {
    expect(() => audit.record(req(), { action: 'user.updated' })).not.toThrow();
    await tick(); await tick();
  }
  expect(error).toHaveBeenCalledTimes(2);
  expect(error).toHaveBeenCalledWith('audit_write_failed', { action: 'user.updated', requestId: 'audit-request' });
});
test('whitelist and shared redaction exclude sensitive metadata and diff fields including all pushToken variants', async () => {
  const secrets = Object.fromEntries(['password', 'passwordHash', 'otp', 'resetToken', 'pushToken', 'pushTokenPlatform', 'pushTokenUpdatedAt', 'authorization', 'cookie', 'resetPassword', 'reminders', 'leaveBalanceOperations', 'notificationPreferences'].map(key => [key, `secret_${key}`]));
  audit.record(req(), { action: 'user.updated', target: { type: 'user', id: oid() },
    changes: Object.entries(secrets).map(([field, to]) => ({ field, from: null, to })).concat({ field: 'profile.department', from: 'Sales', to: 'Marketing' }),
    metadata: { nested: secrets, ...secrets } });
  await tick();
  const doc = insert.mock.calls[0][0], json = JSON.stringify(doc);
  for (const key of Object.keys(secrets)) expect(json).not.toContain(key);
  expect(doc.changes).toEqual([{ field: 'profile.department', from: 'Sales', to: 'Marketing' }]);
  expect(logger._internals.redactMeta(secrets).pushToken).toBe('[REDACTED]');
});
test('diff handles ObjectId, populated refs, arrays, Date, nested paths, null and unset', () => {
  const first = oid(), second = oid(), before = { teamId: first, managerId: second, isActive: null, profile: { department: 'Sales' }, dueDate: new Date('2026-01-01'), assignedTo: [first] };
  expect(audit.diff(before, { ...before, teamId: new mongoose.Types.ObjectId(String(first)), assignedTo: [{ _id: first, password: 'secret' }] }, ['teamId', 'assignedTo'])).toEqual([]);
  expect(audit.diff(before, { teamId: second, profile: { department: 'Marketing' }, dueDate: new Date('2026-02-01') }, ['teamId', 'managerId', 'isActive', 'profile.department', 'dueDate', 'password'])).toEqual([
    { field: 'teamId', from: String(first), to: String(second) }, { field: 'managerId', from: String(second), to: null },
    { field: 'isActive', from: null, to: null }, { field: 'profile.department', from: 'Sales', to: 'Marketing' },
    { field: 'dueDate', from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' }
  ]);
});
test('snapshots are bounded, synchronous, immutable and use the matched route and socket IP', async () => {
  const request = req(); request.user.email = 'a'.repeat(2048);
  const event = { action: 'user.updated', target: { type: 'user', label: ' x'.repeat(1000) }, reason: ' password=123 ', metadata: { large: '測'.repeat(10000), nested: { a: { b: { c: 'deep' } } } } };
  audit.record(request, event);
  request.user.profile.fullName = 'Mutated'; event.reason = 'Mutated';
  await tick(); const doc = insert.mock.calls[0][0];
  expect(doc.actor.name).toBe('HR'); expect(doc.actor.email).toHaveLength(500);
  expect(doc.reason).toBe('password=123'); expect(doc.target.label.length).toBeLessThanOrEqual(500);
  expect(doc.context).toMatchObject({ route: '/api/users/:id', ip: '127.0.0.1', requestId: 'audit-request' });
  expect(doc.metadata.truncated).toBe(true); expect(Buffer.byteLength(JSON.stringify(doc.metadata))).toBeLessThanOrEqual(4096);
});
test.each([['alice@example.com', 'a***@example.com'], ['bad input', '*@*'], ['', '*@*']])('masks unauthenticated email %s', (input, expected) => expect(audit.maskEmail(input)).toBe(expected));
test('recordSystem uses a system actor and no request ID', async () => {
  audit.recordSystem({ action: 'office.updated' }); await tick();
  expect(insert.mock.calls[0][0]).toMatchObject({ actor: { id: null, role: 'system' }, context: { requestId: null } });
});
test('diff preparation failure cannot escape the audit helper; proxy setting never trusts forwarded headers', () => {
  const log = jest.spyOn(logger, 'error').mockImplementation(() => {});
  const broken = { get role() { throw new Error('snapshot unavailable'); } };
  expect(() => audit.changed(req(), 'user.updated', 'user', broken, {})).not.toThrow();
  expect(log).toHaveBeenCalledWith('audit_write_failed', { action: 'user.updated', requestId: 'audit-request' });
  const previous = process.env.AUDIT_TRUST_PROXY;
  process.env.AUDIT_TRUST_PROXY = 'loopback';
  expect(audit.trustProxyDeclaration()).toBe('loopback');
  expect(audit.context({ ...req(), headers: { 'x-forwarded-for': 'untrusted' } }).ip).toBe('127.0.0.1');
  if (previous === undefined) delete process.env.AUDIT_TRUST_PROXY; else process.env.AUDIT_TRUST_PROXY = previous;
});
