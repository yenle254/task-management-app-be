const { body, param } = require('express-validator');

const assistantChatValidation = [
  body('message')
    .isString()
    .withMessage('Message must be a string')
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ max: 2000 })
    .withMessage('Message cannot exceed 2000 characters'),
  body('history')
    .optional()
    .isArray({ max: 20 })
    .withMessage('History must be an array of at most 20 messages'),
  body('forceRefresh')
    .optional()
    .isBoolean()
    .withMessage('forceRefresh must be a boolean')
];

const taskBreakdownValidation = [
  body('title')
    .isString()
    .withMessage('Task title must be a string')
    .trim()
    .notEmpty()
    .withMessage('Task title is required')
    .isLength({ max: 300 })
    .withMessage('Task title cannot exceed 300 characters'),
  body('description')
    .optional({ nullable: true })
    .isString()
    .withMessage('Description must be a string')
    .isLength({ max: 5000 })
    .withMessage('Description cannot exceed 5000 characters')
];

const taskSummaryValidation = [
  param('taskId')
    .isMongoId()
    .withMessage('Invalid taskId')
];

const assistantFeedbackValidation = [
  body('message')
    .isString()
    .withMessage('Message must be a string')
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ max: 1000 })
    .withMessage('Message cannot exceed 1000 characters'),
  body('rating')
    .isIn(['up', 'down'])
    .withMessage('Rating must be up or down'),
  body('predictedIntent')
    .optional()
    .isString()
    .isLength({ max: 100 }),
  body('comment')
    .optional()
    .isString()
    .isLength({ max: 500 })
];

module.exports = {
  assistantChatValidation,
  taskBreakdownValidation,
  taskSummaryValidation,
  assistantFeedbackValidation
};
