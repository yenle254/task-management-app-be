const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../../../services/notification.service', () => ({ notifyTaskUpdated: jest.fn(), notifyTaskAssigned: jest.fn(), notifyTaskCompleted: jest.fn(), notifyCommentAdded: jest.fn() }));
jest.mock('../../../controllers/task.controller', () => {
  const actual = jest.requireActual('../../../controllers/task.controller');
  return { ...actual, updateTask: async (req, res) => {
    await actual.updateTask(req, res);
    if (req.body.forceRollback) res.status(400).json({ success: false, error: 'Simulated rejection after save' });
  } };
});
const Task = require('../../../models/task.model');
const User = require('../../../models/user.model');
const Team = require('../../../models/team.model');
const AuditLog = require('../../../models/audit-log.model');
const { verifyToken } = require('../../../config/jwt');
const { journalTaskSave } = require('../../../services/task-write-lock.service');
const tick = () => new Promise(resolve => setImmediate(resolve));
const id = new mongoose.Types.ObjectId(), userId = new mongoose.Types.ObjectId(), teamId = new mongoose.Types.ObjectId();
let persisted, rows, tasks, locks;
const app = express(); app.use(express.json()); app.use('/api/tasks', require('../../../routes/task.routes'));
beforeEach(() => {
  persisted = { _id: id, title: 'Planning', assignedBy: userId, assignedTo: [userId], teamId, status: 'todo', priority: 'low', dueDate: null };
  rows = [];
  tasks = { replaceOne: jest.fn(async (filter, before) => { persisted = before; }), deleteOne: jest.fn() };
  locks = { insertOne: jest.fn().mockResolvedValue({}), updateOne: jest.fn().mockResolvedValue({}), deleteOne: jest.fn().mockResolvedValue({}) };
  jest.spyOn(mongoose.connection, 'collection').mockImplementation(name => name === 'tasks' ? tasks : locks);
  verifyToken.mockReturnValue({ id: userId });
  jest.spyOn(User, 'findById').mockReturnValue({ select: async () => ({ _id: userId, role: 'hr_manager', isActive: true }) });
  jest.spyOn(Task.collection, 'findOne').mockImplementation(async () => ({ ...persisted }));
  jest.spyOn(Task, 'findById').mockImplementation(async () => {
    const doc = new Task(persisted);
    doc.save = async () => { await journalTaskSave(doc); persisted = doc.toObject(); return doc; };
    doc.populate = async () => doc;
    return doc;
  });
  jest.spyOn(AuditLog, 'create').mockImplementation(async doc => { rows.push(doc); return doc; });
});
afterEach(async () => { await tick(); await tick(); });
const update = body => request(app).put(`/api/tasks/${id}`).set('Authorization', 'Bearer test').send(body);
test('response 400 after save and staged event rolls back persisted task and emits no success audit', async () => {
  expect((await update({ priority: 'high', forceRollback: true })).status).toBe(400); await tick();
  expect(tasks.replaceOne).toHaveBeenCalledTimes(1); expect(persisted.priority).toBe('low');
  expect(rows.filter(row => row.action.startsWith('task.'))).toHaveLength(0);
});
test('successful write uses journal before-image and records after lock release', async () => {
  AuditLog.create.mockImplementation(async doc => { expect(locks.deleteOne).toHaveBeenCalled(); rows.push(doc); return doc; });
  expect((await update({ priority: 'high' })).status).toBe(200); await tick();
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ action: 'task.updated', changes: [{ field: 'priority', from: 'low', to: 'high' }] });
  expect(tasks.replaceOne).not.toHaveBeenCalled();
});
test('description-only edit produces no planning audit; deletion records status', async () => {
  expect((await update({ description: 'Private description' })).status).toBe(200); await tick(); expect(rows).toHaveLength(0);
  expect((await request(app).delete(`/api/tasks/${id}`).set('Authorization', 'Bearer test')).status).toBe(200); await tick();
  expect(rows[0]).toMatchObject({ action: 'task.deleted', changes: [{ field: 'status', from: 'todo', to: 'deleted' }] });
});
test('create and assign events are emitted once after locked writes with ID-only assignments', async () => {
  jest.spyOn(Team, 'findById').mockReturnValue({ select: async () => ({ _id: teamId }) });
  jest.spyOn(User, 'countDocuments').mockResolvedValue(1);
  Task.collection.findOne.mockImplementation(async filter => String(filter._id) === String(persisted._id) ? { ...persisted } : null);
  jest.spyOn(Task, 'create').mockImplementation(async data => {
    const doc = new Task(data); await journalTaskSave(doc); persisted = doc.toObject(); doc.populate = async () => doc; return doc;
  });
  const created = await request(app).post('/api/tasks').set('Authorization', 'Bearer test').send({ title: 'New audit task', assignedTo: [String(userId)], teamId: String(teamId), priority: 'high' });
  expect(created.status).toBe(201); await tick();
  expect(rows[0]).toMatchObject({ action: 'task.created', target: { label: 'New audit task' } });
  expect(rows[0].changes).toContainEqual({ field: 'assignedTo', from: null, to: [String(userId)] });
  const assignee = new mongoose.Types.ObjectId();
  const assigned = await request(app).post(`/api/tasks/${persisted._id}/assign`).set('Authorization', 'Bearer test').send({ assignedTo: [String(assignee)] });
  expect(assigned.status).toBe(200); await tick();
  expect(rows.map(row => row.action)).toEqual(['task.created', 'task.assigned']);
  expect(rows[1].changes).toContainEqual({ field: 'assignedTo', from: [String(userId)], to: [String(assignee)] });
});
