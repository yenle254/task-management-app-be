/**
 * Rate Limiting Middleware
 * Four levels:
 *  - strict: registration only (5 / 15 min / IP)
 *  - general: normal API endpoints (1000 / 15 min / IP)
 *  - notificationRead:  frequently-polled notification read endpoints
 *                       (3000 / 15 min / IP) - badge/polling can be high volume
 *  - auth: login and password recovery (30 / 15 min / IP)
 */
const rateLimit = require('express-rate-limit');
const { TIME } = require('../utils/constants.utils');

/**
 * General rate limiter for normal API endpoints
 * - 1000 requests per 15 minutes per IP
 */
const generalLimiter = rateLimit({
  windowMs: TIME.RATE_LIMIT_WINDOW_MS,
  max: 1000,
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
    retryAfter: TIME.RATE_LIMIT_WINDOW_MS / 1000
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test'
});

/**
 * Notification read-rate limiter
 * - 3000 requests per 15 minutes per IP
 * - Higher than generalLimiter because the unread-count badge and
 *   mark-as-read actions are frequently called from the same client
 *   (header badge, dropdown, list page, websocket-triggered refetch,
 *   React StrictMode double-mount in dev). The limit remains finite.
 */
const notificationReadLimiter = rateLimit({
  windowMs: TIME.RATE_LIMIT_WINDOW_MS,
  max: 3000,
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
    retryAfter: TIME.RATE_LIMIT_WINDOW_MS / 1000
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test'
});

/**
 * Strict rate limiter for account registration (preserved)
 * - 5 requests per 15 minutes per IP
 */
const strictLimiter = rateLimit({
  windowMs: TIME.RATE_LIMIT_WINDOW_MS,
  max: 5,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfter: TIME.RATE_LIMIT_WINDOW_MS / 1000
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test'
});

/**
 * Login and password recovery use a separate budget from registration.
 * - 30 requests per 15 minutes per IP, shared across these auth endpoints.
 */
const authLimiter = rateLimit({
  windowMs: TIME.RATE_LIMIT_WINDOW_MS,
  max: 30,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfter: TIME.RATE_LIMIT_WINDOW_MS / 1000
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test'
});

const auditLimiter = rateLimit({
  windowMs: TIME.RATE_LIMIT_WINDOW_MS, max: 60,
  message: { success: false, error: 'Too many audit requests. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test'
});

module.exports = {
  auditLimiter,
  generalLimiter,
  notificationReadLimiter,
  strictLimiter,
  authLimiter
};
