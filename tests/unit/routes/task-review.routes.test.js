const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../../../services/task-write-lock.service', () => {
  let tail = Promise.resolve();
  return { withTaskWriteLock: operation => { const result = tail.then(operation); tail = result.catch(() => {}); return result; }, journalTaskSave: async () => {}, getTaskBeforeImage: () => null };
});
jest.mock('../../../services/audit.service', () => ({ record: jest.fn(), target: (_, task) => ({ type: 'task', id: task._id }) }));
jest.mock('../../../services/task-review-notification.service', () => ({ notify: jest.fn() }));
const Task = require('../../../models/task.model');
const Team = require('../../../models/team.model');
const User = require('../../../models/user.model');
const audit = require('../../../services/audit.service');
const notifications = require('../../../services/task-review-notification.service');
const { verifyToken } = require('../../../config/jwt');
const service = require('../../../services/task-review.service');
const app = express(); app.use(express.json()); app.use('/api/tasks', require('../../../routes/task.routes'));
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ success: false, error: err.message }));
const id = () => new mongoose.Types.ObjectId();
const chain = value => ({ select() { return this; }, lean() { return this; }, populate() { return this; },
  sort() { return this; }, skip() { return this; }, limit() { return this; }, then(resolve) { return Promise.resolve(value).then(resolve); } });
