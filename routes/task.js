const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { uploadSingle, uploadErrorHandler, uploadMultiple } = require('../middleware/upload');
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
  // Subtask operations
  createSubtask,
  toggleSubtask,
  updateSubtask,
  deleteSubtask,
  getSubtasks
} = require('../controllers/taskController');

// All routes require authentication
router.use(protect);

// Main CRUD operations
router.post('/', authorize('team_lead', 'hr_manager'), createTask);
router.get('/', authorize('team_lead', 'hr_manager'), getAllTasks); // only hr managers and team leads of the same team can access
router.get('/my', getMyTasks);
router.get('/stats', getTaskStats_endpoint);
router.get('/overdue', getOverdueTasks);
router.get('/:id', getTaskById); // only hr managers, team leads of the same team, creators, and assignees can access
router.put('/:id', authorize('team_lead', 'hr_manager'), updateTask);
router.delete('/:id', authorize('team_lead', 'hr_manager'), deleteTask);  // delete is soft delete ~ sets status to 'deleted'

// Task operations
router.post('/:id/assign', authorize('team_lead', 'hr_manager'), assignTask); // assign task to users again ~ reassign/ a new list of users
router.put('/:id/status', updateTaskStatus);
router.put('/:id/progress', updateTaskProgress);

// Comments
router.post('/:id/comments', addComment);

// Team tasks (should be after :id route to avoid conflicts)
router.get('/team/:teamId', getTeamTasks);
router.post('/:id/attachments', uploadSingle, uploadErrorHandler, addAttachment);  // single attachment upload after has been implemented
router.post('/:id/attachments/bulk', uploadMultiple, uploadErrorHandler, addAttachmentBulk); // multiple attachment upload after has been implemented

// Subtask routes
router.get('/:id/subtasks', getSubtasks);                    // Get all subtasks
router.post('/:id/subtasks', createSubtask);                 // Create subtask
router.put('/:id/subtasks/:subtaskId', toggleSubtask);       // Toggle subtask completion
router.patch('/:id/subtasks/:subtaskId', updateSubtask);     // Update subtask title/status
router.delete('/:id/subtasks/:subtaskId', deleteSubtask);    // Delete subtask

module.exports = router;