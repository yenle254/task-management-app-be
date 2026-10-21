const mongoose = require('mongoose');
const User = require('../models/user.model');
const Task = require('../models/task.model');
const Leave = require('../models/leave.model');
const Team = require('../models/team.model');
const { TASK_STATUS, TASK_PRIORITY } = require('../utils/constants.utils');
const statisticsService = require('../services/statistics.service');
const {
  validateDateRange,
  validateMonthYear,
  validatePeriod,
  parseDate,
  normalizeRange
} = require('../utils/dashboard.helper');

// Overview statistics
const getOverviewStats = async (req, res) => {
  try {
    const [totalEmployees, totalTeams, totalTasks, pendingLeaves] =
      await Promise.all([
        User.countDocuments({ isActive: true }),
        Team.countDocuments(),
        Task.countDocuments({ status: { $ne: "deleted" } }),
        Leave.countDocuments({ status: "pending" }),
      ]);

    res.json({
      success: true,
      data: {
        totalEmployees,
        totalTeams,
        totalTasks,
        pendingLeaves,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Employees by department statistics
const getEmployeesByDepartment = async (req, res) => {
  try {
    const { teamId, employeeId } = req.query;
    if (teamId && !mongoose.isValidObjectId(teamId)) {
      return res.status(400).json({ success: false, error: 'Invalid teamId' });
    }
    if (employeeId && !mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({ success: false, error: 'Invalid employeeId' });
    }
    const userMatch = { isActive: true };
    if (teamId) userMatch.teamId = new mongoose.Types.ObjectId(teamId);
    if (employeeId) userMatch._id = new mongoose.Types.ObjectId(employeeId);
    const stats = await User.aggregate([
      { $match: userMatch },
      {
        $group: {
          _id: "$profile.department",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json({
      success: true,
      data: stats.map((item) => ({
        department: item._id || "Unassigned",
        count: item.count,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Attendance statistics.
 *
 * Supports `month` + `year` (existing) and additionally `startDate`/`endDate`.
 * When an explicit date range is given it takes precedence over month/year.
 */
const getAttendanceStats = async (req, res) => {
  try {
    const { month, year, startDate, endDate } = req.query;

    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }
    if (Boolean(startDate) !== Boolean(endDate)) {
      return res.status(400).json({ success: false, error: 'Both startDate and endDate are required' });
    }

    const myCheck = validateMonthYear(month, year);
    if (!myCheck.valid) {
      return res.status(400).json({ success: false, error: myCheck.error });
    }

    let range;
    if (startDate && endDate) {
      range = normalizeRange(parseDate(startDate), parseDate(endDate));
    } else {
      const start = new Date(myCheck.year, myCheck.month - 1, 1, 0, 0, 0, 0);
      const end = new Date(myCheck.year, myCheck.month, 0, 23, 59, 59, 999);
      range = { startDate: start, endDate: end };
    }

    const stats = await statisticsService.getAttendanceStats(
      range.startDate,
      range.endDate
    );

    res.json({
      success: true,
      data: {
        // Backward-compatible fields.
        summary: stats.summary,
        daily: stats.daily,
        // New fields.
        period: {
          startDate: range.startDate,
          endDate: range.endDate,
          month: myCheck.month,
          year: myCheck.year,
          source: startDate && endDate ? 'explicit' : 'month',
        },
        counts: stats.counts,
        totalRecords: stats.totalRecords,
        storedRecords: stats.storedRecords,
        calculatedAbsences: stats.calculatedAbsences,
        onTimeRate: stats.onTimeRate,
        lateRate: stats.lateRate,
        absentRate: stats.absentRate,
        totalWorkHours: stats.totalWorkHours,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Leave statistics for a month/year.
 *
 * `employeesOnLeave` counts DISTINCT users whose approved leave overlaps the
 * selected month or explicit range. `pendingLeaves` counts currently pending
 * requests; `createdLeaves` counts every request created in the period.
 */
const getLeaveStats = async (req, res) => {
  try {
    const { year, month, startDate, endDate } = req.query;

    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }
    if (Boolean(startDate) !== Boolean(endDate)) {
      return res.status(400).json({ success: false, error: 'Both startDate and endDate are required' });
    }

    const myCheck = validateMonthYear(month, year);
    if (!myCheck.valid) {
      return res.status(400).json({ success: false, error: myCheck.error });
    }

    let range;
    if (startDate && endDate) {
      range = normalizeRange(parseDate(startDate), parseDate(endDate));
    } else {
      const start = new Date(myCheck.year, 0, 1, 0, 0, 0, 0);
      const end = new Date(myCheck.year, 11, 31, 23, 59, 59, 999);
      range = { startDate: start, endDate: end };
    }

    const stats = await statisticsService.getLeaveStats(
      range.startDate,
      range.endDate,
      myCheck.month,
      myCheck.year,
      startDate && endDate ? range : null
    );

    res.json({
      success: true,
      data: {
        // Backward-compatible fields.
        byType: stats.byType,
        byStatus: stats.byStatus,
        byMonth: stats.byMonth,
        byYearMonth: stats.byYearMonth,
        approvedOverlapPeriod: stats.approvedOverlapPeriod,
        // New fields.
        period: {
          startDate: range.startDate,
          endDate: range.endDate,
          month: myCheck.month,
          year: myCheck.year,
          source: startDate && endDate ? 'explicit' : 'year',
        },
        employeesOnLeave: stats.employeesOnLeave,
        approvedLeaveRecords: stats.approvedLeaveRecords,
        approvedLeaveDays: stats.approvedLeaveDays,
        pendingLeaves: stats.pendingLeaves,
        createdLeaves: stats.createdLeaves,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Task statistics with optional startDate / endDate / teamId / employeeId.
 */
const getTaskStats = async (req, res) => {
  try {
    const { startDate, endDate, teamId, employeeId, status, priority } =
      req.query;

    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }

    if (teamId && !mongoose.isValidObjectId(teamId)) {
      return res.status(400).json({ success: false, error: "Invalid teamId" });
    }
    if (employeeId && !mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employeeId",
      });
    }
    if (status && (typeof status !== 'string' || !Object.values(TASK_STATUS).includes(status) || status === TASK_STATUS.DELETED)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    if (priority && (typeof priority !== 'string' || !Object.values(TASK_PRIORITY).includes(priority))) {
      return res.status(400).json({ success: false, error: 'Invalid priority' });
    }

    // Verify the employee exists so the filter cannot silently match nothing.
    if (employeeId) {
      const employee = await User.findById(employeeId).select("_id").lean();
      if (!employee) {
        return res.status(404).json({
          success: false,
          error: "Employee not found",
        });
      }
    }

    const filter = statisticsService.buildTaskFilter({
      startDate: parseDate(startDate),
      endDate: parseDate(endDate),
      teamId,
      employeeId,
      status,
      priority,
    });

    const stats = await statisticsService.getTaskStats(filter);

    res.json({
      success: true,
      data: {
        // Backward-compatible fields.
        byStatus: stats.byStatus,
        byPriority: stats.byPriority,
        byTeam: stats.byTeam,
        // New fields.
        filters: { startDate, endDate, teamId, employeeId, status, priority },
        totalTasks: stats.totalTasks,
        doneTasks: stats.doneTasks,
        openTasks: stats.openTasks,
        overdueTasks: stats.overdueTasks,
        completionRate: stats.completionRate,
        overdueRate: stats.overdueRate,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Performance trends over weeks or months.
 *
 * Buckets are built from recorded status events. No synthetic
 * history is generated for periods without activity.
 */
const getPerformanceTrends = async (req, res) => {
  try {
    const { startDate, endDate, teamId, employeeId, period } = req.query;

    const periodCheck = validatePeriod(period);
    if (!periodCheck.valid) {
      return res.status(400).json({ success: false, error: periodCheck.error });
    }

    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }
    if (Boolean(startDate) !== Boolean(endDate)) {
      return res.status(400).json({ success: false, error: 'Both startDate and endDate are required' });
    }

    if (teamId && !mongoose.isValidObjectId(teamId)) {
      return res.status(400).json({ success: false, error: "Invalid teamId" });
    }
    if (employeeId && !mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employeeId",
      });
    }

    const now = new Date();
    let range;
    if (startDate && endDate) {
      range = normalizeRange(parseDate(startDate), parseDate(endDate));
    } else if (period === "week") {
      const day = (now.getDay() + 6) % 7;
      const s = new Date(now);
      s.setDate(now.getDate() - day);
      s.setHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      e.setHours(23, 59, 59, 999);
      range = { startDate: s, endDate: e };
    } else {
      const s = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      range = { startDate: s, endDate: e };
    }

    const filter = statisticsService.buildTaskFilter({
      teamId,
      employeeId,
    });

    const trend = await statisticsService.getPerformanceTrend(
      filter,
      period === "week" ? "week" : "month",
      range.startDate,
      range.endDate
    );

    res.json({
      success: true,
      data: {
        period: {
          startDate: range.startDate,
          endDate: range.endDate,
          period: period === "week" ? "week" : "month",
        },
        filters: { teamId, employeeId },
        trend,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Team performance statistics
const getTeamPerformance = async (req, res) => {
  try {
    const { teamId, employeeId, startDate, endDate } = req.query;
    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }
    if (teamId && !mongoose.isValidObjectId(teamId)) {
      return res.status(400).json({ success: false, error: 'Invalid teamId' });
    }
    if (employeeId && !mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({ success: false, error: 'Invalid employeeId' });
    }

    const teams = await Team.find(teamId ? { _id: teamId } : {})
      .populate("leaderId", "profile.fullName");

    const teamIds = teams.map((team) => team._id);
    const taskFilter = statisticsService.buildTaskFilter({
      employeeId,
      startDate: parseDate(startDate),
      endDate: parseDate(endDate)
    });
    taskFilter.teamId = { $in: teamIds };
    const [taskRows, memberRows] = teamIds.length === 0 ? [[], []] : await Promise.all([
      Task.aggregate([
        { $match: taskFilter },
        { $group: { _id: { teamId: '$teamId', status: '$status' }, count: { $sum: 1 } } }
      ]),
      User.aggregate([
        { $match: { teamId: { $in: teamIds }, isActive: true } },
        { $group: { _id: '$teamId', count: { $sum: 1 } } }
      ])
    ]);
    const taskCounts = new Map();
    for (const row of taskRows) {
      const key = row._id.teamId.toString();
      const counts = taskCounts.get(key) || { total: 0, done: 0 };
      counts.total += row.count;
      if (row._id.status === TASK_STATUS.DONE) counts.done += row.count;
      taskCounts.set(key, counts);
    }
    const memberCounts = new Map(memberRows.map((row) => [row._id.toString(), row.count]));
    const performance = teams.map((team) => {
      const counts = taskCounts.get(team._id.toString()) || { total: 0, done: 0 };
      return {
        teamName: team.name,
        leader: team.leaderId?.profile?.fullName || "N/A",
        memberCount: memberCounts.get(team._id.toString()) || 0,
        totalTasks: counts.total,
        completedTasks: counts.done,
        completionRate: counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0,
      };
    });

    res.json({
      success: true,
      data: performance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getOverviewStats,
  getEmployeesByDepartment,
  getAttendanceStats,
  getLeaveStats,
  getTaskStats,
  getPerformanceTrends,
  getTeamPerformance,
};
