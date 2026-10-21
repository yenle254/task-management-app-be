const mongoose = require('mongoose');
const {
  resolveAccessibleTeam,
  resolveReadableTeam,
  getTeamMemberProgress,
  getTeamPerformance,
  getTeamOverdueTasks
} = require('../../../services/team-dashboard.service');
const Task = require('../../../models/task.model');
const Team = require('../../../models/team.model');
const User = require('../../../models/user.model');
const { USER_ROLES } = require('../../../utils/constants.utils');

/**
 * Team dashboard service tests.
 *
 * The service reads from the database through Mongoose models, so the models
 * are mocked here in the same style as the other service tests in this repo.
 */
describe('team-dashboard.service', () => {
    const teamId = new mongoose.Types.ObjectId();
    const leaderId = new mongoose.Types.ObjectId();
    const memberId = new mongoose.Types.ObjectId();
    const outsiderId = new mongoose.Types.ObjectId();

    const team = {
        _id: teamId,
        leaderId,
        memberIds: [memberId]
    };

    const makeUser = (id, name) => ({
        _id: id,
        role: USER_ROLES.EMPLOYEE,
        teamId,
        profile: { fullName: name }
    });

    /** Mock Task.find(...).select(...).lean() */
    const mockTasks = (tasks) => {
        jest.spyOn(Task, 'find').mockReturnValue({
            select: () => ({ lean: () => Promise.resolve(tasks) })
        });
    };

    /** Mock User.find(...).select(...).lean() */
    const mockUsers = (users) => {
        jest.spyOn(User, 'find').mockReturnValue({
            select: () => ({ lean: () => Promise.resolve(users) })
        });
    };

    beforeEach(() => {
        jest.spyOn(Team, 'findById').mockResolvedValue(team);
        mockTasks([]);
        mockUsers([
            { _id: leaderId, profile: { fullName: 'Leader One' } },
            { _id: memberId, profile: { fullName: 'Member Two' } }
        ]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('resolveAccessibleTeam()', () => {
        test('allows an HR Manager to read any team', async () => {
            const result = await resolveAccessibleTeam(
                { _id: outsiderId, role: USER_ROLES.HR_MANAGER },
                teamId.toString()
            );

            expect(result.ok).toBe(true);
            expect(result.team).toBe(team);
        });

        test('allows the team leader to read their own team', async () => {
            const result = await resolveAccessibleTeam(
                { _id: leaderId, role: USER_ROLES.TEAM_LEAD },
                teamId.toString()
            );

            expect(result.ok).toBe(true);
        });

        test('denies a team lead who does not lead the team', async () => {
            const result = await resolveAccessibleTeam(
                { _id: outsiderId, role: USER_ROLES.TEAM_LEAD },
                teamId.toString()
            );

            expect(result.ok).toBe(false);
            expect(result.status).toBe(403);
        });

        test('denies an employee who is not a leader', async () => {
            const result = await resolveAccessibleTeam(
                { _id: memberId, role: USER_ROLES.EMPLOYEE },
                teamId.toString()
            );

            expect(result.ok).toBe(false);
            expect(result.status).toBe(403);
        });

        test('rejects an invalid team id', async () => {
            const result = await resolveAccessibleTeam(
                { _id: outsiderId, role: USER_ROLES.HR_MANAGER },
                'not-an-id'
            );

            expect(result.ok).toBe(false);
            expect(result.status).toBe(400);
        });

        test('returns 404 for a team that does not exist', async () => {
            Team.findById.mockResolvedValue(null);

            const result = await resolveAccessibleTeam(
                { _id: outsiderId, role: USER_ROLES.HR_MANAGER },
                teamId.toString()
            );

            expect(result.ok).toBe(false);
            expect(result.status).toBe(404);
        });
    });

    describe('resolveReadableTeam()', () => {
        test('allows a team member to read the task list of their team', async () => {
            const result = await resolveReadableTeam(
                makeUser(memberId, 'Member Two'),
                teamId.toString()
            );

            expect(result.ok).toBe(true);
        });

        test('denies a user from another team', async () => {
            const result = await resolveReadableTeam(
                { _id: outsiderId, role: USER_ROLES.EMPLOYEE, teamId: new mongoose.Types.ObjectId() },
                teamId.toString()
            );

            expect(result.ok).toBe(false);
            expect(result.status).toBe(403);
        });

        test('denies a team lead who does not lead the team', async () => {
            const result = await resolveReadableTeam(
                { _id: outsiderId, role: USER_ROLES.TEAM_LEAD },
                teamId.toString()
            );

            expect(result.ok).toBe(false);
            expect(result.status).toBe(403);
        });
    });

    describe('getTeamMemberProgress()', () => {
        test('returns an entry for every member of the team', async () => {
            const progress = await getTeamMemberProgress(team);

            expect(progress).toHaveLength(2);
            expect(progress.map((p) => p.userName).sort()).toEqual([
                'Leader One',
                'Member Two'
            ]);
        });

        test('returns zeroed metrics for a member without tasks', async () => {
            const progress = await getTeamMemberProgress(team);
            const member = progress.find((p) => p.userId.toString() === memberId.toString());

            expect(member).toMatchObject({
                totalTasks: 0,
                completedTasks: 0,
                inProgressTasks: 0,
                overdueTasks: 0,
                completionRate: 0,
                onTimeRate: 0
            });
        });

        test('computes completionRate from the real task counts', async () => {
            mockTasks([
                { status: 'done', dueDate: null, completedAt: new Date(), createdAt: new Date(), assignedTo: [leaderId] },
                { status: 'done', dueDate: null, completedAt: new Date(), createdAt: new Date(), assignedTo: [leaderId] },
                { status: 'in_progress', dueDate: null, completedAt: null, createdAt: new Date(), assignedTo: [leaderId] },
                { status: 'todo', dueDate: null, completedAt: null, createdAt: new Date(), assignedTo: [leaderId] }
            ]);

            const progress = await getTeamMemberProgress(team);
            const leader = progress.find((p) => p.userId.toString() === leaderId.toString());

            expect(leader.totalTasks).toBe(4);
            expect(leader.completedTasks).toBe(2);
            expect(leader.inProgressTasks).toBe(1);
            expect(leader.completionRate).toBe(50);
        });

        test('computes onTimeRate only from tasks having both dueDate and completedAt', async () => {
            const now = new Date();
            const past = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
            const future = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

            mockTasks([
                // Completed before the deadline -> on time.
                { status: 'done', dueDate: future, completedAt: now, createdAt: past, assignedTo: [leaderId] },
                // Completed after the deadline -> late.
                { status: 'done', dueDate: past, completedAt: now, createdAt: past, assignedTo: [leaderId] },
                // No dueDate -> excluded from the on-time denominator.
                { status: 'done', dueDate: null, completedAt: now, createdAt: past, assignedTo: [leaderId] }
            ]);

            const progress = await getTeamMemberProgress(team);
            const leader = progress.find((p) => p.userId.toString() === leaderId.toString());

            // 2 of 3 completed tasks, but on-time denominator is 2 (only the
            // two tasks that have a dueDate), of which 1 was on time.
            expect(leader.completedTasks).toBe(3);
            expect(leader.completionRate).toBe(100);
            expect(leader.onTimeRate).toBe(50);
        });

        test('excludes closed tasks from the overdue count', async () => {
            const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

            mockTasks([
                { status: 'todo', dueDate: past, completedAt: null, createdAt: past, assignedTo: [leaderId] },
                { status: 'in_progress', dueDate: past, completedAt: null, createdAt: past, assignedTo: [leaderId] },
                { status: 'done', dueDate: past, completedAt: new Date(), createdAt: past, assignedTo: [leaderId] }
            ]);

            const progress = await getTeamMemberProgress(team);
            const leader = progress.find((p) => p.userId.toString() === leaderId.toString());

            // The completed task must not count as overdue.
            expect(leader.overdueTasks).toBe(2);
        });

        test('returns an empty array for a team with no people', async () => {
            mockUsers([]);

            const progress = await getTeamMemberProgress({
                _id: teamId,
                leaderId: null,
                memberIds: []
            });

            expect(progress).toEqual([]);
        });
    });

    describe('getTeamPerformance()', () => {
        test('returns zeroed metrics for a team with no tasks', async () => {
            const perf = await getTeamPerformance(team);

            expect(perf.taskCounts).toEqual({
                total: 0,
                todo: 0,
                inProgress: 0,
                done: 0
            });
            expect(perf.completionRate).toBe(0);
            expect(perf.overdueRate).toBe(0);
            expect(perf.onTimeRate).toBe(0);
        });

        test('counts tasks per status and computes the completion rate', async () => {
            mockTasks([
                { status: 'done', priority: 'high', dueDate: null, completedAt: new Date(), assignedTo: [leaderId] },
                { status: 'todo', priority: 'low', dueDate: null, completedAt: null, assignedTo: [leaderId] },
                { status: 'in_progress', priority: 'medium', dueDate: null, completedAt: null, assignedTo: [leaderId] }
            ]);

            const perf = await getTeamPerformance(team);

            expect(perf.taskCounts).toEqual({
                total: 3,
                todo: 1,
                inProgress: 1,
                done: 1
            });
            expect(perf.completionRate).toBeCloseTo(33.33, 1);
        });

        test('does not count finished tasks as outstanding workload', async () => {
            mockTasks([
                { status: 'done', priority: 'high', dueDate: null, completedAt: new Date(), assignedTo: [leaderId] },
                { status: 'todo', priority: 'low', dueDate: null, completedAt: null, assignedTo: [leaderId] }
            ]);

            const perf = await getTeamPerformance(team);
            const leader = perf.workloadByMember.find(
                (m) => m.userId.toString() === leaderId.toString()
            );

            expect(leader.openTasks).toBe(1);
            expect(leader.completedTasks).toBe(1);
            expect(leader.totalTasks).toBe(2);
        });

        test('reports the member with the most open tasks', async () => {
            mockTasks([
                { status: 'todo', priority: 'low', dueDate: null, completedAt: null, assignedTo: [leaderId] },
                { status: 'todo', priority: 'low', dueDate: null, completedAt: null, assignedTo: [memberId] },
                { status: 'todo', priority: 'low', dueDate: null, completedAt: null, assignedTo: [memberId] }
            ]);

            const perf = await getTeamPerformance(team);

            expect(perf.mostLoadedMember.userId.toString()).toBe(memberId.toString());
            expect(perf.mostLoadedMember.openTasks).toBe(2);
        });
    });

    describe('getTeamOverdueTasks()', () => {
        test('sorts the most overdue task first and reports days overdue', async () => {
            const now = Date.now();
            const oldest = new Date(now - 10 * 24 * 60 * 60 * 1000);
            const newest = new Date(now - 2 * 24 * 60 * 60 * 1000);

            jest.spyOn(Task, 'countDocuments').mockResolvedValue(2);
            jest.spyOn(Task, 'find').mockReturnValue({
                populate: () => ({
                    populate: () => ({
                        populate: () => ({
                            sort: () => ({
                                skip: () => ({
                                    limit: () => ({
                                        lean: () => Promise.resolve([
                                            {
                                                _id: new mongoose.Types.ObjectId(),
                                                title: 'Oldest',
                                                status: 'todo',
                                                priority: 'high',
                                                dueDate: oldest,
                                                assignedTo: [],
                                                assignedBy: null,
                                                teamId
                                            },
                                            {
                                                _id: new mongoose.Types.ObjectId(),
                                                title: 'Newest',
                                                status: 'in_progress',
                                                priority: 'low',
                                                dueDate: newest,
                                                assignedTo: [],
                                                assignedBy: null,
                                                teamId
                                            }
                                        ])
                                    })
                                })
                            })
                        })
                    })
                })
            });

            const result = await getTeamOverdueTasks(team, 1, 10);

            expect(result.tasks).toHaveLength(2);
            expect(result.tasks[0].title).toBe('Oldest');
            expect(result.tasks[0].daysOverdue).toBeGreaterThanOrEqual(10);
            expect(result.tasks[1].daysOverdue).toBeLessThan(result.tasks[0].daysOverdue);
            expect(result.pagination.total).toBe(2);
            expect(result.pagination.pages).toBe(1);
        });
    });
});
