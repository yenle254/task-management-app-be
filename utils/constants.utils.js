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
        TASK_OVERDUE: 'task_overdue',
        ATTENDANCE_REMINDER: 'attendance_reminder',
        LEAVE_STARTING: 'leave_starting',
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
      DRAFT: 'draft',
      PENDING: 'pending',
      PENDING_TEAM_LEAD: 'pending_team_lead',
      PENDING_HR: 'pending_hr',
      APPROVED: 'approved',
      REJECTED: 'rejected',
      CANCELLED: 'cancelled'
    },
    LEAVE_STEP: { TEAM_LEAD: 'team_lead', HR: 'hr' },
    LEAVE_PENDING_STATUSES: ['pending', 'pending_team_lead', 'pending_hr'],
  
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
      MAX_SIZE: 10 * 1024 * 1024, // Matches active task forms and local Multer storage
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
      MY_TASKS_DEFAULT_LIMIT: 100
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
  
constants.AUDIT_ACTIONS = Object.freeze({
  'auth.register': { category: 'auth', severity: 'info' },
  'auth.login_success': { category: 'auth', severity: 'info' },
  'auth.login_failed': { category: 'auth', severity: 'warning' },
  'auth.password_reset_requested': { category: 'auth', severity: 'warning' },
  'auth.otp_verify_failed': { category: 'auth', severity: 'warning' },
  'auth.password_reset_completed': { category: 'auth', severity: 'warning' },
  'auth.password_changed': { category: 'auth', severity: 'warning' },
  'admin.hr_account_created': { category: 'admin', severity: 'critical' },
  'user.updated': { category: 'user', severity: 'warning' },
  'user.role_changed': { category: 'user', severity: 'critical' },
  'user.deactivated': { category: 'user', severity: 'critical' },
  'security.access_denied': { category: 'security', severity: 'warning' },
  'security.auth_rejected': { category: 'security', severity: 'warning' },
  'team.created': { category: 'team', severity: 'warning' },
  'team.updated': { category: 'team', severity: 'warning' },
  'team.member_added': { category: 'team', severity: 'warning' },
  'team.member_removed': { category: 'team', severity: 'warning' },
  'team.lead_assigned': { category: 'team', severity: 'warning' },
  'team.deleted': { category: 'team', severity: 'warning' },
  'leave.submitted': { category: 'leave', severity: 'info' },
  'leave.approved': { category: 'leave', severity: 'warning' },
  'leave.rejected': { category: 'leave', severity: 'warning' },
  'leave.cancelled': { category: 'leave', severity: 'warning' },
  'leave.balance_deducted': { category: 'leave', severity: 'warning' },
  'leave.balance_refunded': { category: 'leave', severity: 'warning' },
  'attendance.manual_updated': { category: 'attendance', severity: 'warning' },
  'office.created': { category: 'office', severity: 'warning' },
  'office.updated': { category: 'office', severity: 'warning' },
  'office.activated': { category: 'office', severity: 'warning' },
  'office.deleted': { category: 'office', severity: 'warning' },
  'task.created': { category: 'task', severity: 'info' },
  'task.updated': { category: 'task', severity: 'warning' },
  'task.assigned': { category: 'task', severity: 'warning' },
  'task.deleted': { category: 'task', severity: 'warning' }
});

  module.exports = constants;
