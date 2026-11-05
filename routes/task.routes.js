const { USER_ROLES } = require('../utils/constants.utils');
const express = require('express');
const router = express.Router();
const catchAsync = require('../middleware/async-handler.middleware');
const { withTaskWriteLock } = require('../services/task-write-lock.service');
const audit = require('../services/audit.service');
// Acquire before the controller loads a document. Holding only around save()
// would still allow stale validation and lost embedded-array/total updates.
const asyncHandler = handler => catchAsync(async (req, res, next) => {
  if (['GET', 'HEAD'].includes(req.method)) return handler(req, res, next);
  // Defer the response until writes/compensation and lock release finish.
  const json = res.json;
  let body;
  let handlerStarted = false;
  res.json = value => { body = value; return res; };
  try {
    await withTaskWriteLock(() => {
      handlerStarted = true;
      return handler(req, res, next);
    }, () => res.statusCode >= 400);
  } catch (error) {
    // Multer runs before this wrapper. If acquiring the lock failed, no
    // controller could attach these newly uploaded files to a task.
    if (!handlerStarted) {
      for (const file of [...(req.files || []), ...(req.file ? [req.file] : [])]) {
        await deleteFile(file.filename);
      }
    }
    throw error;
  } finally { res.json = json; }
  if (res.statusCode < 400 && res.locals?.auditTaskEvent) audit.record(req, res.locals.auditTaskEvent);
  if (res.statusCode < 400 && res.locals?.taskReviewNotification) await require('../services/task-review-notification.service').notify(res.locals.taskReviewNotification);
  return res.json(body);
});
const { protect, authorize } = require('../middleware/auth.middleware');
const { uploadSingle, uploadErrorHandler, uploadMultiple, deleteFile } = require('../middleware/upload.middleware');
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
const review = require('../controllers/task-review.controller');
const { reviewValidation, pendingApprovalValidation } = require('../validators/task.validators');
const getMyTasks = require('../controllers/my-tasks.controller');
const advanced = require('../controllers/task-advanced.controller');
const { advancedTaskValidation: rules, taskViewValidation } = require('../validators');
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
router.get('/watching/me', asyncHandler(advanced.getWatchingTasks));
router.get('/board', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), taskViewValidation(), validateRequest, asyncHandler(advanced.getBoard));
router.get('/calendar', taskViewValidation(true), validateRequest, asyncHandler(advanced.getCalendar));
router.get('/timeline', taskViewValidation(true), validateRequest, asyncHandler(advanced.getTimeline));

router.post('/:id/parent', rules('parent'), validateRequest, asyncHandler(advanced.setParentTask));
router.delete('/:id/parent', rules(), validateRequest, asyncHandler(advanced.removeParentTask));
router.get('/:id/children', rules(), validateRequest, asyncHandler(advanced.getTaskChildren));
router.post('/:id/checklists', rules('checklist'), validateRequest, asyncHandler(advanced.addChecklist));
router.patch('/:id/checklists/:checklistId', rules('checklist', ['checklistId']), validateRequest, asyncHandler(advanced.checklistMutation('update')));
router.delete('/:id/checklists/:checklistId', rules(null, ['checklistId']), validateRequest, asyncHandler(advanced.checklistMutation('delete')));
router.post('/:id/checklists/:checklistId/items', rules('item', ['checklistId']), validateRequest, asyncHandler(advanced.checklistMutation('addItem')));
router.patch('/:id/checklists/:checklistId/items/:itemId', rules('patchItem', ['checklistId', 'itemId']), validateRequest, asyncHandler(advanced.checklistMutation('updateItem')));
router.delete('/:id/checklists/:checklistId/items/:itemId', rules(null, ['checklistId', 'itemId']), validateRequest, asyncHandler(advanced.checklistMutation('deleteItem')));
router.post('/:id/dependencies', rules('dependencies'), validateRequest, asyncHandler(advanced.addDependencies));
router.delete('/:id/dependencies/:dependencyId', rules(null, ['dependencyId']), validateRequest, asyncHandler(advanced.removeDependency));
router.get('/:id/dependencies', rules(), validateRequest, asyncHandler(advanced.getDependencies));
router.post('/:id/watchers', rules('watcher'), validateRequest, asyncHandler(advanced.addWatcher));
router.delete('/:id/watchers/:userId', rules(null, ['userId']), validateRequest, asyncHandler(advanced.removeWatcher));
router.get('/:id/watchers', rules(), validateRequest, asyncHandler(advanced.getWatchers));
router.post('/:id/tags', rules('tags'), validateRequest, asyncHandler(advanced.setTags));
router.put('/:id/estimate', rules('estimate'), validateRequest, asyncHandler(advanced.updateEstimate));
router.post('/:id/time-entries', rules('time'), validateRequest, asyncHandler(advanced.addTimeEntry));
router.get('/:id/time-entries', rules(), validateRequest, asyncHandler(advanced.getTimeEntries));
router.delete('/:id/time-entries/:entryId', rules(null, ['entryId']), validateRequest, asyncHandler(advanced.deleteTimeEntry));
router.delete('/:id/attachments/:attachmentId', rules(), validateRequest, asyncHandler(advanced.deleteAttachment));
router.get('/:id/history', rules(), validateRequest, asyncHandler(advanced.getTaskHistory));
router.get('/pending-approval', pendingApprovalValidation, validateRequest, asyncHandler(review.findPendingApproval));
router.get('/pending-approval/stats', pendingApprovalValidation, validateRequest, asyncHandler(review.pendingApprovalStats));
router.post('/:id/submit', reviewValidation(), validateRequest, asyncHandler(review.submitForReview));
router.post('/:id/approve', reviewValidation(), validateRequest, asyncHandler(review.approveReview));
router.post('/:id/request-changes', reviewValidation(true), validateRequest, asyncHandler(review.requestChanges));
router.post('/:id/withdraw', reviewValidation(), validateRequest, asyncHandler(review.withdrawSubmission));
router.get('/:id', asyncHandler(getTaskById));
router.put('/:id', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), updateTaskValidation, validateRequest, asyncHandler(updateTask));
router.delete('/:id', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), asyncHandler(deleteTask));

// Task operations
router.post('/:id/assign', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), assignTaskValidation, validateRequest, asyncHandler(assignTask));
router.put('/:id/status', updateStatusValidation, reviewValidation(), validateRequest, asyncHandler(updateTaskStatus));
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
