const mongoose = require('mongoose');
const Task = require('../models/task.model');
const User = require('../models/user.model');
const Team = require('../models/team.model');
const { TASK_STATUS, USER_ROLES } = require('../utils/constants.utils');
const { percentage, OPEN_STATUSES } = require('../utils/dashboard.helper');

/**
 * Team dashboard service.
 *
 * Every entry point resolves the team from the database and verifies that the
 * caller is allowed to read it. A teamId supplied by the client is never
 * trusted on its own.
 */

/**
 * Resolve a team and verify the caller may read its statistics.
 *
 * Rules:
 *  - HR Manager may read any team.
 *  - Team Lead may only read the team they actually lead (Team.leaderId).
 *  - A user with role team_lead who is not the leader of that team is denied,
 *    even if they belong to it.
 *
 * @param {Object} user - Authenticated user document
 * @param {string} teamId - Requested team ID
 * @returns {Promise<{ok: boolean, team?: Object, status?: number, error?: string}>}
 */
const resolveAccessibleTeam = async (user, teamId) => {
  if (!mongoose.isValidObjectId(teamId)) {
    return { ok: false, status: 400, error: 'Invalid teamId' };
  }

  const team = await Team.findById(teamId);
  if (!team) {
    return { ok: false, status: 404, error: 'Team not found' };
  }

  if (user.role === USER_ROLES.HR_MANAGER) {
    return { ok: true, team };
  }

  if (user.role === USER_ROLES.TEAM_LEAD) {
    if (
      team.leaderId &&
      team.leaderId.toString() === user._id.toString()
    ) {
      return { ok: true, team };
    }
    return {
      ok: false,
      status: 403,
      error: 'You are not the leader of this team'
    };
  }

  return {
    ok: false,
    status: 403,
    error: 'Not authorized to view team statistics'
  };
};

/**
 * Resolve a team and verify the caller may read its TASKS.
 *
 * Same rules as {@link resolveAccessibleTeam}, with one addition: a plain
 * employee who is a member of the team may also read the task list of their
 * own team. A team lead may still only read the team they lead, and a user
 * with role team_lead who does not lead the team is denied.
 *
 * @param {Object} user - Authenticated user document
 * @param {string} teamId - Requested team ID
 * @returns {Promise<{ok: boolean, team?: Object, status?: number, error?: string}>}
 */
const resolveReadableTeam = async (user, teamId) => {
  if (!mongoose.isValidObjectId(teamId)) {
    return { ok: false, status: 400, error: 'Invalid teamId' };
  }

  const team = await Team.findById(teamId);
  if (!team) {
    return { ok: false, status: 404, error: 'Team not found' };
  }

  if (user.role === USER_ROLES.HR_MANAGER) {
    return { ok: true, team };
  }

  const userId = user._id.toString();

  if (user.role === USER_ROLES.TEAM_LEAD) {
    if (team.leaderId && team.leaderId.toString() === userId) {
      return { ok: true, team };
    }
    return {
      ok: false,
      status: 403,
      error: 'You are not the leader of this team'
    };
  }

  // Employees may only read the task list of a team they belong to.
  const isMember =
    (team.memberIds || []).some((id) => id.toString() === userId) ||
    (user.teamId && user.teamId.toString() === team._id.toString());

  if (isMember) {
    return { ok: true, team };
  }

  return {
    ok: false,
    status: 403,
    error: 'Not authorized to view tasks of this team'
  };
};

/**
 * Collect the unique set of users belonging to a team (leader + members).
 *
 * @param {Object} team - Team document
 * @returns {Promise<Array<{userId, userName}>>}
 */
const getTeamPeople = async (team) => {
  const ids = [];
  if (team.leaderId) ids.push(team.leaderId);
  for (const m of team.memberIds || []) ids.push(m);

  const unique = [...new Map(ids.map((i) => [i.toString(), i])).values()];
  if (unique.length === 0) return [];

  const users = await User.find({ _id: { $in: unique } })
    .select('profile.fullName')
    .lean();

  return users.map((u) => ({
    userId: u._id,
    userName: u.profile?.fullName || 'Unknown'
  }));
};

/**
 * Per-member task progress for a team.
 *
 * completionRate = completedTasks / totalTasks * 100
 * onTimeRate     = onTimeTasks / completedTasksWithBothDates * 100
 *
 * The on-time denominator only includes completed tasks that have BOTH a
 * dueDate and a completedAt. Legacy tasks without a completion timestamp are
 * excluded from numerator and denominator, so they are never counted as
 * on-time and never inflate the rate.
 *
 * @param {Object} team - Team document
 * @param {Date} [startDate]
 * @param {Date} [endDate]
 * @returns {Promise<Array<Object>>}
 */
