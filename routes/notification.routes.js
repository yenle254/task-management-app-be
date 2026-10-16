const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { validateRequest } = require('../middleware/validate-request.middleware');
const asyncHandler = require('../middleware/async-handler.middleware');
const { notificationReadLimiter } = require('../middleware/rate-limit.middleware');
const {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification_endpoint,
  deleteAllNotifications_endpoint,
  getUnreadNotificationCount,
  getNotificationsByType
} = require('../controllers/notification.controller');
const {
  getNotificationsValidation,
  getNotificationsByTypeValidation,
  markAsReadValidation
} = require('../validators');

// All routes require authentication
router.use(protect);

// Frequently-called read endpoints use the higher-volume notification
// limiter to prevent legitimate badge polling from being throttled.
const readRateLimit = notificationReadLimiter;

// Notifications CRUD
router.get('/', readRateLimit, getNotificationsValidation, validateRequest, asyncHandler(getMyNotifications));
router.get('/unread/count', readRateLimit, asyncHandler(getUnreadNotificationCount));
router.get('/type/:type', readRateLimit, getNotificationsByTypeValidation, validateRequest, asyncHandler(getNotificationsByType));

router.put('/:id/read', readRateLimit, markAsReadValidation, validateRequest, asyncHandler(markNotificationAsRead));
router.put('/read-all', readRateLimit, asyncHandler(markAllNotificationsAsRead));

router.delete('/:id', readRateLimit, markAsReadValidation, validateRequest, asyncHandler(deleteNotification_endpoint));
router.delete('/', readRateLimit, asyncHandler(deleteAllNotifications_endpoint));

module.exports = router;