const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const User = require('../../../models/user.model');
const { verifyToken } = require('../../../config/jwt');
const { getEmployeeDashboard } = require('../../../services/employee-dashboard.service');

jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../../../services/employee-dashboard.service', () => ({
  getEmployeeDashboard: jest.fn()
}));

describe('employee dashboard HTTP access', () => {
  const employeeId = new mongoose.Types.ObjectId();
  const users = {
    employee: { _id: employeeId, role: 'employee', isActive: true },
    hr: { _id: new mongoose.Types.ObjectId(), role: 'hr_manager', isActive: true },
    admin: { _id: new mongoose.Types.ObjectId(), role: 'system_admin', isActive: true }
  };
  const app = express();
  app.use('/api/employees', require('../../../routes/employee.routes'));

  beforeEach(() => {
    verifyToken.mockImplementation((token) => ({ id: users[token]._id.toString() }));
    jest.spyOn(User, 'findById').mockImplementation((id) => ({
      select: async () => Object.values(users).find((user) => user._id.toString() === id)
    }));
    getEmployeeDashboard.mockResolvedValue({ tasks: { completed: 0 } });
  });

  afterEach(() => jest.restoreAllMocks());

  test('reads only the authenticated employee identity', async () => {
    const response = await request(app)
      .get(`/api/employees/dashboard?userId=${users.hr._id}`)
      .set('Authorization', 'Bearer employee');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { tasks: { completed: 0 } } });
    expect(getEmployeeDashboard.mock.calls[0][0].toString()).toBe(employeeId.toString());
  });

  test.each(['hr', 'admin'])('rejects %s role', async (role) => {
    const response = await request(app).get('/api/employees/dashboard')
      .set('Authorization', `Bearer ${role}`);
    expect(response.status).toBe(403);
    expect(getEmployeeDashboard).not.toHaveBeenCalled();
  });

  

  test('requires authentication', async () => {
    const response = await request(app).get('/api/employees/dashboard');
    expect(response.status).toBe(401);
  });
});
