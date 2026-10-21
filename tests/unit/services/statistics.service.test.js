const mongoose = require('mongoose');
const {
  buildTaskFilter,
  getAttendanceStats,
  getLeaveStats,
  getTaskStats,
  getPerformanceTrend
} = require('../../../services/statistics.service');
const Task = require('../../../models/task.model');
const Attendance = require('../../../models/attendance.model');
const Leave = require('../../../models/leave.model');
const { TASK_STATUS, ATTENDANCE_STATUS, LEAVE_STATUS } = require('../../../utils/constants.utils');

/**
 * HR statistics service tests.
 *
 * The service is built on aggregation pipelines, so the tests assert on the
 * pipeline that is handed to Mongoose as well as on the computed metrics.
 */
describe('statistics.service', () => {
    const teamId = new mongoose.Types.ObjectId();
    const employeeId = new mongoose.Types.ObjectId();

    /** Mock a model aggregate() call and capture the pipeline. */
    const mockAggregate = (model, result) => {
        const spy = jest.spyOn(model, 'aggregate');
        spy.mockImplementation((pipeline) => {
            spy.pipeline = pipeline;
            return { then: (resolve) => Promise.resolve(resolve(result)) };
        });
        return spy;
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('buildTaskFilter()', () => {
        test('excludes deleted tasks by default', () => {
            const filter = buildTaskFilter({});

            expect(filter.status).toEqual({ $ne: TASK_STATUS.DELETED });
        });

        test('applies the date range to the query', () => {
            const start = new Date('2025-01-01');
            const end = new Date('2025-01-31');

            const filter = buildTaskFilter({ startDate: start, endDate: end });

            expect(filter.createdAt).toEqual({ $gte: start, $lte: end });
        });

        test('applies the teamId filter', () => {
            const filter = buildTaskFilter({ teamId: teamId.toString() });

            expect(filter.teamId).toBeInstanceOf(mongoose.Types.ObjectId);
            expect(filter.teamId.toString()).toBe(teamId.toString());
        });

        test('applies the employeeId filter', () => {
            const filter = buildTaskFilter({ employeeId: employeeId.toString() });

            expect(filter.assignedTo).toBeInstanceOf(mongoose.Types.ObjectId);
            expect(filter.assignedTo.toString()).toBe(employeeId.toString());
        });

        test('combines team, employee and date filters without dropping any', () => {
            const start = new Date('2025-01-01');
            const end = new Date('2025-01-31');

            const filter = buildTaskFilter({
                teamId: teamId.toString(),
                employeeId: employeeId.toString(),
                startDate: start,
                endDate: end
            });

            expect(filter.teamId).toBeDefined();
            expect(filter.assignedTo).toBeDefined();
            expect(filter.createdAt).toEqual({ $gte: start, $lte: end });
            expect(filter.status).toEqual({ $ne: TASK_STATUS.DELETED });
        });

        test('never lets a status filter re-include deleted tasks', () => {
            const filter = buildTaskFilter({ status: TASK_STATUS.DELETED });

            expect(filter.status).toEqual({ $ne: TASK_STATUS.DELETED });
        });

        test('narrows the scope for a valid status', () => {
            const filter = buildTaskFilter({ status: TASK_STATUS.DONE });

            expect(filter.status).toBe(TASK_STATUS.DONE);
        });

        test('ignores an unknown status value', () => {
            const filter = buildTaskFilter({ status: 'not-a-status' });

            expect(filter.status).toEqual({ $ne: TASK_STATUS.DELETED });
        });
    });

    describe('getAttendanceStats()', () => {
        test('computes onTimeRate and lateRate over valid records', async () => {
            mockAggregate(Attendance, [
                { _id: ATTENDANCE_STATUS.PRESENT, count: 3, totalWorkHours: 24 },
                { _id: ATTENDANCE_STATUS.LATE, count: 1, totalWorkHours: 8 }
            ]);

            const stats = await getAttendanceStats(
                new Date('2025-01-01'),
                new Date('2025-01-31')
            );

            expect(stats.counts.present).toBe(3);
            expect(stats.counts.late).toBe(1);
            expect(stats.totalRecords).toBe(4);
            expect(stats.onTimeRate).toBe(75);
            expect(stats.lateRate).toBe(25);
        });

        test('returns zero rates when there is no attendance data', async () => {
            mockAggregate(Attendance, []);

            const stats = await getAttendanceStats(
                new Date('2025-01-01'),
                new Date('2025-01-31')
            );

            expect(stats.totalRecords).toBe(0);
            expect(stats.onTimeRate).toBe(0);
            expect(stats.lateRate).toBe(0);
        });

        test('only counts attendance records with a known status', async () => {
            const spy = mockAggregate(Attendance, []);

            await getAttendanceStats(new Date('2025-01-01'), new Date('2025-01-31'));

            const match = spy.pipeline[0].$match;
            expect(match.status.$in).toEqual(
                expect.arrayContaining([
                    ATTENDANCE_STATUS.PRESENT,
                    ATTENDANCE_STATUS.LATE,
                    ATTENDANCE_STATUS.ABSENT
                ])
            );
        });
    });

    describe('getLeaveStats()', () => {
        test('counts distinct employees on approved leave', async () => {
            const aggregateSpy = jest.spyOn(Leave, 'aggregate');

            // The overlap aggregation groups by userId, so two requests from
            // the same employee collapse into one row.
            aggregateSpy.mockImplementation((pipeline) => {
                if (pipeline.some((s) => s.$group && s.$group._id === '$userId')) {
                    return {
                        then: (resolve) =>
                            Promise.resolve(
                                resolve([
                                    { _id: employeeId, totalDays: 5, leaveCount: 2 }
                                ])
                            )
                    };
                }
                return { then: (resolve) => Promise.resolve(resolve([])) };
            });

            jest.spyOn(Leave, 'countDocuments').mockResolvedValue(0);

            const stats = await getLeaveStats(
                new Date('2025-01-01'),
                new Date('2025-01-31'),
                1,
                2025
            );

            // One employee, even though that employee has two approved requests.
            expect(stats.employeesOnLeave).toBe(1);
            expect(stats.approvedLeaveRecords).toBe(2);
            expect(stats.approvedLeaveDays).toBe(5);
        });

        test('only counts approved leaves in the overlap match', async () => {
            const aggregateSpy = jest.spyOn(Leave, 'aggregate');

            aggregateSpy.mockImplementation((pipeline) => ({
                then: (resolve) => Promise.resolve(resolve([]))
            }));
            jest.spyOn(Leave, 'countDocuments').mockResolvedValue(0);

            await getLeaveStats(
                new Date('2025-01-01'),
                new Date('2025-01-31'),
                1,
                2025
            );

            const overlapStage = aggregateSpy.mock.calls[0][0][0];
            expect(overlapStage.$match.status).toBe(LEAVE_STATUS.APPROVED);
        });

        test('counts pending leaves separately from approved ones', async () => {
            jest.spyOn(Leave, 'aggregate').mockImplementation((pipeline) => ({
                then: (resolve) => Promise.resolve(resolve([]))
            }));
            const countSpy = jest.spyOn(Leave, 'countDocuments');
            countSpy.mockResolvedValue(3);

            const stats = await getLeaveStats(
                new Date('2025-01-01'),
                new Date('2025-01-31'),
                1,
                2025
            );

            expect(stats.pendingLeaves).toBe(3);
            expect(stats.employeesOnLeave).toBe(0);
        });
    });

    describe('getTaskStats()', () => {
        test('computes the completion rate from the status breakdown', async () => {
            const aggregateSpy = jest.spyOn(Task, 'aggregate');
            aggregateSpy.mockImplementation((pipeline) => {
                // The byStatus aggregation groups by status.
                if (pipeline.some((s) => s.$group && s.$group._id === '$status')) {
                    return {
                        then: (resolve) =>
                            Promise.resolve(
                                resolve([
                                    { _id: TASK_STATUS.DONE, count: 3 },
                                    { _id: TASK_STATUS.TODO, count: 1 }
                                ])
                            )
                    };
                }
                return { then: (resolve) => Promise.resolve(resolve([])) };
            });

            jest.spyOn(Task, 'countDocuments').mockResolvedValue(0);

            const stats = await getTaskStats({ status: { $ne: TASK_STATUS.DELETED } });

            expect(stats.totalTasks).toBe(4);
            expect(stats.doneTasks).toBe(3);
            expect(stats.openTasks).toBe(1);
            expect(stats.completionRate).toBe(75);
        });
    });

    describe('getPerformanceTrend()', () => {
        test('builds the trend from real completion and creation events', async () => {
            const aggregateSpy = jest.spyOn(Task, 'aggregate');
            aggregateSpy.mockImplementation((pipeline) => {
                const group = pipeline.find((s) => s.$group);
                const usesCompletedAt =
                    JSON.stringify(pipeline).includes('completedAt');
                if (group && usesCompletedAt) {
                    return {
                        then: (resolve) =>
                            Promise.resolve(
                                resolve([
                                    {
                                        _id: '2025-01',
                                        completed: 2,
                                        withDueDate: 2,
                                        onTime: 1
                                    }
                                ])
                            )
                    };
                }
                if (group) {
                    return {
                        then: (resolve) =>
                            Promise.resolve(resolve([{ _id: '2025-01', total: 5 }]))
                    };
                }
                return { then: (resolve) => Promise.resolve(resolve([])) };
            });

            const trend = await getPerformanceTrend(
                { status: { $ne: TASK_STATUS.DELETED } },
                'month',
                new Date('2025-01-01'),
                new Date('2025-12-31')
            );

            expect(trend).toHaveLength(1);
            expect(trend[0].period).toBe('2025-01');
            expect(trend[0].totalTasks).toBe(5);
            expect(trend[0].completedTasks).toBe(2);
            expect(trend[0].completionRate).toBe(40);
            // onTimeRate denominator is only the completed tasks with a dueDate.
            expect(trend[0].onTimeRate).toBe(50);
        });

        test('does not invent buckets for periods without activity', async () => {
            jest.spyOn(Task, 'aggregate').mockImplementation((pipeline) => ({
                then: (resolve) => Promise.resolve(resolve([]))
            }));

            const trend = await getPerformanceTrend(
                { status: { $ne: TASK_STATUS.DELETED } },
                'month',
                new Date('2025-01-01'),
                new Date('2025-03-31')
            );

            // No fabricated history for the months without events.
            expect(trend).toEqual([]);
        });
    });
});
