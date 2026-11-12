const crypto = require('crypto');
const User = require('../models/user.model');
const Session = require('../models/refresh-session.model');
const tokens = require('./token.service');
const audit = require('./audit.service');
const invalid = () => tokens.authError('refresh_invalid', 'Invalid or expired refresh token');
const ioOf = req => req?.app?.get('io');
function disconnect(io, room, reason, code = 'session_revoked') {
  if (!io) return;
  io.to(room).emit('session_revoked', { reason, code });
  io.in(room).disconnectSockets(true);
}
const liveUser = id => User.findById(id).select('+tokenVersion');
async function checkUserVersion(userId, version) {
  const user = await liveUser(userId);
  if (!user?.isActive || (user.tokenVersion ?? 0) !== version) throw invalid();
  return user;
}
function response(user, session, refreshToken) {
  return { token: tokens.signAccessToken(user, session), refreshToken, expiresIn: tokens.tokenConfig().accessSeconds };
}
async function createSession(user, req) {
  const refreshToken = tokens.generateRefreshToken();
  const version = user.tokenVersion ?? 0;
  const session = await Session.create({ userId: user._id, sessionId: crypto.randomUUID(), tokenVersion: version,
    tokenHash: tokens.hashRefreshToken(refreshToken), expiresAt: new Date(Date.now() + tokens.tokenConfig().refreshSeconds * 1000),
    deviceName: typeof req?.body?.deviceName === 'string' ? req.body.deviceName.slice(0, 100) : null,
    userAgent: req?.get?.('user-agent')?.slice(0, 300) || null, ip: req?.ip?.slice(0, 64) || null });
  // A concurrent password reset/deactivation must not mint a usable new session.
  try { await checkUserVersion(user._id, version); }
  catch (error) { await Session.updateOne({ sessionId: session.sessionId }, { $set: { revokedAt: new Date(), revokedReason: 'identity_changed' } }); throw error; }
  return response(user, session, refreshToken);
}
async function revokeSession(sessionId, userId, reason = 'logout', io) {
  const result = await Session.updateOne({ sessionId, userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  if (result.matchedCount) disconnect(io, `session:${sessionId}`, reason);
}
async function revokeAllSessions(userId, reason, req, { increment = true } = {}) {
  // Epoch is the authority if session cleanup fails or races a refresh.
  const user = increment ? await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } }, { new: true }).select('+tokenVersion') : await liveUser(userId);
  disconnect(ioOf(req), String(userId), reason);
  await Session.updateMany({ userId, revokedAt: null, tokenVersion: { $lt: user?.tokenVersion ?? 0 } },
    { $set: { revokedAt: new Date(), revokedReason: reason } });
  return user;
}
async function rotateSession(refreshToken, req) {
  if (process.env.REFRESH_ENABLED === 'false') throw tokens.authError('refresh_disabled', 'Refresh is disabled', 503);
  if (!tokens.validRefreshToken(refreshToken)) throw invalid();
  const hash = tokens.hashRefreshToken(refreshToken);
  const now = new Date();
  const current = await Session.findOne({ $or: [{ tokenHash: hash }, { 'usedTokens.hash': hash }] }).select('+tokenHash +usedTokens');
  if (!current || current.revokedAt || current.expiresAt <= now) throw invalid();
  const user = await checkUserVersion(current.userId, current.tokenVersion);
  if (current.tokenHash !== hash) {
    const previous = current.usedTokens.find(item => item.hash === hash);
    if (previous?.validUntil > now) throw tokens.authError('refresh_retry', 'Refresh token already rotated', 409);
    await revokeAllSessions(current.userId, 'token_reuse', req);
    audit.record({ ...req, user }, { action: 'security.token_reuse_detected', outcome: 'denied', metadata: { sessionId: current.sessionId } });
    throw tokens.authError('token_reuse', 'Session revoked');
  }
  const nextToken = tokens.generateRefreshToken();
  const validUntil = new Date(now.getTime() + tokens.tokenConfig().graceSeconds * 1000);
  const rotated = await Session.findOneAndUpdate({ _id: current._id, tokenHash: hash, revokedAt: null, expiresAt: { $gt: now }, rotations: { $lt: 10000 } },
    { $set: { tokenHash: tokens.hashRefreshToken(nextToken), previousTokenHash: hash, previousValidUntil: validUntil, rotatedAt: now, lastUsedAt: now },
      $push: { usedTokens: { hash, validUntil } }, $inc: { rotations: 1 } }, { new: true });
  if (!rotated) {
    const latest = await Session.findOne({ sessionId: current.sessionId }).select('+usedTokens');
    if (!latest || latest.revokedAt || latest.expiresAt <= now) throw invalid();
    if (latest.usedTokens.some(item => item.hash === hash && item.validUntil > now)) throw tokens.authError('refresh_retry', 'Refresh token already rotated', 409);
    throw invalid();
  }
  await checkUserVersion(user._id, current.tokenVersion);
  audit.record({ ...req, user }, { action: 'auth.refreshed', metadata: { sessionId: current.sessionId } });
  return response(user, rotated, nextToken);
}
async function assertAccessSession(decoded, user) {
  if ((decoded.ver ?? 0) !== (user.tokenVersion ?? 0)) throw tokens.authError('session_revoked', 'Session revoked');
  // Per-session lookup intentionally adds one read: single-device logout must invalidate access tokens too.
  if (decoded.sid && !await Session.exists({ sessionId: decoded.sid, userId: user._id, tokenVersion: decoded.ver, revokedAt: null, expiresAt: { $gt: new Date() } })) {
    throw tokens.authError('session_revoked', 'Session revoked');
  }
}
async function logout(refreshToken, accessToken, req) {
  let session;
  if (tokens.validRefreshToken(refreshToken)) {
    const hash = tokens.hashRefreshToken(refreshToken);
    session = await Session.findOne({ $or: [{ tokenHash: hash }, { 'usedTokens.hash': hash }] });
  } else if (accessToken) {
    try {
      const decoded = tokens.verifyAccessToken(accessToken);
      if (decoded.sid) session = { sessionId: decoded.sid, userId: decoded.sub };
      else await revokeAllSessions(decoded.sub, 'legacy_logout', req);
    } catch (error) { if (!error.statusCode) throw error; }
  }
  if (session) await revokeSession(session.sessionId, session.userId, 'logout', ioOf(req));
  audit.record(req, { action: 'auth.logged_out' });
}
const listSessions = userId => Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
  .select('sessionId deviceName createdAt lastUsedAt expiresAt').lean();
module.exports = { createSession, rotateSession, revokeSession, revokeAllSessions, assertAccessSession, logout, listSessions };
