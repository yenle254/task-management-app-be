/**
 * validators/index.js
 * Central export for all validators
 */

// Auth validators
const authValidators = require('./auth.validators');
const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyOTPValidation,
  resetPasswordValidation,
  changePasswordValidation,
  updateProfileValidation
} = authValidators;

// User validators
const userValidators = require('./user.validators');
const {
  getUsersValidation,
  getUserByIdValidation,
  updateUserValidation,
  getUsersByTeamValidation
} = userValidators;

// Task validators
const taskValidators = require('./task.validators');
const {
  createTaskValidation,
  updateTaskValidation,
  assignTaskValidation,
  updateStatusValidation,
  updateProgressValidation,
  addCommentValidation,
  createSubtaskValidation,
  updateSubtaskValidation,
  getTasksValidation,
  getTeamTasksValidation,
  getOverdueTasksValidation
} = taskValidators;

// Leave validators
const leaveValidators = require('./leave.validators');
const {
  submitLeaveValidation,
  getLeavesValidation,
  getLeaveByIdValidation,
  processLeaveValidation,
  getLeaveBalanceValidation,
  getTeamLeavesValidation,
  cancelLeaveValidation
} = leaveValidators;

// Attendance validators
const attendanceValidators = require('./attendance.validators');
const {
  clockInValidation,
  getAttendanceValidation,
  getAttendanceByDateValidation,
  getTeamAttendanceValidation,
  updateAttendanceValidation
} = attendanceValidators;

// Notification validators
const notificationValidators = require('./notification.validators');
const {
  getNotificationsValidation,
  getNotificationsByTypeValidation,
  markAsReadValidation
} = notificationValidators;

// Message validators
const messageValidators = require('./message.validators');
const {
  sendMessageValidation,
  getMessagesValidation,
  getConversationByUserValidation
} = messageValidators;

module.exports = {
  // Auth
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyOTPValidation,
  resetPasswordValidation,
  changePasswordValidation,
  updateProfileValidation,

  // User
  getUsersValidation,
  getUserByIdValidation,
  updateUserValidation,
  getUsersByTeamValidation,

  // Task
  createTaskValidation,
  updateTaskValidation,
  assignTaskValidation,
  updateStatusValidation,
  updateProgressValidation,
  addCommentValidation,
  createSubtaskValidation,
  updateSubtaskValidation,
  getTasksValidation,
  getTeamTasksValidation,
  getOverdueTasksValidation,

  // Leave
  submitLeaveValidation,
  getLeavesValidation,
  getLeaveByIdValidation,
  processLeaveValidation,
  getLeaveBalanceValidation,
  getTeamLeavesValidation,
  cancelLeaveValidation,

  // Attendance
  clockInValidation,
  getAttendanceValidation,
  getAttendanceByDateValidation,
  getTeamAttendanceValidation,
  updateAttendanceValidation,

  // Notification
  getNotificationsValidation,
  getNotificationsByTypeValidation,
  markAsReadValidation,

  // Message
  sendMessageValidation,
  getMessagesValidation,
  getConversationByUserValidation
};