const getTeamMemberProgress = async (team, startDate, endDate) => {
  const people = await getTeamPeople(team);
  if (people.length === 0) return [];

  const taskQuery = {
    teamId: team._id,
    status: { $ne: TASK_STATUS.DELETED }
  };

  // The date range scopes the tasks considered for this report.
  if (startDate || endDate) {
    taskQuery.createdAt = {};
    if (startDate) taskQuery.createdAt.$gte = startDate;
    if (endDate) taskQuery.createdAt.$lte = endDate;
  }

  const tasks = await Task.find(taskQuery)
    .select('status dueDate completedAt createdAt assignedTo')
    .lean();

  // Bucket tasks by assignee (a task may have several assignees).
  const byAssignee = new Map();
  for (const task of tasks) {
    for (const assignee of task.assignedTo || []) {
      const key = assignee.toString();
      if (!byAssignee.has(key)) byAssignee.set(key, []);
      byAssignee.get(key).push(task);
    }
  }

  const now = new Date();

  return people.map((person) => {
    const key = person.userId.toString();
    const memberTasks = byAssignee.get(key) || [];

    const totalTasks = memberTasks.length;
    const completedTasks = memberTasks.filter(
      (t) => t.status === TASK_STATUS.DONE
    ).length;
    const inProgressTasks = memberTasks.filter(
      (t) => t.status === TASK_STATUS.IN_PROGRESS
    ).length;
    const todoTasks = memberTasks.filter(
      (t) => t.status === TASK_STATUS.TODO
    ).length;
    const overdueTasks = memberTasks.filter(
      (t) =>
        OPEN_STATUSES.includes(t.status) &&
        t.dueDate &&
        new Date(t.dueDate) < now
    ).length;

    const completedWithDates = memberTasks.filter(
      (t) =>
        t.status === TASK_STATUS.DONE &&
        t.completedAt &&
        t.dueDate
    );
    const onTimeTasks = completedWithDates.filter(
      (t) => new Date(t.completedAt) <= new Date(t.dueDate)
    ).length;

    return {
      userId: person.userId,
      userName: person.userName,
      totalTasks,
      completedTasks,
      inProgressTasks,
      todoTasks,
      overdueTasks,
      completionRate: percentage(completedTasks, totalTasks),
      onTimeRate: percentage(onTimeTasks, completedWithDates.length)
    };
  });
};

/**
 * Aggregated performance summary for a team.
 *
 * @param {Object} team - Team document
 * @returns {Promise<Object>}
 */
const getTeamPerformance = async (team) => {
  const tasks = await Task.find({
    teamId: team._id,
    status: { $ne: TASK_STATUS.DELETED }
  })
    .select('status priority dueDate completedAt assignedTo')
    .lean();

  const now = new Date();
  const totalTasks = tasks.length;

  const byStatus = {
    todo: 0,
    in_progress: 0,
    done: 0
  };
  for (const t of tasks) {
    if (byStatus[t.status] !== undefined) byStatus[t.status] += 1;
  }

  const overdueCount = tasks.filter(
    (t) =>
      OPEN_STATUSES.includes(t.status) &&
      t.dueDate &&
      new Date(t.dueDate) < now
  ).length;

  const people = await getTeamPeople(team);
  const workloadByMember = people
    .map((person) => {
      const key = person.userId.toString();
      const memberTasks = tasks.filter((t) =>
        (t.assignedTo || []).some((a) => a.toString() === key)
      );
      return {
        userId: person.userId,
        userName: person.userName,
        // Outstanding work only — finished tasks are not backlog.
        openTasks: memberTasks.filter((t) =>
          OPEN_STATUSES.includes(t.status)
        ).length,
        completedTasks: memberTasks.filter(
          (t) => t.status === TASK_STATUS.DONE
        ).length,
        totalTasks: memberTasks.length
      };
    })
    .sort((a, b) => b.openTasks - a.openTasks);

  const completedWithDates = tasks.filter(
    (t) =>
      t.status === TASK_STATUS.DONE && t.completedAt && t.dueDate
  );
  const onTimeTasks = completedWithDates.filter(
    (t) => new Date(t.completedAt) <= new Date(t.dueDate)
  ).length;

  return {
    taskCounts: {
      total: totalTasks,
      todo: byStatus.todo,
      inProgress: byStatus.in_progress,
      done: byStatus.done
    },
    completionRate: percentage(byStatus.done, totalTasks),
    overdueRate: percentage(overdueCount, totalTasks),
    overdueCount,
    onTimeRate: percentage(onTimeTasks, completedWithDates.length),
    workloadByMember,
    mostLoadedMember: workloadByMember[0] || null
  };
};

/**
 * Overdue tasks for a team, oldest deadline first.
 *
 * @param {Object} team - Team document
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<Object>}
 */
const getTeamOverdueTasks = async (team, page = 1, limit = 20) => {
  const query = {
    teamId: team._id,
    status: { $in: OPEN_STATUSES },
    dueDate: { $lt: new Date(), $ne: null }
  };

  const skip = (page - 1) * limit;
  const total = await Task.countDocuments(query);

  const tasks = await Task.find(query)
    .populate('assignedTo', 'profile.fullName profile.avatar email')
    .populate('assignedBy', 'profile.fullName')
    .populate('teamId', 'name')
    .sort({ dueDate: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const now = new Date();
  const enriched = tasks.map((task) => {
    const dueDate = new Date(task.dueDate);
    const diffMs = now.getTime() - dueDate.getTime();
    return {
      _id: task._id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      daysOverdue: Math.floor(diffMs / (24 * 60 * 60 * 1000)),
      overdueMs: diffMs,
      assignedTo: task.assignedTo,
      assignedBy: task.assignedBy,
      teamId: task.teamId
    };
  });

  return {
    tasks: enriched,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

module.exports = {
  resolveAccessibleTeam,
  resolveReadableTeam,
  getTeamPeople,
  getTeamMemberProgress,
  getTeamPerformance,
  getTeamOverdueTasks
};
