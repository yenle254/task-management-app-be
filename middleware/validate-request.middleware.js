/**
 * validateRequest.js
 * Middleware to handle express-validator validation errors
 */

const { validationResult } = require('express-validator');

/**
 * Middleware to check validation results
 * If validation fails, returns structured error response
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // Format errors into structured array
    const formattedErrors = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg,
      value: err.value
    }));

    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: formattedErrors
    });
  }

  next();
};

/**
 * Helper to format Mongoose validation errors
 */
const formatMongooseError = (error) => {
  const errors = [];

  if (error.errors) {
    Object.keys(error.errors).forEach(key => {
      errors.push({
        field: key,
        message: error.errors[key].message
      });
    });
  }

  return errors;
};

/**
 * Async handler wrapper to avoid try-catch in every controller
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  validateRequest,
  formatMongooseError,
  asyncHandler
};
