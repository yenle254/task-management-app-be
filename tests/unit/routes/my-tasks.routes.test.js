const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const User = require('../../../models/user.model');
const Task = require('../../../models/task.model');
const { verifyToken } = require('../../../config/jwt');
const { protect } = require('../../../middleware/auth.middleware');
const asyncHandler = require('../../../middleware/async-handler.middleware');
const getMyTasks = require('../../../controllers/my-tasks.controller');

jest.mock('../../../config/jwt', () => ({ verifyToken: jest.fn() }));

describe('GET /api/tasks/my ownership', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const app = express();
  app.get('/api/tasks/my', protect, asyncHandler(getMyTasks));

  afterEach(() => jest.restoreAllMocks());

  test('ignores another userId in the query and returns only the authenticated user tasks', async () => {
    verifyToken.mockReturnValue({ id: ownerId.toString() });
    jest.spyOn(User, 'findById').mockReturnValue({
      select: async () => ({ _id: ownerId, role: 'employee', isActive: true })
    });
    const tasks = [
      { _id: new mongoose.Types.ObjectId(), title: 'Mine', status: 'todo', dueDate: null, assignedTo: [ownerId] },
      { _id: new mongoose.Types.ObjectId(), title: 'Other', status: 'todo', dueDate: null, assignedTo: [otherId] }
    ];
    jest.spyOn(Task, 'countDocuments').mockImplementation(async (filter) =>
      tasks.filter((task) => task.assignedTo.some((id) => id.equals(filter.assignedTo))).length
    );
    const find = jest.spyOn(Task, 'find').mockImplementation((filter) => {
      const matched = tasks.filter((task) => task.assignedTo.some((id) => id.equals(filter.assignedTo)));
      return {
        populate() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit: async () => matched
      };
    });

    const response = await request(app)
      .get(`/api/tasks/my?userId=${otherId}`)
      .set('Authorization', 'Bearer owner');
    expect(response.status).toBe(200);
    expect(response.body.data.map((task) => task.title)).toEqual(['Mine']);
    expect(response.body.total).toBe(1);
    expect(find.mock.calls[0][0].assignedTo.toString()).toBe(ownerId.toString());
  });
});
