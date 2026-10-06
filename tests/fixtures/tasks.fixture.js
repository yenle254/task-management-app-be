/**
 * Task Test Fixtures
 */
const mongoose = require('mongoose');

/**
 * Create a mock task object
 */
const createMockTask = (overrides = {}) => {
  const taskId = new mongoose.Types.ObjectId();

  const defaultTask = {
    _id: taskId,
    title: 'Test Task',
    description: 'This is a test task description',
    assignedBy: new mongoose.Types.ObjectId(),
    assignedTo: [new mongoose.Types.ObjectId()],
    teamId: new mongoose.Types.ObjectId(),
    priority: 'medium',
    status: 'todo',
    progress: 0,
    difficulty: 'medium',
    startDate: null,
    dueDate: null,
    tags: [],
    attachments: [],
    comments: [],
    subtasks: [],
    isOverdue: false,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  return { ...defaultTask, ...overrides };
};

/**
 * Predefined mock tasks
 */
const mockTasks = {
  pending: createMockTask({
    title: 'Pending Task',
    status: 'todo',
    progress: 0
  }),

  inProgress: createMockTask({
    title: 'In Progress Task',
    status: 'in_progress',
    progress: 50
  }),

  completed: createMockTask({
    title: 'Completed Task',
    status: 'done',
    progress: 100
  }),

  overdue: createMockTask({
    title: 'Overdue Task',
    status: 'in_progress',
    dueDate: new Date(Date.now() - 86400000), // yesterday
    isOverdue: true
  })
};

/**
 * Create mock subtask
 */
const createMockSubtask = (overrides = {}) => {
  const defaultSubtask = {
    _id: new mongoose.Types.ObjectId(),
    title: 'Test Subtask',
    isCompleted: false,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  return { ...defaultSubtask, ...overrides };
};

/**
 * Create mock comment
 */
const createMockComment = (overrides = {}) => {
  const defaultComment = {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    userName: 'Test User',
    text: 'This is a test comment',
    createdAt: new Date()
  };

  return { ...defaultComment, ...overrides };
};

module.exports = {
  createMockTask,
  mockTasks,
  createMockSubtask,
  createMockComment
};
