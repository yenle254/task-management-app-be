const Task = require('../models/task.model');
const { enrichTasks } = require('../services/task.service');
const { TASK_STATUS } = require('../utils/constants.utils');
const { applyDateFilter, parseDate, validateDateRange } = require('../utils/dashboard.helper');

/**
 * @desc    Get tasks assigned to current user
 * @route   GET /api/tasks/my
 * @access  Private
 */
const getMyTasks = async (req, res) => {
  try {
    const { page = 1, limit = 1000, status, priority, startDate, endDate } = req.query;

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

    // Date filters are applied inside the MongoDB query so pagination totals
    // stay consistent with the returned page.
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

module.exports = getMyTasks;
