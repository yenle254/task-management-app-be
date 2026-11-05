jest.mock('../../../models/audit-log.model', () => ({ create: jest.fn().mockResolvedValue({}) }));
const express = require('express');
jest.mock('../../../services/task-write-lock.service', () => ({ withTaskWriteLock: operation => operation(), journalTaskSave: async () => {} }));
const request = require('supertest');
const mongoose = require('mongoose');
const Task = require('../../../models/task.model');
const User = require('../../../models/user.model');
const { verifyToken } = require('../../../config/jwt');
const service = require('../../../services/task-advanced.service');
jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));
const app = express();
app.use(express.json());
app.use('/api/tasks', require('../../../routes/task.routes'));
app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ success: false, error: error.message }));
const id = () => new mongoose.Types.ObjectId();
const chain = value => ({ populate() { return this; }, select() { return this; }, lean() { return this; },
  sort() { return this; }, skip() { return this; }, limit() { return this; }, then(resolve) { return Promise.resolve(value).then(resolve); } });
let task, user;
beforeEach(() => {
  jest.spyOn(Task, 'exists').mockResolvedValue(null);
  jest.spyOn(Task, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
  user = { _id: id(), role: 'hr_manager', isActive: true, teamId: id() };
  task = new Task({ title: 'Task', assignedBy: user._id, assignedTo: [user._id], teamId: user.teamId });
  task.save = jest.fn().mockResolvedValue(task);
  task.populate = jest.fn().mockResolvedValue(task);
  verifyToken.mockReturnValue({ id: String(user._id) });
  jest.spyOn(User, 'findById').mockReturnValue({ select: async () => user, then: resolve => Promise.resolve(user).then(resolve) });
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  jest.spyOn(Task, 'find').mockReturnValue(chain([]));
});
afterEach(() => jest.restoreAllMocks());
const call = (method, path, body) => request(app)[method](`/api/tasks/${task._id}${path}`).set('Authorization', 'Bearer test').send(body);
const view = path => request(app).get(`/api/tasks/${path}`).set('Authorization', 'Bearer test');
test('literal view routes are reachable, enforce roles and default self identity', async () => {
  expect((await view('board')).body).toMatchObject({ success: true, counts: { todo: 0, done: 0, in_progress: 0 } });
  expect((await view('watching/me')).body).toMatchObject({ success: true, count: 0 });
  user.role = 'employee';
  expect((await view('board')).status).toBe(403);
  for (const name of ['calendar', 'timeline']) {
    expect((await view(`${name}?from=2026-10-01&to=2026-10-31`)).status).toBe(200);
    expect(Task.find.mock.calls.at(-1)[0].assignedTo).toBe(user._id);
    expect((await view(`${name}?from=2026-10-01`)).status).toBe(400);
    expect((await view(`${name}?from=2026-02-31&to=2026-10-31`)).status).toBe(400);
    expect((await view(`${name}?from=2026-10-31&to=2026-10-01`)).status).toBe(400);
    expect((await view(`${name}?from=2026-10-01&to=2026-10-31&scope=team`)).status).toBe(403);
  }
  user.role = 'team_lead';
  expect((await view('board')).status).toBe(400);
  expect((await view(`board?teamId=${id()}`)).status).toBe(403);
});
test('board sorts due dates with nulls last and excludes children by default', async () => {
  Task.find.mockReturnValue(chain([
    { ...task.toObject(), title: 'Undated', dueDate: null },
    { ...task.toObject(), title: 'Later', dueDate: new Date('2026-10-30') },
    { ...task.toObject(), title: 'Soon', dueDate: new Date('2026-10-01') }
  ]));
  const response = await view('board');
  expect(response.body.data.todo.map(item => item.title)).toEqual(['Soon', 'Later', 'Undated']);
  expect(Task.find.mock.calls.at(-1)[0].parentTaskId).toBeNull();
  await view('board?includeSubtasks=true');
  expect(Task.find.mock.calls.at(-1)[0].parentTaskId).toBeUndefined();
});
test('team views require the database leader as well as matching user.teamId', async () => {
  user.role = 'team_lead';
  const team = { _id: user.teamId, leaderId: user._id };
  jest.spyOn(require('../../../models/team.model'), 'findById').mockResolvedValue(team);
  expect((await view(`board?teamId=${team._id}`)).status).toBe(200);
  expect(Task.find.mock.calls.at(-1)[0]).toMatchObject({ teamId: team._id, status: { $ne: 'deleted' } });
  team.leaderId = id();
  expect((await view(`board?teamId=${team._id}`)).status).toBe(403);
});
test('authentication, ownership, missing and deleted task guards', async () => {
  expect((await request(app).get(`/api/tasks/${task._id}/history`)).status).toBe(401);
  user.role = 'employee'; user._id = id();
  expect((await call('get', '/history')).status).toBe(403);
  task.status = 'deleted';
  expect((await call('get', '/history')).status).toBe(404);
  Task.findById.mockResolvedValue(null);
  expect((await call('get', '/history')).status).toBe(404);
});
test('checklist CRUD leaves task status and progress unchanged', async () => {
  task.progress = 37;
  expect((await call('post', '/checklists', { title: 'Review' })).status).toBe(201);
  const checklist = task.checklists[0];
  expect((await call('patch', `/checklists/${checklist._id}`, { title: 'QA' })).status).toBe(200);
  expect((await call('post', `/checklists/${checklist._id}/items`, { text: 'Check output' })).status).toBe(200);
  const item = checklist.items[0];
  expect((await call('patch', `/checklists/${checklist._id}/items/${item._id}`, { isCompleted: true })).status).toBe(200);
  expect(item.isCompleted).toBe(true);
  expect(task.progress).toBe(37);
  expect(task.status).toBe('todo');
  expect((await call('delete', `/checklists/${checklist._id}/items/${item._id}`)).status).toBe(200);
  expect((await call('delete', `/checklists/${checklist._id}`)).status).toBe(200);
  expect(task.checklists).toHaveLength(0);
});
test('tags normalize and deduplicate; estimates accept optional null', async () => {
  expect((await call('post', '/tags', { tags: [' A ', 'A', 'a'] })).status).toBe(200);
  expect(task.tags).toEqual(['A', 'a']);
  expect((await call('put', '/estimate', { estimatedMinutes: 60, storyPoints: 2.5 })).status).toBe(200);
  expect(task.estimatedMinutes).toBe(60);
  expect((await call('put', '/estimate', { estimatedMinutes: null })).status).toBe(200);
  expect(task.estimatedMinutes).toBeNull();
});
test.each([
  ['post', '/time-entries', { minutes: 0 }], ['post', '/time-entries', { minutes: 1.5 }],
  ['post', '/tags', { tags: [''] }], ['put', '/estimate', { estimatedMinutes: -1 }],
  ['post', '/dependencies', { dependencyIds: ['bad'] }], ['post', '/parent', { parentTaskId: 'bad' }],
  ['post', '/watchers', { userId: 'bad' }], ['patch', '/checklists/bad', { title: 'QA' }]
])('validates %s %s', async (method, path, body) => {
  expect((await call(method, path, body)).status).toBe(400);
  expect(task.save).not.toHaveBeenCalled();
});
test('time logs use current identity, sum minutes and enforce author deletion', async () => {
  expect((await call('post', '/time-entries', { minutes: 30, userId: id(), actualMinutes: 999 })).status).toBe(201);
  const entry = task.timeEntries[0];
  expect(String(entry.userId)).toBe(String(user._id));
  expect(task.actualMinutes).toBe(30);
  expect((await call('get', '/time-entries')).body).toMatchObject({ count: 1, totalMinutes: 30 });
  user.role = 'employee'; entry.userId = id();
  expect((await call('delete', `/time-entries/${entry._id}`)).status).toBe(403);
  user.role = 'hr_manager';
  expect((await call('delete', `/time-entries/${entry._id}`)).status).toBe(200);
  expect(task.actualMinutes).toBe(0);
});
test('watchers are active existing readers, unique, and removable only by HR/creator', async () => {
  expect((await call('post', '/watchers', { userId: user._id })).status).toBe(200);
  expect((await call('post', '/watchers', { userId: user._id })).status).toBe(200);
  expect(task.watchers).toHaveLength(1);
  expect((await call('get', '/watchers')).body.count).toBe(1);
  user.isActive = false;
  await expect(service.assertWatcher(task, user._id)).rejects.toThrow('active');
  user.isActive = true; user.role = 'employee'; task.assignedBy = id();
  expect((await call('delete', `/watchers/${user._id}`)).status).toBe(403);
  user.role = 'hr_manager';
  expect((await call('delete', `/watchers/${user._id}`)).status).toBe(200);
});
test('parent and dependencies preserve access and return expected shapes', async () => {
  const parent = new Task({ title: 'Parent', teamId: user.teamId, assignedBy: user._id, assignedTo: [user._id] });
  Task.findById.mockImplementation(key => Promise.resolve(String(key) === String(task._id) ? task : parent));
  jest.spyOn(service, 'syncParentTask').mockResolvedValue();
  expect((await call('post', '/parent', { parentTaskId: parent._id })).status).toBe(200);
  expect(String(task.parentTaskId)).toBe(String(parent._id));
  expect((await call('get', '/children')).body).toMatchObject({ count: 0, data: [] });
  expect((await call('delete', '/parent')).status).toBe(200);
  Task.find.mockReturnValue(chain([parent]));
  expect((await call('post', '/dependencies', { dependencyIds: [String(parent._id)] })).status).toBe(200);
  expect((await call('get', '/dependencies')).body.data.blocking).toHaveLength(1);
  expect((await call('delete', `/dependencies/${parent._id}`)).status).toBe(200);
});
test('history is ordered and populated; attachment deletion tolerates absent file', async () => {
  expect((await call('delete', '/attachments/bad')).status).toBe(404);
  task.statusHistory.push({ from: 'todo', to: 'done', at: new Date('2026-10-02') }, { from: null, to: 'todo', at: new Date('2026-10-01') });
  const result = await call('get', '/history');
  expect(result.body.data[0].from).toBeNull();
  expect(task.populate).toHaveBeenCalledWith('statusHistory.by', service.USER_FIELDS);
  task.attachments.push({ name: 'Missing', filename: 'missing-test.pdf', url: '/uploads/missing-test.pdf', type: 'application/pdf' });
  const remove = jest.spyOn(require('../../../middleware/upload.middleware'), 'deleteFile').mockResolvedValue(false);
  expect((await call('delete', `/attachments/${task.attachments[0]._id}`)).status).toBe(200);
  expect(task.attachments).toHaveLength(0);
  expect(remove).toHaveBeenCalled();
});
