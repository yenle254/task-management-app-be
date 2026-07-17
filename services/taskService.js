const Task = require('../models/Task');
const mongoose = require('mongoose');

/**
 * Calculate progress based on status or manual progress field
 * @param {Object} task - Task document
 * @returns {Number} Progress percentage (0-100)
 */
const calculateProgress = (task) => {
  if (task.progress !== undefined && task.progress !== null) {
    return task.progress;
  }
  if (task.status === 'done') return 100;
  if (task.status === 'in_progress') return 50;
  return 0;
};

/**
 * Check if task is overdue
 * @param {Object} task - Task document
 * @returns {Boolean}
 */
const checkIfOverdue = (task) => {
  return task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    task.status !== 'done';
};

/**
 * Get task statistics for a user
 * @param {String} userId - User ID
 * @returns {Object} { total, todo, in_progress, done, overdue }
 */
const getTaskStats = async (userId) => {
  try {
    const stats = await Task.aggregate([
      {
        $match: {
          assignedTo: new mongoose.Types.ObjectId(userId),
          status: { $ne: 'deleted' }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          todo: { $sum: { $cond: [{ $eq: ['$status', 'todo'] }, 1, 0] } },
          in_progress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ['$dueDate', new Date()] },
                    { $ne: ['$status', 'done'] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    return stats[0] || { total: 0, todo: 0, in_progress: 0, done: 0, overdue: 0 };
  } catch (error) {
    console.error('Get task stats error:', error);
    return { total: 0, todo: 0, in_progress: 0, done: 0, overdue: 0 };
  }
};

/**
 * Check if user has permission to access a task
 * @param {Object} user - Current authenticated user
 * @param {Object} task - Task document
 * @returns {Boolean}
 */
const canUserAccessTask = (user, task) => {
  const isCreator = task.assignedBy.toString() === user._id.toString();
  const isAssignee = task.assignedTo.some(person => person._id.toString() === user._id.toString());
  const isHR = user.role === 'hr_manager';
  const isTeamLeadSameTeam = user.role === 'team_lead' &&
    user.teamId && task.teamId && user.teamId.toString() === task.teamId._id.toString();

  return isCreator || isAssignee || isHR || isTeamLeadSameTeam;
};

/**
 * Check if user can create or assign tasks
 * @param {Object} user - Current user
 * @returns {Boolean}
 */
const canCreateOrAssignTask = (user) => {
  return user.role === 'hr_manager' || user.role === 'team_lead';
};

/**
 * Check if user can update task status
 * @param {Object} user - Current user
 * @param {Object} task - Task document
 * @returns {Boolean}
 */
const canUpdateTaskStatus = (user, task) => {
  const isAssignee = task.assignedTo.some(id => id.toString() === user._id.toString());
  const isCreator = task.assignedBy.toString() === user._id.toString();
  const isHR = user.role === 'hr_manager';

  return isAssignee || isCreator || isHR;
};

/**
 * Validate task data
 * @param {Object} taskData - Task data to validate
 * @returns {Object} { valid: Boolean, message: String }
 */
const validateTaskData = (taskData) => {
  const { title, assignedTo, teamId } = taskData;

  if (!title || title.trim().length === 0) {
    return { valid: false, message: 'Task title is required' };
  }

  if (!Array.isArray(assignedTo) || assignedTo.length === 0) {
    return { valid: false, message: 'At least one assignee is required' };
  }

  if (!teamId) {
    return { valid: false, message: 'Team ID is required' };
  }

  if (taskData.dueDate && taskData.startDate) {
    const dueDate = new Date(taskData.dueDate);
    const startDate = new Date(taskData.startDate);
    if (dueDate < startDate) {
      return { valid: false, message: 'Due date must be after start date' };
    }
  }

  return { valid: true, message: 'Valid' };
};

module.exports = {
  calculateProgress,
  checkIfOverdue,
  getTaskStats,
  canUserAccessTask,
  canCreateOrAssignTask,
  canUpdateTaskStatus,
  validateTaskData
};