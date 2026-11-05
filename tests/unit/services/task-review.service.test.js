const mongoose = require('mongoose');
const Task = require('../../../models/task.model');
const service = require('../../../services/task-review.service');
const id = () => new mongoose.Types.ObjectId();
const hook = Task.schema.s.hooks._pres.get('save').find(h => String(h.fn).includes('statusHistory.push'));
const save = task => new Promise((resolve, reject) => hook.fn.call(task, err => err ? reject(err) : resolve()));
const make = (extra = {}) => new Task({ title: 'Invariant test', assignedBy: id(), assignedTo: [id()], teamId: id(), ...extra });
test('model rejects unapproved completion even without an HTTP controller', async () => {
  const task = make({ status: 'done' }); task.$locals.loadedStatus = 'in_progress';
  await expect(save(task)).rejects.toThrow('submitted for review'); expect(task.statusHistory).toHaveLength(0);
});
test.each([true, false])('review status survives subtask recalculation (complete=%s)', async complete => {
  const task = make({ status: 'in_review', subTasks: [{ title: 'Work', isCompleted: complete }] });
  task.$locals.previousStatus = 'in_review'; await save(task);
  expect(task.status).toBe('in_review'); expect(task.completedAt).toBeNull(); expect(task.statusHistory).toHaveLength(0);
});
test('legacy completed task is preserved without fabricated review events', async () => {
  const completedAt = new Date('2025-01-01'); const task = make({ status: 'done', completedAt });
  task.$locals.loadedStatus = 'done'; await save(task);
  expect(task.completedAt).toEqual(completedAt); expect(task.review.rounds).toHaveLength(0);
});
test('approval consumes the private model capability after one save', async () => {
  const task = make({ status: 'done' }); task.$locals.loadedStatus = 'in_review'; task.$locals.reviewApproved = true;
  await save(task); expect(task.$locals.reviewApproved).toBe(false);
  expect(task.statusHistory[0]).toMatchObject({ from: 'in_review', to: 'done' });
});
test('missing and deleted tasks retain the 404 contract', () => {
  const { assertTaskNotDeleted } = require('../../../services/task-advanced.service');
  expect(() => assertTaskNotDeleted(null)).toThrow('not found');
  expect(() => assertTaskNotDeleted({ status: 'deleted' })).toThrow('not found');
});
test('review content guard locks HR as well as employees; ordinary task remains writable', () => {
  expect(() => service.assertNotInReview({ status: 'in_review' })).toThrow('locked');
  expect(() => service.assertNotInReview({ status: 'in_progress' })).not.toThrow();
});
