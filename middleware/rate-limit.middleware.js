/**
 * Rate Limiting Middleware
 * Three levels:
 *  - strict:  auth endpoints (5 / 15 min / IP)
 *  - general: normal API endpoints (100 / 15 min / IP)
 *  - notificationRead:  frequently-polled notification read endpoints
 *                       (300 / 15 min / IP) - badge/polling can be high volume
 */
const rateLimit = require('express-rate-limit');
const { TIME } = require('../utils/constants.utils');

/**
 * General rate limiter for normal API endpoints
 * - 100 requests per 15 minutes per IP
 */
const generalLimiter = rateLimit({
  windowMs: TIME.RATE_LIMIT_WINDOW_MS,
  max: 100,
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
 * - 300 requests per 15 minutes per IP
 * - Higher than generalLimiter because the unread-count badge and
 *   mark-as-read actions are frequently called from the same client
 *   (header badge, dropdown, list page, websocket-triggered refetch,
 *   React StrictMode double-mount in dev). 300/15min is still well
 *   below abusive thresholds.
 */
const notificationReadLimiter = rateLimit({
  windowMs: TIME.RATE_LIMIT_WINDOW_MS,
  max: 300,
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
 * Strict rate limiter for authentication endpoints
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

module.exports = {
  generalLimiter,
  notificationReadLimiter,
  strictLimiter
};
