const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Create a new notification
 * @param {String} userId - User ID
 * @param {String} type - Notification type
 * @param {String} title - Notification title
 * @param {String} message - Notification message
 * @param {String} relatedId - Related document ID (task, leave, etc.)
 * @returns {Object} Created notification
 */
const createNotification = async (userId, type, title, message, relatedId = null) => {
  try {
    const notification = await Notification.create({
      userId,
      type,
      title,
      message,
      relatedId,
      isRead: false
    });

    return notification;
  } catch (error) {
    console.error('Create notification error:', error);
    throw error;
  }
};

/**
 * Create bulk notifications
 * @param {Array} userIds - Array of user IDs
 * @param {String} type - Notification type
 * @param {String} title - Notification title
 * @param {String} message - Notification message
 * @param {String} relatedId - Related document ID
 * @returns {Array} Created notifications
 */
const createBulkNotifications = async (userIds, type, title, message, relatedId = null) => {
  try {
    const notifications = userIds.map(userId => ({
      userId,
      type,
      title,
      message,
      relatedId,
      isRead: false
    }));

    const result = await Notification.insertMany(notifications);
    return result;
  } catch (error) {
    console.error('Create bulk notifications error:', error);
    throw error;
  }
};

/**
 * Notify when task is assigned
 * @param {Object} task - Task document
 * @param {String} userId - User ID to notify
 */
const notifyTaskAssigned = async (task, userId) => {
  try {
    const title = 'Task assigned';
    const message = `You have been assigned to task: "${task.title}", please check it out.`;
    
    await createNotification(
      userId,
      'task_assigned',
      title,
      message,
      task._id
    );
  } catch (error) {
    console.error('Notify task assigned error:', error);
  }
};

/**
 * Notify when task is updated
 * @param {Object} task - Task document
 * @param {String} updaterId - User ID who updated
 */
const notifyTaskUpdated = async (task, updaterId) => {
  try {
    const title = 'Task updated';
    
    const user = await User.findById(updaterId).select('profile.fullName'); 
    const updaterName = user?.profile?.fullName || 'A user';
    const message = `Task "${task.title}" was updated by ${updaterName}. Please check the details.`;

    // Notify all assigned users except the updater
    const userIds = task.assignedTo
      .map(id => id.toString())
      .filter(id => id !== updaterId.toString());

    if (userIds.length > 0) {
      await createBulkNotifications(
        userIds,
        'task_updated',
        title,
        message,
        task._id
      );
    }

    // Also notify task creator
    if (task.assignedBy.toString() !== updaterId.toString()) {
      await createNotification(
        task.assignedBy,
        'task_updated',
        title,
        message,
        task._id
      );
    }
  } catch (error) {
    console.error('Notify task updated error:', error);
  }
};

/**
 * Notify when comment is added to task
 * @param {Object} task - Task document
 * @param {String} commenterId - User ID who commented
 */
const notifyCommentAdded = async (task, commenterId) => {
  try {
    const title = 'New comment';
    const message = `A new comment was added to "${task.title}"`;

    // Notify all assigned users and creator except commenter
    const userIdsSet = new Set([
      ...task.assignedTo.map(id => id.toString()),
      task.assignedBy.toString()
    ]);
    
    userIdsSet.delete(commenterId.toString());
    const userIds = Array.from(userIdsSet);

    if (userIds.length > 0) {
      await createBulkNotifications(
        userIds,
        'comment_added',
        title,
        message,
        task._id
      );
    }
  } catch (error) {
    console.error('Notify comment added error:', error);
  }
};

/**
 * Notify when task is completed
 * @param {Object} task - Task document
 * @param {String} completerId - User ID who completed the task
 */
const notifyTaskCompleted = async (task, completerId) => {
  try {
    const title = 'Task completed';
    const user = await User.findById(completerId).select('profile.fullName');
    const completerName = user?.profile?.fullName || 'A team member';
    const message = `Task "${task.title}" has been marked as completed by ${completerName}`;

    // Notify all assigned users except the completer
    const userIds = task.assignedTo
      .map(id => id.toString())
      .filter(id => id !== completerId.toString());

    if (userIds.length > 0) {
      await createBulkNotifications(
        userIds,
        'task_completed',
        title,
        message,
        task._id
      );
    }

    // Always notify task creator if not the completer
    if (task.assignedBy.toString() !== completerId.toString()) {
      await createNotification(
        task.assignedBy,
        'task_completed',
        title,
        message,
        task._id
      );
    }
  } catch (error) {
    console.error('Notify task completed error:', error);
  }
};

/**
 * Notify when deadline is approaching
 * @param {Object} task - Task document
 */
