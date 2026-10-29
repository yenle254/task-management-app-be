const mongoose = require('mongoose');
const { withTaskWriteLock, journalTaskSave } = require('../../../services/task-write-lock.service');

let locks, tasks, task, before;
beforeEach(() => {
  locks = { insertOne: jest.fn().mockResolvedValue({}), updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }), deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
  tasks = { replaceOne: jest.fn().mockResolvedValue({}), deleteOne: jest.fn().mockResolvedValue({}) };
  before = { _id: new mongoose.Types.ObjectId(), status: 'todo', statusHistory: [] };
  task = { _id: before._id, constructor: { collection: { findOne: jest.fn().mockResolvedValue(before) } } };
  jest.spyOn(mongoose.connection, 'collection').mockImplementation(name => name === 'tasks' ? tasks : locks);
});

test('successful operation records the original task once before writes and releases ownership', async () => {
  await withTaskWriteLock(async () => { await journalTaskSave(task); await journalTaskSave(task); });
  expect(locks.updateOne).toHaveBeenCalledTimes(1);
  expect(locks.updateOne.mock.calls[0][1].$push.undo.before).toEqual(before);
  expect(locks.deleteOne).toHaveBeenCalledWith({ _id: 'tasks', owner: locks.insertOne.mock.calls[0][0].owner });
  expect(tasks.replaceOne).not.toHaveBeenCalled();
});

test('failed operation restores status and history before releasing the lock', async () => {
  await expect(withTaskWriteLock(async () => { await journalTaskSave(task); throw new Error('Parent failed'); })).rejects.toThrow('Parent failed');
  expect(tasks.replaceOne).toHaveBeenCalledWith({ _id: task._id }, before, { upsert: true });
  expect(locks.deleteOne).toHaveBeenCalledTimes(1);
});

test('a controller error response compensates a newly created task', async () => {
  task.constructor.collection.findOne.mockResolvedValue(null);
  await withTaskWriteLock(() => journalTaskSave(task), () => true);
  expect(tasks.deleteOne).toHaveBeenCalledWith({ _id: task._id });
});

test('failed compensation preserves the durable journal and excludes future writers', async () => {
  tasks.replaceOne.mockRejectedValue(new Error('Database unavailable'));
  await expect(withTaskWriteLock(async () => { await journalTaskSave(task); throw new Error('Write failed'); })).rejects.toMatchObject({ statusCode: 503 });
  expect(locks.deleteOne).not.toHaveBeenCalled();
});

test('busy lock returns conflict without running a stale operation or deleting another owner', async () => {
  locks.insertOne.mockRejectedValue(Object.assign(new Error('Duplicate key'), { code: 11000 }));
  jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(6000);
  const operation = jest.fn();
  await expect(withTaskWriteLock(operation)).rejects.toMatchObject({ statusCode: 409 });
  expect(operation).not.toHaveBeenCalled(); expect(locks.deleteOne).not.toHaveBeenCalled();
});

test('failure to persist the undo record prevents the task write', async () => {
  locks.updateOne.mockRejectedValue(new Error('Journal unavailable'));
  const save = jest.fn();
  await expect(withTaskWriteLock(async () => { await journalTaskSave(task); save(); })).rejects.toThrow('Journal unavailable');
  expect(save).not.toHaveBeenCalled(); expect(tasks.replaceOne).not.toHaveBeenCalled();
});
