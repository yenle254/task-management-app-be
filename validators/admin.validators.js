const { body } = require('express-validator');

const createHRAccountValidation = [
  body('email')
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),

  body('profile.fullName')
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Full name must be between 2 and 100 characters'),

  body('profile.employeeId')
    .trim()
    .notEmpty().withMessage('Employee ID is required'),

  body('profile.department')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Department must be at most 100 characters'),

  body('profile.position')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Position must be at most 100 characters'),

  body('profile.phone')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/).withMessage('Invalid phone number format'),
];

module.exports = {
  createHRAccountValidation,
};
