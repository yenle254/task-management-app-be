const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const writes = new AsyncLocalStorage();

// Write the before-image BEFORE saving each task. This permits compensation on
// standalone MongoDB, and retains recovery evidence if the process/DB fails.
const journalTaskSave = async task => {
  const context = writes.getStore();
  if (!context || context.seen.has(String(task._id))) return;
  const before = await task.constructor.collection.findOne({ _id: task._id });
  const entry = { taskId: task._id, before };
  await context.locks.updateOne({ _id: 'tasks', owner: context.owner }, { $push: { undo: entry } });
  context.undo.push(entry);
  context.seen.add(String(task._id));
};
const rollback = async context => {
  const tasks = mongoose.connection.collection('tasks');
  for (const { taskId, before } of [...context.undo].reverse()) {
    if (before) await tasks.replaceOne({ _id: taskId }, before, { upsert: true });
    else await tasks.deleteOne({ _id: taskId });
  }
};

// Standalone MongoDB supports atomic unique-key insertion. A database lock (not
// an in-process mutex) also covers multiple API workers. Never expire a lock:
// a paused worker could otherwise resume and commit after a new owner starts.
// A crashed writer leaves a fail-closed lock for explicit operator recovery.
const withTaskWriteLock = async (operation, responseFailed = () => false) => {
  const locks = mongoose.connection.collection('task_write_locks');
  const owner = randomUUID();
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      await locks.insertOne({ _id: 'tasks', owner, acquiredAt: new Date(), pid: process.pid, undo: [] });
      break;
    } catch (error) {
      if (error.code !== 11000) throw error;
      if (Date.now() >= deadline) throw Object.assign(new Error('Task changes are busy. Reload and retry.'), { statusCode: 409 });
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  const context = { locks, owner, undo: [], seen: new Set() };
  let release = true;
  const compensate = async () => {
    try { await rollback(context); }
    catch (error) { release = false; throw Object.assign(new Error('Task recovery required; writes remain locked'), { statusCode: 503, cause: error }); }
  };
  try {
    let result;
    try { result = await writes.run(context, operation); }
    catch (error) { await compensate(); throw error; }
    if (responseFailed()) await compensate();
    return result;
  } finally {
    if (release) await locks.deleteOne({ _id: 'tasks', owner });
  }
};

module.exports = { withTaskWriteLock, journalTaskSave };
