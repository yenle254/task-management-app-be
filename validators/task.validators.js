/**
 * task.validators.js
 * Validation rules for task management endpoints
 */

const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const Task = require('../models/task.model');
const Team = require('../models/team.model');
const User = require('../models/user.model');
const { resolveRange, SORTS } = require('../services/task-advanced.service');
const tagRules = () => [
  body('tags').optional().isArray({ max: 20 }),
  body('tags.*').isString().bail().trim().isLength({ min: 1, max: 50 })
];
const estimateRules = () => [
  body('estimatedMinutes').optional({ nullable: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body('storyPoints').optional({ nullable: true }).isFloat({ min: 0 }).toFloat()
];

/**
 * Validation chain for creating a task
 */
const createTaskValidation = [
  ...tagRules(), ...estimateRules(),
  body('title')
    .isString().withMessage('Must be a string').bail()
    .trim()
    .notEmpty().withMessage('Task title is required')
    .isLength({ min: 3, max: 255 }).withMessage('Title must be between 3 and 255 characters'),

  body('description')
    .optional()
    .isString().withMessage('Must be a string').bail()
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
    .isString().withMessage('Must be a string').bail()
    .trim()
    .isLength({ max: 50 }).withMessage('Each tag must be at most 50 characters')
];

/**
 * Validation chain for updating a task
 */
const updateTaskValidation = [
  body('teamId').optional().isMongoId(),
  body('assignedTo').optional().isArray({ min: 1 }), body('assignedTo.*').optional().isMongoId(),
  ...tagRules(), ...estimateRules(),
  body('difficulty').optional().isIn(['easy', 'medium', 'hard']),
  body('removedAttachments').optional().isArray(),
  body('removedAttachments.*').isMongoId(),
  param('id')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid task ID');
      }
      return true;
    }),

  body('title')
    .optional()
    .isString().withMessage('Must be a string').bail()
    .trim()
    .isLength({ min: 3, max: 255 }).withMessage('Title must be between 3 and 255 characters'),

  body('description')
    .optional()
    .isString().withMessage('Must be a string').bail()
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
    .isString().withMessage('Must be a string').bail()
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
    .isString().withMessage('Must be a string').bail()
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
    .isMongoId().withMessage('Invalid subtask ID'),

  body('title')
    .optional()
    .isString().withMessage('Must be a string').bail()
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
  query('sort').optional().isIn(Object.keys(SORTS)),
  query('assigneeId').optional().isMongoId(),
  query('hasSubtasks').optional().isBoolean(),
  query('tags').optional().isString().bail().custom(value => {
    const tags = value.split(',');
    return tags.length <= 5 && tags.every(tag => tag.trim().length > 0 && tag.trim().length <= 50);
  }),
  query('fromDate').optional().isISO8601({ strict: true }),
  query('toDate').optional().isISO8601({ strict: true }),
  query().custom(value => { resolveRange(value.fromDate, value.toDate); return true; }),
  query('teamId').optional().isMongoId().withMessage('Invalid team ID'),
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
    .isIn(['todo', 'in_progress', 'in_review', 'done']).withMessage('Invalid status'),

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
  ...getTasksValidation
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

// Every advanced endpoint validates task and nested resource identifiers.
const advancedTaskValidation = (kind, ids = []) => {
  const rules = [param('id').isMongoId(), ...ids.map(id => param(id).isMongoId())];
  const text = (field, max) => body(field).isString().bail().trim().isLength({ min: 1, max });
  const operations = {
    parent: [body('parentTaskId').isMongoId()],
    checklist: [text('title', 255)],
    item: [text('text', 500)],
    patchItem: [body('text').optional().isString().bail().trim().isLength({ min: 1, max: 500 }),
      body('isCompleted').optional().isBoolean().toBoolean(),
      body().custom(value => value.text !== undefined || value.isCompleted !== undefined)],
    dependencies: [body('dependencyIds').isArray({ max: 20 }), body('dependencyIds.*').isMongoId()],
    watcher: [body('userId').isMongoId()],
    tags: [body('tags').exists(), ...tagRules()],
    estimate: [...estimateRules(), body().custom(value => value.estimatedMinutes !== undefined || value.storyPoints !== undefined)],
    time: [body('minutes').isInt({ min: 1, max: 1440 }).toInt(), body('note').optional().isString().bail().trim().isLength({ max: 500 })]
  };
  return [...rules, ...(operations[kind] || [])];
};
const taskViewValidation = (rangeRequired = false) => [
  query('teamId').optional().isMongoId(), query('scope').optional().isIn(['self', 'team']),
  query('includeSubtasks').optional().isBoolean().toBoolean(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ...(rangeRequired ? [query('from').isISO8601({ strict: true }), query('to').isISO8601({ strict: true }),
    query().custom(value => { resolveRange(value.from, value.to, true); return true; })] : [])
];

const reviewValidation = (reason = false) => [param('id').isMongoId(),
  body('note').optional().isString().bail().trim().isLength({ max: 500 }),
  ...(reason ? [body('reason').isString().bail().trim().isLength({ min: 1, max: 1000 }).withMessage('A reason is required when requesting changes')] : [])];
const pendingApprovalValidation = [query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(), query('teamId').optional().isMongoId(),
  query('overdueSla').optional().isBoolean().toBoolean()];
module.exports = {
  reviewValidation, pendingApprovalValidation,
  advancedTaskValidation, taskViewValidation,
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
