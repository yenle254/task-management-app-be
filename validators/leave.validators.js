/**
 * leave.validators.js
 * Validation rules for leave management endpoints
 */

const { body, param, query } = require('express-validator');

/**
 * Validation chain for submitting a leave request
 */
const submitLeaveValidation = [
  body('type')
    .notEmpty().withMessage('Leave type is required')
    .isIn(['sick', 'vacation', 'personal']).withMessage('Leave type must be: sick, vacation, or personal'),

  body('startDate')
    .notEmpty().withMessage('Start date is required')
    .isISO8601().withMessage('Invalid start date format')
    .custom((value) => {
      const startDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (startDate < today) {
        throw new Error('Start date cannot be in the past');
      }
      return true;
    }),

  body('endDate')
    .notEmpty().withMessage('End date is required')
    .isISO8601().withMessage('Invalid end date format')
    .custom((value, { req }) => {
      const endDate = new Date(value);
      const startDate = new Date(req.body.startDate);
      if (endDate < startDate) {
        throw new Error('End date must be after or equal to start date');
      }
      return true;
    }),

  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Reason must be at most 500 characters')
];

/**
 * Validation chain for getting leaves
 */
const getLeavesValidation = [
  query('status')
    .optional()
    .isIn(['pending', 'approved', 'rejected']).withMessage('Invalid status'),

  query('type')
    .optional()
    .isIn(['sick', 'vacation', 'personal']).withMessage('Invalid leave type'),

  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 }).withMessage('Invalid year')
    .toInt(),

  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt()
];

/**
 * Validation chain for getting leave by ID
 */
const getLeaveByIdValidation = [
  param('id')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid leave ID');
      }
      return true;
    })
];

/**
 * Validation chain for approving/rejecting leave
 */
const processLeaveValidation = [
  param('id')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid leave ID');
      }
      return true;
    }),

  body('rejectionReason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Rejection reason must be at most 500 characters')
];

/**
 * Validation chain for getting leave balance
 */
const getLeaveBalanceValidation = [
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 }).withMessage('Invalid year')
    .toInt()
];

/**
 * Validation chain for getting team leaves
 */
const getTeamLeavesValidation = [
  param('teamId')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid team ID');
      }
      return true;
    }),

  query('status')
    .optional()
    .isIn(['pending', 'approved', 'rejected']).withMessage('Invalid status'),

  query('month')
    .optional()
    .isInt({ min: 1, max: 12 }).withMessage('Month must be between 1 and 12')
    .toInt(),

  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 }).withMessage('Invalid year')
    .toInt()
];

/**
 * Validation chain for cancelling leave
 */
const cancelLeaveValidation = [
  param('id')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid leave ID');
      }
      return true;
    })
];

module.exports = {
  submitLeaveValidation,
  getLeavesValidation,
  getLeaveByIdValidation,
  processLeaveValidation,
  getLeaveBalanceValidation,
  getTeamLeavesValidation,
  cancelLeaveValidation
};
