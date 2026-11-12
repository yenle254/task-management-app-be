const mongoose = require('mongoose');
const Task = require('../../models/task.model');
const User = require('../../models/user.model');
const Team = require('../../models/team.model');
const Leave = require('../../models/leave.model');
const Attendance = require('../../models/attendance.model');
const Office = require('../../models/office.model');
const { getLeaveBalance } = require('../../services/employee-dashboard.service');
const { getTodayAttendance, getAttendanceStats } = require('../../services/attendance.service');
const { getTeamMemberProgress } = require('../../services/team-dashboard.service');
const { canUserAccessTask } = require('../../services/task.service');
const { TASK_STATUS, USER_ROLES } = require('../../utils/constants.utils');
const { formatDateISO } = require('../utils/vietnamese-nlp.utils');

const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const OPEN_STATUSES = [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS, TASK_STATUS.IN_REVIEW];

/**
 * Build RBAC-safe real-time context from MongoDB for the authenticated user
 * @param {Object} authUser - req.user from protect middleware
 * @returns {Promise<Object>}
 */
const buildUserCopilotContext = async (authUser) => {
  const userId = authUser._id;
  const now = new Date();
  const currentYear = now.getFullYear();
  const startOfMonth = new Date(currentYear, now.getMonth(), 1, 0, 0, 0, 0);
  const endOfMonth = new Date(currentYear, now.getMonth() + 1, 0, 23, 59, 59, 999);
  const next14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const next2Days = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const [
    fullUser,
    myOpenTasksRaw,
    myLeavesRaw,
    todayAttendance,
    monthAttendanceStats,
    monthLateRecords,
    activeOffice
  ] = await Promise.all([
    User.findById(userId)
      .select('email role profile teamId leaveBalance')
      .populate('teamId', 'name leaderId')
      .lean(),
    Task.find({
      assignedTo: userId,
      status: { $in: OPEN_STATUSES }
    })
      .select('title status priority difficulty dueDate startDate progress estimatedMinutes actualMinutes storyPoints dependencies subTasks checklists updatedAt')
      .populate('dependencies', 'title status dueDate')
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(25)
      .lean(),
    Leave.find({
      userId,
      status: { $in: ['pending_team_lead', 'pending_hr', 'approved', 'rejected'] },
      startDate: { $gte: new Date(currentYear, 0, 1) }
    })
      .select('type startDate endDate numberOfDays reason status currentStep createdAt')
      .sort({ startDate: -1 })
      .limit(15)
      .lean(),
    getTodayAttendance(userId),
    getAttendanceStats(userId, startOfMonth, now),
    Attendance.find({
      userId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: 'late'
    })
      .select('date clockIn workHours status')
      .sort({ date: -1 })
      .lean(),
    Office.findOne({ isActive: true })
      .select('name address location radius workingHours')
      .lean()
  ]);

  const leaveBalance = getLeaveBalance(fullUser || authUser, currentYear);
  const pendingLeaves = myLeavesRaw.filter((l) =>
    ['pending_team_lead', 'pending_hr'].includes(l.status)
  );
  const approvedLeaves = myLeavesRaw.filter((l) => l.status === 'approved');

  const myOpenTasks = myOpenTasksRaw
    .map((task) => {
      const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
      const unfinishedDeps = deps.filter((d) => d && d.status && d.status !== TASK_STATUS.DONE);
      const isOverdue = Boolean(task.dueDate && new Date(task.dueDate) < now);
      const subTasksTotal = (task.subTasks || []).length;
      const subTasksDone = (task.subTasks || []).filter((st) => st.isCompleted).length;

      return {
        _id: String(task._id),
        title: task.title,
        status: task.status,
        priority: task.priority || 'medium',
        difficulty: task.difficulty || 'medium',
        dueDate: formatDateISO(task.dueDate),
        isOverdue,
        isBlocked: unfinishedDeps.length > 0,
        blockedByTitles: unfinishedDeps.map((d) => d.title),
        progress: task.progress ?? 0,
        estimatedMinutes: task.estimatedMinutes ?? null,
        actualMinutes: task.actualMinutes ?? 0,
        storyPoints: task.storyPoints ?? null,
        subTasksSummary: `${subTasksDone}/${subTasksTotal}`
      };
    })
    .sort((a, b) => {
      if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1;
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      const pDiff = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
      if (pDiff !== 0) return pDiff;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });

  const priorityRecommendation = myOpenTasks.filter((t) => !t.isBlocked).slice(0, 3);

  const context = {
    currentTimeISO: now.toISOString(),
    todayDate: formatDateISO(now),
    tomorrowDate: formatDateISO(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    user: {
      _id: String(userId),
      fullName: fullUser?.profile?.fullName || authUser.profile?.fullName || authUser.email,
      email: fullUser?.email || authUser.email,
      role: fullUser?.role || authUser.role,
      department: fullUser?.profile?.department || null,
      position: fullUser?.profile?.position || null,
      employeeId: fullUser?.profile?.employeeId || null,
      teamName: fullUser?.teamId?.name || null,
      teamId: fullUser?.teamId?._id ? String(fullUser.teamId._id) : null
    },
    personalLeaves: {
      year: currentYear,
      balance: leaveBalance,
      pendingCount: pendingLeaves.length,
      pendingRequests: pendingLeaves.map((l) => ({
        _id: String(l._id),
        type: l.type,
        startDate: formatDateISO(l.startDate),
        endDate: formatDateISO(l.endDate),
        numberOfDays: l.numberOfDays,
        status: l.status,
        reason: l.reason || ''
      })),
      approvedCount: approvedLeaves.length,
      recentApproved: approvedLeaves.slice(0, 5).map((l) => ({
        type: l.type,
        startDate: formatDateISO(l.startDate),
        endDate: formatDateISO(l.endDate),
        numberOfDays: l.numberOfDays
      }))
    },
    personalAttendance: {
      monthLabel: `${now.getMonth() + 1}/${currentYear}`,
      today: todayAttendance
        ? {
            clockIn: todayAttendance.clockIn,
            clockOut: todayAttendance.clockOut || null,
            status: todayAttendance.status,
            workHours: todayAttendance.workHours ?? null
          }
        : null,
      monthStats: monthAttendanceStats,
      lateDatesThisMonth: monthLateRecords.map((r) => ({
        date: formatDateISO(r.date),
        clockInTime: r.clockIn ? new Date(r.clockIn).toTimeString().slice(0, 5) : null,
        workHours: r.workHours ?? null
      }))
    },
    officePolicy: activeOffice
      ? {
          name: activeOffice.name,
          address: activeOffice.address || 'Chưa cập nhật địa chỉ chi tiết',
          radiusMeters: activeOffice.radius,
          workingHours: activeOffice.workingHours || { start: '09:00', end: '18:00' },
          coordinates: activeOffice.location
        }
      : null,
    personalTasks: {
      totalOpen: myOpenTasks.length,
      overdueCount: myOpenTasks.filter((t) => t.isOverdue).length,
      blockedCount: myOpenTasks.filter((t) => t.isBlocked).length,
      inProgressCount: myOpenTasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS).length,
      todoCount: myOpenTasks.filter((t) => t.status === TASK_STATUS.TODO).length,
      inReviewCount: myOpenTasks.filter((t) => t.status === TASK_STATUS.IN_REVIEW).length,
      topPriorityTasks: priorityRecommendation,
      openTasksList: myOpenTasks
    },
    teamWorkloadAdvisor: null
  };

  if ([USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER].includes(authUser.role)) {
    let managedTeams = [];
    if (authUser.role === USER_ROLES.TEAM_LEAD) {
      const teamQuery = authUser.teamId
        ? { $or: [{ leaderId: userId }, { _id: authUser.teamId }] }
        : { leaderId: userId };
      managedTeams = await Team.find(teamQuery).lean();
    } else if (authUser.role === USER_ROLES.HR_MANAGER) {
      managedTeams = await Team.find().limit(10).lean();
    }

    if (managedTeams.length > 0) {
      const primaryTeam =
        managedTeams.find((t) => String(t.leaderId) === String(userId)) || managedTeams[0];

      const memberProgress = await getTeamMemberProgress(primaryTeam);
      const memberIds = memberProgress.map((m) => m.userId);

      const upcomingTeamLeaves = await Leave.find({
        userId: { $in: memberIds },
        status: { $in: ['approved', 'pending_team_lead', 'pending_hr'] },
        endDate: { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
        startDate: { $lte: next14Days }
      })
        .select('userId type startDate endDate numberOfDays status')
        .lean();

      const leavesByMember = new Map();
      for (const lv of upcomingTeamLeaves) {
        const key = String(lv.userId);
        if (!leavesByMember.has(key)) leavesByMember.set(key, []);
        leavesByMember.get(key).push({
          type: lv.type,
          status: lv.status,
          startDate: formatDateISO(lv.startDate),
          endDate: formatDateISO(lv.endDate),
          numberOfDays: lv.numberOfDays,
          overlapsNext2Days:
            new Date(lv.startDate) <= next2Days &&
            new Date(lv.endDate) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
        });
      }

      const enrichedMembers = memberProgress.map((m) => {
        const key = String(m.userId);
        const memberLeaves = leavesByMember.get(key) || [];
        const hasApprovedLeaveNext2Days = memberLeaves.some(
          (l) => l.status === 'approved' && l.overlapsNext2Days
        );
        const hasPendingLeaveNext2Days = memberLeaves.some(
          (l) => l.status !== 'approved' && l.overlapsNext2Days
        );
        const activeLoad = m.inProgressTasks + m.todoTasks;
        const suitabilityScore =
          (hasApprovedLeaveNext2Days ? -1000 : 0) -
          m.overdueTasks * 30 -
          m.inProgressTasks * 15 -
          m.todoTasks * 8 +
          (m.onTimeRate || 0) * 0.4 +
          (m.completionRate || 0) * 0.2;

        return {
          userId: String(m.userId),
          userName: m.userName,
          inProgressTasks: m.inProgressTasks,
          todoTasks: m.todoTasks,
          awaitingReviewTasks: m.awaitingReviewTasks,
          overdueTasks: m.overdueTasks,
          completedTasks: m.completedTasks,
          totalTasks: m.totalTasks,
          activeLoad,
          completionRate: m.completionRate,
          onTimeRate: m.onTimeRate,
          hasApprovedLeaveNext2Days,
          hasPendingLeaveNext2Days,
          upcomingLeaves: memberLeaves,
          suitabilityScore: Math.round(suitabilityScore * 10) / 10
        };
      });

      const sortedRecommendations = [...enrichedMembers].sort(
        (a, b) => b.suitabilityScore - a.suitabilityScore
      );

      context.teamWorkloadAdvisor = {
        teamId: String(primaryTeam._id),
        teamName: primaryTeam.name,
        totalMembers: enrichedMembers.length,
        membersOnLeaveNext2Days: enrichedMembers
          .filter((m) => m.hasApprovedLeaveNext2Days)
          .map((m) => ({
            userId: m.userId,
            userName: m.userName,
            upcomingLeaves: m.upcomingLeaves
          })),
        recommendedAssignees: sortedRecommendations
          .filter((m) => !m.hasApprovedLeaveNext2Days)
          .slice(0, 3),
        allMembersWorkload: sortedRecommendations
      };
    }
  }

  return context;
};

/**
 * Build detailed context for summarizing a specific Task (with RBAC check)
 * @param {Object} authUser - req.user
 * @param {string} taskId
 * @returns {Promise<{ok: boolean, status?: number, error?: string, taskContext?: Object}>}
 */
const buildTaskSummaryContext = async (authUser, taskId) => {
  if (!mongoose.isValidObjectId(taskId)) {
    return { ok: false, status: 400, error: 'Invalid taskId' };
  }

  const task = await Task.findById(taskId)
    .populate('assignedTo', 'profile.fullName email role')
    .populate('assignedBy', 'profile.fullName email role')
    .populate('teamId', 'name leaderId')
    .populate('dependencies', 'title status priority dueDate assignedTo')
    .populate('comments.userId', 'profile.fullName email role')
    .populate('statusHistory.by', 'profile.fullName email')
    .populate('review.rounds.by', 'profile.fullName email')
    .lean();

  if (!task || task.status === TASK_STATUS.DELETED) {
    return { ok: false, status: 404, error: 'Task not found' };
  }

  if (!canUserAccessTask(authUser, task)) {
    return { ok: false, status: 403, error: 'Not authorized to access this task' };
  }

  const now = new Date();
  const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
  const blockingDependencies = dependencies
    .filter((d) => d && d.status && d.status !== TASK_STATUS.DONE)
    .map((d) => ({
      _id: String(d._id),
      title: d.title,
      status: d.status,
      dueDate: formatDateISO(d.dueDate)
    }));

  const subTasks = (task.subTasks || []).map((st) => ({
    title: st.title,
    isCompleted: Boolean(st.isCompleted)
  }));

  const checklists = (task.checklists || []).map((cl) => ({
    title: cl.title,
    completedCount: (cl.items || []).filter((i) => i.isCompleted).length,
    totalCount: (cl.items || []).length,
    pendingItems: (cl.items || [])
      .filter((i) => !i.isCompleted)
      .map((i) => i.text)
  }));

  const recentStatusHistory = (task.statusHistory || []).slice(-8).map((h) => ({
    from: h.from,
    to: h.to,
    at: h.at ? new Date(h.at).toISOString() : null,
    by: h.by?.profile?.fullName || h.by?.email || 'System'
  }));

  const recentReviewRounds = (task.review?.rounds || []).slice(-5).map((r) => ({
    round: r.round,
    type: r.type,
    by: r.by?.profile?.fullName || r.by?.email || 'Reviewer',
    at: r.at ? new Date(r.at).toISOString() : null,
    note: r.note || '',
    reason: r.reason || ''
  }));

  const recentComments = (task.comments || []).slice(-8).map((c) => ({
    author: c.userId?.profile?.fullName || c.userId?.email || 'User',
    text: c.text,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null
  }));

  return {
    ok: true,
    taskContext: {
      _id: String(task._id),
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority || 'medium',
      difficulty: task.difficulty || 'medium',
      progress: task.progress ?? 0,
      startDate: formatDateISO(task.startDate),
      dueDate: formatDateISO(task.dueDate),
      isOverdue: Boolean(
        task.dueDate &&
          new Date(task.dueDate) < now &&
          task.status !== TASK_STATUS.DONE
      ),
      estimatedMinutes: task.estimatedMinutes ?? null,
      actualMinutes: task.actualMinutes ?? 0,
      storyPoints: task.storyPoints ?? null,
      teamName: task.teamId?.name || null,
      assignees: (task.assignedTo || []).map(
        (u) => u.profile?.fullName || u.email || 'Assignee'
      ),
      assignedBy: task.assignedBy?.profile?.fullName || task.assignedBy?.email || 'Manager',
      subTasks: {
        total: subTasks.length,
        completed: subTasks.filter((s) => s.isCompleted).length,
        pendingTitles: subTasks.filter((s) => !s.isCompleted).map((s) => s.title)
      },
      checklists,
      blockingDependencies,
      recentStatusHistory,
      recentReviewRounds,
      recentComments
    }
  };
};

module.exports = {
  buildUserCopilotContext,
  buildTaskSummaryContext,
  formatDateISO
};