const notifyDeadlineApproaching = async (task) => {
  try {
    if (!task.dueDate || task.status === 'done') {
      return;
    }

    const dueDate = new Date(task.dueDate);
    const now = new Date();
    const timeToDeadline = dueDate - now;
    const hoursToDeadline = timeToDeadline / (1000 * 60 * 60);

    // Notify if deadline is within 24 hours
    if (hoursToDeadline <= 24 && hoursToDeadline > 0) {
      const title = 'Deadline approaching';
      const message = `Task "${task.title}" is due soon, please ensure to complete it on time.`;

      const userIds = task.assignedTo.map(id => id.toString());

      await createBulkNotifications(
        userIds,
        'deadline_reminder',
        title,
        message,
        task._id
      );
    }
  } catch (error) {
    console.error('Notify deadline approaching error:', error);
  }
};

/**
 * Notify when leave is approved
 * @param {Object} leave - Leave document
 * @param {String} userId - User ID to notify
 */
const notifyLeaveApproved = async (leave, userId) => {
  try {
    const title = 'Leave approved';
    const message = `Your leave request has been approved, enjoy your time off!`;

    await createNotification(
      userId,
      'leave_approved',
      title,
      message,
      leave._id
    );
  } catch (error) {
    console.error('Notify leave approved error:', error);
  }
};

/**
 * Notify when leave is rejected
 * @param {Object} leave - Leave document
 * @param {String} userId - User ID to notify
 */
const notifyLeaveRejected = async (leave, userId) => {
  try {
    const title = 'Leave Rejected';
    const message = `Your leave request has been rejected. Please contact HR for more details.`;

    await createNotification(
      userId,
      'leave_rejected',
      title,
      message,
      leave._id
    );
  } catch (error) {
    console.error('Notify leave rejected error:', error);
  }
};

/**
 * Notify HR Manager and Team Lead when new leave is pending
 * @param {Object} leave - Leave document with populated userId
 */
const notifyPendingLeave = async (leave) => {
  try {
    const employee = await User.findById(leave.userId).select('profile.fullName email teamId');
    if (!employee) return;

    const title = 'New Leave Request';
    const message = `${employee.profile?.fullName || employee.email} has submitted a new leave request for ${leave.numberOfDays} day(s)`;

    // Notify HR Managers
    const hrManagers = await User.find({ role: 'hr_manager' }).select('_id');
    const hrIds = hrManagers.map(hr => hr._id);

    // Notify Team Lead of employee's team
    if (employee.teamId) {
      const teamLead = await User.findOne({ 
        role: 'team_lead', 
        teamId: employee.teamId 
      }).select('_id');
      
      if (teamLead) {
        hrIds.push(teamLead._id);
      }
    }

    // Remove duplicates
    const uniqueIds = [...new Set(hrIds.map(id => id.toString()))];

    if (uniqueIds.length > 0) {
      await createBulkNotifications(
        uniqueIds,
        'leave_pending',
        title,
        message,
        leave._id
      );
    }
  } catch (error) {
    console.error('Notify pending leave error:', error);
  }
};

/**
 * Mark notification as read
 * @param {String} notificationId - Notification ID
 * @returns {Object} Updated notification
 */
const markAsRead = async (notificationId) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { isRead: true },
      { new: true }
    );
    return notification;
  } catch (error) {
    console.error('Mark as read error:', error);
    throw error;
  }
};

/**
 * Mark all notifications as read for a user
 * @param {String} userId - User ID
 * @returns {Object} Update result
 */
const markAllAsRead = async (userId) => {
  try {
    const result = await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true }
    );
    return result;
  } catch (error) {
    console.error('Mark all as read error:', error);
    throw error;
  }
};

/**
 * Get unread notification count for user
 * @param {String} userId - User ID
 * @returns {Number} Unread count
 */
const getUnreadCount = async (userId) => {
  try {
    const count = await Notification.countDocuments({
      userId,
      isRead: false
    });
    return count;
  } catch (error) {
    console.error('Get unread count error:', error);
    return 0;
  }
};

/**
 * Delete notification
 * @param {String} notificationId - Notification ID
 * @returns {Object} Deleted notification
 */
const deleteNotification = async (notificationId) => {
  try {
    const notification = await Notification.findByIdAndDelete(notificationId);
    return notification;
  } catch (error) {
    console.error('Delete notification error:', error);
    throw error;
  }
};

/**
 * Delete all notifications for a user
 * @param {String} userId - User ID
 * @returns {Object} Delete result
 */
const deleteAllNotifications = async (userId) => {
  try {
    const result = await Notification.deleteMany({ userId });
    return result;
  } catch (error) {
    console.error('Delete all notifications error:', error);
    throw error;
  }
};



module.exports = {
  createNotification,
  createBulkNotifications,
  notifyTaskAssigned,
  notifyTaskUpdated,
  notifyTaskCompleted,
  notifyCommentAdded,
  notifyDeadlineApproaching,
  notifyLeaveApproved,
  notifyLeaveRejected,
  notifyPendingLeave,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  deleteNotification,
  deleteAllNotifications
};