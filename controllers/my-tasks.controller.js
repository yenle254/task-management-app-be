const Task = require('../models/task.model');
const advanced = require('../services/task-advanced.service');
const { enrichTasks } = require('../services/task.service');
const { TASK_STATUS, PAGINATION } = require('../utils/constants.utils');
const { applyDateFilter, parseDate, validateDateRange } = require('../utils/dashboard.helper');

/**
 * @desc    Get tasks assigned to current user
 * @route   GET /api/tasks/my
 * @access  Private
 */
const getMyTasks = async (req, res) => {
  try {
    const { page = 1, limit = PAGINATION.MY_TASKS_DEFAULT_LIMIT, status, priority, startDate, endDate } = req.query;

    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }
    if ((startDate && !endDate) || (!startDate && endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Both startDate and endDate are required when specifying a date range'
      });
    }

    const query = {
      assignedTo: req.user._id,
      status: { $ne: TASK_STATUS.DELETED }
    };

    if (status) query.status = status;
    if (priority) query.priority = priority;
    advanced.applyListFilters(query, req.query, true);

    // Date filters are applied inside the MongoDB query so pagination totals
    // stay consistent with the returned page.
    applyDateFilter(query, 'createdAt', parseDate(startDate), parseDate(endDate));

    const total = await Task.countDocuments(query);

    const tasks = await advanced.findListTasks(query, req.query, { dueDate: 1 });

    res.json({
      success: true,
      count: tasks.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: enrichTasks(tasks, true)
    });
  } catch (error) {
    console.error('Get my tasks error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = getMyTasks;
