const jwt = require('jsonwebtoken');
const tokens = require('../services/token.service');
const sessions = require('../services/session.service');
const publicUser = user => {
  const value = user.toObject ? user.toObject() : { ...user };
  for (const key of ['password', 'resetPassword', 'tokenVersion', 'pushToken', 'reminders', 'leaveBalanceOperations']) delete value[key];
  return value;
};
const sendTokenResponse = async (user, statusCode, res, req) => {
  const pair = await sessions.createSession(user, req);
  res.status(statusCode).json({ success: true, ...pair, user: publicUser(user) });
};
module.exports = { verifyToken: tokens.verifyAccessToken, sendTokenResponse, publicUser, decodeToken: token => jwt.decode(token) };
