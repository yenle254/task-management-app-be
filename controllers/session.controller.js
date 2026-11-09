const sessions = require('../services/session.service');
const audit = require('../services/audit.service');
const handler = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Unable to process session', code: error.code || 'session_error' }); }
};
exports.refresh = handler(async (req, res) => res.json({ success: true, ...await sessions.rotateSession(req.body.refreshToken, req) }));
exports.logout = handler(async (req, res) => {
  await sessions.logout(req.body?.refreshToken, req.headers.authorization?.replace(/^Bearer\s+/i, ''), req);
  res.json({ success: true, message: 'Logged out' });
});
exports.logoutAll = handler(async (req, res) => {
  await sessions.revokeAllSessions(req.user._id, 'logout_all', req);
  audit.record(req, { action: 'auth.logged_out_all' });
  res.json({ success: true, message: 'All sessions revoked' });
});
exports.list = handler(async (req, res) => res.json({ success: true, data: await sessions.listSessions(req.user._id) }));
exports.revoke = handler(async (req, res) => {
  await sessions.revokeSession(req.params.sessionId, req.user._id, 'device_revoked', req.app?.get('io'));
  res.json({ success: true, message: 'Session revoked' });
});
