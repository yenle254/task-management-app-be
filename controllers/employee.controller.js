const { getEmployeeDashboard } = require('../services/employee-dashboard.service');
const Task = require('../models/task.model');
const { enrichTasks } = require('../services/task.service');
const { TASK_STATUS } = require('../utils/constants.utils');
const {
  validateDateRange,
  validatePeriod,
  parseDate,
  applyDateFilter
} = require('../utils/dashboard.helper');

/**
 * @desc    Get dashboard for the authenticated user
 * @route   GET /api/employees/dashboard
 * @access  Private (any authenticated user)
 */
const getDashboard = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;

    const periodCheck = validatePeriod(period);
    if (!periodCheck.valid) {
      return res.status(400).json({ success: false, error: periodCheck.error });
    }

    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }

    // Only one of startDate/endDate given -> the range is incomplete.
    if ((startDate && !endDate) || (!startDate && endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Both startDate and endDate are required when specifying a date range'
      });
    }

    // The user identity always comes from the auth middleware, never from query.
    const dashboardData = await getEmployeeDashboard(req.user._id, {
      period,
      startDate,
      endDate
    });

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Employee dashboard error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Get tasks assigned to the authenticated user (with optional filters)
 * @route   GET /api/employees/tasks
 * @access  Private
 */
const getMyTasks = async (req, res) => {
  try {
    const { page = 1, limit = 1000, status, startDate, endDate } = req.query;

    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }

    if (status && !Object.values(TASK_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${Object.values(TASK_STATUS).join(', ')}`
      });
    }

    const query = {
      assignedTo: req.user._id,
      status: { $ne: TASK_STATUS.DELETED }
    };

    if (status) {
      query.status = status;
    }

    // Date filters are applied in the MongoDB query, not post-filtering.
    applyDateFilter(query, 'createdAt', parseDate(startDate), parseDate(endDate));

    const skip = (page - 1) * limit;
    const total = await Task.countDocuments(query);

    const tasks = await Task.find(query)
      .populate('assignedBy', 'profile.fullName profile.position profile.avatar email')
      .populate('assignedTo', 'profile.fullName profile.position profile.avatar email')
      .populate('teamId', 'name')
      .sort({ dueDate: 1 })
      .skip(skip)
      .limit(parseInt(limit));

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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getDashboard,
  getMyTasks
};
