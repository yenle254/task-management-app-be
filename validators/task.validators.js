/**
 * task.validators.js
 * Validation rules for task management endpoints
 */

const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const Task = require('../models/task.model');
const Team = require('../models/team.model');
const User = require('../models/user.model');

/**
 * Validation chain for creating a task
 */
const createTaskValidation = [
  body('title')
    .trim()
    .notEmpty().withMessage('Task title is required')
    .isLength({ min: 3, max: 255 }).withMessage('Title must be between 3 and 255 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 }).withMessage('Description must be at most 5000 characters'),

  body('assignedTo')
    .isArray({ min: 1 }).withMessage('At least one assignee is required')
    .custom(async (assignees) => {
      for (const id of assignees) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
          throw new Error(`Invalid assignee ID: ${id}`);
        }
        const user = await User.findById(id);
        if (!user) {
          throw new Error(`User not found: ${id}`);
        }
      }
      return true;
    }),

  body('teamId')
    .notEmpty().withMessage('Team ID is required')
    .custom(async (value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid team ID');
      }
      const team = await Team.findById(value);
      if (!team) {
        throw new Error('Team not found');
      }
      return true;
    }),

  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high']).withMessage('Priority must be: low, medium, or high'),

  body('difficulty')
    .optional()
    .isIn(['easy', 'medium', 'hard']).withMessage('Difficulty must be: easy, medium, or hard'),

  body('startDate')
    .optional()
    .isISO8601().withMessage('Invalid start date format'),

  body('dueDate')
    .optional()
    .isISO8601().withMessage('Invalid due date format')
    .custom((value, { req }) => {
      if (value && req.body.startDate) {
        if (new Date(value) < new Date(req.body.startDate)) {
          throw new Error('Due date must be after or equal to start date');
        }
      }
      return true;
    }),

  body('tags')
    .optional()
    .isArray().withMessage('Tags must be an array'),

  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Each tag must be at most 50 characters')
];

/**
 * Validation chain for updating a task
 */
const updateTaskValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid task ID');
      }
      return true;
    }),

  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 255 }).withMessage('Title must be between 3 and 255 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 }).withMessage('Description must be at most 5000 characters'),

  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high']).withMessage('Priority must be: low, medium, or high'),

  body('startDate')
    .optional()
    .isISO8601().withMessage('Invalid start date format'),

  body('dueDate')
    .optional()
    .isISO8601().withMessage('Invalid due date format'),

  body('tags')
    .optional()
    .isArray().withMessage('Tags must be an array')
];

/**
 * Validation chain for assigning tasks
 */
const assignTaskValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid task ID');
      }
      return true;
    }),

  body('assignedTo')
    .isArray({ min: 1 }).withMessage('At least one assignee is required')
    .custom(async (assignees) => {
      for (const id of assignees) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
          throw new Error(`Invalid assignee ID: ${id}`);
        }
      }
      return true;
    })
];

/**
 * Validation chain for updating task status
 */
const updateStatusValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid task ID');
      }
      return true;
    }),

  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['todo', 'in_progress', 'done']).withMessage('Status must be: todo, in_progress, or done')
];

/**
 * Validation chain for updating task progress
 */
const updateProgressValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid task ID');
      }
      return true;
    }),

  body('progress')
    .notEmpty().withMessage('Progress is required')
    .isInt({ min: 0, max: 100 }).withMessage('Progress must be between 0 and 100')
    .toInt()
];

/**
 * Validation chain for adding comments
 */
const addCommentValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid task ID');
      }
      return true;
    }),

  body('text')
    .trim()
    .notEmpty().withMessage('Comment text is required')
    .isLength({ min: 1, max: 2000 }).withMessage('Comment must be between 1 and 2000 characters')
];

/**
 * Validation chain for adding subtasks
 */
const createSubtaskValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid task ID');
      }
      return true;
    }),

  body('title')
    .trim()
    .notEmpty().withMessage('Subtask title is required')
    .isLength({ min: 1, max: 255 }).withMessage('Subtask title must be between 1 and 255 characters')
];

/**
 * Validation chain for updating subtask
 */
const updateSubtaskValidation = [
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid task ID');
      }
      return true;
    }),

  param('subtaskId')
    .notEmpty().withMessage('Subtask ID is required'),

  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Subtask title must be between 1 and 255 characters'),

  body('isCompleted')
    .optional()
    .isBoolean().withMessage('isCompleted must be a boolean')
];

/**
 * Validation chain for getting tasks (filters)
 */
const getTasksValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt(),

  query('status')
    .optional()
    .isIn(['todo', 'in_progress', 'done']).withMessage('Invalid status'),

  query('priority')
    .optional()
    .isIn(['low', 'medium', 'high']).withMessage('Invalid priority'),

  query('search')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Search must be at most 100 characters')
];

/**
 * Validation chain for getting team tasks
 */
const getTeamTasksValidation = [
  param('teamId')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid team ID');
      }
      return true;
    }),

  query('status')
    .optional()
    .isIn(['todo', 'in_progress', 'done']).withMessage('Invalid status')
];

/**
 * Validation chain for getting overdue tasks
 */
const getOverdueTasksValidation = [
  query('forTeam')
    .optional()
    .isBoolean().withMessage('forTeam must be a boolean')
    .toBoolean()
];

module.exports = {
  createTaskValidation,
  updateTaskValidation,
  assignTaskValidation,
  updateStatusValidation,
  updateProgressValidation,
  addCommentValidation,
  createSubtaskValidation,
  updateSubtaskValidation,
  getTasksValidation,
  getTeamTasksValidation,
  getOverdueTasksValidation
};
