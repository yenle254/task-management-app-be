const Task = require('../models/task.model');
const Attendance = require('../models/attendance.model');
const User = require('../models/user.model');
const { getTaskEventTrend, countCompletedTasks } = require('./task-history.service');
const { TASK_STATUS } = require('../utils/constants.utils');
const {
  resolveDateRange,
  OPEN_STATUSES
} = require('../utils/dashboard.helper');

/**
 * Employee dashboard service.
 *
 * All metrics are scoped to the authenticated user — no userId is ever taken
 * from the request payload or query string.
 */

/**
 * Read the leave balance for a given year from User.leaveBalance.
 * `leaveBalance` is a Mongoose Map keyed by year string.
 *
 * @param {Object} user - User document (or lean object)
 * @param {number} year
 * @returns {Object} { total, used, remaining }
 */
const getLeaveBalance = (user, year) => {
  const fallback = { total: 12, used: 0, remaining: 12 };

  if (!user || !user.leaveBalance) return fallback;

  const key = String(year);
  // Mongoose Map: .get() works on documents; plain objects use bracket access.
  const entry =
    typeof user.leaveBalance.get === 'function'
      ? user.leaveBalance.get(key)
      : user.leaveBalance[key];

  if (!entry) return fallback;

  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const total = toNumber(entry.total);
  const used = toNumber(entry.used);

  return {
    total,
    used,
    remaining: Number.isFinite(Number(entry.remaining))
      ? Number(entry.remaining)
      : Math.max(total - used, 0)
  };
};

/**
 * Build performance trend buckets from real task events.
 *
 * Buckets are derived from recorded creation and completion events. No
 * synthetic history or empty periods are generated.
 *
 * @param {string} userId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} periodType - 'week' | 'month'
 * @returns {Array<{period, label, totalTasks, completedTasks, completionRate}>}
 */
const getPerformanceTrend = async (userId, startDate, endDate, periodType) => {
  return getTaskEventTrend({ employeeId: userId }, periodType, startDate, endDate);
};

/**
 * Get the employee dashboard payload.
 *
 * @param {string} userId - Authenticated user ID
 * @param {Object} query - { period, startDate, endDate }
 * @returns {Promise<Object>}
 */
const getEmployeeDashboard = async (userId, query = {}) => {
  const { startDate, endDate, period, source } = resolveDateRange(query);
  const now = new Date();
  const currentYear = now.getFullYear();

  const baseScope = {
    assignedTo: userId,
    status: { $ne: TASK_STATUS.DELETED }
  };

  const [inProgressTasks, completedTasks, overdueTasks, attendanceAgg, user] =
    await Promise.all([
      // "In progress" reflects the actual Task status, not the entire backlog.
      Task.countDocuments({
        ...baseScope,
        status: TASK_STATUS.IN_PROGRESS
      }),

      // Tasks completed inside the range, using the real completion timestamp.
      countCompletedTasks({ employeeId: userId }, startDate, endDate),

      // Overdue: dueDate < now and still open.
      Task.countDocuments({
        ...baseScope,
        status: { $in: OPEN_STATUSES },
        dueDate: { $lt: now, $ne: null }
      }),

      // Work hours — only recorded workHours are summed.
      Attendance.aggregate([
        {
          $match: {
            userId,
            date: { $gte: startDate, $lte: endDate },
            workHours: { $type: 'number', $gte: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalWorkHours: { $sum: '$workHours' },
            attendanceDays: { $sum: 1 }
          }
        }
      ]),

      User.findById(userId).select('leaveBalance').lean()
    ]);

  const rawWorkHours = attendanceAgg[0]?.totalWorkHours ?? 0;
  const workHours = Number.isFinite(rawWorkHours) && rawWorkHours >= 0 ? rawWorkHours : 0;
  const attendanceDays = attendanceAgg[0]?.attendanceDays ?? 0;

  const performanceTrend = await getPerformanceTrend(
    userId,
    startDate,
    endDate,
    period === 'week' ? 'week' : 'month'
  );

  return {
    period: {
      startDate,
      endDate,
      period,
      source,
      days: Math.round((endDate - startDate) / (24 * 60 * 60 * 1000)) + 1
    },
    tasks: {
      inProgress: inProgressTasks,
      completed: completedTasks,
      overdue: overdueTasks
    },
    workHours: {
      total: Math.round(workHours * 100) / 100,
      attendanceDays
    },
    leaveBalance: getLeaveBalance(user, currentYear),
    performanceTrend
  };
};

module.exports = {
  getEmployeeDashboard,
  getLeaveBalance,
  getPerformanceTrend
};
