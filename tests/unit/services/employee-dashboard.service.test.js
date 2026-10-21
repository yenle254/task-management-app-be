const mongoose = require('mongoose');
const {
  getEmployeeDashboard,
  getLeaveBalance
} = require('../../../services/employee-dashboard.service');
const Task = require('../../../models/task.model');
const Attendance = require('../../../models/attendance.model');
const User = require('../../../models/user.model');

/**
 * Employee dashboard service tests.
 *
 * The Mongoose models are mocked so the aggregation/count calls can be
 * asserted precisely without a live database.
 */
describe('employee-dashboard.service', () => {
  const userId = new mongoose.Types.ObjectId();

  let countDocumentsSpy;
  let aggregateSpy;
  let userFindSpy;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  /**
   * Route each countDocuments call to the right count based on the filter.
   */
  const mockCounts = (counts) => {
    aggregateSpy.mockImplementation(async (pipeline) =>
      pipeline.some((stage) => stage.$count)
        ? [{ total: counts.completed || 0 }]
        : []
    );
    countDocumentsSpy.mockImplementation(async (filter = {}) => {
      if (filter.assignedTo && filter.assignedTo.toString() !== userId.toString()) {
        return 0;
      }
      if (filter.status === 'in_progress') return counts.inProgress || 0;
      if (Array.isArray(filter.status?.$in)) {
        if (filter.dueDate) return counts.overdue || 0;
      }
      return 0;
    });
  };

  beforeEach(() => {
    // Default to a non-DB implementation. A bare spyOn would call through to
    // Mongoose and buffer the operation until it times out.
    countDocumentsSpy = jest
      .spyOn(Task, 'countDocuments')
      .mockResolvedValue(0);
    aggregateSpy = jest.spyOn(Task, 'aggregate').mockReturnValue(Promise.resolve([]));
    jest.spyOn(Attendance, 'aggregate').mockReturnValue(
      Promise.resolve([{ totalWorkHours: 0, attendanceDays: 0 }])
    );
    userFindSpy = jest.spyOn(User, 'findById').mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) })
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getEmployeeDashboard()', () => {
    test('returns the default month range when no filters are given', async () => {
      mockCounts({});
      const data = await getEmployeeDashboard(userId, {});

      expect(data.period.period).toBe('month');
      expect(data.period.startDate).toEqual(startOfMonth);
      expect(data.period.endDate).toEqual(endOfMonth);
    });

    test('returns a week range when period=week', async () => {
      mockCounts({});
      const data = await getEmployeeDashboard(userId, { period: 'week' });

      expect(data.period.period).toBe('week');
      expect(data.period.startDate.getDay()).toBe(1);
    });

    test('uses an explicit startDate/endDate range when supplied', async () => {
      mockCounts({});
      const data = await getEmployeeDashboard(userId, {
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      });

      expect(data.period.startDate.getMonth()).toBe(0);
      expect(data.period.startDate.getDate()).toBe(1);
      expect(data.period.endDate.getMonth()).toBe(0);
      expect(data.period.endDate.getDate()).toBe(31);
      expect(data.period.endDate.getHours()).toBe(23);
    });

    test('counts in-progress, completed and overdue tasks', async () => {
      mockCounts({ inProgress: 4, completed: 7, overdue: 2 });

      const data = await getEmployeeDashboard(userId, {});

      expect(data.tasks.inProgress).toBe(4);
      expect(data.tasks.completed).toBe(7);
      expect(data.tasks.overdue).toBe(2);
      expect(countDocumentsSpy.mock.calls[0][0].status).toBe('in_progress');
    });

    test('scopes every task query to the authenticated user', async () => {
      mockCounts({});
      await getEmployeeDashboard(userId, {});

      for (const call of countDocumentsSpy.mock.calls) {
        expect(call[0].assignedTo.toString()).toBe(userId.toString());
      }
    });

    test('excludes deleted tasks from the counts', async () => {
      mockCounts({});
      await getEmployeeDashboard(userId, {});

      for (const call of countDocumentsSpy.mock.calls) {
        const status = call[0].status;
        if (status && status.$ne) {
          expect(status.$ne).toBe('deleted');
        } else {
          expect(status.$in || status).not.toContain('deleted');
        }
      }
    });

    test('counts completed tasks using the completedAt timestamp', async () => {
      mockCounts({ completed: 3 });
      const data = await getEmployeeDashboard(userId, {});

      expect(data.tasks.completed).toBe(3);
      const completedPipeline = aggregateSpy.mock.calls.find(
        ([pipeline]) => pipeline.some((stage) => stage.$count)
      )[0];
      expect(completedPipeline[2].$match['statusHistory.at'].$gte).toBeInstanceOf(Date);
      expect(completedPipeline[2].$match['statusHistory.at'].$lte).toBeInstanceOf(Date);
    });

    test('does not use updatedAt as a completion proxy', async () => {
      mockCounts({ completed: 3 });
      await getEmployeeDashboard(userId, {});

      expect(JSON.stringify(aggregateSpy.mock.calls)).not.toContain('updatedAt');
    });

    test('sums only recorded work hours and never returns NaN', async () => {
      jest
        .spyOn(Attendance, 'aggregate')
        .mockReturnValue(Promise.resolve([]));

      const data = await getEmployeeDashboard(userId, {});

      expect(data.workHours.total).toBe(0);
      expect(Number.isNaN(data.workHours.total)).toBe(false);
      expect(Number.isFinite(data.workHours.total)).toBe(true);
    });

    test('does not return a non-finite work-hours total', async () => {
      jest.spyOn(Attendance, 'aggregate').mockResolvedValue([{ totalWorkHours: Infinity }]);
      const data = await getEmployeeDashboard(userId, {});
      expect(data.workHours.total).toBe(0);
    });

    test('sums work hours from attendance records', async () => {
      jest.spyOn(Attendance, 'aggregate').mockReturnValue(
        Promise.resolve([{ totalWorkHours: 7.5, attendanceDays: 3 }])
      );

      const data = await getEmployeeDashboard(userId, {});

      expect(data.workHours.total).toBe(7.5);
      expect(data.workHours.attendanceDays).toBe(3);
    });

    test('filters attendance to the requested range and the user', async () => {
      const attendanceSpy = jest
        .spyOn(Attendance, 'aggregate')
        .mockReturnValue(Promise.resolve([]));

      await getEmployeeDashboard(userId, {
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      });

      const [pipeline] = attendanceSpy.mock.calls[0];
      expect(pipeline[0].$match.userId.toString()).toBe(userId.toString());
      expect(pipeline[0].$match.date.$gte).toBeInstanceOf(Date);
      expect(pipeline[0].$match.date.$lte).toBeInstanceOf(Date);
      expect(pipeline[0].$match.workHours.$type).toBe('number');
    });

    test('returns a meaningful leave balance when the user has no data', async () => {
      userFindSpy.mockReturnValue({
        select: () => ({ lean: () => Promise.resolve(null) })
      });

      const data = await getEmployeeDashboard(userId, {});

      expect(data.leaveBalance).toEqual({ total: 12, used: 0, remaining: 12 });
    });

    test('builds a performance trend from real completion events', async () => {
      aggregateSpy.mockImplementation((pipeline) => {
        if (pipeline.some((stage) => stage.$count)) return Promise.resolve([]);
        return Promise.resolve([{
          _id: '2025-01', totalTasks: 3, createdTasks: 2,
          completedTasks: 2, completedWithDueDate: 2, onTimeTasks: 1
        }]);
      });

      const data = await getEmployeeDashboard(userId, {
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      });

      expect(data.performanceTrend).toHaveLength(1);
      expect(data.performanceTrend[0]).toMatchObject({
        period: '2025-01',
        totalTasks: 3,
        completedTasks: 2
      });
      expect(data.performanceTrend[0].completionRate).toBeCloseTo(66.67, 1);
    });

    test('does not fabricate trend buckets without data', async () => {
      aggregateSpy.mockReturnValue(Promise.resolve([]));

      const data = await getEmployeeDashboard(userId, {});

      expect(data.performanceTrend).toEqual([]);
    });
  });

  describe('getLeaveBalance()', () => {
    test('reads the balance for the given year from the Mongoose Map', () => {
      const map = new Map([
        [
          '2025',
          { total: 12, used: 4, remaining: 8 }
        ]
      ]);
      const user = { leaveBalance: map };

      expect(getLeaveBalance(user, 2025)).toEqual({
        total: 12,
        used: 4,
        remaining: 8
      });
    });

    test('falls back to the default when the year has no entry', () => {
      const map = new Map([['2024', { total: 12, used: 4, remaining: 8 }]]);
      const user = { leaveBalance: map };

      expect(getLeaveBalance(user, 2025)).toEqual({
        total: 12,
        used: 0,
        remaining: 12
      });
    });

    test('falls back when the user has no leaveBalance at all', () => {
      expect(getLeaveBalance({}, 2025)).toEqual({
        total: 12,
        used: 0,
        remaining: 12
      });
      expect(getLeaveBalance(null, 2025)).toEqual({
        total: 12,
        used: 0,
        remaining: 12
      });
    });

    test('derives remaining from total and used when remaining is missing', () => {
      const map = new Map([['2025', { total: 12, used: 5 }]]);
      expect(getLeaveBalance({ leaveBalance: map }, 2025).remaining).toBe(7);
    });
  });
});
