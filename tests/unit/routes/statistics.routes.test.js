const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const User = require('../../../models/user.model');
const Team = require('../../../models/team.model');
const Task = require('../../../models/task.model');
const { verifyToken } = require('../../../config/jwt');
const statisticsService = require('../../../services/statistics.service');

jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../../../services/statistics.service', () => ({
  ...jest.requireActual('../../../services/statistics.service'),
  getAttendanceStats: jest.fn(),
  getLeaveStats: jest.fn(),
  getTaskStats: jest.fn(),
  getPerformanceTrend: jest.fn()
}));

describe('HR statistics HTTP contracts', () => {
  const teamId = new mongoose.Types.ObjectId();
  const employeeId = new mongoose.Types.ObjectId();
  const users = {
    hr: { _id: new mongoose.Types.ObjectId(), role: 'hr_manager', isActive: true },
    employee: { _id: employeeId, role: 'employee', isActive: true }
  };
  const app = express();
  app.use('/api/statistics', require('../../../routes/statistics.routes'));

  beforeEach(() => {
    verifyToken.mockImplementation((token) => ({ id: users[token]._id.toString() }));
    jest.spyOn(User, 'findById').mockImplementation((id) => ({
      select: () => {
        const user = Object.values(users).find((u) => u._id.toString() === id);
        return { then: (resolve) => Promise.resolve(resolve(user)), lean: () => Promise.resolve(user) };
      }
    }));
    statisticsService.getAttendanceStats.mockResolvedValue({
      summary: [], daily: [], counts: { present: 2, late: 1, absent: 1, total: 4 },
      totalRecords: 4, storedRecords: 3, calculatedAbsences: 1,
      onTimeRate: 50, lateRate: 25, absentRate: 25, totalWorkHours: 20
    });
    statisticsService.getLeaveStats.mockResolvedValue({
      byType: [], byStatus: [], byMonth: [], byYearMonth: [], employeesOnLeave: 1,
      approvedLeaveRecords: 2, approvedLeaveDays: 3, pendingLeaves: 1,
      createdLeaves: 4
    });
    statisticsService.getTaskStats.mockResolvedValue({
      byStatus: [], byPriority: [], byTeam: [], totalTasks: 0,
      doneTasks: 0, openTasks: 0, overdueTasks: 0,
      completionRate: 0, overdueRate: 0
    });
    statisticsService.getPerformanceTrend.mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  test.each(['overview', 'employees-by-department', 'attendance', 'leaves', 'tasks', 'team-performance', 'performance-trends'])
  ('%s requires HR Manager authentication', async (path) => {
    expect((await request(app).get(`/api/statistics/${path}`)).status).toBe(401);
    expect((await request(app).get(`/api/statistics/${path}`)
      .set('Authorization', 'Bearer employee')).status).toBe(403);
  });

  test('overview retains its original success/data fields', async () => {
    jest.spyOn(User, 'countDocuments').mockResolvedValue(3);
    jest.spyOn(Team, 'countDocuments').mockResolvedValue(2);
    jest.spyOn(Task, 'countDocuments').mockResolvedValue(5);
    const Leave = require('../../../models/leave.model');
    jest.spyOn(Leave, 'countDocuments').mockResolvedValue(1);
    const response = await request(app).get('/api/statistics/overview')
      .set('Authorization', 'Bearer hr');
    expect(response.body).toEqual({ success: true, data: {
      totalEmployees: 3, totalTeams: 2, totalTasks: 5, pendingLeaves: 1
    } });
  });

  test('attendance preserves prior fields and returns new counts and rates', async () => {
    const response = await request(app).get('/api/statistics/attendance?month=1&year=2025')
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      summary: [], daily: [], totalRecords: 4, calculatedAbsences: 1,
      onTimeRate: 50, lateRate: 25,
      counts: { present: 2, late: 1, absent: 1, total: 4 }
    });
  });

  test('leaves pass an explicit range to overlap statistics', async () => {
    const response = await request(app)
      .get('/api/statistics/leaves?startDate=2025-03-10&endDate=2025-04-05')
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      byType: [], byStatus: [], byMonth: [], employeesOnLeave: 1,
      approvedLeaveRecords: 2, pendingLeaves: 1
    });
    const passedRange = statisticsService.getLeaveStats.mock.calls[0][4];
    expect(passedRange.startDate.getDate()).toBe(10);
    expect(passedRange.endDate.getHours()).toBe(23);
    expect(response.body.data.period.month).toEqual(expect.any(Number));
    expect(response.body.data.period.year).toEqual(expect.any(Number));
  });

  test('attendance preserves numeric month/year metadata for explicit ranges', async () => {
    const response = await request(app)
      .get('/api/statistics/attendance?month=3&year=2025&startDate=2025-03-10&endDate=2025-04-05')
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
    expect(response.body.data.period).toMatchObject({ month: 3, year: 2025 });
    expect(response.body.data).toEqual(expect.objectContaining({ summary: [], daily: [] }));
  });

  test('task filters combine team, employee and an inclusive last day', async () => {
    const response = await request(app)
      .get(`/api/statistics/tasks?teamId=${teamId}&employeeId=${employeeId}&startDate=2025-01-01&endDate=2025-01-31`)
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      byStatus: [], byPriority: [], byTeam: [], totalTasks: 0
    });
    const filter = statisticsService.getTaskStats.mock.calls[0][0];
    expect(filter.teamId.toString()).toBe(teamId.toString());
    expect(filter.assignedTo.toString()).toBe(employeeId.toString());
    expect(filter.createdAt.$lte.getHours()).toBe(23);
  });

  test('rejects non-scalar priority input', async () => {
    const response = await request(app).get('/api/statistics/tasks?priority=low&priority=high')
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(400);
  });

  test('team performance applies filters without changing its array response', async () => {
    const team = { _id: teamId, name: 'A', leaderId: { profile: { fullName: 'Lead' } } };
    jest.spyOn(Team, 'find').mockReturnValue({ populate: async () => [team] });
    jest.spyOn(Task, 'aggregate').mockResolvedValue([
      { _id: { teamId, status: 'done' }, count: 1 }
    ]);
    jest.spyOn(User, 'aggregate').mockResolvedValue([{ _id: teamId, count: 2 }]);

    const response = await request(app)
      .get(`/api/statistics/team-performance?teamId=${teamId}&employeeId=${employeeId}`)
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data[0]).toEqual({
      teamName: 'A', leader: 'Lead', memberCount: 2,
      totalTasks: 1, completedTasks: 1, completionRate: 100
    });
    expect(Team.find.mock.calls[0][0]._id).toBe(teamId.toString());
    expect(Task.aggregate.mock.calls[0][0][0].$match.assignedTo.toString()).toBe(employeeId.toString());
    expect(Task.aggregate.mock.calls[0][0][0].$match.teamId.$in).toEqual([teamId]);
    expect(Task.aggregate).toHaveBeenCalledTimes(1);
    expect(User.aggregate).toHaveBeenCalledTimes(1);
  });

  test('team performance batches counts for multiple teams and preserves response order', async () => {
    const secondId = new mongoose.Types.ObjectId();
    const teams = [
      { _id: teamId, name: 'A', leaderId: { profile: { fullName: 'Lead A' } } },
      { _id: secondId, name: 'B', leaderId: null }
    ];
    jest.spyOn(Team, 'find').mockReturnValue({ populate: async () => teams });
    jest.spyOn(Task, 'aggregate').mockResolvedValue([
      { _id: { teamId: secondId, status: 'todo' }, count: 3 },
      { _id: { teamId, status: 'done' }, count: 2 },
      { _id: { teamId, status: 'todo' }, count: 2 }
    ]);
    jest.spyOn(User, 'aggregate').mockResolvedValue([
      { _id: teamId, count: 4 }, { _id: secondId, count: 3 }
    ]);
    const response = await request(app).get('/api/statistics/team-performance')
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      { teamName: 'A', leader: 'Lead A', memberCount: 4,
        totalTasks: 4, completedTasks: 2, completionRate: 50 },
      { teamName: 'B', leader: 'N/A', memberCount: 3,
        totalTasks: 3, completedTasks: 0, completionRate: 0 }
    ]);
    expect(Task.aggregate).toHaveBeenCalledTimes(1);
    expect(User.aggregate).toHaveBeenCalledTimes(1);
  });

  test.each(['week', 'month'])('performance trends combine %s, explicit dates, team, and employee', async (period) => {
    statisticsService.getPerformanceTrend.mockResolvedValue([{ period: '2025-W03', completedTasks: 1 }]);
    const response = await request(app)
      .get(`/api/statistics/performance-trends?period=${period}&startDate=2025-01-13&endDate=2025-01-19&teamId=${teamId}&employeeId=${employeeId}`)
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
    expect(response.body.data.filters).toEqual({ teamId: teamId.toString(), employeeId: employeeId.toString() });
    expect(response.body.data.period.period).toBe(period);
    expect(new Date(response.body.data.period.startDate).getDate()).toBe(13);
    expect(new Date(response.body.data.period.endDate).getDate()).toBe(19);
    expect(response.body.data.trend).toEqual([{ period: '2025-W03', completedTasks: 1 }]);
    const [filter, grouping, start, end] = statisticsService.getPerformanceTrend.mock.calls[0];
    expect(filter.teamId.toString()).toBe(teamId.toString());
    expect(filter.assignedTo.toString()).toBe(employeeId.toString());
    expect(grouping).toBe(period);
    expect(start.getDate()).toBe(13);
    expect(end.getDate()).toBe(19);
    expect(end.getHours()).toBe(23);
  });

  test('department statistics can filter by team and employee', async () => {
    const spy = jest.spyOn(User, 'aggregate').mockResolvedValue([]);
    const response = await request(app)
      .get(`/api/statistics/employees-by-department?teamId=${teamId}&employeeId=${employeeId}`)
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [] });
    const match = spy.mock.calls[0][0][0].$match;
    expect(match.teamId.toString()).toBe(teamId.toString());
    expect(match._id.toString()).toBe(employeeId.toString());
  });
});
