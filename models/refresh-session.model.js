const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true, unique: true },
  tokenVersion: { type: Number, required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  previousTokenHash: { type: String, default: null, select: false },
  previousValidUntil: Date,
  usedTokens: { type: [new mongoose.Schema({ hash: String, validUntil: Date }, { _id: false })], default: [], select: false },
  rotations: { type: Number, default: 0 },
  deviceName: { type: String, maxlength: 100, default: null },
  userAgent: { type: String, maxlength: 300, default: null },
  ip: { type: String, maxlength: 64, default: null },
  lastUsedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  rotatedAt: Date, revokedAt: { type: Date, default: null }, revokedReason: String,
}, { timestamps: true, collection: 'refresh_sessions' });
schema.set('toJSON', { transform: (_doc, value) => {
  for (const key of ['tokenHash', 'previousTokenHash', 'usedTokens', 'tokenVersion']) delete value[key];
  return value;
} });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ userId: 1, revokedAt: 1 });
schema.index({ 'usedTokens.hash': 1 });
module.exports = mongoose.model('RefreshSession', schema);
