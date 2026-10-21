const mongoose = require('mongoose');
const User = require('../models/user.model');
const Task = require('../models/task.model');
const Attendance = require('../models/attendance.model');
const Leave = require('../models/leave.model');
const Team = require('../models/team.model');
const { TASK_STATUS, ATTENDANCE_STATUS, LEAVE_STATUS } = require('../utils/constants.utils');
const { percentage, OPEN_STATUSES } = require('../utils/dashboard.helper');

/**
 * Statistics service for HR Manager dashboards.
 *
 * Metric definitions (single source of truth, reused by every endpoint):
 *
 *  - completionRate = doneTasks / totalTasks * 100
 *  - overdueRate    = overdueTasks / totalTasks * 100
 *  - onTimeRate     = onTimeTasks / completedTasksWithBothDates * 100
 *  - attendance onTimeRate = presentRecords / validAttendanceRecords * 100
 *  - attendance lateRate   = lateRecords   / validAttendanceRecords * 100
 *
 * A task counts as "on time" only when it has both a dueDate and a completedAt
 * and completedAt <= dueDate. Tasks without a completion timestamp are
 * excluded from both the numerator and the denominator.
 */

const VALID_ATTENDANCE_STATUSES = [
  ATTENDANCE_STATUS.PRESENT,
  ATTENDANCE_STATUS.LATE,
  ATTENDANCE_STATUS.ABSENT
];

/**
 * Build a MongoDB filter for tasks from query params.
 * @param {Object} query
 * @param {Object} opts
 * @returns {Object} mongo filter
 */
const buildTaskFilter = (query = {}) => {
  const filter = { status: { $ne: TASK_STATUS.DELETED } };

  if (query.startDate || query.endDate) {
    filter.createdAt = {};
    if (query.startDate) filter.createdAt.$gte = query.startDate;
    if (query.endDate) filter.createdAt.$lte = query.endDate;
  }

  if (query.teamId) {
    filter.teamId = new mongoose.Types.ObjectId(query.teamId);
  }

  if (query.employeeId) {
    // `assignedTo` is an array field; matching a single ObjectId selects every
    // task that lists that employee among its assignees.
    filter.assignedTo = new mongoose.Types.ObjectId(query.employeeId);
  }

  // An explicit status narrows the scope but never re-includes deleted tasks.
  if (
    query.status &&
    Object.values(TASK_STATUS).includes(query.status) &&
    query.status !== TASK_STATUS.DELETED
  ) {
    filter.status = query.status;
  }

  if (query.priority) {
    filter.priority = query.priority;
  }

  return filter;
};

/**
 * Attendance statistics with on-time / late rates.
 *
 * `present` means the employee was on time, `late` means they arrived late,
 * `absent` means no show. The denominator is every attendance record with a
 * known status.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Object>}
 */
const getAttendanceStats = async (startDate, endDate) => {
  const match = {
    date: { $gte: startDate, $lte: endDate },
    status: { $in: VALID_ATTENDANCE_STATUSES }
  };

  const [summaryRows, dailyRows] = await Promise.all([
    Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalWorkHours: { $sum: '$workHours' }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dayOfMonth: '$date' },
          present: {
            $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.PRESENT] }, 1, 0] }
          },
          late: {
            $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.LATE] }, 1, 0] }
          },
          absent: {
            $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.ABSENT] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  const byStatus = {};
  let totalRecords = 0;
  let presentCount = 0;
  let lateCount = 0;
  let absentCount = 0;
  let totalWorkHours = 0;

  for (const row of summaryRows) {
    byStatus[row._id] = row.count;
    totalRecords += row.count;
    if (row._id === ATTENDANCE_STATUS.PRESENT) presentCount = row.count;
    if (row._id === ATTENDANCE_STATUS.LATE) lateCount = row.count;
    if (row._id === ATTENDANCE_STATUS.ABSENT) absentCount = row.count;
    totalWorkHours += row.totalWorkHours || 0;
  }

  return {
    // Kept for backward compatibility with the previous response shape.
    summary: summaryRows,
    daily: dailyRows,
    // New explicit counters.
    counts: {
      present: presentCount,
      late: lateCount,
      absent: absentCount,
      total: totalRecords
    },
    totalRecords,
    onTimeRate: percentage(presentCount, totalRecords),
    lateRate: percentage(lateCount, totalRecords),
    absentRate: percentage(absentCount, totalRecords),
    totalWorkHours: Math.round(totalWorkHours * 100) / 100
  };
};

/**
 * Leave statistics for a period.
 *
 * A leave "overlaps" a month when startDate <= endOfMonth AND endDate >= startOfMonth.
 * Approved employees are counted as DISTINCT userId.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {number} month - 1..12 used for the monthly overlap bucket
 * @param {number} year
 * @returns {Promise<Object>}
 */
