// Shared by operational logging and audit. Test key segments, never secret values.
const SENSITIVE_KEY_PATTERN = /^(password|passwordHash|token|otp|refresh[_-]?token|access[_-]?token|id[_-]?token|reset[_-]?token|authorization|cookie|push[_-]?token.*|client[_-]?secret|resetPassword|reminders|leaveBalanceOperations|notificationPreferences)$/i;
const isSensitiveKey = key => String(key).split('.').some(part => SENSITIVE_KEY_PATTERN.test(part));

function redactMeta(meta, seen = new WeakSet()) {
  if (!meta || typeof meta !== 'object' || meta instanceof Error || meta instanceof Date) return meta;
  if (seen.has(meta)) return '[Circular]';
  seen.add(meta);
  const out = Array.isArray(meta) ? meta.map(value => redactMeta(value, seen)) : Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [key, isSensitiveKey(key) ? '[REDACTED]' : redactMeta(value, seen)]));
  seen.delete(meta);
  return out;
}
module.exports = { redactMeta, isSensitiveKey, SENSITIVE_KEY_PATTERN };
