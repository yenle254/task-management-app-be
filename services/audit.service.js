const mongoose = require('mongoose');
const AuditLog = require('../models/audit-log.model');
const logger = require('../utils/logger.utils');
const { AUDIT_ACTIONS } = require('../utils/constants.utils');
const { redactMeta, isSensitiveKey } = require('../utils/redact.utils');
const { FIELDS, snapshot, diff } = require('../utils/audit-field.helper');
const { normalizeRoute } = require('../middleware/request-logger.middleware');

const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : null;
const objectId = value => mongoose.isObjectIdOrHexString(value?._id || value) ? String(value?._id || value) : null;
function maskEmail(value) {
  if (typeof value !== 'string') return '*@*';
  const match = value.trim().match(/^([^\s@]+)@([^\s@]+\.[^\s@]+)$/);
  return match ? `${match[1][0]}***@${match[2].slice(0, 255)}` : '*@*';
}
// Remove sensitive keys, cap depth/width/value size and total UTF-8 bytes.
function bounded(value, maxBytes = 4096) {
  let truncated = false;
  const seen = new WeakSet();
  function visit(item, depth) {
    if (typeof item === 'string') { if (item.length > 500) truncated = true; return item.slice(0, 500); }
    if (item == null) return null;
    if (item instanceof Date) return item.toISOString();
    if (item._bsontype === 'ObjectId') return String(item);
    if (typeof item !== 'object') return ['number', 'boolean'].includes(typeof item) ? item : null;
    if (depth > 3 || seen.has(item)) { truncated = true; return '[Truncated]'; }
    seen.add(item);
    const entries = Object.entries(item);
    if (entries.length > 30) truncated = true;
    const safe = entries.slice(0, 30).filter(([key]) => !isSensitiveKey(key));
    const result = Array.isArray(item) ? safe.map(([, v]) => visit(v, depth + 1)) : Object.fromEntries(safe.map(([k, v]) => [k.slice(0, 100), visit(v, depth + 1)]));
    seen.delete(item);
    return result;
  }
  const result = visit(value || {}, 0);
  const out = result && typeof result === 'object' && !Array.isArray(result) ? result : { value: result };
  while (Buffer.byteLength(JSON.stringify(out)) > maxBytes - 20) { delete out[Object.keys(out).at(-1)]; truncated = true; }
  if (truncated) out.truncated = true;
  return out;
}
function context(req = {}) {
  return { requestId: text(req.requestId, 128), ip: text(req.ip, 64), userAgent: text(req.headers?.['user-agent'], 512),
    method: text(req.method, 16), route: text(req.route ? normalizeRoute(req) : (req.originalUrl?.split('?')[0] || normalizeRoute(req)), 500) };
}
function record(req = {}, event = {}) {
  const failure = () => { try { logger.error('audit_write_failed', redactMeta({ action: event.action, requestId: req.requestId })); } catch (_) { /* logging must not fail business */ } };
  try {
    const catalog = AUDIT_ACTIONS[event.action];
    if (!catalog) throw new Error('Unknown audit action');
    const actor = req.user;
    const allowed = FIELDS[event.target?.type] || [];
    const changes = (event.changes || []).filter(change => allowed.includes(change.field) && !isSensitiveKey(change.field)).slice(0, 20)
      .map(change => ({ field: change.field, from: bounded({ value: change.from }, 2048).value ?? null, to: bounded({ value: change.to }, 2048).value ?? null }));
    const doc = { at: new Date(), action: event.action, ...catalog, outcome: event.outcome || 'success',
      actor: { id: objectId(actor?._id), role: text(actor?.role), name: text(actor?.profile?.fullName), email: text(actor?.email) },
      target: { type: text(event.target?.type, 40), id: objectId(event.target?.id), label: text(event.target?.label) },
      changes, reason: text(event.reason, event.action === 'task.review_rejected' ? 1000 : 500), metadata: bounded(redactMeta(event.metadata)), context: context(req) };
    // No mutable request/document is retained by the deferred insert or its catch.
    const failureMeta = { action: doc.action, requestId: doc.context.requestId };
    setImmediate(() => {
      Promise.resolve().then(() => AuditLog.create(doc)).catch(() => {
        try { logger.error('audit_write_failed', failureMeta); } catch (_) { /* no unhandled rejection */ }
      });
    });
  } catch (_) { failure(); }
}
function recordSystem(event) { record({ user: { role: 'system' } }, event); }
function target(type, document) {
  return { type, id: objectId(document?._id), label: text(document?.name || document?.title || document?.profile?.fullName || document?.type) };
}
function changed(req, action, type, before, after, extras = {}) {
  try {
    record(req, { action, target: target(type, after || before), changes: diff(before, after, FIELDS[type]), ...extras });
  } catch (_) {
    // Preparing a diff is part of the audit pipeline too, never a business failure.
    try { logger.error('audit_write_failed', { action: text(action), requestId: text(req?.requestId, 128) }); } catch (_) { /* best effort */ }
  }
}
async function list(filters = {}, fixedTarget) {
  const query = {};
  for (const key of ['action', 'category', 'outcome', 'severity']) if (filters[key]) query[key] = filters[key];
  for (const [key, field] of [['actorId', 'actor.id'], ['targetType', 'target.type'], ['targetId', 'target.id']]) if (filters[key]) query[field] = filters[key];
  if (fixedTarget) Object.assign(query, { 'target.type': fixedTarget.type, 'target.id': fixedTarget.id });
  if (filters.from && filters.to) query.at = { $gte: new Date(filters.from), $lt: new Date(filters.to) };
  const page = Number(filters.page || 1), limit = Number(filters.limit || 10);
  const [data, total] = await Promise.all([AuditLog.find(query).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(query)]);
  return { success: true, data, count: data.length, total, page, pages: Math.ceil(total / limit) };
}
module.exports = { record, recordSystem, diff, snapshot, FIELDS, target, changed, context, maskEmail, bounded, text, list,
  getById: id => AuditLog.findById(id).lean(),
  // Deployment declaration only; never trust an arbitrary forwarded header or change Express globally.
  trustProxyDeclaration: () => process.env.AUDIT_TRUST_PROXY || 'false' };
