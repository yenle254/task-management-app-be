const constants = {
    // User roles
    USER_ROLES: {
      SYSTEM_ADMIN: 'system_admin',
      HR_MANAGER: 'hr_manager',
      TEAM_LEAD: 'team_lead',
      EMPLOYEE: 'employee'
    },
  
    // Task statuses
    TASK_STATUS: {
      TODO: 'todo',
      IN_PROGRESS: 'in_progress',
      DONE: 'done',
      DELETED: 'deleted'
    },
  
    // Task priorities
    TASK_PRIORITY: {
      LOW: 'low',
      MEDIUM: 'medium',
      HIGH: 'high'
    },
  
    // Notification types
    NOTIFICATION_TYPES: {
      TASK_ASSIGNED: 'task_assigned',
      TASK_UPDATED: 'task_updated',
      TASK_COMPLETED: 'task_completed',
      COMMENT_ADDED: 'comment_added',
      DEADLINE_REMINDER: 'deadline_reminder',
      LEAVE_APPROVED: 'leave_approved',
      LEAVE_REJECTED: 'leave_rejected',
      LEAVE_PENDING: 'leave_pending'
    },
  
    // Leave types
    LEAVE_TYPES: {
      SICK: 'sick',
      VACATION: 'vacation',
      PERSONAL: 'personal'
    },
  
    // Leave status
    LEAVE_STATUS: {
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected'
    },
  
    // Attendance status
    ATTENDANCE_STATUS: {
      PRESENT: 'present',
      LATE: 'late',
      ABSENT: 'absent'
    },
  
    // Pagination defaults
    PAGINATION: {
      DEFAULT_PAGE: 1,
      DEFAULT_LIMIT: 10,
      MAX_LIMIT: 100
    },
  
    // File upload
    FILE_UPLOAD: {
      MAX_SIZE: 5 * 1024 * 1024, // 5MB
      MAX_FILES: 5,
      ALLOWED_TYPES: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/gif'
      ]
    },
  
    // Time thresholds (in milliseconds)
    TIME: {
      DEADLINE_WARNING_HOURS: 24,
      NOTIFICATION_REFRESH_INTERVAL: 30000, // 30 seconds
      OTP_EXPIRY_MS: 10 * 60 * 1000,        // 10 minutes
      RESET_TOKEN_EXPIRY_MS: 15 * 60 * 1000, // 15 minutes
      RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000  // 15 minutes
    },

    // Password constraints
    PASSWORD: {
      MIN_LENGTH: 6,
      MAX_LENGTH: 128,
      SALT_ROUNDS: 10,
      OTP_LENGTH: 6
    },

    // Office location constraints (meters)
    OFFICE: {
      DEFAULT_RADIUS: 200,
      MIN_RADIUS: 10,
      MAX_RADIUS: 1000
    },

    // Pagination defaults
    PAGINATION: {
      DEFAULT_PAGE: 1,
      DEFAULT_LIMIT: 10,
      MAX_LIMIT: 100,
      TASKS_DEFAULT_LIMIT: 100,
      MY_TASKS_DEFAULT_LIMIT: 1000
    },

    // Task progress limits
    TASK_PROGRESS: {
      MIN: 0,
      MAX: 100,
      DONE_THRESHOLD: 100,
      IN_PROGRESS_THRESHOLD: 1
    },
  
    // API response messages
    MESSAGES: {
      SUCCESS_CREATE: 'Created successfully',
      SUCCESS_UPDATE: 'Updated successfully',
      SUCCESS_DELETE: 'Deleted successfully',
      ERROR_NOT_FOUND: 'Resource not found',
      ERROR_UNAUTHORIZED: 'Not authorized',
      ERROR_FORBIDDEN: 'Permission denied',
      ERROR_VALIDATION: 'Validation failed',
      ERROR_SERVER: 'Server error occurred'
    }
  };
  
  module.exports = constants;