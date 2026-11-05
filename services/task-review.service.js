const Task = require('../models/task.model');
const Team = require('../models/team.model');
const User = require('../models/user.model');
const { idOf, fail, canCompleteTask, findListTasks } = require('./task-advanced.service');
const { enrichTasks } = require('./task.service');
const SLA_MS = 24 * 60 * 60 * 1000;
const isAssignee = (actor, task) => (task.assignedTo || []).some(id => idOf(id) === idOf(actor));
const assertNotInReview = task => {
  if (task.status === 'in_review') throw fail('Task content is locked while awaiting review. Withdraw or request changes first.', 409);
};
async function canDecide(actor, task) {
  if (actor.isActive === false || isAssignee(actor, task)) return false;
  if (actor.role === 'hr_manager') return true;
  if (actor.role !== 'team_lead') return false;
  if (task.review?.approverSnapshot?.some(entry => entry.active !== false && entry.role === 'team_lead' && idOf(entry.userId) === idOf(actor))) return true;
  const team = task.teamId?.leaderId ? task.teamId : await Team.findById(idOf(task.teamId)).select('leaderId').lean();
  return !!team && idOf(team.leaderId) === idOf(actor);
}
async function resolveApprovers(task) {
  const team = await Team.findById(idOf(task.teamId)).select('leaderId').lean();
  const users = await User.find({ isActive: true, $or: [
    { role: 'hr_manager' }, ...(team?.leaderId ? [{ _id: team.leaderId, role: 'team_lead' }] : [])
  ] }).select('_id role').lean();
  return users.filter(user => !isAssignee(user, task)).map(user => ({ userId: user._id, role: user.role, resolvedAt: new Date(), active: true }));
}
function append(task, actor, type, input = {}) {
  task.review.rounds.push({ round: task.review.currentRound, type, by: actor._id, at: new Date(), ...input });
}
function transition(task, actor, status) {
  task.$locals.previousStatus = task.status;
  task.$locals.statusChangedBy = actor._id;
  task.status = status;
}
async function submitForReview(actor, task, input = {}) {
  if (!isAssignee(actor, task) || actor.role === 'system_admin') throw fail('Only an assignee can submit this task for review', 403);
  if (task.status === 'in_review') throw fail('Task is already awaiting review', 409);
  if (task.status !== 'in_progress') throw fail('Only an in-progress task can be submitted for review');
  const incomplete = (task.subTasks || []).filter(item => !item.isCompleted).length;
  if (incomplete) throw fail(`Cannot submit for review. ${incomplete} subtask(s) still incomplete.`);
  const approvers = await resolveApprovers(task);
  if (!approvers.length) throw fail('No active task approver is available', 409);
  task.review ||= { rounds: [], currentRound: 0 };
  task.review.currentRound = (task.review.currentRound || 0) + 1;
  task.review.submittedBy = actor._id;
  task.review.submittedAt = new Date();
  task.review.note = input.note || '';
  task.review.approverSnapshot = approvers;
  task.review.remindedAt = null;
  append(task, actor, 'submitted', { note: input.note || '' });
  transition(task, actor, 'in_review');
  await task.save();
  return task;
}
async function assertDecision(actor, task) {
  if (!await canDecide(actor, task)) throw fail(isAssignee(actor, task) ? 'You cannot review a task you are assigned to' : 'Only the assigned team lead or HR can approve this task', 403);
  if (task.status !== 'in_review') throw fail('Task is no longer awaiting review', 409);
}
async function approveReview(actor, task, input = {}) {
  await assertDecision(actor, task);
  const completion = await canCompleteTask(task);
  if (!completion.ok) throw fail(completion.error);
  append(task, actor, 'approved', { note: input.note || '' });
  transition(task, actor, 'done');
  task.progress = 100;
  task.$locals.reviewApproved = true;
  await task.save();
  return task;
}
async function requestChanges(actor, task, input = {}) {
  await assertDecision(actor, task);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > 1000) throw fail('A reason of 1–1000 characters is required when requesting changes');
  append(task, actor, 'changes_requested', { reason });
  transition(task, actor, 'in_progress');
  await task.save();
  return task;
}
async function withdrawSubmission(actor, task) {
  if (!isAssignee(actor, task)) throw fail('Only an assignee can withdraw this submission', 403);
  if (task.status !== 'in_review') throw fail('Task is no longer awaiting review', 409);
  append(task, actor, 'withdrawn');
  transition(task, actor, 'in_progress');
  await task.save();
  return task;
}
async function resetAssignment(actor, task) {
  if (task.status !== 'in_review') return;
  if (actor.role !== 'hr_manager') throw fail('Only HR can reassign a task awaiting review', 403);
  task.review.approverSnapshot = await resolveApprovers(task);
  append(task, actor, 'reassigned');
  transition(task, actor, 'in_progress');
}
async function pendingScope(actor, input = {}) {
  if (!['team_lead', 'hr_manager'].includes(actor.role)) throw fail('You are not a task approver', 403);
  const query = { status: 'in_review', assignedTo: { $ne: actor._id } };
  if (actor.role === 'team_lead') {
    const teams = await Team.find({ leaderId: actor._id }).select('_id').lean();
    const snapshot = { 'review.approverSnapshot': { $elemMatch: { userId: actor._id, role: 'team_lead', active: { $ne: false } } } };
    if (!teams.length && !await Task.exists({ ...query, ...snapshot })) throw fail('You are not a task approver', 403);
    query.$or = [{ teamId: { $in: teams.map(team => team._id) } }, snapshot];
  }
  if (input.teamId) query.teamId = input.teamId;
  if (input.overdueSla === true || input.overdueSla === 'true') query['review.submittedAt'] = { $lt: new Date(Date.now() - SLA_MS) };
  return query;
}
async function findPendingApproval(actor, input = {}) {
  const query = await pendingScope(actor, input);
  const page = Number(input.page || 1), limit = Number(input.limit || 20);
  const [tasks, total] = await Promise.all([
    findListTasks(query, { page, limit, sort: 'createdAt_desc' }), Task.countDocuments(query)
  ]);
  await Task.populate(tasks, { path: 'review.submittedBy', select: 'profile.fullName' });
  return { success: true, data: enrichTasks(tasks), count: tasks.length, total, page, pages: Math.ceil(total / limit) };
}
async function pendingApprovalStats(actor, input = {}) {
  const scope = await pendingScope(actor, input);
  const query = Task.find(scope).cast(Task);
  const rows = await Task.aggregate([{ $match: query }, { $group: { _id: '$teamId', pending: { $sum: 1 },
    overdueSla: { $sum: { $cond: [{ $lt: ['$review.submittedAt', new Date(Date.now() - SLA_MS)] }, 1, 0] } } } }]);
  return { pending: rows.reduce((n, row) => n + row.pending, 0), overdueSla: rows.reduce((n, row) => n + row.overdueSla, 0),
    byTeam: rows.map(row => ({ teamId: row._id, pending: row.pending, overdueSla: row.overdueSla })) };
}
module.exports = { SLA_MS, isAssignee, assertNotInReview, canDecide, resolveApprovers, submitForReview, approveReview,
  requestChanges, withdrawSubmission, resetAssignment, pendingScope, findPendingApproval, pendingApprovalStats };
