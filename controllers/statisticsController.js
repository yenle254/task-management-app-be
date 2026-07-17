const User = require("../models/User");
const Task = require("../models/Task");
const Attendance = require("../models/Attendance");
const Leave = require("../models/Leave");
const Team = require("../models/Team");

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
    const stats = await User.aggregate([
      { $match: { isActive: true } },
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

// Attendance statistics by month
const getAttendanceStats = async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentDate = new Date();
    const targetMonth = parseInt(month) || currentDate.getMonth() + 1;
    const targetYear = parseInt(year) || currentDate.getFullYear();

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const stats = await Attendance.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const dailyStats = await Attendance.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { $dayOfMonth: "$date" },
          present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      data: { summary: stats, daily: dailyStats },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Leave statistics
const getLeaveStats = async (req, res) => {
  try {
    const { year } = req.query;
    const currentYear = parseInt(year) || new Date().getFullYear();
    const startOfYear = new Date(`${currentYear}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${currentYear}-12-31T23:59:59.999Z`);

    const [byType, byStatus, byMonth] = await Promise.all([
      Leave.aggregate([
        { $match: { createdAt: { $gte: startOfYear, $lte: endOfYear } } },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            totalDays: { $sum: "$numberOfDays" },
          },
        },
      ]),
      Leave.aggregate([
        { $match: { createdAt: { $gte: startOfYear, $lte: endOfYear } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Leave.aggregate([
        { $match: { createdAt: { $gte: startOfYear, $lte: endOfYear } } },
        {
          $group: {
            _id: { $month: "$startDate" },
            count: { $sum: 1 },
            totalDays: { $sum: "$numberOfDays" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      success: true,
      data: { byType, byStatus, byMonth },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Task statistics
const getTaskStats = async (req, res) => {
  try {
    const [byStatus, byPriority, byTeam] = await Promise.all([
      Task.aggregate([
        { $match: { status: { $ne: "deleted" } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Task.aggregate([
        { $match: { status: { $ne: "deleted" } } },
        { $group: { _id: "$priority", count: { $sum: 1 } } },
      ]),
      Task.aggregate([
        { $match: { status: { $ne: "deleted" } } },
        {
          $lookup: {
            from: "teams",
            localField: "teamId",
            foreignField: "_id",
            as: "team",
          },
        },
        { $unwind: { path: "$team", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$team.name",
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      data: { byStatus, byPriority, byTeam },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Team performance statistics
const getTeamPerformance = async (req, res) => {
  try {
    const teams = await Team.find().populate("leaderId", "profile.fullName");

    const performance = await Promise.all(
      teams.map(async (team) => {
        const [totalTasks, completedTasks, memberCount] = await Promise.all([
          Task.countDocuments({ teamId: team._id, status: { $ne: "deleted" } }),
          Task.countDocuments({ teamId: team._id, status: "done" }),
          User.countDocuments({ teamId: team._id, isActive: true }),
        ]);

        return {
          teamName: team.name,
          leader: team.leaderId?.profile?.fullName || "N/A",
          memberCount,
          totalTasks,
          completedTasks,
          completionRate:
            totalTasks > 0
              ? Math.round((completedTasks / totalTasks) * 100)
              : 0,
        };
      })
    );

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
  getTeamPerformance,
};
