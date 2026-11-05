const Task = require('../models/task.model');
const service = require('../services/task-review.service');
const { assertTaskNotDeleted, USER_FIELDS } = require('../services/task-advanced.service');
const { enrichTask } = require('../services/task.service');
const audit = require('../services/audit.service');
const actions = { submitForReview: 'task.submitted_for_review', approveReview: 'task.review_approved',
  requestChanges: 'task.review_rejected', withdrawSubmission: 'task.review_withdrawn' };
const handlers = {};
for (const operation of Object.keys(actions)) handlers[operation] = async (req, res) => {
  try {
    const task = assertTaskNotDeleted(await Task.findById(req.params.id));
    const before = task.status;
    await service[operation](req.user, task, req.body);
    res.locals ||= {};
    res.locals.auditTaskEvent = { action: actions[operation], target: audit.target('task', task),
      changes: [{ field: 'status', from: before, to: task.status }], reason: req.body.reason };
    // Wrapper delivers only after the task write/parent synchronization commits.
    res.locals.taskReviewNotification = { operation, task: task.toObject(), actorId: req.user._id, reason: req.body.reason };
    await task.populate('assignedBy assignedTo review.submittedBy review.rounds.by', USER_FIELDS);
    res.json({ success: true, data: enrichTask(task) });
  } catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
};
handlers.findPendingApproval = async (req, res) => {
  try { res.json(await service.findPendingApproval(req.user, req.query)); }
  catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
};
handlers.pendingApprovalStats = async (req, res) => {
  try { res.json({ success: true, data: await service.pendingApprovalStats(req.user, req.query) }); }
  catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
};
module.exports = handlers;
