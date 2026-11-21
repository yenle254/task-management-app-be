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
 * Determine if a completed task was finished on time using statusHistory OR completedAt/updatedAt fallback
 * @param {Object} task
 * @returns {boolean|null} true = on time, false = late, null = no dueDate
 */
const isTaskCompletedOnTime = (task) => {
  if (!task || task.status !== TASK_STATUS.DONE) return null;

  const completions = (task.statusHistory || []).filter((e) => e.to === TASK_STATUS.DONE);
  const latestEvent = completions[completions.length - 1];
  const dueRaw = latestEvent?.dueDate || task.dueDate;
  if (!dueRaw) return null;

  const completedAtRaw = latestEvent?.at || task.completedAt || task.updatedAt;
  if (!completedAtRaw) return true;

  const dueEnd = new Date(dueRaw);
  dueEnd.setHours(23, 59, 59, 999);
  return new Date(completedAtRaw) <= dueEnd;
};

/**
 * Enrich a single team's member progress with experience-weighted suitability scoring
 */
const buildSingleTeamWorkload = ({
  team,
  memberProgress,
  tasksByMember,
  leavesByMember,
  callerUserId
}) => {
  const enrichedMembers = memberProgress.map((m) => {
    const key = String(m.userId);
    const memberLeaves = leavesByMember.get(key) || [];
    const rawMemberTasks = tasksByMember.get(key) || [];
    const doneTasks = rawMemberTasks.filter((t) => t.status === TASK_STATUS.DONE);
    const completedHardTasks = doneTasks.filter((t) => t.difficulty === 'hard').length;

    let effectiveOnTimeRate = m.onTimeRate || 0;
    if (m.onTimeEligibleTasks === 0 && doneTasks.length > 0) {
      const evaluated = doneTasks.map(isTaskCompletedOnTime).filter((v) => v !== null);
      if (evaluated.length > 0) {
        effectiveOnTimeRate = Math.round(
          (evaluated.filter(Boolean).length / evaluated.length) * 100
        );
      } else {
        effectiveOnTimeRate = 100;
      }
    }

    const hasApprovedLeaveNext2Days = memberLeaves.some(
      (l) => l.status === 'approved' && l.overlapsNext2Days
    );
    const hasPendingLeaveNext2Days = memberLeaves.some(
      (l) => l.status !== 'approved' && l.overlapsNext2Days
    );

    const activeLoad = m.inProgressTasks + m.todoTasks;
    const isCurrentUser = key === String(callerUserId);
    const isTeamLeader = team.leaderId && key === String(team.leaderId);
    const isUnproven = m.completedTasks === 0 || m.completionRate === 0;

    const performanceScore = isUnproven
      ? 0
      : 50 +
        (m.completionRate || 0) * 0.55 +
        effectiveOnTimeRate * 0.65 +
        Math.min(m.completedTasks, 10) * 3 +
        Math.min(completedHardTasks, 5) * 6;

    const workloadPenalty =
      m.overdueTasks * 38 +
      m.inProgressTasks * 12 +
      m.todoTasks * 4 +
      (hasPendingLeaveNext2Days ? 15 : 0);

    const suitabilityScore =
      (hasApprovedLeaveNext2Days ? -1000 : 0) -
      (isCurrentUser && memberProgress.length > 1 ? 250 : 0) +
      performanceScore -
      workloadPenalty;

    return {
      userId: key,
      userName: m.userName,
      teamId: String(team._id),
      teamName: team.name,
      isCurrentUser,
      isTeamLeader: Boolean(isTeamLeader),
      isUnproven,
      inProgressTasks: m.inProgressTasks,
      todoTasks: m.todoTasks,
      awaitingReviewTasks: m.awaitingReviewTasks,
      overdueTasks: m.overdueTasks,
      completedTasks: m.completedTasks,
      completedHardTasks,
      totalTasks: m.totalTasks,
      activeLoad,
      completionRate: m.completionRate,
      onTimeRate: effectiveOnTimeRate,
      hasApprovedLeaveNext2Days,
      hasPendingLeaveNext2Days,
      upcomingLeaves: memberLeaves,
      performanceScore: Math.round(performanceScore * 10) / 10,
      suitabilityScore: Math.round(suitabilityScore * 10) / 10
    };
  });

  const availableCandidates = enrichedMembers.filter(
    (m) =>
      !m.hasApprovedLeaveNext2Days &&
      (!m.isCurrentUser || enrichedMembers.length === 1)
  );

  const provenRecommendees = availableCandidates
    .filter((m) => !m.isUnproven)
    .sort((a, b) => {
      if (b.suitabilityScore !== a.suitabilityScore) {
        return b.suitabilityScore - a.suitabilityScore;
      }
      if (b.onTimeRate !== a.onTimeRate) return b.onTimeRate - a.onTimeRate;
      return b.completionRate - a.completionRate;
    });

  const unprovenAvailable = availableCandidates
    .filter((m) => m.isUnproven)
    .sort((a, b) => a.activeLoad - b.activeLoad);

  const prioritizedAssignees =
    provenRecommendees.length > 0
      ? [...provenRecommendees, ...unprovenAvailable]
      : unprovenAvailable;

  const sortedAllMembers = [...enrichedMembers].sort(
    (a, b) => b.suitabilityScore - a.suitabilityScore
  );

  // Aggregate team-level performance metrics for cross-team comparison
  const teamTotalTasks = enrichedMembers.reduce((s, m) => s + m.totalTasks, 0);
  const teamCompletedTasks = enrichedMembers.reduce((s, m) => s + m.completedTasks, 0);
  const teamOverdueTasks = enrichedMembers.reduce((s, m) => s + m.overdueTasks, 0);
  const teamActiveTasks = enrichedMembers.reduce((s, m) => s + m.activeLoad, 0);
  const provenMembersForAvg = enrichedMembers.filter((m) => !m.isUnproven);
  const teamAvgOnTimeRate =
    provenMembersForAvg.length > 0
      ? Math.round(
          provenMembersForAvg.reduce((s, m) => s + m.onTimeRate, 0) /
            provenMembersForAvg.length
        )
      : 0;
  const teamCompletionRate =
    teamTotalTasks > 0 ? Math.round((teamCompletedTasks / teamTotalTasks) * 100) : 0;

  return {
    teamId: String(team._id),
    teamName: team.name,
    totalMembers: enrichedMembers.length,
    teamMetrics: {
      totalTasks: teamTotalTasks,
      completedTasks: teamCompletedTasks,
      activeTasks: teamActiveTasks,
      overdueTasks: teamOverdueTasks,
      completionRate: teamCompletionRate,
      onTimeRate: teamAvgOnTimeRate
    },
    membersOnLeaveNext2Days: enrichedMembers
      .filter((m) => m.hasApprovedLeaveNext2Days)
      .map((m) => ({
        userId: m.userId,
        userName: m.userName,
        teamName: team.name,
        upcomingLeaves: m.upcomingLeaves
      })),
    provenRecommendees: provenRecommendees.slice(0, 3),
    unprovenAvailable: unprovenAvailable.slice(0, 3),
    recommendedAssignees: prioritizedAssignees.slice(0, 3),
    allMembersWorkload: sortedAllMembers
  };
};

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
    myCompletedTasksRaw,
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
      .select('title description status priority difficulty dueDate startDate progress estimatedMinutes actualMinutes storyPoints dependencies subTasks checklists tags updatedAt')
      .populate('dependencies', 'title status dueDate')
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(25)
      .lean(),
    Task.find({
      assignedTo: userId,
      status: TASK_STATUS.DONE
    })
      .select('title difficulty priority dueDate completedAt updatedAt status statusHistory actualMinutes estimatedMinutes')
      .sort({ completedAt: -1, updatedAt: -1 })
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
      const dueObj = task.dueDate ? new Date(task.dueDate) : null;
      const isOverdue = Boolean(dueObj && dueObj < now);
      const isDueWithin48h = Boolean(
        dueObj && dueObj >= now && dueObj <= next2Days
      );
      const subTasksList = task.subTasks || [];
      const subTasksTotal = subTasksList.length;
      const subTasksDone = subTasksList.filter((st) => st.isCompleted).length;
      const pendingSubTaskTitles = subTasksList
        .filter((st) => !st.isCompleted)
        .map((st) => st.title);

      return {
        _id: String(task._id),
        title: task.title,
        status: task.status,
        priority: task.priority || 'medium',
        difficulty: task.difficulty || 'medium',
        dueDate: formatDateISO(task.dueDate),
        isOverdue,
        isDueWithin48h,
        isBlocked: unfinishedDeps.length > 0,
        blockedByTitles: unfinishedDeps.map((d) => d.title),
        progress: task.progress ?? 0,
        estimatedMinutes: task.estimatedMinutes ?? null,
        actualMinutes: task.actualMinutes ?? 0,
        storyPoints: task.storyPoints ?? null,
        subTasksSummary: `${subTasksDone}/${subTasksTotal}`,
        pendingSubTaskTitles: pendingSubTaskTitles.slice(0, 5),
        tags: task.tags || []
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

  const myCompletedCount = myCompletedTasksRaw.length;
  const myTotalTasks = myOpenTasks.length + myCompletedCount;
  const myCompletionRate =
    myTotalTasks > 0 ? Math.round((myCompletedCount / myTotalTasks) * 100) : 0;
  const myOnTimeEvaluated = myCompletedTasksRaw
    .map(isTaskCompletedOnTime)
    .filter((v) => v !== null);
  const myOnTimeRate =
    myOnTimeEvaluated.length > 0
      ? Math.round(
          (myOnTimeEvaluated.filter(Boolean).length / myOnTimeEvaluated.length) * 100
        )
      : myCompletedCount > 0
        ? 100
        : 0;

  // Time tracking & estimation variance statistics
  const totalLoggedMinutes =
    myOpenTasks.reduce((s, t) => s + (t.actualMinutes || 0), 0) +
    myCompletedTasksRaw.reduce((s, t) => s + (t.actualMinutes || 0), 0);
  const totalEstimatedMinutes = myOpenTasks.reduce(
    (s, t) => s + (t.estimatedMinutes || 0),
    0
  );
  const overEstimateTasks = myOpenTasks.filter(
    (t) =>
      t.estimatedMinutes != null &&
      t.estimatedMinutes > 0 &&
      t.actualMinutes > t.estimatedMinutes
  );

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
      completedCount: myCompletedCount,
      completionRate: myCompletionRate,
      onTimeRate: myOnTimeRate,
      overdueCount: myOpenTasks.filter((t) => t.isOverdue).length,
      dueSoon48hCount: myOpenTasks.filter((t) => t.isDueWithin48h).length,
      blockedCount: myOpenTasks.filter((t) => t.isBlocked).length,
      inProgressCount: myOpenTasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS).length,
      todoCount: myOpenTasks.filter((t) => t.status === TASK_STATUS.TODO).length,
      inReviewCount: myOpenTasks.filter((t) => t.status === TASK_STATUS.IN_REVIEW).length,
      totalLoggedMinutes,
      totalEstimatedMinutes,
      overEstimateTasks: overEstimateTasks.map((t) => ({
        title: t.title,
        actualMinutes: t.actualMinutes,
        estimatedMinutes: t.estimatedMinutes
      })),
      topPriorityTasks: priorityRecommendation,
      openTasksList: myOpenTasks,
      recentCompletedTitles: myCompletedTasksRaw.slice(0, 5).map((t) => t.title)
    },
    pendingApprovals: null,
    teamWorkloadAdvisor: null
  };

  // RBAC: Team Lead & HR Manager Multi-Team Workload Engine + Approvals Inbox
  if ([USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER].includes(authUser.role)) {
    let managedTeams = [];
    if (authUser.role === USER_ROLES.TEAM_LEAD) {
      const teamQuery = authUser.teamId
        ? { $or: [{ leaderId: userId }, { _id: authUser.teamId }] }
        : { leaderId: userId };
      managedTeams = await Team.find(teamQuery).lean();
    } else if (authUser.role === USER_ROLES.HR_MANAGER) {
      managedTeams = await Team.find().limit(20).lean();
    }

    if (managedTeams.length > 0) {
      // Order primaryTeam first (leader's own team if applicable), followed by all other managed teams
      managedTeams.sort((a, b) => {
        const aIsLead = String(a.leaderId) === String(userId) ? -1 : 0;
        const bIsLead = String(b.leaderId) === String(userId) ? -1 : 0;
        return aIsLead - bIsLead;
      });

      const primaryTeam = managedTeams[0];
      const managedTeamIds = managedTeams.map((t) => t._id);

      // Query member progress for ALL managed teams in parallel!
      const [
        allTeamsMemberProgress,
        allTeamsTasksDetailed,
        pendingLeavesToApprove,
        tasksAwaitingReview
      ] = await Promise.all([
        Promise.all(managedTeams.map((team) => getTeamMemberProgress(team))),
        Task.find({
          teamId: { $in: managedTeamIds },
          status: { $ne: TASK_STATUS.DELETED }
        })
          .select('title teamId status difficulty priority dueDate completedAt updatedAt statusHistory assignedTo')
          .lean(),
        Leave.find(
          authUser.role === USER_ROLES.HR_MANAGER
            ? { status: { $in: ['pending_hr', 'pending_team_lead'] } }
            : {
                teamSnapshot: { $in: managedTeamIds },
                status: 'pending_team_lead'
              }
        )
          .populate('userId', 'profile.fullName email')
          .select('userId type startDate endDate numberOfDays status reason')
          .sort({ createdAt: -1 })
          .limit(12)
          .lean(),
        Task.find({
          teamId: { $in: managedTeamIds },
          status: TASK_STATUS.IN_REVIEW
        })
          .populate('assignedTo', 'profile.fullName email')
          .select('title teamId priority difficulty dueDate assignedTo review.submittedAt review.note')
          .sort({ updatedAt: -1 })
          .limit(12)
          .lean()
      ]);

      context.pendingApprovals = {
        pendingLeaveCount: pendingLeavesToApprove.length,
        pendingLeaves: pendingLeavesToApprove.map((lv) => ({
          _id: String(lv._id),
          employeeName: lv.userId?.profile?.fullName || lv.userId?.email || 'Nhân viên',
          type: lv.type,
          startDate: formatDateISO(lv.startDate),
          endDate: formatDateISO(lv.endDate),
          numberOfDays: lv.numberOfDays,
          status: lv.status,
          reason: lv.reason || ''
        })),
        tasksInReviewCount: tasksAwaitingReview.length,
        tasksInReview: tasksAwaitingReview.map((t) => ({
          _id: String(t._id),
          title: t.title,
          priority: t.priority || 'medium',
          dueDate: formatDateISO(t.dueDate),
          assignees: (t.assignedTo || []).map(
            (u) => u.profile?.fullName || u.email || 'Nhân viên'
          )
        }))
      };

      // Collect unique member IDs across ALL managed teams to fetch upcoming leaves in 1 query
      const uniqueMemberIdSet = new Set();
      for (const progList of allTeamsMemberProgress) {
        for (const m of progList) {
          uniqueMemberIdSet.add(String(m.userId));
        }
      }

      const upcomingTeamLeaves = await Leave.find({
        userId: { $in: [...uniqueMemberIdSet] },
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

      // Build per-team workload analysis for every managed team
      const teamsWorkload = managedTeams.map((team, idx) => {
        const teamIdStr = String(team._id);
        const teamTasks = allTeamsTasksDetailed.filter(
          (t) => String(t.teamId) === teamIdStr
        );
        const tasksByMember = new Map();
        for (const t of teamTasks) {
          for (const assigneeId of t.assignedTo || []) {
            const key = String(assigneeId);
            if (!tasksByMember.has(key)) tasksByMember.set(key, []);
            tasksByMember.get(key).push(t);
          }
        }

        return buildSingleTeamWorkload({
          team,
          memberProgress: allTeamsMemberProgress[idx] || [],
          tasksByMember,
          leavesByMember,
          callerUserId: userId
        });
      });

      const primaryTeamWorkload = teamsWorkload[0];

      // Aggregate cross-team top proven performers across all managed teams
      const crossTeamProvenMap = new Map();
      const crossTeamAllMembersMap = new Map();
      const crossTeamLeavesMap = new Map();

      for (const tw of teamsWorkload) {
        for (const m of tw.allMembersWorkload) {
          if (!crossTeamAllMembersMap.has(m.userId)) {
            crossTeamAllMembersMap.set(m.userId, m);
          }
        }
        for (const m of tw.provenRecommendees) {
          const existing = crossTeamProvenMap.get(m.userId);
          if (!existing || m.suitabilityScore > existing.suitabilityScore) {
            crossTeamProvenMap.set(m.userId, m);
          }
        }
        for (const lvMember of tw.membersOnLeaveNext2Days) {
          if (!crossTeamLeavesMap.has(lvMember.userId)) {
            crossTeamLeavesMap.set(lvMember.userId, lvMember);
          }
        }
      }

      const crossTeamProvenRecommendees = [...crossTeamProvenMap.values()].sort(
        (a, b) => b.suitabilityScore - a.suitabilityScore
      );

      context.teamWorkloadAdvisor = {
        teamId: primaryTeamWorkload.teamId,
        teamName: primaryTeamWorkload.teamName,
        managedTeamsCount: teamsWorkload.length,
        managedTeamNames: teamsWorkload.map((t) => t.teamName),
        totalMembers: crossTeamAllMembersMap.size,
        // Multi-team array containing full breakdown per team!
        teamsWorkload,
        crossTeamProvenRecommendees: crossTeamProvenRecommendees.slice(0, 5),
        // Backward-compatible fields on root object
        membersOnLeaveNext2Days: [...crossTeamLeavesMap.values()],
        provenRecommendees: primaryTeamWorkload.provenRecommendees,
        unprovenAvailable: primaryTeamWorkload.unprovenAvailable,
        recommendedAssignees:
          crossTeamProvenRecommendees.length > 0
            ? crossTeamProvenRecommendees.slice(0, 3)
            : primaryTeamWorkload.recommendedAssignees,
        allMembersWorkload: [...crossTeamAllMembersMap.values()].sort(
          (a, b) => b.suitabilityScore - a.suitabilityScore
        )
      };
    }
  }

  return context;
};

/**
 * Build a multi-domain compact digest (~450-650 tokens) covering all 7 domains & ALL managed teams
 * so Ollama qwen2.5:3b / Gemini can answer compound, multi-team, and specific entity questions accurately.
 *
 * @param {Object} context
 * @returns {string}
 */
const buildCompactContextDigest = (context) => {
  const u = context.user;
  const pt = context.personalTasks;
  const lv = context.personalLeaves;
  const att = context.personalAttendance;
  const off = context.officePolicy;
  const app = context.pendingApprovals;
  const adv = context.teamWorkloadAdvisor;

  const lines = [];
  lines.push(
    `[1. NGƯỜI DÙNG] ${u.fullName} | Role: ${u.role} | Team: ${u.teamName || 'N/A'} | Hôm nay: ${context.todayDate} (Ngày mai: ${context.tomorrowDate})`
  );

  lines.push(
    `[2. TASK CÁ NHÂN] Đang mở: ${pt.totalOpen} (Đang làm: ${pt.inProgressCount}, Chờ làm: ${pt.todoCount}, Chờ duyệt: ${pt.inReviewCount}, Quá hạn: ${pt.overdueCount}, Sắp đến hạn 48h: ${pt.dueSoon48hCount || 0}, Bị chặn: ${pt.blockedCount}) | Đã hoàn thành: ${pt.completedCount} task (Hoàn thành: ${pt.completionRate}%, Đúng hạn: ${pt.onTimeRate}%) | Tổng giờ đã log: ${pt.totalLoggedMinutes || 0} phút`
  );

  for (const t of pt.openTasksList.slice(0, 7)) {
    const subNote =
      t.pendingSubTaskTitles && t.pendingSubTaskTitles.length > 0
        ? ` | Subtasks chưa xong: ${t.pendingSubTaskTitles.slice(0, 3).join('; ')}`
        : '';
    const blockNote = t.isBlocked ? ` | BỊ CHẶN BỞI: ${t.blockedByTitles.join(', ')}` : '';
    lines.push(
      `  - Task "${t.title}" (ID:${t._id}) [${t.priority.toUpperCase()}/${t.difficulty}] Status:${t.status}, Tiến độ:${t.progress}%, Hạn:${t.dueDate || 'N/A'}${t.isOverdue ? '(QUÁ HẠN)' : ''}, Giờ làm:${t.actualMinutes}/${t.estimatedMinutes || '?'}p, Subtasks:${t.subTasksSummary}${subNote}${blockNote}`
    );
  }

  lines.push(
    `[3. NGHỈ PHÉP NĂM ${lv.year}] Tổng: ${lv.balance.total}, Đã dùng: ${lv.balance.used}, Còn lại: ${lv.balance.remaining} ngày | Đơn chờ duyệt: ${lv.pendingCount}`
  );

  const s = att.monthStats;
  lines.push(
    `[4. CHẤM CÔNG THÁNG ${att.monthLabel}] Có mặt: ${s.presentDays + s.lateDays}/${s.totalDays} ngày (Đúng giờ: ${s.presentDays}, Đi muộn: ${s.lateDays}, Vắng: ${s.absentDays}) | Tổng giờ: ${s.totalWorkHours}h | Ngày đi muộn: ${
      att.lateDatesThisMonth.map((d) => `${d.date}(${d.clockInTime})`).join(', ') || 'Không có'
    }`
  );

  if (off) {
    lines.push(
      `[5. QUY ĐỊNH GPS VĂN PHÒNG] ${off.name} | Địa chỉ: ${off.address} | Bán kính: ${off.radiusMeters}m | Giờ chuẩn: ${off.workingHours.start}-${off.workingHours.end}`
    );
  }

  if (app) {
    lines.push(
      `[6. HỘP THƯ QUẢN LÝ CHỜ DUYỆT] Đơn nghỉ phép chờ duyệt: ${app.pendingLeaveCount} | Task chờ nghiệm thu (in_review): ${app.tasksInReviewCount}`
    );
  }

  if (adv) {
    const teamsList = Array.isArray(adv.teamsWorkload) && adv.teamsWorkload.length > 0
      ? adv.teamsWorkload
      : [adv];

    lines.push(
      `[7. ĐIỀU PHỐI & HIỆU SUẤT ĐA TEAM (${teamsList.length} Team đang quản lý)]`
    );
    for (const tw of teamsList) {
      const topProven = (tw.provenRecommendees || [])[0];
      lines.push(
        `  * TEAM "${tw.teamName}" (${tw.totalMembers} thành viên | Hoàn thành: ${tw.teamMetrics?.completionRate ?? 0}%, Đúng hạn: ${tw.teamMetrics?.onTimeRate ?? 0}%, Quá hạn: ${tw.teamMetrics?.overdueTasks ?? 0}) -> Đề xuất số 1: ${
          topProven
            ? `${topProven.userName} (Hoàn thành ${topProven.completionRate}%, Đúng hạn ${topProven.onTimeRate}%, Đang làm ${topProven.inProgressTasks})`
            : 'Chưa có ứng viên hiệu suất cao'
        }`
      );
      for (const m of (tw.allMembersWorkload || []).slice(0, 5)) {
        lines.push(
          `    - ${m.userName} [${tw.teamName}]: Hoàn thành ${m.completedTasks}/${m.totalTasks} (${m.completionRate}%), Đúng hạn: ${m.onTimeRate}% | Đang làm: ${m.inProgressTasks}, Todo: ${m.todoTasks}, Quá hạn: ${m.overdueTasks}${
            m.hasApprovedLeaveNext2Days ? ' [ĐANG NGHỈ PHÉP]' : m.isUnproven ? ' [CHƯA CÓ LỊCH SỬ 0%]' : ' [HIỆU SUẤT CAO]'
          }`
        );
      }
    }
  }

  return lines.join('\n');
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
  buildCompactContextDigest,
  buildTaskSummaryContext,
  buildSingleTeamWorkload,
  isTaskCompletedOnTime,
  formatDateISO
};
