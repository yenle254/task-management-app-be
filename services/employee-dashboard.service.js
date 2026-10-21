const Task = require('../models/task.model');
const Attendance = require('../models/attendance.model');
const User = require('../models/user.model');
const { TASK_STATUS } = require('../utils/constants.utils');
const {
  resolveDateRange,
  percentage,
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
 * Buckets are derived from `completedAt` (real completion timestamps) and
 * `createdAt` (real creation timestamps). No synthetic history is generated:
 * buckets with no activity simply carry zeros.
 *
 * @param {string} userId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} periodType - 'week' | 'month'
 * @returns {Array<{period, label, totalTasks, completedTasks, completionRate}>}
 */
const getPerformanceTrend = async (userId, startDate, endDate, periodType) => {
  // 'week' period -> group by day inside the week.
  // 'month' period -> group by ISO-ish week inside the month.
  const groupFormat =
    periodType === 'week'
      ? { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }
      : { $dateToString: { format: '%G-W%V', date: '$completedAt' } };

  const [completedRows, createdRows] = await Promise.all([
    Task.aggregate([
      {
        $match: {
          assignedTo: userId,
          status: TASK_STATUS.DONE,
          completedAt: { $gte: startDate, $lte: endDate, $ne: null }
        }
      },
      {
        $group: {
          _id: groupFormat,
          completed: { $sum: 1 },
          onTime: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$dueDate', null] },
                    { $lte: ['$completedAt', '$dueDate'] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    Task.aggregate([
      {
        $match: {
          assignedTo: userId,
          status: { $ne: TASK_STATUS.DELETED },
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format:
                periodType === 'week' ? '%Y-%m-%d' : '%G-W%V',
              date: '$createdAt'
            }
          },
          total: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  const completedMap = new Map(completedRows.map((r) => [r._id, r]));
  const createdMap = new Map(createdRows.map((r) => [r._id, r]));

  // Union of buckets that actually have data.
  const bucketKeys = Array.from(
    new Set([...completedMap.keys(), ...createdMap.keys()])
  ).sort();

  return bucketKeys.map((key) => {
    const completed = completedMap.get(key);
    const created = createdMap.get(key);
    const totalTasks = created?.total || 0;
    const completedTasks = completed?.completed || 0;

    return {
      period: key,
      label: key,
      totalTasks,
      completedTasks,
      completionRate: percentage(completedTasks, totalTasks),
      onTimeTasks: completed?.onTime || 0
    };
  });
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
      // Open tasks currently assigned to the user (not scoped to the range —
      // "đang thực hiện" reflects the current backlog).
      Task.countDocuments({
        ...baseScope,
        status: { $in: OPEN_STATUSES }
      }),

      // Tasks completed inside the range, using the real completion timestamp.
      Task.countDocuments({
        ...baseScope,
        status: TASK_STATUS.DONE,
        completedAt: { $gte: startDate, $lte: endDate, $ne: null }
      }),

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

  const workHours = attendanceAgg[0]?.totalWorkHours ?? 0;
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
