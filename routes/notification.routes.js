const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { validateRequest } = require('../middleware/validate-request.middleware');
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

// Notifications CRUD
router.get('/', getNotificationsValidation, validateRequest, getMyNotifications);
router.get('/unread/count', getUnreadNotificationCount);
router.get('/type/:type', getNotificationsByTypeValidation, validateRequest, getNotificationsByType);

router.put('/:id/read', markAsReadValidation, validateRequest, markNotificationAsRead);
router.put('/read-all', markAllNotificationsAsRead);

router.delete('/:id', markAsReadValidation, validateRequest, deleteNotification_endpoint);
router.delete('/', deleteAllNotifications_endpoint);

module.exports = router;