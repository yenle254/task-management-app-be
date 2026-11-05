/**
 * notification.validators.js
 * Validation rules for notification endpoints
 */

const { body, param, query } = require('express-validator');

const VALID_NOTIFICATION_TYPES = [
  'task_submitted_for_review',
      'task_review_approved',
      'task_review_requested',
      'task_review_withdrawn',
      'task_review_reminder',
      'task_assigned',
  'task_updated',
  'task_completed',
  'comment_added',
  'deadline_reminder',
  'task_overdue',
  'attendance_reminder',
  'leave_starting',
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

const registerPushTokenValidation = [
  body('token').isString().bail().matches(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/).isLength({ max: 256 }),
  body('platform').isString().bail().isIn(['android', 'ios', 'web']),
  body().custom(value => Object.keys(value).every(key => ['token', 'platform'].includes(key)))
];

const preferencesValidation = [body().custom(value => {
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!object(value)) throw new Error('Preferences must be an object');
  for (const [key, setting] of Object.entries(value)) {
    if (['master', 'push', 'sound'].includes(key)) {
      if (typeof setting !== 'boolean') throw new Error(`${key} must be boolean`);
    } else if (key === 'categories') {
      if (!object(setting)) throw new Error('Invalid categories');
      for (const [category, channels] of Object.entries(setting)) {
        if (!['task', 'leave', 'attendance'].includes(category) || !object(channels)) throw new Error('Invalid category');
        for (const [channel, enabled] of Object.entries(channels)) {
          if (channel === 'types' && category === 'task') {
            if (!object(enabled)) throw new Error('Invalid notification types');
            for (const [type, settings] of Object.entries(enabled)) {
              if (!require('../utils/notification-preferences.helper').REVIEW_TYPES.includes(type) || !object(settings)) throw new Error('Invalid notification type');
              for (const [name, value] of Object.entries(settings)) if (!['inApp', 'push'].includes(name) || typeof value !== 'boolean') throw new Error('Invalid notification channel');
            }
            continue;
          }
          if (!['inApp', 'push'].includes(channel) || typeof enabled !== 'boolean') throw new Error('Invalid channel');
        }
      }
    } else if (key === 'reminderTimes') {
      if (!object(setting)) throw new Error('Invalid reminder times');
      for (const [name, time] of Object.entries(setting)) {
        if (!['clockIn', 'clockOut'].includes(name) || (time !== null && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))) throw new Error('Use HH:mm or null');
      }
    } else throw new Error(`Unknown preference: ${key}`);
  }
  return true;
})];

module.exports = {
  registerPushTokenValidation,
  preferencesValidation,
  getNotificationsValidation,
  getNotificationsByTypeValidation,
  markAsReadValidation,
  VALID_NOTIFICATION_TYPES
};
