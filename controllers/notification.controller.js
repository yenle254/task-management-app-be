const Notification = require('../models/notification.model');
const Task = require('../models/task.model');
const Leave = require('../models/leave.model');
const {
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  deleteNotification,
  deleteAllNotifications
} = require('../services/notification.service');
const { NOTIFICATION_TYPES } = require('../utils/constants.utils');

// Notification type -> Model mapping
const TYPE_MODEL_MAP = {
  [NOTIFICATION_TYPES.TASK_ASSIGNED]: 'task',
  [NOTIFICATION_TYPES.TASK_UPDATED]: 'task',
  [NOTIFICATION_TYPES.COMMENT_ADDED]: 'task',
  [NOTIFICATION_TYPES.DEADLINE_REMINDER]: 'task',
  [NOTIFICATION_TYPES.TASK_COMPLETED]: 'task',
  [NOTIFICATION_TYPES.LEAVE_APPROVED]: 'leave',
  [NOTIFICATION_TYPES.LEAVE_REJECTED]: 'leave',
  [NOTIFICATION_TYPES.LEAVE_PENDING]: 'leave',
};

/**
 * Batch fetch related documents by type
 * @param {Array} notifications - Array of notification documents
 * @returns {Array} Notifications with populated relatedId
 */
const populateRelatedDocs = async (notifications) => {
  if (!notifications.length) return notifications;

  // Group notifications by related model type
  const taskIds = [];
  const leaveIds = [];

  notifications.forEach(n => {
    const model = TYPE_MODEL_MAP[n.type];
    if (model === 'task' && n.relatedId) {
      taskIds.push(n.relatedId);
    } else if (model === 'leave' && n.relatedId) {
      leaveIds.push(n.relatedId);
    }
  });

  // Batch fetch in parallel
  const [tasks, leaves] = await Promise.all([
    taskIds.length ? Task.find({ _id: { $in: taskIds } }).select('title _id').lean() : [],
    leaveIds.length ? Leave.find({ _id: { $in: leaveIds } }).select('_id').lean() : [],
  ]);

  // Build lookup maps
  const taskMap = new Map(tasks.map(t => [t._id.toString(), t]));
  const leaveMap = new Map(leaves.map(l => [l._id.toString(), l]));

  // Attach related docs to notifications.
  // notifications are plain objects (from .lean()), so assign directly
  // instead of touching the Mongoose _doc accessor.
  return notifications.map(n => {
    const model = TYPE_MODEL_MAP[n.type];
    if (model === 'task' && n.relatedId) {
      n.relatedId = taskMap.get(n.relatedId.toString()) || null;
    } else if (model === 'leave' && n.relatedId) {
      n.relatedId = leaveMap.get(n.relatedId.toString()) || null;
    }
    return n;
  });
};

/**
 * @desc    Get all notifications for current user
 * @route   GET /api/notifications
 * @access  Private
 */
const getMyNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const userId = req.user._id;

    const query = { userId };
    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const skip = (page - 1) * limit;

    // Parallel count + find
    const [total, notifications] = await Promise.all([
      Notification.countDocuments(query),
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean()
    ]);

    // Batch fetch related documents
    const enriched = await populateRelatedDocs(notifications);

    res.json({
      success: true,
      count: enriched.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: enriched
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Mark single notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markNotificationAsRead = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id).lean();

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    if (notification.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized'
      });
    }

    const updated = await markAsRead(req.params.id);

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: updated
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const result = await markAllAsRead(req.user._id);

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: result
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Delete notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
const deleteNotification_endpoint = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id).lean();

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    if (notification.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized'
      });
    }

    await deleteNotification(req.params.id);

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Delete all notifications
 * @route   DELETE /api/notifications
 * @access  Private
 */
const deleteAllNotifications_endpoint = async (req, res) => {
  try {
    const result = await deleteAllNotifications(req.user._id);

    res.json({
      success: true,
      message: 'All notifications deleted',
      data: result
    });
  } catch (error) {
    console.error('Delete all notifications error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Get unread notification count
 * @route   GET /api/notifications/unread/count
 * @access  Private
 */
const getUnreadNotificationCount = async (req, res) => {
  try {
    const count = await getUnreadCount(req.user._id);

    res.json({
      success: true,
      data: {
        unreadCount: count
      }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Get notifications by type
 * @route   GET /api/notifications/type/:type
 * @access  Private
 */
const getNotificationsByType = async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const validTypes = Object.values(NOTIFICATION_TYPES);
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const skip = (page - 1) * limit;
    const query = { userId: req.user._id, type };

    // Parallel count + find
    const [total, notifications] = await Promise.all([
      Notification.countDocuments(query),
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean()
    ]);

    // Batch fetch related documents
    const enriched = await populateRelatedDocs(notifications);

    res.json({
      success: true,
      count: enriched.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: enriched
    });
  } catch (error) {
    console.error('Get notifications by type error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification_endpoint,
  deleteAllNotifications_endpoint,
  getUnreadNotificationCount,
  getNotificationsByType,
  populateRelatedDocs
};
