/**
 * auth.validators.js
 * Validation rules for authentication endpoints
 */

const { body, param, validationResult } = require('express-validator');
const User = require('../models/user.model');
const { PASSWORD, USER_ROLES } = require('../utils/constants.utils');

/**
 * Validation chain for user registration
 */
const registerValidation = [
  body('email')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail({ gmail_remove_dots: false })
    .isLength({ max: 255 }).withMessage('Email must be at most 255 characters')
    .custom(async (email) => {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        throw new Error('Email already registered');
      }
      return true;
    }),

  body('password').isString().withMessage('Must be a string').bail()
    .notEmpty().withMessage('Password is required')
    .isLength({ min: PASSWORD.MIN_LENGTH, max: PASSWORD.MAX_LENGTH })
    .withMessage(`Password must be between ${PASSWORD.MIN_LENGTH} and ${PASSWORD.MAX_LENGTH} characters`),

  body('role')
    .optional()
    .isIn(Object.values(USER_ROLES).filter(r => r !== USER_ROLES.SYSTEM_ADMIN))
    .withMessage('Invalid role'),

  body('profile.fullName')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Full name is required')
    .isLength({ min: 3, max: 100 }).withMessage('Full name must be between 3 and 100 characters'),

  body('profile.employeeId')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Employee ID is required')
    .isLength({ max: 50 }).withMessage('Employee ID must be at most 50 characters'),

  body('profile.department')
    .optional()
    .isString().withMessage('Must be a string').bail()
    .trim()
    .isLength({ max: 100 }).withMessage('Department must be at most 100 characters'),

  body('profile.position')
    .optional()
    .isString().withMessage('Must be a string').bail()
    .trim()
    .isLength({ max: 100 }).withMessage('Position must be at most 100 characters'),

  body('profile.phone')
    .optional()
    .isString().withMessage('Must be a string').bail()
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/).withMessage('Invalid phone number format')
];

/**
 * Validation chain for user login
 */
const loginValidation = [
  body('email')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail({ gmail_remove_dots: false }),

  body('password')
    .isString().withMessage('Password must be a string').bail()
    .notEmpty().withMessage('Password is required')
];

/**
 * Validation chain for forgot password
 */
const forgotPasswordValidation = [
  body('email')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail({ gmail_remove_dots: false })
];

/**
 * Validation chain for OTP verification
 */
const verifyOTPValidation = [
  body('email')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail({ gmail_remove_dots: false }),

  body('otp')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('OTP is required')
    .isLength({ min: PASSWORD.OTP_LENGTH, max: PASSWORD.OTP_LENGTH })
    .withMessage(`OTP must be ${PASSWORD.OTP_LENGTH} digits`)
    .isNumeric().withMessage('OTP must be numeric')
];

/**
 * Validation chain for password reset
 */
const resetPasswordValidation = [
  body('email')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail({ gmail_remove_dots: false }),

  body('resetToken')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Reset token is required'),

  body('newPassword').isString().withMessage('Must be a string').bail()
    .notEmpty().withMessage('New password is required')
    .isLength({ min: PASSWORD.MIN_LENGTH, max: PASSWORD.MAX_LENGTH })
    .withMessage(`Password must be between ${PASSWORD.MIN_LENGTH} and ${PASSWORD.MAX_LENGTH} characters`)
];

/**
 * Validation chain for changing password (authenticated)
 */
const changePasswordValidation = [
  body('oldPassword')
    .isString().withMessage('Password must be a string').bail()
    .notEmpty().withMessage('Old password is required'),

  body('newPassword').isString().withMessage('Must be a string').bail()
    .notEmpty().withMessage('New password is required')
    .isLength({ min: PASSWORD.MIN_LENGTH, max: PASSWORD.MAX_LENGTH })
    .withMessage(`Password must be between ${PASSWORD.MIN_LENGTH} and ${PASSWORD.MAX_LENGTH} characters`)
    .custom((value, { req }) => {
      if (value === req.body.oldPassword) {
        throw new Error('New password must be different from old password');
      }
      return true;
    })
];

/**
 * Validation chain for updating profile
 */
const updateProfileValidation = [
  body('fullName')
    .optional()
    .isString().withMessage('Must be a string').bail()
    .trim()
    .isLength({ min: 3, max: 100 }).withMessage('Full name must be between 3 and 100 characters'),

  body('department')
    .optional({ nullable: true, checkFalsy: true })
    .isString().withMessage('Must be a string').bail()
    .trim()
    .isLength({ max: 100 }).withMessage('Department must be at most 100 characters'),

  body('position')
    .optional({ nullable: true, checkFalsy: true })
    .isString().withMessage('Must be a string').bail()
    .trim()
    .isLength({ max: 100 }).withMessage('Position must be at most 100 characters'),

  body('phone')
    .optional({ nullable: true, checkFalsy: true })
    .isString().withMessage('Must be a string').bail()
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/).withMessage('Invalid phone number format'),

  body('avatar')
    .optional({ nullable: true, checkFalsy: true })
    .isString().withMessage('Must be a string').bail()
    .trim()
    .isURL().withMessage('Avatar must be a valid URL')
];

const refreshTokenValidation = [
  body('refreshToken').isString().withMessage('Refresh token must be a string').bail()
    .matches(/^[A-Za-z0-9_-]{64}$/).withMessage('Invalid refresh token format')
];
// Logout deliberately accepts unknown/malformed credentials and returns200 (idempotent, no token oracle).
// Coerce only the optional credential; non-scalar bodies never reach a database query.
const logoutValidation = [body('refreshToken').optional().customSanitizer(value => typeof value === 'string' && value.length <= 256 ? value : undefined)];

module.exports = {
  refreshTokenValidation,
  logoutValidation,
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyOTPValidation,
  resetPasswordValidation,
  changePasswordValidation,
  updateProfileValidation
};
