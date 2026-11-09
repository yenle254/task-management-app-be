const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fixture = require('../../fixtures/auth-session.fixture');
const tokens = require('../../../services/token.service');
const sessions = require('../../../services/session.service');
const User = require('../../../models/user.model');
const audit = require('../../../services/audit.service');
jest.mock('../../../services/email.service', () => ({ sendResetPasswordEmail: jest.fn().mockResolvedValue() }));
jest.mock('../../../services/auth.service', () => ({ hashPassword: jest.fn(async value => `hashed:${value}`), comparePassword: jest.fn(async (value, hash) => hash === 'hashed' ? value === 'correct' : hash === `hashed:${value}`) }));
const app = express(); app.use(express.json());
app.use('/api/auth', require('../../../routes/auth.routes'));
app.get('/protected', require('../../../middleware/auth.middleware').protect, (req, res) => res.json({ role: req.user.role }));
let db;
beforeEach(() => { db = fixture(); jest.spyOn(audit, 'record').mockImplementation(() => {}); });
const login = () => request(app).post('/api/auth/login').send({ email: db.user.email, password: 'correct' });
const get = token => request(app).get('/protected').set('Authorization', `Bearer ${token}`);
test('login response remains additive and hides reset secrets, password and epoch', async () => {
  db.user.resetPassword = { otp: '123456', resetToken: 'ResetSecret' };
  const res = await login();
  expect(res.status).toBe(200); expect(res.body).toMatchObject({ success: true, token: expect.any(String), refreshToken: expect.any(String), expiresIn: 900, user: { _id: db.user._id } });
  for (const key of ['password', 'resetPassword', 'tokenVersion']) expect(res.body.user).not.toHaveProperty(key);
  expect((await get(res.body.token)).status).toBe(200);
});
test('register still creates employee and issues pair while ignoring injected role/epoch', async () => {
  const res = await request(app).post('/api/auth/register').send({ email: 'new@example.com', password: 'Password123!', profile: { fullName: 'New User', employeeId: 'NEW01' }, role: 'hr_manager', tokenVersion: 9 });
  expect(res.status).toBe(201); expect(res.body.user.role).toBe('employee'); expect(res.body.refreshToken).toHaveLength(64);
  expect(res.body.user).not.toHaveProperty('password');
});
test('legacy session works at epoch zero and is denied after logout-all', async () => {
  const token = jwt.sign({ id: db.user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  expect((await get(token)).status).toBe(200);
  expect((await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  expect((await get(token)).status).toBe(401);
});
test('HTTP refresh rotates, grace returns409, invalid input cannot leak submitted secret', async () => {
  const pair = (await login()).body;
  const next = await request(app).post('/api/auth/refresh').send({ refreshToken: pair.refreshToken });
  expect(next.status).toBe(200); expect(next.body.refreshToken).not.toBe(pair.refreshToken);
  expect((await get(next.body.token)).status).toBe(200);
  const conflict = await request(app).post('/api/auth/refresh').send({ refreshToken: pair.refreshToken });
  expect(conflict.status).toBe(409); expect(conflict.body.code).toBe('refresh_retry');
  const bad = await request(app).post('/api/auth/refresh').send({ refreshToken: 'sensitive-malformed' });
  expect(bad.status).toBe(400); expect(JSON.stringify(bad.body)).not.toContain('sensitive-malformed');
});
test('HTTP logout idempotent, access immediately denied, other device unaffected', async () => {
  const pair = (await login()).body, second = (await login()).body;
  for (let i = 0; i < 2; i++) expect((await request(app).post('/api/auth/logout').send({ refreshToken: pair.refreshToken })).status).toBe(200);
  expect((await get(pair.token)).status).toBe(401); expect((await get(second.token)).status).toBe(200);
  expect((await request(app).post('/api/auth/logout').send({})).status).toBe(200);
});
test('list and revoke selected session enforce authenticated ownership', async () => {
  const pair = (await login()).body, second = (await login()).body;
  const list = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${pair.token}`);
  expect(list.status).toBe(200); expect(list.body.data).toHaveLength(2);
  expect(JSON.stringify(list.body)).not.toContain('tokenHash');
  expect((await request(app).delete(`/api/auth/sessions/${db.rows[1].sessionId}`).set('Authorization', `Bearer ${pair.token}`)).status).toBe(200);
  expect((await get(second.token)).status).toBe(401); expect((await get(pair.token)).status).toBe(200);
});
test('password change atomically increments epoch, revokes all old devices and returns working pair', async () => {
  const pair = (await login()).body, second = (await login()).body;
  const changed = await request(app).put('/api/auth/password').set('Authorization', `Bearer ${pair.token}`).send({ oldPassword: 'correct', newPassword: 'NewPassword123!' });
  expect(changed.status).toBe(200); expect(changed.body.message).toBe('Password changed successfully');
  expect(db.user.tokenVersion).toBe(1); expect(db.user.password).toBe('hashed:NewPassword123!');
  expect((await get(pair.token)).status).toBe(401); expect((await get(second.token)).status).toBe(401);
  expect((await get(changed.body.token)).status).toBe(200);
  expect((await request(app).post('/api/auth/refresh').send({ refreshToken: pair.refreshToken })).status).toBe(401);
  expect(User.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ password: 'hashed', isActive: true }), expect.objectContaining({ $inc: { tokenVersion: 1 } }), expect.anything());
});
test('wrong old password never changes epoch or sessions', async () => {
  const pair = (await login()).body;
  expect((await request(app).put('/api/auth/password').set('Authorization', `Bearer ${pair.token}`).send({ oldPassword: 'wrong123', newPassword: 'NewPassword123!' })).status).toBe(400);
  expect(db.user.tokenVersion).toBe(0); expect(db.rows[0].revokedAt).toBeNull();
});
test('forgot -> OTP -> reset survives select:false and reset token is single-use', async () => {
  const pair = (await login()).body;
  const email = db.user.email;
  expect((await request(app).post('/api/auth/forgot-password').send({ email })).status).toBe(200);
  const otp = db.user.resetPassword.otp;
  expect(otp).toMatch(/^\d{6}$/);
  const verified = await request(app).post('/api/auth/verify-otp').send({ email, otp });
  expect(verified.status).toBe(200); const resetToken = verified.body.data.resetToken;
  const reset = () => request(app).post('/api/auth/reset-password').send({ email, resetToken, newPassword: 'NewPassword123!' });
  expect((await reset()).status).toBe(200); expect(db.user.tokenVersion).toBe(1); expect(db.user.resetPassword).toEqual({});
  expect((await get(pair.token)).status).toBe(401); expect((await reset()).status).toBe(400);
  expect(User.findOne.mock.results.some(result => result.value.select.mock.calls.some(([selection]) => selection.includes('+resetPassword')))).toBe(true);
});
test.each(['forgot-password', 'verify-otp', 'resend-otp', 'reset-password'])('inactive account denied in %s', async route => {
  db.user.isActive = false;
  const res = await request(app).post(`/api/auth/${route}`).send({ email: db.user.email, otp: '123456', resetToken: 'a'.repeat(64), newPassword: 'NewPassword123!' });
  expect(res.status).toBe(401); expect(db.user.tokenVersion).toBe(0);
});
test('deactivation persists epoch: reactivation cannot resurrect access or refresh', async () => {
  const pair = (await login()).body;
  await require('../../../services/user.service').deleteUser(db.user._id);
  expect(db.user.tokenVersion).toBe(1); expect((await get(pair.token)).status).toBe(401);
  db.user.isActive = true;
  expect((await get(pair.token)).status).toBe(401);
  await expect(sessions.rotateSession(pair.refreshToken)).rejects.toMatchObject({ code: 'refresh_invalid' });
});
test('role change updates authorization and invalidates old epoch', async () => {
  const pair = (await login()).body;
  await require('../../../services/user.service').updateUser(db.user._id, { role: 'team_lead' });
  expect(db.user.tokenVersion).toBe(1); expect((await get(pair.token)).status).toBe(401);
});
test('expired access returns machine-readable token_expired; no token returns401', async () => {
  const pair = (await login()).body, claims = jwt.decode(pair.token);
  const expired = jwt.sign({ ...claims, iat: 1, exp: 2 }, process.env.JWT_SECRET);
  const response = await get(expired); expect(response.status).toBe(401); expect(response.body.code).toBe('token_expired');
  expect((await request(app).get('/protected')).status).toBe(401);
});
