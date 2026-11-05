/** Progress is derived only for tasks with embedded subtasks. */
const recalculateProgress = (task) => {
  if (task.subTasks?.length) {
    task.progress = Math.round(100 * task.subTasks.filter(item => item.isCompleted).length / task.subTasks.length);
  }
  return task.progress;
};

const assertTaskNotDeleted = (task) => {
  if (!task || task.status === 'deleted') {
    const error = new Error('Task not found');
    error.statusCode = 404;
    throw error;
  }
  return task;
};

const removeAttachments = (task, ids) => {
  const removed = task.attachments.filter(item => ids.some(id => String(id) === String(item._id)));
  if (task.pendingAttachmentDeletes) task.pendingAttachmentDeletes.push(...removed.map(item => item.toObject ? item.toObject() : item));
  ids.forEach(id => task.attachments.pull(id));
  return removed;
};

const deleteAttachmentFiles = async (attachments, taskId) => {
  const { deleteFile } = require('../middleware/upload.middleware');
  const path = require('path');
  for (const attachment of attachments) {
    // Metadata can originate from client input. Never leave the uploads directory.
    if (!attachment.filename || path.basename(attachment.filename) !== attachment.filename || attachment.filename.includes('\\')) continue;
    try {
      // Existing/legacy metadata may share a file: keep it while referenced.
      const referenced = taskId && await model().exists({ 'attachments.filename': attachment.filename });
      if (!referenced) await deleteFile(attachment.filename, { throwOnError: true });
      if (taskId) await model().updateOne({ _id: taskId }, { $pull: { pendingAttachmentDeletes: { _id: attachment._id } } });
    } catch (error) {
      console.error('Delete attachment file error:', error.message);
    }
  }
};

// Lazy model lookup avoids a circular import from Task's lifecycle hooks.
const model = () => require('../models/task.model');
const idOf = value => String(value?._id || value || '');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const normalizeTags = tags => {
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 50)) {
    throw fail('Use at most 20 tags, each with 1–50 characters');
  }
  return [...new Set(tags.map(tag => tag.trim()))];
};
const syncActualMinutes = task => {
  task.actualMinutes = (task.timeEntries || []).reduce((sum, entry) => sum + entry.minutes, 0);
  return task.actualMinutes;
};
const getTaskChildren = taskId => model().find({ parentTaskId: taskId, status: { $ne: 'deleted' } });

const resolveParentTask = async (taskId, parentTaskId) => {
  if (idOf(taskId) === idOf(parentTaskId)) return { ok: false, error: 'A task cannot be its own parent' };
  const [task, parent] = await Promise.all([model().findById(taskId), model().findById(parentTaskId)]);
  if (!parent || parent.status === 'deleted') return { ok: false, error: 'Parent task not found' };
  if (!task || task.status === 'deleted') return { ok: false, error: 'Task not found' };
  if (parent.status === 'in_review') return { ok: false, error: 'Cannot change children of a task awaiting review' };
  if (parent.parentTaskId) return { ok: false, error: 'Only one parent-child level is allowed' };
  if (idOf(parent.teamId) !== idOf(task.teamId)) return { ok: false, error: 'Parent must belong to the same team' };
  if ((await getTaskChildren(taskId)).length) return { ok: false, error: 'A task with children cannot become a child' };
  if (parent.status === 'done' && task.status !== 'done') return { ok: false, error: 'Cannot add an incomplete child to a completed parent' };
  return { ok: true, parent };
};

const assertNoDependencyCycle = async (taskId, dependencyIds) => {
  const seen = new Set();
  let frontier = dependencyIds.map(idOf);
  while (frontier.length) {
    if (frontier.includes(idOf(taskId))) throw fail('Dependency cycle detected');
    const next = [...new Set(frontier)].filter(id => !seen.has(id));
    if (!next.length) break;
    next.forEach(id => seen.add(id));
    const tasks = await model().find({ _id: { $in: next } }).select('dependencies').lean();
    frontier = tasks.flatMap(task => (task.dependencies || []).map(idOf));
  }
  return true;
};

const validateDependencies = async (taskId, dependencyIds) => {
  const ids = [...new Set(dependencyIds.map(idOf))];
  if (ids.length > 20) throw fail('Maximum 20 dependencies');
  if (ids.includes(idOf(taskId))) throw fail('A task cannot depend on itself');
  const task = assertTaskNotDeleted(await model().findById(taskId));
  const dependencies = await model().find({ _id: { $in: ids }, status: { $ne: 'deleted' } }).lean();
  if (dependencies.length !== ids.length) throw fail('Dependency task not found');
  if (dependencies.some(item => idOf(item.teamId) !== idOf(task.teamId))) throw fail('Dependencies must belong to the same team');
  if (task.status === 'done' && dependencies.some(item => item.status !== 'done')) throw fail('Cannot complete task while blocked by: incomplete dependency');
  await assertNoDependencyCycle(taskId, ids);
  return dependencies;
};

const getBlockingTasks = async taskId => {
  const task = assertTaskNotDeleted(await model().findById(taskId));
  return model().find({ _id: { $in: task.dependencies || [] }, status: { $ne: 'done' } }).select('title status');
};

