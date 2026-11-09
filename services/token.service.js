const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const objectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const authError = (code = 'invalid_token', message = 'Invalid or expired token', statusCode = 401) => Object.assign(new Error(message), { code, statusCode });
const seconds = (value, fallback, max) => {
  const input = String(value || fallback);
  const match = /^(\d+)(s|m|h|d)?$/.exec(input);
  const amount = match && Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2] || 's']);
  if (!amount || amount > max) throw new Error('Invalid token lifetime configuration');
  return amount;
};
function tokenConfig(env = process.env) {
  return { accessSeconds: seconds(env.ACCESS_TOKEN_TTL, '15m', 900), refreshSeconds: seconds(env.REFRESH_TOKEN_TTL, '30d', 90 * 86400),
    graceSeconds: seconds(env.REFRESH_GRACE_SECONDS, '60', 300), issuer: env.JWT_ISSUER || 'taskflow-api', audience: env.JWT_AUDIENCE || 'taskflow-client' };
}
function validateTokenConfig(env = process.env) {
  tokenConfig(env);
  if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes; use a cryptographically random secret');
}
function signAccessToken(user, session) {
  const config = tokenConfig();
  return jwt.sign({ sid: session.sessionId, ver: user.tokenVersion ?? 0, typ: 'access' }, process.env.JWT_SECRET,
    { algorithm: 'HS256', subject: String(user._id), issuer: config.issuer, audience: config.audience,
      jwtid: crypto.randomUUID(), expiresIn: config.accessSeconds });
}
function verifyAccessToken(token) {
  try {
    const config = tokenConfig();
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded || typeof decoded !== 'object' || !Number.isInteger(decoded.iat) || !Number.isInteger(decoded.exp) || decoded.exp <= decoded.iat || decoded.iat > Math.floor(Date.now() / 1000) + 30) throw authError();
    // Bounded rollout exception for the old id/iat/exp tokens only. Never treat a malformed modern token as legacy.
    const legacy = decoded.typ === undefined && decoded.sub === undefined && decoded.sid === undefined && decoded.ver === undefined &&
      decoded.iss === undefined && decoded.aud === undefined && decoded.jti === undefined;
    if (legacy) {
      const cutoff = Date.parse(process.env.LEGACY_TOKEN_ISSUED_BEFORE || '2026-11-07T23:59:59Z') / 1000;
      if (process.env.ACCEPT_LEGACY_TOKENS === 'false' || !Number.isFinite(cutoff) || !objectId(decoded.id) ||
        decoded.iat > cutoff || decoded.exp - decoded.iat > 7 * 86400 || Date.now() / 1000 > cutoff + 7 * 86400) throw authError();
      return { ...decoded, sub: decoded.id, ver: 0, legacy: true };
    }
    if (!objectId(decoded.sub) || typeof decoded.sid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(decoded.sid) ||
      !Number.isSafeInteger(decoded.ver) || decoded.ver < 0 || decoded.typ !== 'access' ||
      decoded.iss !== config.issuer || decoded.aud !== config.audience || typeof decoded.jti !== 'string' || !decoded.jti ||
      decoded.exp - decoded.iat > 900) throw authError();
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') throw authError('token_expired', 'Token has expired');
    throw authError();
  }
}
const generateRefreshToken = () => crypto.randomBytes(48).toString('base64url');
const hashRefreshToken = value => crypto.createHash('sha256').update(value).digest('hex');
const validRefreshToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{64}$/.test(value);
module.exports = { tokenConfig, validateTokenConfig, signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken, validRefreshToken, authError };
