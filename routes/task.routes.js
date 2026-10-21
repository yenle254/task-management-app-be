const { USER_ROLES } = require('../utils/constants.utils');
const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/async-handler.middleware');
const { protect, authorize } = require('../middleware/auth.middleware');
const { uploadSingle, uploadErrorHandler, uploadMultiple } = require('../middleware/upload.middleware');
const { validateRequest } = require('../middleware/validate-request.middleware');
const {
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
  assignTask,
  updateTaskStatus,
  updateTaskProgress,
  getMyTasks,
  getTeamTasks,
  addComment,
  getOverdueTasks,
  getTaskStats_endpoint,
  addAttachment,
  addAttachmentBulk,
  createSubtask,
  toggleSubtask,
  updateSubtask,
  deleteSubtask,
  getSubtasks
} = require('../controllers/task.controller');
const { getTeamOverdue } = require('../controllers/team-dashboard.controller');
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
} = require('../validators');

// All routes require authentication
router.use(protect);

// Main CRUD operations
router.post('/', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), createTaskValidation, validateRequest, asyncHandler(createTask));
router.get('/', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), getTasksValidation, validateRequest, asyncHandler(getAllTasks));
router.get('/my', getTasksValidation, validateRequest, asyncHandler(getMyTasks));
router.get('/stats', asyncHandler(getTaskStats_endpoint));
router.get('/overdue', getOverdueTasksValidation, validateRequest, asyncHandler(getOverdueTasks));
router.get('/:id', asyncHandler(getTaskById));
router.put('/:id', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), updateTaskValidation, validateRequest, asyncHandler(updateTask));
router.delete('/:id', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), asyncHandler(deleteTask));

// Task operations
router.post('/:id/assign', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), assignTaskValidation, validateRequest, asyncHandler(assignTask));
router.put('/:id/status', updateStatusValidation, validateRequest, asyncHandler(updateTaskStatus));
router.put('/:id/progress', updateProgressValidation, validateRequest, asyncHandler(updateTaskProgress));

// Comments
router.post('/:id/comments', addCommentValidation, validateRequest, asyncHandler(addComment));

// Team tasks (should be after :id route to avoid conflicts)
router.get('/team/:teamId', getTeamTasksValidation, validateRequest, asyncHandler(getTeamTasks));
router.get('/team/:teamId/overdue', getTeamTasksValidation, validateRequest, asyncHandler(getTeamOverdue));
router.post('/:id/attachments', uploadSingle, uploadErrorHandler, asyncHandler(addAttachment));
router.post('/:id/attachments/bulk', uploadMultiple, uploadErrorHandler, asyncHandler(addAttachmentBulk));

// Subtask routes
router.get('/:id/subtasks', asyncHandler(getSubtasks));
router.post('/:id/subtasks', createSubtaskValidation, validateRequest, asyncHandler(createSubtask));
router.put('/:id/subtasks/:subtaskId', updateSubtaskValidation, validateRequest, asyncHandler(toggleSubtask));
router.patch('/:id/subtasks/:subtaskId', updateSubtaskValidation, validateRequest, asyncHandler(updateSubtask));
router.delete('/:id/subtasks/:subtaskId', asyncHandler(deleteSubtask));

module.exports = router;