const Task = require('../models/task.model');
const mongoose = require('mongoose');
const idOf = value => String(value?._id || value || '');

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
const getTaskStats = async (userId, matchFilter = null) => {
  try {
    const match = matchFilter || {
      assignedTo: new mongoose.Types.ObjectId(userId),
      status: { $ne: 'deleted' }
    };
    const stats = await Task.aggregate([
      {
        $match: match
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          todo: { $sum: { $cond: [{ $eq: ['$status', 'todo'] }, 1, 0] } },
          in_progress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          in_review: { $sum: { $cond: [{ $eq: ['$status', 'in_review'] }, 1, 0] } },
          done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ['$dueDate', null] }, null] },
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

    return stats[0] || { total: 0, todo: 0, in_progress: 0, in_review: 0, done: 0, overdue: 0 };
  } catch (error) {
    console.error('Get task stats error:', error);
    return { total: 0, todo: 0, in_progress: 0, in_review: 0, done: 0, overdue: 0 };
  }
};

/**
 * Check if user has permission to access a task
 * @param {Object} user - Current authenticated user
 * @param {Object} task - Task document
 * @returns {Boolean}
 */
const canUserAccessTask = (user, task) => {
  const isCreator = idOf(task.assignedBy) === idOf(user);
  const isAssignee = task.assignedTo.some(person => idOf(person) === idOf(user));
  const isHR = user.role === 'hr_manager';
  const isTeamLeadSameTeam = user.role === 'team_lead' &&
    user.teamId && task.teamId && idOf(user.teamId) === idOf(task.teamId);

  const isReviewLead = user.role === 'team_lead' && (idOf(task.teamId?.leaderId) === idOf(user) || task.review?.approverSnapshot?.some(entry => entry.active !== false && entry.role === 'team_lead' && idOf(entry.userId) === idOf(user)));
  return isCreator || isAssignee || isHR || isTeamLeadSameTeam || isReviewLead;
};

/**
 * Check if user can view a task (includes read-only access for employees in the same team)
 * @param {Object} user - Current authenticated user
 * @param {Object} task - Task document
 * @returns {Boolean}
 */
const canUserViewTask = (user, task) => {
  if (canUserAccessTask(user, task)) return true;
  return user.role === 'employee' &&
    Boolean(user.teamId && task.teamId && idOf(user.teamId) === idOf(task.teamId));
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
  const isAssignee = task.assignedTo.some(id => idOf(id) === idOf(user));
  const isCreator = idOf(task.assignedBy) === idOf(user);
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

/**
 * Enrich a task document with computed fields (overdue, progress)
 * @param {Object} task - Task document or plain object
 * @param {Boolean} includeOverdue - Whether to calculate overdue status
 * @returns {Object} Enriched task object
 */
const enrichTask = (task, includeOverdue = true) => {
  const taskObj = task.toObject ? task.toObject() : task;
  const enriched = { ...taskObj, review: { rounds: [], currentRound: 0, submittedBy: null, submittedAt: null, ...taskObj.review } };
  delete enriched.pendingAttachmentDeletes;

  if (includeOverdue) {
    enriched.overdue = checkIfOverdue(task);
  }
  enriched.progress = calculateProgress(task);

  return enriched;
};

/**
 * Enrich an array of tasks
 * @param {Array} tasks - Array of task documents
 * @param {Boolean} includeOverdue - Whether to calculate overdue status
 * @returns {Array} Array of enriched tasks
 */
const enrichTasks = (tasks, includeOverdue = true) => {
  return tasks.map(t => enrichTask(t, includeOverdue));
};

module.exports = {
  calculateProgress,
  checkIfOverdue,
  getTaskStats,
  canUserAccessTask,
  canUserViewTask,
  canCreateOrAssignTask,
  canUpdateTaskStatus,
  validateTaskData,
  enrichTask,
  enrichTasks
};
