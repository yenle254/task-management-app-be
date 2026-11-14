const Task = require('../models/task.model');
const { canUserAccessTask, canUserViewTask, enrichTask, enrichTasks } = require('../services/task.service');
const service = require('../services/task-advanced.service');
const { parseDate } = require('../utils/dashboard.helper');

const loadTask = async (req) => {
  const task = service.assertTaskNotDeleted(await Task.findById(req.params.id));
  const isRead = ['GET', 'HEAD'].includes(req.method);
  const allowed = isRead ? canUserViewTask(req.user, task) : canUserAccessTask(req.user, task);
  if (!allowed && !await require('../services/task-review.service').canDecide(req.user, task)) throw service.fail('Not authorized', 403);
  if (!isRead) require('../services/task-review.service').assertNotInReview(task);
  return task;
};
const saveTask = async (task, user) => {
  task.$locals.statusChangedBy = user._id;
  await task.save();
  await task.populate([
    { path: 'assignedTo assignedBy watchers statusHistory.by timeEntries.userId', select: service.USER_FIELDS },
    { path: 'teamId', select: 'name' }
  ]);
  return enrichTask(task);
};
const resource = (items, id, label) => {
  if (!require('mongoose').Types.ObjectId.isValid(id)) throw service.fail(`${label} not found`, 404);
  const item = items.id(id);
  if (!item) throw service.fail(`${label} not found`, 404);
  return item;
};
const withTask = handler => async (req, res) => handler(req, res, await loadTask(req));

exports.setParentTask = withTask(async (req, res, task) => {
  const result = await service.resolveParentTask(task._id, req.body.parentTaskId);
  if (!result.ok) throw service.fail(result.error);
  if (!canUserAccessTask(req.user, result.parent)) throw service.fail('Not authorized to access parent', 403);
  const previous = task.parentTaskId;
  if (previous) { const oldParent = await Task.findById(previous); if (oldParent) require('../services/task-review.service').assertNotInReview(oldParent); }
  task.parentTaskId = result.parent._id;
  const data = await saveTask(task, req.user);
  if (previous && service.idOf(previous) !== service.idOf(task.parentTaskId)) await service.syncParentTask(previous, req.user._id);
  res.json({ success: true, data });
});
exports.removeParentTask = withTask(async (req, res, task) => {
  const previous = task.parentTaskId;
  if (previous) { const oldParent = await Task.findById(previous); if (oldParent) require('../services/task-review.service').assertNotInReview(oldParent); }
  task.parentTaskId = null;
  const data = await saveTask(task, req.user);
  await service.syncParentTask(previous, req.user._id);
  res.json({ success: true, data });
});
exports.getTaskChildren = withTask(async (req, res, task) => {
  const children = await service.getTaskChildren(task._id).populate('assignedTo assignedBy', service.USER_FIELDS);
  const data = enrichTasks(children.filter(child => canUserViewTask(req.user, child)));
  res.json({ success: true, count: data.length, data });
});
exports.addChecklist = withTask(async (req, res, task) => {
  task.checklists.push({ title: req.body.title });
  const checklist = task.checklists[task.checklists.length - 1];
  res.status(201).json({ success: true, data: { task: await saveTask(task, req.user), checklist } });
});
exports.checklistMutation = action => withTask(async (req, res, task) => {
  const checklist = resource(task.checklists, req.params.checklistId, 'Checklist');
  if (action === 'delete') task.checklists.pull(checklist._id);
  if (action === 'update') checklist.title = req.body.title;
  if (action === 'addItem') checklist.items.push({ text: req.body.text });
  if (action === 'updateItem' || action === 'deleteItem') {
    const item = resource(checklist.items, req.params.itemId, 'Checklist item');
    if (action === 'deleteItem') checklist.items.pull(item._id);
    else for (const field of ['text', 'isCompleted']) if (req.body[field] !== undefined) item[field] = req.body[field];
  }
  const data = { task: await saveTask(task, req.user) };
  if (action !== 'delete') data.checklist = checklist;
  res.json({ success: true, data });
});
exports.addDependencies = withTask(async (req, res, task) => {
  const ids = [...new Set([...task.dependencies.map(service.idOf), ...req.body.dependencyIds])];
  const dependencies = await service.validateDependencies(task._id, ids);
  if (dependencies.some(item => !canUserAccessTask(req.user, item))) throw service.fail('Not authorized to access dependency', 403);
  task.dependencies = ids;
  res.json({ success: true, data: await saveTask(task, req.user) });
});
exports.removeDependency = withTask(async (req, res, task) => {
  task.dependencies.pull(req.params.dependencyId);
  res.json({ success: true, data: await saveTask(task, req.user) });
});
exports.getDependencies = withTask(async (req, res, task) => {
  const dependencies = await Task.find({ _id: { $in: task.dependencies }, status: { $ne: 'deleted' } }).lean();
  const visible = dependencies.filter(item => canUserViewTask(req.user, item)).map(({ _id, title, status }) => ({ _id, title, status }));
  res.json({ success: true, count: visible.length, data: { blocking: visible.filter(item => item.status !== 'done'), blockedBy: visible } });
});
exports.addWatcher = withTask(async (req, res, task) => {
  await service.assertWatcher(task, req.body.userId);
  task.watchers.addToSet(req.body.userId);
  res.json({ success: true, data: await saveTask(task, req.user) });
});
exports.removeWatcher = withTask(async (req, res, task) => {
  if (req.user.role !== 'hr_manager' && service.idOf(task.assignedBy) !== service.idOf(req.user)) throw service.fail('Only HR or task creator can remove watchers', 403);
  task.watchers.pull(req.params.userId);
  res.json({ success: true, data: await saveTask(task, req.user) });
});
exports.getWatchers = withTask(async (req, res, task) => {
  await task.populate('watchers', service.USER_FIELDS);
  res.json({ success: true, count: task.watchers.length, data: task.watchers });
});
exports.getWatchingTasks = async (req, res) => {
  const tasks = await Task.find({ watchers: req.user._id, status: { $ne: 'deleted' } })
    .populate('assignedTo assignedBy', service.USER_FIELDS).lean();
  const data = enrichTasks(tasks.filter(task => canUserViewTask(req.user, task)));
  res.json({ success: true, count: data.length, data });
};
exports.setTags = withTask(async (req, res, task) => {
  task.tags = service.normalizeTags(req.body.tags);
  res.json({ success: true, data: await saveTask(task, req.user) });
});
exports.updateEstimate = withTask(async (req, res, task) => {
  for (const field of ['estimatedMinutes', 'storyPoints']) if (req.body[field] !== undefined) task[field] = req.body[field];
  res.json({ success: true, data: await saveTask(task, req.user) });
});
exports.addTimeEntry = withTask(async (req, res, task) => {
  task.timeEntries.push({ userId: req.user._id, minutes: req.body.minutes, note: req.body.note });
  service.syncActualMinutes(task);
  const data = await saveTask(task, req.user);
  res.status(201).json({ success: true, data: { task: data, timeEntry: data.timeEntries[data.timeEntries.length - 1] } });
});
exports.deleteTimeEntry = withTask(async (req, res, task) => {
  const entry = resource(task.timeEntries, req.params.entryId, 'Time entry');
  if (req.user.role !== 'hr_manager' && service.idOf(entry.userId) !== service.idOf(req.user)) throw service.fail('Only entry author or HR can delete time entries', 403);
  task.timeEntries.pull(entry._id);
  service.syncActualMinutes(task);
  res.json({ success: true, data: await saveTask(task, req.user) });
});
exports.getTimeEntries = withTask(async (req, res, task) => {
  await task.populate('timeEntries.userId', service.USER_FIELDS);
  res.json({ success: true, count: task.timeEntries.length, totalMinutes: service.syncActualMinutes(task), data: task.timeEntries });
});
exports.deleteAttachment = withTask(async (req, res, task) => {
  const pending = task.pendingAttachmentDeletes?.find(item => service.idOf(item) === req.params.attachmentId);
  if (pending && !task.attachments.id(req.params.attachmentId)) {
    await service.deleteAttachmentFiles([pending], task._id);
    return res.json({ success: true, data: require('../services/task.service').enrichTask(task) });
  }
  resource(task.attachments, req.params.attachmentId, 'Attachment');
  const removed = service.removeAttachments(task, [req.params.attachmentId]);
  const data = await saveTask(task, req.user);
  await service.deleteAttachmentFiles(removed, task._id);
  res.json({ success: true, data });
});
exports.getTaskHistory = withTask(async (req, res, task) => {
  await task.populate('statusHistory.by', service.USER_FIELDS);
  const data = [...task.statusHistory].sort((a, b) => a.at - b.at);
  res.json({ success: true, count: data.length, data });
});

