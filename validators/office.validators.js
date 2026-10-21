/**
 * Office Validators
 */
const { body, param } = require('express-validator');
const { OFFICE } = require('../utils/constants.utils');

const createOfficeValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),

  body('address')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Address must be at most 500 characters'),

  body('location.lat')
    .notEmpty().withMessage('Latitude is required')
    .isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),

  body('location.lng')
    .notEmpty().withMessage('Longitude is required')
    .isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),

  body('radius')
    .optional()
    .isInt({ min: OFFICE.MIN_RADIUS, max: OFFICE.MAX_RADIUS })
    .withMessage(`Radius must be between ${OFFICE.MIN_RADIUS} and ${OFFICE.MAX_RADIUS} meters`),

  body('workingHours.start')
    .optional()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:mm format'),

  body('workingHours.end')
    .optional()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:mm format'),

  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive must be a boolean')
];

const updateOfficeValidation = [
  param('id')
    .notEmpty().withMessage('Office ID is required'),

  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),

  body('address')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Address must be at most 500 characters'),

  body('location.lat')
    .optional()
    .isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),

  body('location.lng')
    .optional()
    .isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),

  body('radius')
    .optional()
    .isInt({ min: OFFICE.MIN_RADIUS, max: OFFICE.MAX_RADIUS })
    .withMessage(`Radius must be between ${OFFICE.MIN_RADIUS} and ${OFFICE.MAX_RADIUS} meters`),

  body('workingHours.start')
    .optional()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:mm format'),

  body('workingHours.end')
    .optional()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:mm format'),

  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive must be a boolean')
];

const officeIdValidation = [
  param('id')
    .notEmpty().withMessage('Office ID is required')
];

module.exports = {
  createOfficeValidation,
  updateOfficeValidation,
  officeIdValidation
};
