const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification_endpoint,
  deleteAllNotifications_endpoint,
  getUnreadNotificationCount,
  getNotificationsByType
} = require('../controllers/notificationController');

// All routes require authentication
router.use(protect);

// Notifications CRUD
router.get('/', getMyNotifications);
router.get('/unread/count', getUnreadNotificationCount);
router.get('/type/:type', getNotificationsByType);

router.put('/:id/read', markNotificationAsRead);
router.put('/read-all', markAllNotificationsAsRead);

router.delete('/:id', deleteNotification_endpoint);
router.delete('/', deleteAllNotifications_endpoint);

module.exports = router;