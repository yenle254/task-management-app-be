const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../../../services/email.service', () => ({ sendResetPasswordEmail: jest.fn() }));
jest.mock('../../../services/expo-push.service', () => ({ send: jest.fn() }));
const { verifyToken } = require('../../../config/jwt');
const Session = require('../../../models/refresh-session.model');
const User = require('../../../models/user.model');
const AuditLog = require('../../../models/audit-log.model');
const logger = require('../../../utils/logger.utils');
const audit = require('../../../services/audit.service');
const oid = () => new mongoose.Types.ObjectId().toString();
const adminId = oid(), hrId = oid(), targetId = oid();
const tick = () => new Promise(resolve => setImmediate(resolve));
const chain = value => ({ select() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
let rows, users;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.requestId = 'route-test'; next(); });
app.use('/api/admin', require('../../../routes/admin.routes'));
app.use('/api/users', require('../../../routes/user.routes'));
const matches = (entry, query) => Object.entries(query).every(([key, expected]) => {
  const value = key.split('.').reduce((item, part) => item?.[part], entry);
  return key === 'at' ? new Date(value) >= expected.$gte && new Date(value) < expected.$lt : String(value) === String(expected);
});
beforeEach(() => {
  jest.spyOn(Session, 'updateMany').mockResolvedValue({ modifiedCount: 0 });
  rows = [];
  users = { [adminId]: { _id: adminId, role: 'system_admin', isActive: true }, [hrId]: { _id: hrId, role: 'hr_manager', isActive: true },
    [targetId]: { _id: targetId, role: 'employee', isActive: true, profile: { fullName: 'Employee snapshot', department: 'Sales' },
      password: 'never-store', pushToken: 'never-store', resetPassword: { otp: 'never-store' } } };
  verifyToken.mockImplementation(token => ({ id: token }));
  jest.spyOn(User, 'findById').mockImplementation(id => chain(users[String(id)] ? structuredClone(users[String(id)]) : null));
  jest.spyOn(User, 'findByIdAndUpdate').mockImplementation((id, update) => {
    const user = users[String(id)];
    if (user) for (const [key, value] of Object.entries(update.$set || update)) {
      const parts = key.split('.'); let into = user;
      for (const part of parts.slice(0, -1)) into = into[part] ||= {};
      into[parts.at(-1)] = value;
    }
    return chain(user ? structuredClone(user) : null);
  });
  jest.spyOn(AuditLog, 'create').mockImplementation(async doc => { const entry = { _id: oid(), ...structuredClone(doc) }; rows.push(entry); return entry; });
  jest.spyOn(AuditLog, 'find').mockImplementation(query => {
    let offset = 0, count = 10;
    return { sort: jest.fn().mockReturnThis(), skip(value) { offset = value; return this; }, limit(value) { count = value; return this; },
      lean: async () => rows.filter(entry => matches(entry, query)).sort((a, b) => new Date(b.at) - new Date(a.at) || b._id.localeCompare(a._id)).slice(offset, offset + count) };
  });
  jest.spyOn(AuditLog, 'countDocuments').mockImplementation(async query => rows.filter(entry => matches(entry, query)).length);
  jest.spyOn(AuditLog, 'findById').mockImplementation(id => ({ lean: async () => rows.find(row => row._id === id) || null }));
});
afterEach(async () => { await tick(); await tick(); });
const get = (path = '', actor = adminId) => request(app).get(`/api/admin/audit-logs${path}`).set('Authorization', `Bearer ${actor}`);
test('unauthenticated request returns 401 and anonymous security event', async () => {
  expect((await request(app).get('/api/admin/audit-logs')).status).toBe(401); await tick();
  expect(rows[0]).toMatchObject({ action: 'security.auth_rejected', outcome: 'denied', actor: { id: null }, context: { route: '/api/admin/audit-logs' } });
});
test.each(['employee', 'team_lead'])('%s cannot read any audit endpoint; denial has route/method/required roles', async role => {
  users[hrId].role = role;
  for (const path of ['', `/${oid()}`, `/target/user/${targetId}`]) expect((await get(path, hrId)).status).toBe(403);
  await tick(); expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({ action: 'security.access_denied', outcome: 'denied', metadata: { route: '/api/admin/audit-logs', method: 'GET', requiredRoles: ['system_admin', 'hr_manager'] } });
});
test.each([['system_admin', adminId], ['hr_manager', hrId]])('%s can filter, paginate, read detail and target history', async (_role, actor) => {
  const read = path => get(path, actor);
  for (let i = 0; i < 3; i++) rows.push({ _id: oid(), at: '2026-11-03T00:00:00Z', action: 'user.updated', category: 'user', outcome: 'success', severity: 'warning', actor: { id: hrId }, target: { type: 'user', id: targetId, label: 'Persisted name' } });
  rows.push({ ...rows[0], _id: oid(), at: '2026-11-04T00:00:00Z' });
  const response = await read(`?actorId=${hrId}&targetType=user&targetId=${targetId}&from=2026-11-03&to=2026-11-04&limit=2&page=1&action=user.updated&category=user&outcome=success&severity=warning`);
  expect(response.status).toBe(200); expect(response.body).toMatchObject({ count: 2, total: 3, page: 1, pages: 2 });
  expect(AuditLog.find.mock.results.at(-1).value.sort).toHaveBeenCalledWith({ at: -1, _id: -1 });
  const detail = await read(`/${response.body.data[0]._id}`);
  expect(detail.status).toBe(200);
  expect(detail.body.data.target.label).toBe('Persisted name');
  const history = await read(`/target/user/${targetId}?limit=2&page=2`);
  expect(history.status).toBe(200);
  expect(history.body).toMatchObject({ page: 2, count: 2, total: 4 });
  expect((await read(`/${oid()}`)).status).toBe(404);
  expect((await read(`/target/team/${oid()}`)).body).toMatchObject({ success: true, data: [], total: 0 });
});
test.each(['employee', 'team_lead', 'hr_manager'])('%s cannot create HR accounts', async role => {
  users[hrId].role = role;
  expect((await request(app).post('/api/admin/hr-accounts').set('Authorization', `Bearer ${hrId}`).send({})).status).toBe(403);
});
test('system admin still reaches create-HR validation', async () => {
  expect((await request(app).post('/api/admin/hr-accounts').set('Authorization', `Bearer ${adminId}`).send({})).status).toBe(400);
});
test.each(['?actorId=bad', '?targetId=bad', '?targetType=invalid', '?from=2026-11-03', '?to=2026-11-04', '?from=2026-11-04&to=2026-11-03', '?limit=101', '?limit=abc', '?page=0', '?action=invalid', '?category=invalid', '?severity=bad', '?outcome=bad', '/target/invalid/123', '/invalid'])('reject invalid audit query %s', async path => expect((await get(path)).status).toBe(400));
test.each(['post', 'put', 'delete'])('no client %s route for audit', async method => expect((await request(app)[method]('/api/admin/audit-logs').set('Authorization', `Bearer ${adminId}`)).status).toBe(404));
test('persisted user before-image, reason, immutable labels/diffs survive deactivate and target disappearance', async () => {
  const update = await request(app).put(`/api/users/${targetId}`).set('Authorization', `Bearer ${hrId}`).send({ 'profile.department': 'Marketing', reason: '  Department transfer  ' });
  expect(update.status).toBe(200); await tick();
  const first = rows.find(row => row.action === 'user.updated');
  expect(first).toMatchObject({ reason: 'Department transfer', target: { label: 'Employee snapshot' }, changes: [{ field: 'profile.department', from: 'Sales', to: 'Marketing' }] });
  expect(users[targetId]).not.toHaveProperty('reason');
  expect((await request(app).delete(`/api/users/${targetId}`).set('Authorization', `Bearer ${hrId}`)).status).toBe(200); await tick();
  expect(rows.find(row => row.action === 'user.deactivated').reason).toBeNull();
  delete users[targetId];
  const history = await get(`/target/user/${targetId}`);
  expect(history.status).toBe(200); expect(history.body.total).toBe(2);
  expect(history.body.data.find(row => row._id === first._id)).toMatchObject({ target: { label: 'Employee snapshot' }, changes: first.changes });
  for (const secret of ['password', 'pushToken', 'resetPassword', 'reminders', 'leaveBalanceOperations']) expect(JSON.stringify(history.body)).not.toContain(secret);
});
test('optional reason defaults, free text is retained, long input truncated, role changes use critical event', async () => {
  const change = body => request(app).put(`/api/users/${targetId}`).set('Authorization', `Bearer ${hrId}`).send(body);
  expect((await change({ role: 'team_lead' })).status).toBe(200); await tick();
  expect(rows[0]).toMatchObject({ action: 'user.role_changed', severity: 'critical', reason: 'No reason provided' });
  expect((await change({ reason: ' password=123 ' })).status).toBe(200); await tick(); expect(rows[1].reason).toBe('password=123');
  expect((await change({ reason: 'x'.repeat(2000) })).status).toBe(200); await tick(); expect(rows[2].reason).toHaveLength(500);
  expect(users[targetId]).not.toHaveProperty('reason');
});
test('audit DB failure leaves a successful business request at HTTP 200', async () => {
  AuditLog.create.mockRejectedValue(new Error('audit collection unavailable'));
  const log = jest.spyOn(logger, 'error').mockImplementation(() => {});
  expect((await request(app).put(`/api/users/${targetId}`).set('Authorization', `Bearer ${hrId}`).send({ 'profile.department': 'Marketing' })).status).toBe(200);
  await tick(); await tick(); expect(users[targetId].profile.department).toBe('Marketing');
  expect(log).toHaveBeenCalledWith('audit_write_failed', { action: 'user.updated', requestId: 'route-test' });
});
