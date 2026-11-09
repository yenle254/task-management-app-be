const jwt = require('jsonwebtoken');
const tokens = require('../../../services/token.service');
const User = require('../../../models/user.model');
const Session = require('../../../models/refresh-session.model');
const user = { _id: 'a'.repeat(24), tokenVersion: 3, role: 'employee', email: 'private@example.com' };
const session = { sessionId: '12345678-1234-4234-9234-123456789012' };
const raw = changes => ({ ...jwt.decode(tokens.signAccessToken(user, session)), ...changes });
const sign = (payload, options = {}) => jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', ...options });
test('access has strict minimal claims, unique jti, configurable TTL <=15m and no PII', () => {
  const payload = tokens.verifyAccessToken(tokens.signAccessToken(user, session));
  expect(payload).toMatchObject({ sub: user._id, sid: session.sessionId, ver: 3, typ: 'access', iss: 'taskflow-api', aud: 'taskflow-client' });
  expect(payload.exp - payload.iat).toBe(900);
  expect(payload).not.toHaveProperty('email'); expect(payload).not.toHaveProperty('role');
  expect(jwt.decode(tokens.signAccessToken(user, session)).jti).not.toBe(payload.jti);
  expect(tokens.tokenConfig({ ACCESS_TOKEN_TTL: '5m' }).accessSeconds).toBe(300);
});
test.each(['iss', 'aud', 'typ', 'sid', 'sub', 'ver', 'jti', 'exp', 'iat'])('missing modern claim %s rejected', key => {
  const payload = raw(); delete payload[key];
  expect(() => tokens.verifyAccessToken(sign(payload, key === 'iat' ? { noTimestamp: true } : {}))).toThrow();
});
test.each([{ iss: 'other' }, { aud: 'other' }, { typ: 'refresh' }, { ver: -1 }, { ver: '3' }, { sub: 'invalid' }, { sid: '' }, { jti: '' }, { exp: Math.floor(Date.now() / 1000) + 1000 }])('invalid modern claims %j rejected', changes => {
  expect(() => tokens.verifyAccessToken(sign(raw(changes)))).toThrow();
});
test.each(['HS384', 'HS512', 'none'])('algorithm %s rejected', algorithm => {
  expect(() => tokens.verifyAccessToken(jwt.sign(raw(), algorithm === 'none' ? null : process.env.JWT_SECRET, { algorithm }))).toThrow();
});
test('wrong secret, malformed token, expired token rejected with safe codes', () => {
  for (const token of ['bad', jwt.sign(raw(), 'other-secret')]) expect(() => tokens.verifyAccessToken(token)).toThrow();
  try { tokens.verifyAccessToken(sign(raw({ iat: 1, exp: 2 }))); } catch (error) { expect(error.code).toBe('token_expired'); }
});
test('bounded legacy tokens remain valid but cannot bypass a malformed modern claim', () => {
  const iat = Math.floor(Date.now() / 1000);
  const old = sign({ id: user._id, email: user.email, role: user.role, iat, exp: iat + 3600 });
  expect(tokens.verifyAccessToken(old)).toMatchObject({ sub: user._id, ver: 0, legacy: true });
  expect(() => tokens.verifyAccessToken(sign({ id: user._id, typ: 'refresh', iat, exp: iat + 3600 }))).toThrow();
  const previous = process.env.ACCEPT_LEGACY_TOKENS;
  process.env.ACCEPT_LEGACY_TOKENS = 'false';
  try { expect(() => tokens.verifyAccessToken(old)).toThrow(); }
  finally { if (previous === undefined) delete process.env.ACCEPT_LEGACY_TOKENS; else process.env.ACCEPT_LEGACY_TOKENS = previous; }
});
test('configuration fails fast for weak secret and unsafe TTL', () => {
  expect(() => tokens.validateTokenConfig({ JWT_SECRET: 'short' })).toThrow(/32 bytes/);
  expect(() => tokens.validateTokenConfig({ JWT_SECRET: 'a'.repeat(32) })).not.toThrow();
  for (const ttl of ['16m', '0', '-1', 'forever']) expect(() => tokens.tokenConfig({ ACCESS_TOKEN_TTL: ttl })).toThrow();
});
test('opaque token has 384 bits, unique random values and only irreversible digest stored', () => {
  const a = tokens.generateRefreshToken(), b = tokens.generateRefreshToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/); expect(a).not.toBe(b);
  expect(tokens.hashRefreshToken(a)).toMatch(/^[a-f0-9]{64}$/); expect(tokens.hashRefreshToken(a)).not.toBe(a);
  expect(tokens.validRefreshToken({})).toBe(false);
});
test('schema hides credentials and declares TTL/indexes without connecting to a database', () => {
  expect(User.schema.path('tokenVersion').options.select).toBe(false);
  expect(User.schema.path('resetPassword').options.select).toBe(false);
  const value = new User({ ...user, password: 'secret', resetPassword: { otp: '123456', resetToken: 'secret' } }).toJSON();
  expect(value).not.toHaveProperty('password'); expect(value).not.toHaveProperty('resetPassword'); expect(value).not.toHaveProperty('tokenVersion');
  expect(Session.schema.indexes()).toEqual(expect.arrayContaining([[{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]]));
  expect(Session.schema.path('tokenHash').options.select).toBe(false);
});
