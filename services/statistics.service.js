const mongoose = require('mongoose');
const User = require('../models/user.model');
const Task = require('../models/task.model');
const Attendance = require('../models/attendance.model');
const Leave = require('../models/leave.model');
const { getTaskEventTrend } = require('./task-history.service');
const attendanceService = require('./attendance.service');
const { TASK_STATUS, ATTENDANCE_STATUS, LEAVE_STATUS, USER_ROLES } = require('../utils/constants.utils');
const { percentage, OPEN_STATUSES, applyDateFilter } = require('../utils/dashboard.helper');

/**
 * Statistics service for HR Manager dashboards.
 *
 * Metric definitions (single source of truth, reused by every endpoint):
 *
 *  - completionRate = doneTasks / totalTasks * 100
 *  - overdueRate    = overdueTasks / totalTasks * 100
 *  - onTimeRate     = onTimeTasks / completedTasksWithBothDates * 100
 *  - attendance onTimeRate = presentRecords / (storedRecords + calculatedAbsences) * 100
 *  - attendance lateRate   = lateRecords   / (storedRecords + calculatedAbsences) * 100
 *
 * A task counts as on time only when its recorded completion event has a
 * due-date snapshot and the event time is no later than that due date.
 */

const VALID_ATTENDANCE_STATUSES = [
  ATTENDANCE_STATUS.PRESENT,
  ATTENDANCE_STATUS.LATE,
  ATTENDANCE_STATUS.ABSENT
];

const countCalculatedAbsences = async (startDate, endDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastDay = new Date(Math.min(endDate.getTime(), today.getTime() - 1));
  if (lastDay < startDate) return { total: 0, byDate: {} };

  const workingDays = attendanceService.getWorkingDays(startDate, lastDay);
  if (workingDays.length === 0) return { total: 0, byDate: {} };

  const [users, records] = await Promise.all([
    User.find({
      isActive: true,
      role: { $in: [USER_ROLES.EMPLOYEE, USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER] },
      createdAt: { $lte: lastDay }
    }).select('_id createdAt').lean(),
    Attendance.find({
      date: { $gte: startDate, $lte: lastDay },
      status: { $in: VALID_ATTENDANCE_STATUSES }
    }).select('userId date').lean()
  ]);

  const dateKey = (date) => {
    const d = new Date(date);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')].join('-');
  };
  const recorded = new Set(records.map((record) =>
    `${record.userId.toString()}:${dateKey(record.date)}`
  ));

  let absent = 0;
  const byDate = {};
  for (const user of users) {
    const createdDay = new Date(user.createdAt);
    createdDay.setHours(0, 0, 0, 0);
    for (const day of workingDays) {
      if (day >= createdDay && !recorded.has(`${user._id.toString()}:${dateKey(day)}`)) {
        absent += 1;
        byDate[dateKey(day)] = (byDate[dateKey(day)] || 0) + 1;
      }
    }
  }
  return { total: absent, byDate };
};

/**
 * Build a MongoDB filter for tasks from query params.
 * @param {Object} query
 * @param {Object} opts
 * @returns {Object} mongo filter
 */
const buildTaskFilter = (query = {}) => {
  const filter = { status: { $ne: TASK_STATUS.DELETED } };

  applyDateFilter(filter, 'createdAt', query.startDate, query.endDate);

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
 * `present` means the employee was on time, `late` means they arrived late.
 * Missing past workdays for active staff are counted as calculated absences.
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

  const [summaryRows, dailyRows, calculated] = await Promise.all([
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
          _id: { $dateToString: {
            format: '%Y-%m-%d', date: '$date',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          } },
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
    ]),
    countCalculatedAbsences(startDate, endDate)
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

  const storedRecords = totalRecords;
  absentCount += calculated.total;
  totalRecords += calculated.total;

  const summary = summaryRows.map((row) => ({ ...row }));
  if (calculated.total > 0) {
    const absentRow = summary.find((row) => row._id === ATTENDANCE_STATUS.ABSENT);
    if (absentRow) absentRow.count += calculated.total;
    else summary.push({ _id: ATTENDANCE_STATUS.ABSENT, count: calculated.total, totalWorkHours: 0 });
  }

  const dailyMap = new Map(dailyRows.map((row) => [row._id, { ...row }]));
  for (const [date, count] of Object.entries(calculated.byDate)) {
    const row = dailyMap.get(date) || { _id: date, present: 0, late: 0, absent: 0 };
    row.absent += count;
    dailyMap.set(date, row);
  }
  const daily = [...dailyMap.values()].sort((a, b) => String(a._id).localeCompare(String(b._id)))
    .map((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row._id))
      ? { ...row, date: row._id, _id: Number(row._id.slice(8)) }
      : row);

  return {
    // Kept for backward compatibility with the previous response shape.
    summary,
    daily,
    // New explicit counters.
    counts: {
      present: presentCount,
      late: lateCount,
      absent: absentCount,
      total: totalRecords
    },
    totalRecords,
    storedRecords,
    calculatedAbsences: calculated.total,
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
const getLeaveStats = async (startDate, endDate, month, year, explicitOverlapRange = null) => {
  const periodStart = explicitOverlapRange?.startDate || new Date(year, month - 1, 1, 0, 0, 0, 0);
  const periodEnd = explicitOverlapRange?.endDate || new Date(year, month, 0, 23, 59, 59, 999);

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

  const [overlapRows, pendingCount, createdCount, byType, byStatus, byYearMonth] =
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
      Leave.countDocuments({ status: LEAVE_STATUS.PENDING }),
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
            _id: { $dateToString: {
              format: '%Y-%m', date: '$startDate', timezone: 'UTC'
            } },
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
  const monthlyTotals = new Map();
  for (const row of byYearMonth) {
    const monthNumber = Number(String(row._id).slice(5));
    const current = monthlyTotals.get(monthNumber) || { _id: monthNumber, count: 0, totalDays: 0 };
    current.count += row.count;
    current.totalDays += row.totalDays || 0;
    monthlyTotals.set(monthNumber, current);
  }
  const byMonth = [...monthlyTotals.values()].sort((a, b) => a._id - b._id);

  return {
    // Kept for backward compatibility.
    byType,
    byStatus,
    byMonth,
    byYearMonth,
    approvedOverlapPeriod: { startDate: periodStart, endDate: periodEnd },
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
 * Buckets come from recorded status events. Periods without activity are not fabricated.
 *
 * @param {Object} filter - Mongo filter from buildTaskFilter
 * @param {string} periodType - 'week' | 'month'
 * @returns {Promise<Array<Object>>}
 */
const getPerformanceTrend = async (filter, periodType, startDate, endDate) => {
  return getTaskEventTrend({
    teamId: filter.teamId,
    employeeId: filter.assignedTo
  }, periodType, startDate, endDate);
};

module.exports = {
  buildTaskFilter,
  getAttendanceStats,
  getLeaveStats,
  getTaskStats,
  getPerformanceTrend,
  VALID_ATTENDANCE_STATUSES
};
