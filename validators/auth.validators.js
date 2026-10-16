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
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email must be at most 255 characters')
    .custom(async (email) => {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        throw new Error('Email already registered');
      }
      return true;
    }),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: PASSWORD.MIN_LENGTH, max: PASSWORD.MAX_LENGTH })
    .withMessage(`Password must be between ${PASSWORD.MIN_LENGTH} and ${PASSWORD.MAX_LENGTH} characters`),

  body('role')
    .optional()
    .isIn(Object.values(USER_ROLES).filter(r => r !== USER_ROLES.SYSTEM_ADMIN))
    .withMessage('Invalid role'),

  body('profile.fullName')
    .trim()
    .notEmpty().withMessage('Full name is required')
    .isLength({ min: 3, max: 100 }).withMessage('Full name must be between 3 and 100 characters'),

  body('profile.employeeId')
    .trim()
    .notEmpty().withMessage('Employee ID is required')
    .isLength({ max: 50 }).withMessage('Employee ID must be at most 50 characters'),

  body('profile.department')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Department must be at most 100 characters'),

  body('profile.position')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Position must be at most 100 characters'),

  body('profile.phone')
    .optional()
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/).withMessage('Invalid phone number format')
];

/**
 * Validation chain for user login
 */
const loginValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required')
];

/**
 * Validation chain for forgot password
 */
const forgotPasswordValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail()
];

/**
 * Validation chain for OTP verification
 */
const verifyOTPValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),

  body('otp')
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
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),

  body('resetToken')
    .trim()
    .notEmpty().withMessage('Reset token is required'),

  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: PASSWORD.MIN_LENGTH, max: PASSWORD.MAX_LENGTH })
    .withMessage(`Password must be between ${PASSWORD.MIN_LENGTH} and ${PASSWORD.MAX_LENGTH} characters`)
];

/**
 * Validation chain for changing password (authenticated)
 */
const changePasswordValidation = [
  body('oldPassword')
    .notEmpty().withMessage('Old password is required'),

  body('newPassword')
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
    .trim()
    .isLength({ min: 3, max: 100 }).withMessage('Full name must be between 3 and 100 characters'),

  body('department')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 100 }).withMessage('Department must be at most 100 characters'),

  body('position')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 100 }).withMessage('Position must be at most 100 characters'),

  body('phone')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/).withMessage('Invalid phone number format'),

  body('avatar')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isURL().withMessage('Avatar must be a valid URL')
];

module.exports = {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyOTPValidation,
  resetPasswordValidation,
  changePasswordValidation,
  updateProfileValidation
};
