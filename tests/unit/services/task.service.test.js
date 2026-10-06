/**
 * Task Service Unit Tests
 */
const mongoose = require('mongoose');
const {
  calculateProgress,
  checkIfOverdue,
  canUserAccessTask,
  canCreateOrAssignTask,
  canUpdateTaskStatus,
  validateTaskData
} = require('../../../services/task.service');

describe('TaskService', () => {
  describe('calculateProgress()', () => {
    it('should return manual progress if set', () => {
      const task = { progress: 75 };
      const result = calculateProgress(task);
      expect(result).toBe(75);
    });

    it('should return 100 if status is done', () => {
      const task = { status: 'done', progress: undefined };
      const result = calculateProgress(task);
      expect(result).toBe(100);
    });

    it('should return 50 if status is in_progress', () => {
      const task = { status: 'in_progress', progress: undefined };
      const result = calculateProgress(task);
      expect(result).toBe(50);
    });

    it('should return 0 if status is todo', () => {
      const task = { status: 'todo', progress: undefined };
      const result = calculateProgress(task);
      expect(result).toBe(0);
    });

    it('should prioritize manual progress over status', () => {
      const task = { status: 'todo', progress: 30 };
      const result = calculateProgress(task);
      expect(result).toBe(30);
    });

    it('should handle null progress', () => {
      const task = { status: 'in_progress', progress: null };
      const result = calculateProgress(task);
      expect(result).toBe(50);
    });

    it('should handle 0 progress', () => {
      const task = { progress: 0 };
      const result = calculateProgress(task);
      expect(result).toBe(0);
    });

    it('should handle 100 progress', () => {
      const task = { progress: 100 };
      const result = calculateProgress(task);
      expect(result).toBe(100);
    });
  });

  describe('checkIfOverdue()', () => {
    it('should return true if dueDate is in past and status is not done', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const task = { dueDate: yesterday, status: 'in_progress' };

      const result = checkIfOverdue(task);

      expect(result).toBe(true);
    });

    it('should return false if dueDate is in past but status is done', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const task = { dueDate: yesterday, status: 'done' };

      const result = checkIfOverdue(task);

      expect(result).toBe(false);
    });

    it('should return false if dueDate is in future', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const task = { dueDate: tomorrow, status: 'in_progress' };

      const result = checkIfOverdue(task);

      expect(result).toBe(false);
    });

    it('should return false if no dueDate', () => {
      const task = { status: 'in_progress' };

      const result = checkIfOverdue(task);

      // Function returns falsy value (undefined) when dueDate is missing
      expect(result).toBeFalsy();
    });

    it('should return false for todo status with past due date', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const task = { dueDate: yesterday, status: 'todo' };

      const result = checkIfOverdue(task);

      expect(result).toBe(true);
    });
  });

  describe('canUserAccessTask()', () => {
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const teamId = new mongoose.Types.ObjectId();

    it('should return true if user is the creator', () => {
      const user = { _id: userId, role: 'employee' };
      const task = {
        assignedBy: userId,
        assignedTo: [otherUserId],
        teamId: { _id: teamId }
      };

      const result = canUserAccessTask(user, task);

      expect(result).toBe(true);
    });

    it('should return true if user is an assignee', () => {
      const user = { _id: userId, role: 'employee' };
      const task = {
        assignedBy: otherUserId,
        assignedTo: [{ _id: userId }],
        teamId: { _id: teamId }
      };

      const result = canUserAccessTask(user, task);

      expect(result).toBe(true);
    });

    it('should return true if user is HR Manager', () => {
      const user = { _id: userId, role: 'hr_manager' };
      const task = {
        assignedBy: otherUserId,
        assignedTo: [otherUserId],
        teamId: { _id: teamId }
      };

      const result = canUserAccessTask(user, task);

      expect(result).toBe(true);
    });

    it('should return true if team lead is in same team', () => {
      const user = { _id: userId, role: 'team_lead', teamId: teamId };
      const task = {
        assignedBy: otherUserId,
        assignedTo: [otherUserId],
        teamId: { _id: teamId }
      };

      const result = canUserAccessTask(user, task);

      // Team lead in same team has access
      expect(result).toBe(true);
    });

    it('should return false if user has no relation to task', () => {
      const user = { _id: userId, role: 'employee' };
      const task = {
        assignedBy: otherUserId,
        assignedTo: [otherUserId],
        teamId: { _id: new mongoose.Types.ObjectId() }
      };

      const result = canUserAccessTask(user, task);

      expect(result).toBe(false);
    });
  });

  describe('canCreateOrAssignTask()', () => {
    it('should return true for HR Manager', () => {
      const user = { role: 'hr_manager' };
      const result = canCreateOrAssignTask(user);
      expect(result).toBe(true);
    });

    it('should return true for Team Lead', () => {
      const user = { role: 'team_lead' };
      const result = canCreateOrAssignTask(user);
      expect(result).toBe(true);
    });

    it('should return false for Employee', () => {
      const user = { role: 'employee' };
      const result = canCreateOrAssignTask(user);
      expect(result).toBe(false);
    });
  });

  describe('canUpdateTaskStatus()', () => {
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();

    it('should return true if user is an assignee', () => {
      const user = { _id: userId };
      const task = { assignedTo: [userId], assignedBy: otherUserId };

      const result = canUpdateTaskStatus(user, task);

      expect(result).toBe(true);
    });

    it('should return true if user is the creator', () => {
      const user = { _id: userId };
      const task = { assignedTo: [otherUserId], assignedBy: userId };

      const result = canUpdateTaskStatus(user, task);

      expect(result).toBe(true);
    });

    it('should return true if user is HR Manager', () => {
      const user = { _id: userId, role: 'hr_manager' };
      const task = { assignedTo: [otherUserId], assignedBy: otherUserId };

      const result = canUpdateTaskStatus(user, task);

      expect(result).toBe(true);
    });

    it('should return false if user has no relation', () => {
      const user = { _id: userId, role: 'employee' };
      const task = { assignedTo: [otherUserId], assignedBy: otherUserId };

      const result = canUpdateTaskStatus(user, task);

      expect(result).toBe(false);
    });
  });

  describe('validateTaskData()', () => {
    it('should return valid for correct data', () => {
      const taskData = {
        title: 'Test Task',
        assignedTo: [new mongoose.Types.ObjectId()],
        teamId: new mongoose.Types.ObjectId()
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Valid');
    });

    it('should return invalid if title is empty', () => {
      const taskData = {
        title: '',
        assignedTo: [new mongoose.Types.ObjectId()],
        teamId: new mongoose.Types.ObjectId()
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Task title is required');
    });

    it('should return invalid if title is whitespace only', () => {
      const taskData = {
        title: '   ',
        assignedTo: [new mongoose.Types.ObjectId()],
        teamId: new mongoose.Types.ObjectId()
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Task title is required');
    });

    it('should return invalid if assignedTo is empty array', () => {
      const taskData = {
        title: 'Test Task',
        assignedTo: [],
        teamId: new mongoose.Types.ObjectId()
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('At least one assignee is required');
    });

    it('should return invalid if assignedTo is not an array', () => {
      const taskData = {
        title: 'Test Task',
        assignedTo: 'not-an-array',
        teamId: new mongoose.Types.ObjectId()
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('At least one assignee is required');
    });

    it('should return invalid if teamId is missing', () => {
      const taskData = {
        title: 'Test Task',
        assignedTo: [new mongoose.Types.ObjectId()]
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Team ID is required');
    });

    it('should return invalid if dueDate is before startDate', () => {
      const taskData = {
        title: 'Test Task',
        assignedTo: [new mongoose.Types.ObjectId()],
        teamId: new mongoose.Types.ObjectId(),
        startDate: new Date('2024-06-20'),
        dueDate: new Date('2024-06-15')
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Due date must be after start date');
    });

    it('should return valid if title, assignedTo, and teamId are provided', () => {
      const taskData = {
        title: 'Test Task',
        assignedTo: [new mongoose.Types.ObjectId()],
        teamId: new mongoose.Types.ObjectId()
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(true);
    });

    it('should return valid when dueDate equals startDate', () => {
      const sameDate = new Date('2024-06-15');
      const taskData = {
        title: 'Test Task',
        assignedTo: [new mongoose.Types.ObjectId()],
        teamId: new mongoose.Types.ObjectId(),
        startDate: sameDate,
        dueDate: sameDate
      };

      const result = validateTaskData(taskData);

      expect(result.valid).toBe(true);
    });
  });
});
