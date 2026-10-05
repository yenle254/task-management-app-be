const express = require('express');
const router = express.Router();
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
router.post('/', authorize('team_lead', 'hr_manager'), createTaskValidation, validateRequest, createTask);
router.get('/', authorize('team_lead', 'hr_manager'), getTasksValidation, validateRequest, getAllTasks);
router.get('/my', getTasksValidation, validateRequest, getMyTasks);
router.get('/stats', getTaskStats_endpoint);
router.get('/overdue', getOverdueTasksValidation, validateRequest, getOverdueTasks);
router.get('/:id', getTaskById);
router.put('/:id', authorize('team_lead', 'hr_manager'), updateTaskValidation, validateRequest, updateTask);
router.delete('/:id', authorize('team_lead', 'hr_manager'), getTaskById);

// Task operations
router.post('/:id/assign', authorize('team_lead', 'hr_manager'), assignTaskValidation, validateRequest, assignTask);
router.put('/:id/status', updateStatusValidation, validateRequest, updateTaskStatus);
router.put('/:id/progress', updateProgressValidation, validateRequest, updateTaskProgress);

// Comments
router.post('/:id/comments', addCommentValidation, validateRequest, addComment);

// Team tasks (should be after :id route to avoid conflicts)
router.get('/team/:teamId', getTeamTasksValidation, validateRequest, getTeamTasks);
router.post('/:id/attachments', uploadSingle, uploadErrorHandler, addAttachment);
router.post('/:id/attachments/bulk', uploadMultiple, uploadErrorHandler, addAttachmentBulk);

// Subtask routes
router.get('/:id/subtasks', getSubtasks);
router.post('/:id/subtasks', createSubtaskValidation, validateRequest, createSubtask);
router.put('/:id/subtasks/:subtaskId', updateSubtaskValidation, validateRequest, toggleSubtask);
router.patch('/:id/subtasks/:subtaskId', updateSubtaskValidation, validateRequest, updateSubtask);
router.delete('/:id/subtasks/:subtaskId', getSubtasks);

module.exports = router;