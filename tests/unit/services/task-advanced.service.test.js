const mongoose = require('mongoose');
const Task = require('../../../models/task.model');
const service = require('../../../services/task-advanced.service');
const id = () => new mongoose.Types.ObjectId();
const chain = value => ({ select() { return this; }, lean() { return this; }, then(resolve) { return Promise.resolve(value).then(resolve); } });
afterEach(() => jest.restoreAllMocks());
test('recalculateProgress preserves manual progress or derives embedded progress', () => {
  expect(service.recalculateProgress({ progress: 42, subTasks: [] })).toBe(42);
  expect(service.recalculateProgress({ subTasks: [{ isCompleted: true }, { isCompleted: false }] })).toBe(50);
});
test('actual time is computed from entries, including after removal', () => {
  const task = { actualMinutes: 999, timeEntries: [{ minutes: 30 }, { minutes: 15 }] };
  expect(service.syncActualMinutes(task)).toBe(45);
  task.timeEntries.pop();
  expect(service.syncActualMinutes(task)).toBe(30);
});
test.each([1, 2, 3])('rejects a dependency cycle of %i nodes', async count => {
  const nodes = Array.from({ length: count }, id);
  jest.spyOn(Task, 'find').mockImplementation(query => chain(query._id.$in.map(key => {
    const index = nodes.findIndex(node => String(node) === String(key));
    return { dependencies: [nodes[(index + 1) % count]] };
  })));
  await expect(service.assertNoDependencyCycle(nodes[0], [nodes[count === 1 ? 0 : 1]])).rejects.toThrow('cycle');
});
test('accepts an acyclic graph, including shared descendants', async () => {
  jest.spyOn(Task, 'find').mockReturnValue(chain([{ dependencies: [] }]));
  await expect(service.assertNoDependencyCycle(id(), [id(), id()])).resolves.toBe(true);
});
test('dependency validation rejects self, missing, cross-team, blocked done', async () => {
  const task = { _id: id(), teamId: id(), status: 'todo' };
  jest.spyOn(Task, 'findById').mockResolvedValue(task);
  const find = jest.spyOn(Task, 'find').mockReturnValue(chain([]));
  await expect(service.validateDependencies(task._id, [task._id])).rejects.toThrow('itself');
  await expect(service.validateDependencies(task._id, [id()])).rejects.toThrow('not found');
  find.mockReturnValue(chain([{ teamId: id(), status: 'done' }]));
  await expect(service.validateDependencies(task._id, [id()])).rejects.toThrow('same team');
  task.status = 'done';
  find.mockReturnValue(chain([{ teamId: task.teamId, status: 'todo' }]));
  await expect(service.validateDependencies(task._id, [id()])).rejects.toThrow('blocked');
});
test('completion checks subtasks, dependencies and children', async () => {
  const task = { _id: id(), subTasks: [{ isCompleted: false }], dependencies: [] };
  expect((await service.canCompleteTask(task)).ok).toBe(false);
  task.subTasks = [];
  task.dependencies = [id()];
  const find = jest.spyOn(Task, 'find').mockReturnValue(chain([{ status: 'todo', title: 'Blocked' }]));
  expect((await service.canCompleteTask(task)).error).toContain('Blocked');
  find.mockReturnValueOnce(chain([{ status: 'done' }])).mockReturnValueOnce(chain([{ status: 'todo' }]));
  expect((await service.canCompleteTask(task)).error).toContain('child');
  find.mockReturnValueOnce(chain([{ status: 'done' }])).mockReturnValueOnce(chain([]));
  expect((await service.canCompleteTask(task)).ok).toBe(true);
});
test('one-level hierarchy rejects self, missing parent, grandchildren, cycles and reparenting a parent', async () => {
  const task = { _id: id(), teamId: id(), status: 'todo' };
  const parent = { _id: id(), teamId: task.teamId, status: 'todo', parentTaskId: id() };
  jest.spyOn(Task, 'findById').mockImplementation(key => Promise.resolve(String(key) === String(task._id) ? task : parent));
  const find = jest.spyOn(Task, 'find').mockReturnValue(chain([]));
  expect((await service.resolveParentTask(task._id, task._id)).ok).toBe(false);
  expect((await service.resolveParentTask(task._id, parent._id)).error).toContain('one parent-child');
  parent.parentTaskId = task._id;
  expect((await service.resolveParentTask(task._id, parent._id)).ok).toBe(false);
  parent.parentTaskId = null;
  find.mockReturnValue(chain([{}]));
  expect((await service.resolveParentTask(task._id, parent._id)).error).toContain('children');
  find.mockReturnValue(chain([]));
  expect((await service.resolveParentTask(task._id, parent._id)).ok).toBe(true);
  parent.status = 'deleted';
  expect((await service.resolveParentTask(task._id, parent._id)).error).toContain('not found');
});
test('filters use AND tags, inclusive due dates, escaped search and immutable self scope', () => {
  const query = { assignedTo: 'self' };
  service.applyListFilters(query, { tags: 'A,b', fromDate: '2026-10-01', toDate: '2026-10-02', search: 'a.*', assigneeId: 'other' }, true);
  expect(query.assignedTo).toBe('self');
  expect(query.tags).toEqual({ $all: ['A', 'b'] });
  expect(query.dueDate.$lte.getHours()).toBe(23);
  expect(query.$or[0].title.$regex).toBe('a\\.\\*');
});
test('ranges reject missing pair, overflow date, reversed dates', () => {
  expect(() => service.resolveRange('2026-01-01')).toThrow();
  expect(() => service.resolveRange('2026-02-31', '2026-03-04')).toThrow();
  expect(() => service.resolveRange('2026-03-04', '2026-01-01')).toThrow();
});
test('priority sorting casts ownership and ranks before pagination in MongoDB', async () => {
  const userId = id();
  const aggregate = jest.spyOn(Task, 'aggregate').mockResolvedValue([{ title: 'High' }]);
  jest.spyOn(Task, 'populate').mockImplementation(async tasks => tasks);
  const tasks = await service.findListTasks({ assignedTo: String(userId) }, { sort: 'priority_desc', page: 2, limit: 20 });
  expect(tasks).toEqual([{ title: 'High' }]);
  const pipeline = aggregate.mock.calls[0][0];
  expect(pipeline[0].$match.assignedTo).toEqual(userId);
  expect(pipeline[1].$addFields.priorityRank.$indexOfArray[0]).toEqual(['low', 'medium', 'high']);
  expect(pipeline[2]).toEqual({ $sort: { priorityRank: -1, _id: 1 } });
  expect(pipeline[3]).toEqual({ $skip: 20 });
});
test('tag limits are enforced in the service as well as validation', () => {
  expect(() => service.normalizeTags([' '])).toThrow();
  expect(() => service.normalizeTags(Array(21).fill('tag'))).toThrow();
  expect(service.normalizeTags([' A ', 'A', 'a'])).toEqual(['A', 'a']);
});
test('child lifecycle completes and reopens parent through save with actor and prior state', async () => {
  const parent = { _id: id(), status: 'todo', $locals: {}, subTasks: [], dependencies: [], save: jest.fn() };
  const actor = id();
  jest.spyOn(Task, 'findById').mockResolvedValue(parent);
  const find = jest.spyOn(Task, 'find').mockReturnValue(chain([{ status: 'done' }]));
  await service.syncParentTask(parent._id, actor);
  expect(parent.status).toBe('done');
  expect(parent.$locals).toMatchObject({ previousStatus: 'todo', statusChangedBy: actor });
  find.mockReturnValue(chain([{ status: 'in_progress' }]));
  await service.syncParentTask(parent._id, actor);
  expect(parent.status).toBe('in_progress');
  expect(parent.save).toHaveBeenCalledTimes(2);
});
