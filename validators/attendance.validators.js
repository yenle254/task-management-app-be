/**
 * attendance.validators.js
 * Validation rules for attendance management endpoints
 */

const { body, param, query } = require('express-validator');

/**
 * Validation chain for clock-in
 */
const clockInValidation = [
  body('lat')
    .notEmpty().withMessage('Latitude is required')
    .isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),

  body('lng')
    .notEmpty().withMessage('Longitude is required')
    .isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude')
];

/**
 * Validation chain for getting attendance records
 */
const getAttendanceValidation = [
  query('startDate')
    .optional()
    .isISO8601().withMessage('Invalid start date format'),

  query('endDate')
    .optional()
    .isISO8601().withMessage('Invalid end date format')
    .custom((value, { req }) => {
      if (value && req.query.startDate) {
        if (new Date(value) < new Date(req.query.startDate)) {
          throw new Error('End date must be after or equal to start date');
        }
      }
      return true;
    }),

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
 * Validation chain for getting attendance by date
 */
const getAttendanceByDateValidation = [
  param('date')
    .optional()
    .isISO8601().withMessage('Invalid date format'),

  query('date')
    .optional()
    .isISO8601().withMessage('Invalid date format')
];

/**
 * Validation chain for getting team attendance
 */
const getTeamAttendanceValidation = [
  param('teamId')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid team ID');
      }
      return true;
    }),

  query('startDate')
    .optional()
    .isISO8601().withMessage('Invalid start date format'),

  query('endDate')
    .optional()
    .isISO8601().withMessage('Invalid end date format')
];

/**
 * Validation chain for updating attendance
 */
const updateAttendanceValidation = [
  param('id')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid attendance ID');
      }
      return true;
    }),

  body('clockIn')
    .optional()
    .isISO8601().withMessage('Invalid clock-in time format'),

  body('clockOut')
    .optional()
    .isISO8601().withMessage('Invalid clock-out time format'),

  body('status')
    .optional()
    .isIn(['present', 'late', 'absent']).withMessage('Invalid status'),

  body('workHours')
    .optional()
    .isFloat({ min: 0, max: 24 }).withMessage('Work hours must be between 0 and 24'),

  body('location.lat')
    .optional()
    .isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),

  body('location.lng')
    .optional()
    .isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude')
];

module.exports = {
  clockInValidation,
  getAttendanceValidation,
  getAttendanceByDateValidation,
  getTeamAttendanceValidation,
  updateAttendanceValidation
};