const viewScope = async (req, board = false) => {
  const query = { status: { $ne: 'deleted' } };
  const teamScope = board || req.query.scope === 'team' || !!req.query.teamId;
  if (!teamScope) return { ...query, assignedTo: req.user._id };
  if (!['hr_manager', 'team_lead'].includes(req.user.role)) throw service.fail('Not authorized for team scope', 403);
  const teamId = req.query.teamId;
  if (req.user.role === 'team_lead') {
    if (!teamId) throw service.fail('teamId is required for team scope');
    if (service.idOf(req.user.teamId) !== service.idOf(teamId)) throw service.fail('Team lead can only view their own team', 403);
  }
  if (teamId) {
    const result = await require('../services/team-dashboard.service').resolveReadableTeam(req.user, teamId);
    if (!result.ok) throw service.fail(result.error, result.status);
    query.teamId = result.team._id;
  }
  return query;
};
exports.getBoard = async (req, res) => {
  const query = await viewScope(req, true);
  if (!req.query.includeSubtasks) query.parentTaskId = null;
  const tasks = await Task.find(query).populate('assignedTo assignedBy', service.USER_FIELDS).lean();
  const data = { todo: [], in_progress: [], in_review: [], done: [] };
  for (const task of enrichTasks(tasks)) if (data[task.status]) data[task.status].push(task);
  const counts = {};
  for (const status of Object.keys(data)) {
    data[status].sort((a, b) => {
      const ad = a.dueDate ? parseDate(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? parseDate(b.dueDate).getTime() : Infinity;
      return (ad === bd ? 0 : ad - bd) || (parseDate(b.createdAt)?.getTime() || 0) - (parseDate(a.createdAt)?.getTime() || 0) || String(a._id).localeCompare(String(b._id));
    });
    counts[status] = data[status].length;
  }
  res.json({ success: true, data, counts });
};
exports.getCalendar = async (req, res) => {
  const query = await viewScope(req);
  const range = service.resolveRange(req.query.from, req.query.to, true);
  query.$or = [
    { dueDate: { $gte: range.startDate, $lte: range.endDate } },
    { startDate: { $lte: range.endDate }, dueDate: { $gte: range.startDate } }
  ];
  const data = await Task.find(query).select('title status priority startDate dueDate assignedTo assignedBy progress dependencies parentTaskId')
    .populate('assignedTo assignedBy', service.USER_FIELDS).sort({ dueDate: 1, _id: 1 }).lean();
  res.json({ success: true, count: data.length, data });
};
exports.getTimeline = exports.getCalendar;
