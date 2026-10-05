const notificationHelper = {
    // Notification type configurations
    types: {
      TASK_ASSIGNED: {
        type: 'task_assigned',
        icon: '📌',
        color: '#3498db',
        title: 'Task Assigned'
      },
      TASK_UPDATED: {
        type: 'task_updated',
        icon: '✏️',
        color: '#2ecc71',
        title: 'Task Updated'
      },
      COMMENT_ADDED: {
        type: 'comment_added',
        icon: '💬',
        color: '#e74c3c',
        title: 'New Comment'
      },
      DEADLINE_REMINDER: {
        type: 'deadline_reminder',
        icon: '⏰',
        color: '#f39c12',
        title: 'Deadline Approaching'
      },
      LEAVE_APPROVED: {
        type: 'leave_approved',
        icon: '✅',
        color: '#27ae60',
        title: 'Leave Approved'
      },
      LEAVE_REJECTED: {
        type: 'leave_rejected',
        icon: '❌',
        color: '#e74c3c',
        title: 'Leave Rejected'
      }
    },
  
    /**
     * Format task assigned notification message
     * @param {Object} task - Task document
     * @returns {Object} { title, message }
     */
    formatTaskAssigned: (task) => {
      return {
        title: 'Task Assigned',
        message: `You have been assigned to task: "${task.title}"`
      };
    },
  
    /**
     * Format task updated notification message
     * @param {Object} task - Task document
     * @param {String} fieldChanged - Field that was changed
     * @returns {Object} { title, message }
     */
    formatTaskUpdated: (task, fieldChanged = 'priority') => {
      const messages = {
        priority: `Task priority changed to "${task.priority}"`,
        status: `Task status updated to "${task.status}"`,
        dueDate: `Task due date changed to ${new Date(task.dueDate).toLocaleDateString()}`,
        title: `Task title updated: "${task.title}"`
      };
  
      return {
        title: 'Task Updated',
        message: messages[fieldChanged] || `Task "${task.title}" has been updated`
      };
    },
  
    /**
     * Format comment added notification message
     * @param {Object} task - Task document
     * @param {String} commenterName - Name of person who commented
     * @returns {Object} { title, message }
     */
    formatCommentAdded: (task, commenterName) => {
      return {
        title: 'New Comment',
        message: `${commenterName} commented on "${task.title}"`
      };
    },
  
    /**
     * Format deadline reminder notification message
     * @param {Object} task - Task document
     * @param {Number} hoursLeft - Hours until deadline
     * @returns {Object} { title, message }
     */
    formatDeadlineReminder: (task, hoursLeft) => {
      const timeLeft = hoursLeft < 1 ? 'less than 1 hour' : `${hoursLeft} hours`;
      return {
        title: 'Deadline Approaching',
        message: `Task "${task.title}" is due in ${timeLeft}`
      };
    },
  
    /**
     * Get notification type configuration
     * @param {String} type - Notification type
     * @returns {Object} Type configuration
     */
    getTypeConfig: (type) => {
      const typeKey = Object.keys(notificationHelper.types).find(
        key => notificationHelper.types[key].type === type
      );
      return typeKey ? notificationHelper.types[typeKey] : null;
    },
  
    /**
     * Get icon for notification type
     * @param {String} type - Notification type
     * @returns {String} Icon emoji
     */
    getIcon: (type) => {
      const config = notificationHelper.getTypeConfig(type);
      return config ? config.icon : '📢';
    },
  
    /**
     * Get color for notification type
     * @param {String} type - Notification type
     * @returns {String} Color hex code
     */
    getColor: (type) => {
      const config = notificationHelper.getTypeConfig(type);
      return config ? config.color : '#95a5a6';
    },
  
    /**
     * Format time ago (e.g., "2 hours ago", "1 day ago")
     * @param {Date} date - Date to format
     * @returns {String} Formatted time ago
     */
    formatTimeAgo: (date) => {
      const now = new Date();
      const diffMs = now - new Date(date);
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
  
      if (diffSecs < 60) return 'just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      return new Date(date).toLocaleDateString();
    },
  
    /**
     * Group notifications by date
     * @param {Array} notifications - Array of notifications
     * @returns {Object} Notifications grouped by date
     */
    groupByDate: (notifications) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
  
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
  
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
  
      const grouped = {
        today: [],
        yesterday: [],
        thisWeek: [],
        older: []
      };
  
      notifications.forEach(notif => {
        const notifDate = new Date(notif.createdAt);
        notifDate.setHours(0, 0, 0, 0);
  
        if (notifDate.getTime() === today.getTime()) {
          grouped.today.push(notif);
        } else if (notifDate.getTime() === yesterday.getTime()) {
          grouped.yesterday.push(notif);
        } else if (notifDate > weekAgo) {
          grouped.thisWeek.push(notif);
        } else {
          grouped.older.push(notif);
        }
      });
  
      return grouped;
    },
  
    /**
     * Validate notification data
     * @param {Object} data - Notification data
     * @returns {Object} { valid: Boolean, errors: Array }
     */
    validate: (data) => {
      const errors = [];
  
      if (!data.userId) errors.push('userId is required');
      if (!data.type) errors.push('type is required');
      if (!data.title) errors.push('title is required');
      if (!data.message) errors.push('message is required');
  
      const validTypes = Object.values(notificationHelper.types).map(t => t.type);
      if (data.type && !validTypes.includes(data.type)) {
        errors.push(`type must be one of: ${validTypes.join(', ')}`);
      }
  
      return {
        valid: errors.length === 0,
        errors
      };
    }
  };
  
  module.exports = notificationHelper;