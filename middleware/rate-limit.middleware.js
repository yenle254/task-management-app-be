/**
 * Rate Limiting Middleware
 * Two levels: general (normal APIs) and strict (auth APIs)
 */
const rateLimit = require('express-rate-limit');

/**
 * General rate limiter for normal API endpoints
 * - 100 requests per 15 minutes per IP
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
    retryAfter: 15 * 60 // seconds
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting in test environment
    return process.env.NODE_ENV === 'test';
  }
});

/**
 * Strict rate limiter for authentication endpoints
 * - 5 requests per 15 minutes per IP
 * - Prevents brute force, credential stuffing, OTP abuse
 */
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfter: 15 * 60 // seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  }
});

module.exports = {
  generalLimiter,
  strictLimiter
};