const getLeaveStats = async (startDate, endDate, month, year) => {
  const periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

  // Leaves overlapping the period.
  const overlapMatch = {
    status: LEAVE_STATUS.APPROVED,
    startDate: { $lte: periodEnd },
    endDate: { $gte: periodStart }
  };

  // Leaves created inside the period (any status).
  const createdMatch = {
    createdAt: { $gte: startDate, $lte: endDate }
  };

  const [overlapRows, pendingCount, createdCount, byType, byStatus, byMonth] =
    await Promise.all([
      Leave.aggregate([
        { $match: overlapMatch },
        {
          $group: {
            _id: '$userId',
            totalDays: { $sum: '$numberOfDays' },
            leaveCount: { $sum: 1 }
          }
        }
      ]),
      Leave.countDocuments({
        status: LEAVE_STATUS.PENDING,
        createdAt: { $gte: startDate, $lte: endDate }
      }),
      Leave.countDocuments(createdMatch),
      Leave.aggregate([
        { $match: createdMatch },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            totalDays: { $sum: '$numberOfDays' }
          }
        }
      ]),
      Leave.aggregate([
        { $match: createdMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Leave.aggregate([
        { $match: createdMatch },
        {
          $group: {
            _id: { $month: '$startDate' },
            count: { $sum: 1 },
            totalDays: { $sum: '$numberOfDays' }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

  // Distinct employees on approved leave overlapping the period.
  const employeesOnLeave = overlapRows.length;
  const totalApprovedDays = overlapRows.reduce(
    (sum, r) => sum + (r.totalDays || 0),
    0
  );
  const totalApprovedLeaveRecords = overlapRows.reduce(
    (sum, r) => sum + (r.leaveCount || 0),
    0
  );

  return {
    // Kept for backward compatibility.
    byType,
    byStatus,
    byMonth,
    // New explicit metrics.
    employeesOnLeave,
    approvedLeaveRecords: totalApprovedLeaveRecords,
    approvedLeaveDays: totalApprovedDays,
    pendingLeaves: pendingCount,
    createdLeaves: createdCount
  };
};

/**
 * Task statistics with filters.
 *
 * @param {Object} filter - Mongo filter from buildTaskFilter
 * @returns {Promise<Object>}
 */
const getTaskStats = async (filter) => {
  const [byStatus, byPriority, byTeam] = await Promise.all([
    Task.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    Task.aggregate([
      { $match: filter },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    Task.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'teams',
          localField: 'teamId',
          foreignField: '_id',
          as: 'team'
        }
      },
      { $unwind: { path: '$team', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$team.name',
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', TASK_STATUS.DONE] }, 1, 0] }
          }
        }
      },
      { $sort: { total: -1 } }
    ])
  ]);

  const statusMap = {};
  let totalTasks = 0;
  let doneTasks = 0;
  let openTasks = 0;
  for (const row of byStatus) {
    statusMap[row._id] = row.count;
    totalTasks += row.count;
    if (row._id === TASK_STATUS.DONE) doneTasks = row.count;
    if (OPEN_STATUSES.includes(row._id)) openTasks += row.count;
  }

  const overdueTasks = await Task.countDocuments({
    ...filter,
    status: { $in: OPEN_STATUSES },
    dueDate: { $lt: new Date(), $ne: null }
  });

  return {
    // Kept for backward compatibility.
    byStatus,
    byPriority,
    byTeam,
    // New explicit metrics.
    totalTasks,
    doneTasks,
    openTasks,
    overdueTasks,
    completionRate: percentage(doneTasks, totalTasks),
    overdueRate: percentage(overdueTasks, totalTasks)
  };
};

/**
 * Performance trend over weeks or months.
 *
 * Buckets come from real events only: completedAt for completions and
 * createdAt for creation. Periods without activity are not fabricated.
 *
 * @param {Object} filter - Mongo filter from buildTaskFilter
 * @param {string} periodType - 'week' | 'month'
 * @returns {Promise<Array<Object>>}
 */
const getPerformanceTrend = async (filter, periodType, startDate, endDate) => {
  const bucketFormat =
    periodType === 'week'
      ? { $dateToString: { format: '%Y-%m-%d', date: '$date' } }
      : { $dateToString: { format: '%Y-%m', date: '$date' } };

  // Completed buckets are keyed on the real completion timestamp.
  const completedFilter = {
    ...filter,
    status: TASK_STATUS.DONE,
    completedAt: { $ne: null }
  };
  if (startDate || endDate) {
    completedFilter.completedAt = {};
    if (startDate) completedFilter.completedAt.$gte = startDate;
    if (endDate) completedFilter.completedAt.$lte = endDate;
  }

  // Created buckets are keyed on the real creation timestamp.
  const createdFilter = { ...filter };
  if (startDate || endDate) {
    createdFilter.createdAt = {};
    if (startDate) createdFilter.createdAt.$gte = startDate;
    if (endDate) createdFilter.createdAt.$lte = endDate;
  }

  const [completedRows, createdRows] = await Promise.all([
    Task.aggregate([
      { $match: completedFilter },
      {
        $group: {
          _id: {
            $dateToString: {
              format: periodType === 'week' ? '%Y-%m-%d' : '%Y-%m',
              date: '$completedAt'
            }
          },
          completed: { $sum: 1 },
          // Count only tasks that have BOTH dates, so the on-time denominator
          // excludes completions without a dueDate.
          withDueDate: {
            $sum: { $cond: [{ $ne: ['$dueDate', null] }, 1, 0] }
          },
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
      { $match: createdFilter },
      {
        $group: {
          _id: {
            $dateToString: {
              format: periodType === 'week' ? '%Y-%m-%d' : '%Y-%m',
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

  const keys = Array.from(
    new Set([...completedMap.keys(), ...createdMap.keys()])
  ).sort();

  return keys.map((key) => {
    const completed = completedMap.get(key);
    const created = createdMap.get(key);
    const totalTasks = created?.total || 0;
    const completedTasks = completed?.completed || 0;
    const onTimeTasks = completed?.onTime || 0;
    const withDueDate = completed?.withDueDate || 0;
    return {
      period: key,
      label: key,
      totalTasks,
      completedTasks,
      completionRate: percentage(completedTasks, totalTasks),
      onTimeTasks,
      onTimeRate: percentage(onTimeTasks, withDueDate)
    };
  });
};

module.exports = {
  buildTaskFilter,
  getAttendanceStats,
  getLeaveStats,
  getTaskStats,
  getPerformanceTrend,
  VALID_ATTENDANCE_STATUSES
};
