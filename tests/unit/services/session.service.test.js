const fixture = require('../../fixtures/auth-session.fixture');
const sessions = require('../../../services/session.service');
const tokens = require('../../../services/token.service');
const Session = require('../../../models/refresh-session.model');
const audit = require('../../../services/audit.service');
let db, req, io;
beforeEach(() => {
  db = fixture();
  io = { to: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), emit: jest.fn(), disconnectSockets: jest.fn() };
  req = { body: { deviceName: 'Test device' }, get: () => 'Test agent', ip: '127.0.0.1', app: { get: () => io } };
  jest.spyOn(audit, 'record').mockImplementation(() => {});
});
test('create stores only hash, absolute expiry and returns compatible pair', async () => {
  const pair = await sessions.createSession(db.user, req);
  expect(pair).toMatchObject({ token: expect.any(String), refreshToken: expect.any(String), expiresIn: 900 });
  expect(JSON.stringify(db.rows)).not.toContain(pair.refreshToken);
  expect(db.rows[0].tokenHash).toBe(tokens.hashRefreshToken(pair.refreshToken));
  expect(db.rows[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
});
test('multiple rotations work and never extend absolute expiry', async () => {
  let pair = await sessions.createSession(db.user, req); const expiry = db.rows[0].expiresAt;
  for (let i = 0; i < 3; i++) pair = await sessions.rotateSession(pair.refreshToken, req);
  expect(db.rows[0].rotations).toBe(3); expect(db.rows[0].usedTokens).toHaveLength(3);
  expect(db.rows[0].expiresAt).toEqual(expiry);
  expect(db.rows[0].tokenHash).toBe(tokens.hashRefreshToken(pair.refreshToken));
});
test('concurrent refresh has exactly one winner; loser receives 409 and no revocation', async () => {
  const pair = await sessions.createSession(db.user, req);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => sessions.rotateSession(pair.refreshToken, req)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  results.filter(result => result.status === 'rejected').forEach(result => expect(result.reason).toMatchObject({ code: 'refresh_retry', statusCode: 409 }));
  expect(db.user.tokenVersion).toBe(0); expect(db.rows[0].revokedAt).toBeNull();
});
test('oldest token replay after later rotations revokes every device outside grace', async () => {
  const first = await sessions.createSession(db.user, req);
  const other = await sessions.createSession(db.user, req);
  const second = await sessions.rotateSession(first.refreshToken, req);
  await sessions.rotateSession(second.refreshToken, req);
  db.rows[0].usedTokens[0].validUntil = new Date(0);
  await expect(sessions.rotateSession(first.refreshToken, req)).rejects.toMatchObject({ code: 'token_reuse' });
  expect(db.user.tokenVersion).toBe(1); expect(db.rows.every(row => row.revokedAt)).toBe(true);
  await expect(sessions.assertAccessSession(tokens.verifyAccessToken(other.token), db.user)).rejects.toMatchObject({ code: 'session_revoked' });
  expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'security.token_reuse_detected' }));
});
test.each(['unknown', 'malformed', 'expired', 'revoked', 'inactive', 'epoch', 'rotation_limit'])('refresh rejects %s session', async kind => {
  const pair = await sessions.createSession(db.user, req);
  if (kind === 'expired') db.rows[0].expiresAt = new Date(0);
  if (kind === 'revoked') db.rows[0].revokedAt = new Date();
  if (kind === 'inactive') db.user.isActive = false;
  if (kind === 'epoch') db.user.tokenVersion++;
  if (kind === 'rotation_limit') db.rows[0].rotations = 10000;
  await expect(sessions.rotateSession(kind === 'unknown' ? tokens.generateRefreshToken() : kind === 'malformed' ? {} : pair.refreshToken, req)).rejects.toMatchObject({ statusCode: 401 });
});
test('single-device logout is idempotent and leaves other device usable', async () => {
  const first = await sessions.createSession(db.user, req), other = await sessions.createSession(db.user, req);
  await sessions.logout(first.refreshToken, null, req); await sessions.logout(first.refreshToken, null, req);
  await expect(sessions.assertAccessSession(tokens.verifyAccessToken(first.token), db.user)).rejects.toMatchObject({ code: 'session_revoked' });
  await expect(sessions.assertAccessSession(tokens.verifyAccessToken(other.token), db.user)).resolves.toBeUndefined();
  expect(io.in).toHaveBeenCalledWith(`session:${db.rows[0].sessionId}`);
  expect(db.user.tokenVersion).toBe(0);
});
test('access-only logout works and another user cannot revoke or disconnect an owned session', async () => {
  const first = await sessions.createSession(db.user, req);
  await sessions.revokeSession(db.rows[0].sessionId, 'b'.repeat(24), 'bad', io);
  expect(io.disconnectSockets).not.toHaveBeenCalled(); expect(db.rows[0].revokedAt).toBeNull();
  await sessions.logout(null, first.token, req); expect(db.rows[0].revokedAt).toBeTruthy();
  await expect(sessions.logout(null, 'bad', req)).resolves.toBeUndefined();
});
test('logout all invalidates legacy version zero and modern sessions', async () => {
  await sessions.createSession(db.user, req);
  await sessions.revokeAllSessions(db.user._id, 'logout_all', req);
  await expect(sessions.assertAccessSession({}, db.user)).rejects.toMatchObject({ code: 'session_revoked' });
  expect(db.rows[0].revokedAt).toBeTruthy();
});
test('session listing contains no hashes, used tokens, IP or user agent', async () => {
  await sessions.createSession(db.user, req);
  expect(JSON.stringify(await sessions.listSessions(db.user._id))).not.toMatch(/tokenHash|usedTokens|ip|userAgent/);
});
test('epoch change during issuance prevents usable tokens', async () => {
  const create = Session.create.getMockImplementation();
  Session.create.mockImplementation(async fields => { const result = await create(fields); db.user.tokenVersion++; return result; });
  await expect(sessions.createSession({ ...db.user }, req)).rejects.toMatchObject({ code: 'refresh_invalid' });
  expect(db.rows[0].revokedAt).toBeTruthy();
});
test('epoch change during rotation prevents returning a token pair', async () => {
  const first = await sessions.createSession(db.user, req);
  const rotate = Session.findOneAndUpdate.getMockImplementation();
  Session.findOneAndUpdate.mockImplementation((filter, change) => { const result = rotate(filter, change); db.user.tokenVersion++; return result; });
  await expect(sessions.rotateSession(first.refreshToken, req)).rejects.toMatchObject({ code: 'refresh_invalid' });
});
test('feature flag rejects refresh without revoking sessions', async () => {
  process.env.REFRESH_ENABLED = 'false';
  try { await expect(sessions.rotateSession('anything', req)).rejects.toMatchObject({ statusCode: 503 }); }
  finally { delete process.env.REFRESH_ENABLED; }
});
