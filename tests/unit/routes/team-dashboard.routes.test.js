const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const User = require('../../../models/user.model');
const Team = require('../../../models/team.model');
const { verifyToken } = require('../../../config/jwt');
const dashboard = require('../../../services/team-dashboard.service');

jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../../../controllers/team.controller', () => ({
  createTeam: jest.fn(), getAllTeams: jest.fn(), getTeamById: jest.fn(),
  updateTeam: jest.fn(), deleteTeam: jest.fn(), addMember: jest.fn(),
  removeMember: jest.fn(), assignTeamLead: jest.fn(), getTeamMembers: jest.fn(),
  getAllMembers: jest.fn(), getAvailableLeaders: jest.fn()
}));
jest.mock('../../../services/team-dashboard.service', () => ({
  ...jest.requireActual('../../../services/team-dashboard.service'),
  getTeamMemberProgress: jest.fn(),
  getTeamPerformance: jest.fn(),
  getTeamOverdueTasks: jest.fn()
}));

describe('team dashboard HTTP routes', () => {
  const teamId = new mongoose.Types.ObjectId();
  const leaderId = new mongoose.Types.ObjectId();
  const outsiderId = new mongoose.Types.ObjectId();
  const hrId = new mongoose.Types.ObjectId();
  const employeeId = new mongoose.Types.ObjectId();
  const team = { _id: teamId, leaderId, memberIds: [employeeId] };
  const users = {
    leader: { _id: leaderId, role: 'team_lead', isActive: true },
    outsider: { _id: outsiderId, role: 'team_lead', isActive: true },
    hr: { _id: hrId, role: 'hr_manager', isActive: true },
    employee: { _id: employeeId, role: 'employee', isActive: true }
  };
  const endpoints = [
    { path: 'members/progress', service: 'getTeamMemberProgress' },
    { path: 'performance', service: 'getTeamPerformance' },
    { path: 'overdue', service: 'getTeamOverdueTasks' }
  ];
  const app = express();
  app.use('/api/teams', require('../../../routes/team.routes'));

  beforeEach(() => {
    verifyToken.mockImplementation((token) => ({ id: users[token]._id.toString() }));
    jest.spyOn(User, 'findById').mockImplementation((id) => ({
      select: async () => Object.values(users).find((user) => user._id.toString() === id)
    }));
    jest.spyOn(Team, 'findById').mockResolvedValue(team);
    dashboard.getTeamMemberProgress.mockResolvedValue([]);
    dashboard.getTeamPerformance.mockResolvedValue({ taskCounts: { total: 0 } });
    dashboard.getTeamOverdueTasks.mockResolvedValue({
      tasks: [], pagination: { page: 1, total: 0, pages: 0 }
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test.each(endpoints)('$path accepts the actual team leader and passes the route teamId', async ({ path, service }) => {
    const response = await request(app)
      .get(`/api/teams/${teamId}/${path}`)
      .set('Authorization', 'Bearer leader');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Team.findById).toHaveBeenCalledWith(teamId.toString());
    expect(dashboard[service]).toHaveBeenCalledWith(team, ...(
      service === 'getTeamMemberProgress' ? [null, null] :
      service === 'getTeamOverdueTasks' ? [1, 10] : []
    ));
  });

  test.each(endpoints)('$path permits HR Manager access', async ({ path }) => {
    const response = await request(app)
      .get(`/api/teams/${teamId}/${path}`)
      .set('Authorization', 'Bearer hr');
    expect(response.status).toBe(200);
  });

  test.each(endpoints)('$path rejects unauthenticated requests', async ({ path, service }) => {
    const response = await request(app).get(`/api/teams/${teamId}/${path}`);
    expect(response.status).toBe(401);
    expect(dashboard[service]).not.toHaveBeenCalled();
  });

  test.each(endpoints)('$path rejects employees', async ({ path, service }) => {
    const response = await request(app)
      .get(`/api/teams/${teamId}/${path}`)
      .set('Authorization', 'Bearer employee');
    expect(response.status).toBe(403);
    expect(dashboard[service]).not.toHaveBeenCalled();
  });

  test.each(endpoints)('$path rejects a Team Lead who does not lead this team', async ({ path, service }) => {
    const response = await request(app)
      .get(`/api/teams/${teamId}/${path}`)
      .set('Authorization', 'Bearer outsider');
    expect(response.status).toBe(403);
    expect(dashboard[service]).not.toHaveBeenCalled();
  });

  test('overdue returns page 2 metadata and passes validated pagination', async () => {
    dashboard.getTeamOverdueTasks.mockResolvedValue({
      tasks: [{ _id: 'task-3', title: 'Third' }],
      pagination: { page: 2, limit: 2, total: 3, pages: 2 }
    });
    const response = await request(app)
      .get(`/api/teams/${teamId}/overdue?page=2&limit=2`)
      .set('Authorization', 'Bearer leader');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true, count: 1, total: 3, page: 2, pages: 2,
      data: [{ _id: 'task-3', title: 'Third' }]
    });
    expect(dashboard.getTeamOverdueTasks).toHaveBeenCalledWith(team, 2, 2);
  });

  test.each(['page=2x', 'page=0', 'limit=-1', 'limit=101', 'limit=2x'])
  ('overdue rejects malformed pagination: %s', async (query) => {
    const response = await request(app)
      .get(`/api/teams/${teamId}/overdue?${query}`)
      .set('Authorization', 'Bearer leader');
    expect(response.status).toBe(400);
    expect(dashboard.getTeamOverdueTasks).not.toHaveBeenCalled();
  });
});
