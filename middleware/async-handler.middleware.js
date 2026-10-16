/**
 * Wraps async route handlers to catch errors and pass them to next()
 * Ensures async rejections are properly forwarded to the global error handler
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
const asyncHandler = (fn) => (...args) => {
  Promise.resolve().then(() => fn(...args)).catch(args[2]);
};

module.exports = asyncHandler;
