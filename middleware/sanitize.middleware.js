const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const pollutionGuard = hpp({ checkBody: false });

function hasUnsafeKeys(value, depth = 0) {
  if (!value || typeof value !== 'object') return false;
  if (depth > 32) return true;
  return Object.keys(value).some(key => key.includes('$') ||
    key.split(/[.\[\]]/).some(segment => forbidden.has(segment)) || hasUnsafeKeys(value[key], depth + 1));
}

function validateInput(req, res, next) {
  if ([req.body, req.query, req.params].some(value => hasUnsafeKeys(value))) {
    return res.status(400).json({ success: false, error: 'Validation failed',
      errors: [{ field: 'input', message: 'Unsupported input keys' }] });
  }
  // Use the pure API: the package middleware assigns req.query, an Express 5 getter.
  for (const source of [req.body, req.query, req.params]) {
    if (source) mongoSanitize.sanitize(source, { allowDots: true, replaceWith: '_' });
  }
  next();
}

function sanitizeInput(req, res, next) {
  // Materialize once so sanitization and express-validator see the same query object.
  Object.defineProperty(req, 'query', { value: req.query, writable: true, configurable: true, enumerable: true });
  validateInput(req, res, () => pollutionGuard(req, res, next));
}
module.exports = sanitizeInput;
module.exports.validateInput = validateInput;
module.exports.hasUnsafeKeys = hasUnsafeKeys;
