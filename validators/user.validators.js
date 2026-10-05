/**
 * user.validators.js
 * Validation rules for user management endpoints
 */

const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Validation chain for getting users
 */
const getUsersValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt(),

  query('search')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Search must be at most 100 characters'),

  query('role')
    .optional()
    .isIn(['hr_manager', 'team_lead', 'employee']).withMessage('Invalid role'),

  query('department')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Department must be at most 100 characters')
];

/**
 * Validation chain for getting user by ID
 */
const getUserByIdValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid user ID');
      }
      return true;
    })
];

/**
 * Validation chain for updating user
 */
const updateUserValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid user ID');
      }
      return true;
    }),

  body('email')
    .optional()
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail()
    .custom(async (email, { req }) => {
      if (email) {
        const user = await User.findOne({
          email: email.toLowerCase(),
          _id: { $ne: req.params.id }
        });
        if (user) {
          throw new Error('Email already in use');
        }
      }
      return true;
    }),

  body('role')
    .optional()
    .isIn(['hr_manager', 'team_lead', 'employee']).withMessage('Invalid role'),

  body('teamId')
    .optional()
    .custom((value) => {
      if (value !== null && !mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid team ID');
      }
      return true;
    }),

  body('managerId')
    .optional()
    .custom((value) => {
      if (value !== null && !mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid manager ID');
      }
      return true;
    }),

  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive must be a boolean'),

  body('profile.fullName')
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 }).withMessage('Full name must be between 3 and 100 characters'),

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
 * Validation chain for getting users by team
 */
const getUsersByTeamValidation = [
  param('teamId')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid team ID');
      }
      return true;
    })
];

module.exports = {
  getUsersValidation,
  getUserByIdValidation,
  updateUserValidation,
  getUsersByTeamValidation
};
