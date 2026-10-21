const mongoose = require('mongoose');
const Task = require('../../../models/task.model');
const { getTaskEventTrend, countCompletedTasks } = require('../../../services/task-history.service');

describe('task history statistics', () => {
  const teamId = new mongoose.Types.ObjectId();
  const employeeId = new mongoose.Types.ObjectId();
  const start = new Date('2025-01-01T00:00:00Z');
  const end = new Date('2025-01-31T23:59:59.999Z');

  afterEach(() => jest.restoreAllMocks());

  test('groups weekly events from recorded history and scopes both ownership filters to the same event', async () => {
    const spy = jest.spyOn(Task, 'aggregate').mockResolvedValue([{
      _id: '2025-W03', totalTasks: 4, createdTasks: 2,
      completedTasks: 3, completedWithDueDate: 2, onTimeTasks: 1
    }]);

    const trend = await getTaskEventTrend({ teamId, employeeId }, 'week', start, end);
    const pipeline = spy.mock.calls[0][0];

    expect(pipeline[0].$match.statusHistory.$elemMatch.at).toEqual({ $gte: start, $lte: end });
    expect(pipeline[1]).toEqual({ $unwind: '$statusHistory' });
    expect(pipeline[2].$match['statusHistory.teamId'].toString()).toBe(teamId.toString());
    expect(pipeline[2].$match['statusHistory.assignedTo'].toString()).toBe(employeeId.toString());
    expect(pipeline[2].$match['statusHistory.at']).toEqual({ $gte: start, $lte: end });
    expect(pipeline[4].$group._id.period.$dateToString.format).toBe('%G-W%V');
    expect(trend).toEqual([{
      period: '2025-W03', label: '2025-W03', totalTasks: 4,
      createdTasks: 2, completedTasks: 3, completionRate: 75,
      onTimeTasks: 1, onTimeRate: 50
    }]);
  });

  test('returns no trend when no recorded events exist', async () => {
    jest.spyOn(Task, 'aggregate').mockResolvedValue([]);
    expect(await getTaskEventTrend({}, 'month', start, end)).toEqual([]);
  });

  test('counts distinct tasks completed during the range even if reopened later', async () => {
    const spy = jest.spyOn(Task, 'aggregate').mockResolvedValue([{ total: 2 }]);
    expect(await countCompletedTasks({ employeeId }, start, end)).toBe(2);
    const pipeline = spy.mock.calls[0][0];
    expect(pipeline[2].$match['statusHistory.to']).toBe('done');
    expect(pipeline[2].$match['statusHistory.assignedTo'].toString()).toBe(employeeId.toString());
    expect(pipeline[3]).toEqual({ $group: { _id: '$_id' } });
  });
});