const canCompleteTask = async task => {
  const incomplete = (task.subTasks || []).filter(item => !item.isCompleted).length;
  if (incomplete) return { ok: false, error: `Cannot mark as done. ${incomplete} subtask(s) still incomplete.` };
  if (task.dependencies?.length) {
    const dependencies = await model().find({ _id: { $in: task.dependencies } }).select('title status').lean();
    const blocking = dependencies.filter(item => item.status !== 'done');
    if (blocking.length || dependencies.length !== task.dependencies.length) {
      return { ok: false, error: `Cannot complete task while blocked by: ${blocking.map(item => item.status === 'deleted' ? 'unavailable task' : item.title).join(', ') || 'missing dependency'}` };
    }
  }
  if (!task.isNew && (await getTaskChildren(task._id)).some(item => item.status !== 'done')) {
    return { ok: false, error: 'Cannot complete parent while child tasks are incomplete' };
  }
  return { ok: true };
};

const assertWatcher = async (task, userId) => {
  const user = await require('../models/user.model').findById(userId);
  if (!user?.isActive || !require('./task.service').canUserAccessTask(user, task)) throw fail('Watcher must be active and already have access to this task');
  if (!task.watchers.some(id => idOf(id) === idOf(userId)) && task.watchers.length >= 50) throw fail('Maximum 50 watchers');
  return user;
};

/** Synchronize the one-level parent through save(), preserving transition history. */
const syncParentTask = async (parentId, actor) => {
  if (!parentId) return;
  const parent = await model().findById(parentId);
  if (!parent || parent.status === 'deleted') return;
  const children = await getTaskChildren(parentId);
  if (!children.length) return;
  const allowed = await canCompleteTask(parent);
  const nextStatus = allowed.ok ? (['done', 'in_review'].includes(parent.status) ? parent.status : 'in_progress') : parent.status === 'done' ? 'in_progress' : parent.status;
  if (parent.status === nextStatus) return;
  parent.$locals.previousStatus = parent.status;
  parent.$locals.statusChangedBy = actor;
  parent.status = nextStatus;
  await parent.save();
};

const { parseDate, validateDateRange, normalizeRange } = require('../utils/dashboard.helper');
const resolveRange = (from, to, required = false) => {
  if (!required && from === undefined && to === undefined) return null;
  if (!from || !to) throw fail('Both from and to dates are required');
  const check = validateDateRange(from, to);
  if (!check.valid) throw fail(check.error);
  return normalizeRange(parseDate(from), parseDate(to));
};
const SORTS = {
  createdAt_asc: { createdAt: 1, _id: 1 }, createdAt_desc: { createdAt: -1, _id: 1 },
  dueDate_asc: { dueDate: 1, _id: 1 }, dueDate_desc: { dueDate: -1, _id: 1 },
  priority_asc: { priorityRank: 1, _id: 1 }, priority_desc: { priorityRank: -1, _id: 1 },
  title_asc: { title: 1, _id: 1 }
};
/** Tags use AND semantics: a matching task must contain every requested tag. */
const applyListFilters = (query, input, self = false) => {
  if (input.tags) query.tags = { $all: normalizeTags(input.tags.split(',')) };
  const range = resolveRange(input.fromDate, input.toDate);
  if (range) query.dueDate = { $gte: range.startDate, $lte: range.endDate };
  if (!self && input.assigneeId) query.assignedTo = input.assigneeId;
  if (input.hasSubtasks !== undefined) query['subTasks.0'] = { $exists: input.hasSubtasks === true || input.hasSubtasks === 'true' };
  if (input.search) {
    const literal = input.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = ['title', 'description', 'tags'].map(field => ({ [field]: { $regex: literal, $options: 'i' } }));
  }
  return query;
};
const USER_FIELDS = 'profile.fullName profile.position profile.avatar email';
const findListTasks = async (query, input, defaultSort) => {
  const sort = SORTS[input.sort] || defaultSort;
  const page = Number(input.page || 1);
  const limit = Number(input.limit || 100);
  if (input.sort?.startsWith('priority_')) {
    // Explicit rank gives low < medium < high; alphabetic sorting is incorrect.
    const cast = model().find(query).cast(model());
    const tasks = await model().aggregate([
      { $match: cast },
      { $addFields: { priorityRank: { $indexOfArray: [['low', 'medium', 'high'], '$priority'] } } },
      { $sort: sort }, { $skip: (page - 1) * limit }, { $limit: limit }, { $unset: 'priorityRank' }
    ]);
    return model().populate(tasks, [
      { path: 'assignedTo assignedBy', select: USER_FIELDS }, { path: 'teamId', select: 'name' }
    ]);
  }
  return model().find(query).populate('assignedBy', USER_FIELDS).populate('assignedTo', USER_FIELDS)
    .populate('teamId', 'name').sort(sort).skip((page - 1) * limit).limit(limit);
};

module.exports = {
  recalculateProgress, assertTaskNotDeleted, removeAttachments, deleteAttachmentFiles,
  idOf, fail, normalizeTags, syncActualMinutes, getTaskChildren, resolveParentTask,
  assertNoDependencyCycle, validateDependencies, getBlockingTasks, canCompleteTask,
  assertWatcher, syncParentTask, resolveRange, SORTS, applyListFilters, findListTasks, USER_FIELDS
};
