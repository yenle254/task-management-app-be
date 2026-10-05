/**
 * notification.validators.js
 * Validation rules for notification endpoints
 */

const { param, query } = require('express-validator');

const VALID_NOTIFICATION_TYPES = [
  'task_assigned',
  'task_updated',
  'task_completed',
  'comment_added',
  'deadline_reminder',
  'leave_approved',
  'leave_rejected',
  'leave_pending'
];

/**
 * Validation chain for getting notifications
 */
const getNotificationsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt(),

  query('unreadOnly')
    .optional()
    .isBoolean().withMessage('unreadOnly must be a boolean')
    .toBoolean()
];

/**
 * Validation chain for getting notifications by type
 */
const getNotificationsByTypeValidation = [
  param('type')
    .notEmpty().withMessage('Notification type is required')
    .isIn(VALID_NOTIFICATION_TYPES).withMessage(`Type must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}`),

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
 * Validation chain for marking notification as read
 */
const markAsReadValidation = [
  param('id')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid notification ID');
      }
      return true;
    })
];

module.exports = {
  getNotificationsValidation,
  getNotificationsByTypeValidation,
  markAsReadValidation,
  VALID_NOTIFICATION_TYPES
};
