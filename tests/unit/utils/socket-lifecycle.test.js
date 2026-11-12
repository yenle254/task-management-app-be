const { EventEmitter } = require('events');
const fixture = require('../../fixtures/auth-session.fixture');
const handler = require('../../../utils/socket-handler.utils');
const sessions = require('../../../services/session.service');
const jwt = require('jsonwebtoken');
const audit = require('../../../services/audit.service');
let db, authenticate, connection, stop, io;
beforeEach(() => {
  db = fixture();
  // Persistence is mocked in this suite, including deferred refresh audit writes.
  jest.spyOn(audit, 'record').mockImplementation(() => {});
  io = { httpServer: new EventEmitter(), use(fn) { authenticate = fn; }, on(event, fn) { if (event === 'connection') connection = fn; },
    to: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), emit: jest.fn(), disconnectSockets: jest.fn(), fetchSockets: jest.fn(async () => []) };
  stop = handler(io);
});
afterEach(() => stop());
const socket = token => ({ handshake: { auth: { token } }, data: {}, id: 'test-socket', join: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), broadcast: { emit: jest.fn() }, on: jest.fn() });
test('modern handshake stores epoch/sid and joins both user and session rooms', async () => {
  const pair = await sessions.createSession(db.user); const client = socket(pair.token); const next = jest.fn();
  await authenticate(client, next); expect(next).toHaveBeenCalledWith(); connection(client);
  expect(client.data).toMatchObject({ sid: db.rows[0].sessionId, ver: 0 });
  expect(client.join).toHaveBeenCalledWith(`session:${db.rows[0].sessionId}`); expect(client.join).toHaveBeenCalledWith(db.user._id);
});
test.each(['expired', 'revoked', 'epoch', 'inactive', 'malformed'])('handshake rejects %s with stable machine-readable code', async kind => {
  const pair = await sessions.createSession(db.user);
  let token = pair.token;
  if (kind === 'expired') token = jwt.sign({ ...jwt.decode(token), iat: 1, exp: 2 }, process.env.JWT_SECRET);
  if (kind === 'revoked') db.rows[0].revokedAt = new Date();
  if (kind === 'epoch') db.user.tokenVersion++;
  if (kind === 'inactive') db.user.isActive = false;
  if (kind === 'malformed') token = 'invalid';
  const next = jest.fn(); await authenticate(socket(token), next);
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  expect(next.mock.calls[0][0].data.code).toBe(kind === 'expired' ? 'token_expired' : kind === 'malformed' ? 'invalid_token' : 'session_revoked');
});
test('idle check uses session existence: only revoked device disconnects', async () => {
  const pair = await sessions.createSession(db.user), other = await sessions.createSession(db.user);
  const a = socket(pair.token), b = socket(other.token);
  await authenticate(a, jest.fn()); await authenticate(b, jest.fn());
  db.rows[0].revokedAt = new Date(); io.fetchSockets.mockResolvedValue([a, b]);
  await handler.revalidateSessions(io);
  expect(a.disconnect).toHaveBeenCalledWith(true); expect(b.disconnect).not.toHaveBeenCalled();
});
test('database outage is session_error rather than destructive invalid_token', async () => {
  const pair = await sessions.createSession(db.user);
  require('../../../models/user.model').findById.mockReturnValue({ select: async () => { throw new Error('database unavailable'); } });
  const next = jest.fn(); await authenticate(socket(pair.token), next);
  expect(next.mock.calls[0][0].data.code).toBe('session_error');
});
test('idle expiry is recoverable token_expired and does not revoke refresh session', async () => {
  const pair = await sessions.createSession(db.user), a = socket(pair.token);
  await authenticate(a, jest.fn()); a.data.expiresAt = 1; io.fetchSockets.mockResolvedValue([a]);
  await handler.revalidateSessions(io);
  expect(a.emit).toHaveBeenCalledWith('session_revoked', expect.objectContaining({ code: 'token_expired' }));
  expect(db.rows[0].revokedAt).toBeNull();
  await expect(sessions.rotateSession(pair.refreshToken)).resolves.toHaveProperty('token');
});
