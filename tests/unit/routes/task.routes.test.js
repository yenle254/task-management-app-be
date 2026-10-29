const express = require('express');
jest.mock('../../../services/task-write-lock.service', () => ({ withTaskWriteLock: operation => operation(), journalTaskSave: async () => {} }));
const request = require('supertest');
const mongoose = require('mongoose');
const User = require('../../../models/user.model');
const Team = require('../../../models/team.model');
const Task = require('../../../models/task.model');
const { verifyToken } = require('../../../config/jwt');
const controller = require('../../../controllers/task.controller');
const upload = require('../../../middleware/upload.middleware');
jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../../../services/notification.service', () => ({
  notifyTaskAssigned: jest.fn(), notifyTaskUpdated: jest.fn(),
  notifyTaskCompleted: jest.fn(), notifyCommentAdded: jest.fn()
}));
const app = express();
app.use(express.json());
app.use('/api/tasks', require('../../../routes/task.routes'));
const owner = new mongoose.Types.ObjectId();
const teamId = new mongoose.Types.ObjectId();
let user;
let task;
beforeEach(() => {
  jest.spyOn(Task, 'exists').mockResolvedValue(null);
  jest.spyOn(Task, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
  user = { _id: owner, role: 'hr_manager', isActive: true, teamId };
  verifyToken.mockReturnValue({ id: String(owner) });
  jest.spyOn(User, 'findById').mockReturnValue({ select: async () => user });
  task = new Task({ title: 'Task title', assignedBy: owner, assignedTo: [owner], teamId });
  task.save = jest.fn().mockResolvedValue(task);
  task.populate = jest.fn().mockResolvedValue(task);
});
afterEach(() => jest.restoreAllMocks());
const call = (method, path) => request(app)[method](`/api/tasks${path}`).set('Authorization', 'Bearer owner');

test('BUG-3 create persists difficulty', async () => {
  jest.spyOn(Team, 'findById').mockReturnValue({ select: async () => ({ _id: teamId }) });
  jest.spyOn(User, 'countDocuments').mockResolvedValue(1);
  const create = jest.spyOn(Task, 'create').mockResolvedValue(task);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.createTask({ user, body: { title: 'Task title', assignedTo: [owner], teamId, difficulty: 'hard' } }, res);
  expect(create.mock.calls[0][0].difficulty).toBe('hard');
  expect(res.status).toHaveBeenCalledWith(201);
});
test('BUG-3 update persists difficulty and removes attachment metadata/file', async () => {
  task.attachments.push({ name: 'test', filename: 'test.pdf', url: '/uploads/test.pdf', type: 'application/pdf' });
  const attachmentId = String(task.attachments[0]._id);
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  const remove = jest.spyOn(upload, 'deleteFile').mockResolvedValue(false);
  const res = await call('put', `/${task._id}`).send({ difficulty: 'hard', removedAttachments: [attachmentId] });
  expect(res.status).toBe(200);
  expect(task.difficulty).toBe('hard');
  expect(task.attachments).toHaveLength(0);
  expect(remove).toHaveBeenCalledWith('test.pdf', { throwOnError: true });
});
test('BUG-4 detail retains statusHistory without debug logging', async () => {
  task.statusHistory.push({ from: null, to: 'todo' });
  const chain = { populate() { return this; }, then(resolve) { return Promise.resolve(task).then(resolve); } };
  jest.spyOn(Task, 'findById').mockReturnValue(chain);
  const log = jest.spyOn(console, 'log');
  const res = await call('get', `/${task._id}`);
  expect(res.status).toBe(200);
  expect(res.body.data.statusHistory).toHaveLength(1);
  expect(log).not.toHaveBeenCalled();
});
test('BUG-5 invalid teamId fails validation before querying', async () => {
  const find = jest.spyOn(Task, 'find');
  const res = await call('get', '?teamId=bad');
  expect(res.status).toBe(400);
  expect(find).not.toHaveBeenCalled();
});
test('BUG-6 employee cannot update planning fields through HTTP or direct handler', async () => {
  user.role = 'employee';
  expect((await call('put', `/${task._id}`).send({ dueDate: '2026-11-01' })).status).toBe(403);
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.updateTask({ user, params: { id: task._id }, body: { priority: 'high' } }, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(task.save).not.toHaveBeenCalled();
});
test.each(['put', 'patch', 'delete'])('BUG-7 malformed subtaskId on %s never returns 500', async method => {
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  const res = await call(method, `/${task._id}/subtasks/invalid`).send({ title: 'Changed' });
  expect([400, 404]).toContain(res.status);
  expect(task.save).not.toHaveBeenCalled();
});
test('old status endpoint rejects incomplete subtasks and GET subtasks retains shape', async () => {
  task.subTasks.push({ title: 'Pending' });
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  expect((await call('put', `/${task._id}/status`).send({ status: 'done' })).status).toBe(400);
  const res = await call('get', `/${task._id}/subtasks`);
  expect(res.body).toMatchObject({ success: true, count: 1, data: [{ title: 'Pending' }] });
});

const chain = value => ({ populate() { return this; }, select() { return this; }, lean() { return this; },
  sort() { return this; }, skip() { return this; }, limit() { return this; }, then(resolve) { return Promise.resolve(value).then(resolve); } });
test('create HTTP validates assignees and team while saving tags, difficulty and estimate', async () => {
  User.findById.mockReturnValue(chain(user));
  jest.spyOn(Team, 'findById').mockReturnValue(chain({ _id: teamId }));
  jest.spyOn(User, 'countDocuments').mockResolvedValue(1);
  const create = jest.spyOn(Task, 'create').mockResolvedValue(task);
  const response = await call('post', '').send({ title: 'Created task', description: 'Description', assignedTo: [String(owner)],
    teamId: String(teamId), priority: 'high', difficulty: 'hard', tags: ['A', 'A'],
    startDate: '2026-10-01', dueDate: '2026-10-31', estimatedMinutes: 30, storyPoints: 2.5 });
  expect(response.status).toBe(201);
  expect(create.mock.calls[0][0]).toMatchObject({ tags: ['A'], difficulty: 'hard', estimatedMinutes: 30, storyPoints: 2.5 });
});
test('list uses date/tag/search/sort filters and retains pagination contract', async () => {
  jest.spyOn(Task, 'countDocuments').mockResolvedValue(1);
  const find = jest.spyOn(Task, 'find').mockReturnValue(chain([task]));
  const response = await call('get', `?teamId=${teamId}&tags=A,B&fromDate=2026-10-01&toDate=2026-10-31&sort=title_asc&search=Title&priority=high&status=todo&assigneeId=${owner}&hasSubtasks=true`);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ success: true, count: 1, total: 1, page: 1, pages: 1 });
  expect(find.mock.calls[0][0]).toMatchObject({ teamId: String(teamId), tags: { $all: ['A', 'B'] }, assignedTo: String(owner), 'subTasks.0': { $exists: true } });
  expect(find.mock.calls[0][0].dueDate.$lte.getHours()).toBe(23);
});
test('status/progress transitions keep actors and old response contracts', async () => {
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  expect((await call('put', `/${task._id}/status`).send({ status: 'in_progress' })).body.data.status).toBe('in_progress');
  expect(task.$locals.statusChangedBy).toEqual(owner);
  expect((await call('put', `/${task._id}/status`).send({ status: 'done' })).body.data.status).toBe('done');
  expect(task.completedAt).toBeInstanceOf(Date);
  expect((await call('put', `/${task._id}/status`).send({ status: 'todo' })).body.data.completedAt).toBeNull();
  expect((await call('put', `/${task._id}/progress`).send({ progress: 35 })).body.data.progress).toBe(35);
  expect(task.status).toBe('in_progress');
  expect((await call('put', `/${task._id}/progress`).send({ progress: 100 })).body.data.status).toBe('done');
  expect((await call('put', `/${task._id}/progress`).send({ progress: 20 })).body.data.status).toBe('in_progress');
  expect((await call('delete', `/${task._id}`)).body.message).toBe('Task deleted successfully');
  expect(task.status).toBe('deleted');
});
test('old embedded subtask CRUD preserves response and one-way PUT behavior', async () => {
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  const create = await call('post', `/${task._id}/subtasks`).send({ title: 'One' });
  expect(create.status).toBe(201);
  expect(create.body.data.subtask.title).toBe('One');
  const subId = task.subTasks[0]._id;
  expect((await call('put', `/${task._id}/subtasks/${subId}`)).body.data.subtask.isCompleted).toBe(true);
  expect((await call('put', `/${task._id}/subtasks/${subId}`)).status).toBe(400);
  expect((await call('patch', `/${task._id}/subtasks/${subId}`).send({ title: 'Renamed', isCompleted: false })).body.data.subtask).toMatchObject({ title: 'Renamed', isCompleted: false });
  expect((await call('delete', `/${task._id}/subtasks/${subId}`)).body.data.subTasks).toEqual([]);
});
test('comment and assignment paths retain notification and result contracts', async () => {
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  jest.spyOn(User, 'countDocuments').mockResolvedValue(1);
  const other = new mongoose.Types.ObjectId();
  const comment = await call('post', `/${task._id}/comments`).send({ text: ' A comment ' });
  expect(comment.status).toBe(200);
  expect(comment.body.data.comments[0].text).toBe('A comment');
  const assignment = await call('post', `/${task._id}/assign`).send({ assignedTo: [String(other)] });
  expect(assignment.status).toBe(200);
  expect(task.assignedTo.map(String)).toEqual([String(other)]);
  expect(require('../../../services/notification.service').notifyTaskAssigned).toHaveBeenCalledWith(task, String(other));
});
test('stats, overdue, team list and employee scope still resolve real route literals', async () => {
  const find = jest.spyOn(Task, 'find').mockReturnValue(chain([task]));
  jest.spyOn(Task, 'countDocuments').mockResolvedValue(1);
  jest.spyOn(Task, 'aggregate').mockResolvedValue([{ total: 1, todo: 1 }]);
  jest.spyOn(Team, 'findById').mockResolvedValue({ _id: teamId, leaderId: owner, memberIds: [owner] });
  expect((await call('get', '/stats')).body.data.total).toBe(1);
  expect((await call('get', '/overdue')).body.count).toBe(1);
  expect(find.mock.calls.at(-1)[0].assignedTo).toBe(owner);
  expect((await call('get', `/team/${teamId}`)).body.total).toBe(1);
  user.role = 'employee';
  expect((await call('get', '')).status).toBe(403);
  const mine = await call('get', '/my?sort=createdAt_desc&tags=A&fromDate=2026-10-01&toDate=2026-10-31');
  expect(mine.status).toBe(200);
  expect(find.mock.calls.at(-1)[0]).toMatchObject({ assignedTo: owner, tags: { $all: ['A'] } });
});
test('attachment upload contracts remain unchanged and accept multiple file metadata', async () => {
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  const file = { originalname: 'Document.pdf', filename: 'test-task.pdf', mimetype: 'application/pdf', size: 64 };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.addAttachment({ user, params: { id: task._id }, file }, res);
  expect(res.json.mock.calls.at(-1)[0]).toMatchObject({ success: true, data: { name: file.originalname, size: 64, url: '/uploads/test-task.pdf' } });
  await controller.addAttachmentBulk({ user, params: { id: task._id }, files: [file, file] }, res);
  expect(res.json.mock.calls.at(-1)[0].data).toHaveLength(2);
  expect(task.attachments).toHaveLength(3);
});
test.each([
  ['post', '/subtasks', { title: '' }], ['put', '/progress', { progress: 101 }],
  ['put', '/status', { status: 'deleted' }], ['post', '/comments', { text: '' }],
  ['post', '/assign', { assignedTo: ['invalid'] }], ['', '', {}]
].filter(([method]) => method))('legacy validation rejects %s %s', async (method, path, body) => {
  expect((await call(method, `/${task._id}${path}`).send(body)).status).toBe(400);
});
