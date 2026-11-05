const mongoose = require('mongoose');
const { AUDIT_ACTIONS } = require('../utils/constants.utils');
const AuditLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, required: true },
  action: { type: String, enum: Object.keys(AUDIT_ACTIONS), required: true },
  category: { type: String, enum: ['auth', 'user', 'admin', 'team', 'task', 'leave', 'attendance', 'office', 'security', 'system'], required: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
  outcome: { type: String, enum: ['success', 'failure', 'denied'], required: true },
  actor: { id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, role: String, name: String, email: String },
  target: { type: { type: String, default: null }, id: { type: mongoose.Schema.Types.ObjectId, default: null }, label: { type: String, maxlength: 500, default: null } },
  changes: [{ field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed, _id: false }],
  reason: { type: String, maxlength: 1000, default: null },
  metadata: mongoose.Schema.Types.Mixed,
  context: { requestId: String, ip: { type: String, maxlength: 64 }, userAgent: { type: String, maxlength: 512, default: null }, method: String, route: String }
}, { collection: 'audit_logs', versionKey: false });
AuditLogSchema.index({ at: -1, _id: -1 });
AuditLogSchema.index({ 'actor.id': 1, at: -1 });
AuditLogSchema.index({ 'target.type': 1, 'target.id': 1, at: -1 });
AuditLogSchema.index({ category: 1, action: 1, at: -1 });
AuditLogSchema.index({ outcome: 1, at: -1 });
const rejectMutation = () => { throw new Error('Audit logs are append-only through Mongoose'); };
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace']) {
  AuditLogSchema.pre(operation, { document: true, query: true }, rejectMutation);
}
AuditLogSchema.pre('save', function () { if (!this.isNew) rejectMutation(); });
AuditLogSchema.pre('bulkWrite', function (next, operations) {
  if (operations.some(operation => !operation.insertOne)) return next(new Error('Audit logs are append-only through Mongoose'));
  next();
});
// Raw collection/driver/shell writes bypass these hooks. This is not DB immutability.
module.exports = mongoose.model('AuditLog', AuditLogSchema);