let task, employee, lead, hr, actor, team;
beforeEach(() => {
  employee = { _id: id(), role: 'employee', isActive: true };
  lead = { _id: id(), role: 'team_lead', isActive: true };
  hr = { _id: id(), role: 'hr_manager', isActive: true };
  team = { _id: id(), leaderId: lead._id }; actor = employee;
  task = new Task({ title: 'Review me', assignedTo: [employee._id], assignedBy: lead._id, teamId: team._id, status: 'in_progress', progress: 100 });
  task.$locals.loadedStatus = 'in_progress'; task.isNew = false;
  const hook = Task.schema.s.hooks._pres.get('save').find(h => String(h.fn).includes('statusHistory.push'));
  task.save = jest.fn(async () => { await new Promise((resolve, reject) => hook.fn.call(task, err => err ? reject(err) : resolve())); return task; });
  task.populate = jest.fn().mockResolvedValue(task);
  verifyToken.mockImplementation(() => ({ id: String(actor._id) }));
  jest.spyOn(User, 'findById').mockImplementation(() => chain(actor));
  jest.spyOn(User, 'find').mockImplementation(() => chain([lead, hr]));
  jest.spyOn(Team, 'findById').mockImplementation(() => chain(team));
  jest.spyOn(Team, 'find').mockImplementation(() => chain([team]));
  jest.spyOn(Task, 'findById').mockImplementation(() => chain(task));
  jest.spyOn(Task, 'find').mockImplementation(() => chain([]));
  jest.spyOn(Task, 'exists').mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());
const call = (action, body = {}) => request(app).post(`/api/tasks/${task._id}/${action}`).set('Authorization', 'Bearer test').send(body);
test('submit, reject with full reason, resubmit and approve preserve every round and transition', async () => {
  expect((await call('submit', { note: 'Ready' })).status).toBe(200);
  expect(task.status).toBe('in_review'); expect(task.completedAt).toBeNull();
  actor = lead; const reason = 'x'.repeat(1000);
  expect((await call('request-changes', { reason })).status).toBe(200);
  expect(task.review.rounds[1].reason).toBe(reason);
  actor = employee; await call('submit'); actor = hr;
  expect((await call('approve')).status).toBe(200);
  expect(task.status).toBe('done'); expect(task.completedAt).toBeInstanceOf(Date);
  expect(task.review.currentRound).toBe(2);
  expect(task.review.rounds.map(e => e.type)).toEqual(['submitted', 'changes_requested', 'submitted', 'approved']);
  expect(task.statusHistory.map(e => e.to)).toEqual(['in_review', 'in_progress', 'in_review', 'done']);
  expect(audit.record).toHaveBeenCalledTimes(4); expect(notifications.notify).toHaveBeenCalledTimes(4);
  expect(audit.record.mock.calls[1][1]).toMatchObject({ action: 'task.review_rejected', reason, changes: [{ field: 'status', from: 'in_review', to: 'in_progress' }] });
});
test.each(['', '  ', 'x'.repeat(1001)])('invalid rejection reason never mutates the task', async reason => {
  await call('submit'); actor = lead; const count = task.review.rounds.length;
  expect((await call('request-changes', { reason })).status).toBe(400);
  expect(task.review.rounds).toHaveLength(count); expect(task.status).toBe('in_review');
});
test('assignee and system admin cannot approve; unrelated lead cannot approve', async () => {
  await call('submit'); expect((await call('approve')).status).toBe(403);
  actor = { _id: id(), role: 'system_admin', isActive: true }; expect((await call('approve')).status).toBe(403);
  actor = { _id: id(), role: 'team_lead', isActive: true }; expect((await call('approve')).status).toBe(403);
});
test('self-review is forbidden even for HR or an HR-assigned team lead', async () => {
  task.assignedTo.push(hr._id); await call('submit'); actor = hr;
  expect((await call('approve')).status).toBe(403);
  actor = lead; task.assignedTo.push(lead._id); task.assignedBy = hr._id;
  expect((await call('approve')).status).toBe(403);
});
test('old snapshot lead and current lead both retain review authority', async () => {
  await call('submit'); const old = lead; team.leaderId = id();
  expect(await service.canDecide(old, task)).toBe(true);
  expect(await service.canDecide({ _id: team.leaderId, role: 'team_lead' }, task)).toBe(true);
});
test('unfinished subtasks block submit; incomplete dependencies block approval only', async () => {
  task.subTasks.push({ title: 'Unfinished' }); expect((await call('submit')).status).toBe(400);
  task.subTasks[0].isCompleted = true; task.dependencies.push(id());
  expect((await call('submit')).status).toBe(200); actor = hr;
  Task.find.mockImplementation(() => chain([{ title: 'Dependency', status: 'in_review' }]));
  expect((await call('approve')).status).toBe(400); expect(task.status).toBe('in_review');
});
test('concurrent approve/reject and repeated approve produce exactly one decision', async () => {
  await call('submit'); actor = lead; audit.record.mockClear(); notifications.notify.mockClear();
  const results = await Promise.all([call('approve'), call('request-changes', { reason: 'Redo' })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect(task.statusHistory).toHaveLength(2); expect(audit.record).toHaveBeenCalledTimes(1); expect(notifications.notify).toHaveBeenCalledTimes(1);
  expect((await call('approve')).status).toBe(409);
});
test('withdraw allows a new submission without losing history; duplicate submit conflicts', async () => {
  await call('submit'); expect((await call('submit')).status).toBe(409);
  expect((await call('withdraw')).status).toBe(200); await call('submit');
  expect(task.review.currentRound).toBe(2); expect(task.review.rounds.map(e => e.type)).toEqual(['submitted', 'withdrawn', 'submitted']);
});
test.each(['progress', 'status', 'checklists', 'subtasks', 'dependencies'])('review locks %s mutations', async path => {
  await call('submit'); actor = hr;
  const bodies = { progress: { progress: 20 }, status: { status: 'in_progress' }, checklists: { title: 'New' }, subtasks: { title: 'New' }, dependencies: { dependencyIds: [] } };
  const method = ['progress', 'status'].includes(path) ? 'put' : 'post';
  const response = await request(app)[method](`/api/tasks/${task._id}/${path}`).set('Authorization', 'Bearer test').send(bodies[path]);
  expect(response.status).toBe(409); expect(task.status).toBe('in_review');
});
test('employee inbox access is forbidden and scope excludes own assignments', async () => {
  expect((await request(app).get('/api/tasks/pending-approval').set('Authorization', 'Bearer test')).status).toBe(403);
  const scope = await service.pendingScope(lead);
  expect(scope.assignedTo.$ne).toEqual(lead._id); expect(scope.$or[0].teamId.$in).toEqual([team._id]);
  expect(await service.pendingScope(hr)).toMatchObject({ status: 'in_review', assignedTo: { $ne: hr._id } });
});
test('HR reassignment resets review and preserves original submission', async () => {
  await call('submit'); const at = task.review.submittedAt;
  await expect(service.resetAssignment(lead, task)).rejects.toMatchObject({ statusCode: 403 });
  await service.resetAssignment(hr, task); await task.save();
  expect(task.status).toBe('in_progress'); expect(task.review.submittedAt).toEqual(at);
  expect(task.review.rounds.at(-1).type).toBe('reassigned');
});
