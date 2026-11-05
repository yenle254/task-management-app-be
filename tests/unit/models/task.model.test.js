const mongoose = require('mongoose');
const Task = require('../../../models/task.model');

/**
 * Task model status-history tests.
 *
 * The schema hooks are exercised directly on in-memory documents, so the
 * tests need no database connection.
 */
describe('Task model status history', () => {
    test('declares an index for recorded event dates', () => {
        expect(Task.schema.indexes().some(([fields]) =>
            fields['statusHistory.at'] === 1
        )).toBe(true);
    });
    const buildTask = (overrides = {}) => {
        const task = new Task({
            title: 'A task',
            assignedBy: new mongoose.Types.ObjectId(),
            teamId: new mongoose.Types.ObjectId(),
            assignedTo: [new mongoose.Types.ObjectId()],
            ...overrides
        });
        return task;
    };

    /**
     * Run the model's own pre-save hook without touching the database.
     *
     * The hook is located by its source rather than by index, so unrelated
     * Mongoose-internal pre-save hooks being added or reordered does not
     * break the test.
     */
    const runSaveHooks = async (task) => {
        const pres = task.schema.s.hooks._pres.get('save');
        const hook = pres.find((h) =>
            String(h.fn).includes('statusHistory.push')
        );
        if (!hook) {
            throw new Error('Task pre-save hook not found');
        }

        await new Promise((resolve, reject) => {
            hook.fn.call(task, (err) => (err ? reject(err) : resolve()));
        });
    };

    describe('pre-save hook', () => {
        test('blocks explicit completion and preserves history when dependencies are unfinished', async () => {
            const task = buildTask({ status: 'done', dependencies: [new mongoose.Types.ObjectId()] });
            task.$locals.previousStatus = 'in_review';
            task.$locals.reviewApproved = true;
            jest.spyOn(Task, 'find').mockReturnValue({ select() { return this; }, lean: async () => [{ title: 'Pending', status: 'todo' }] });
            await expect(runSaveHooks(task)).rejects.toThrow('blocked by');
            expect(task.statusHistory).toHaveLength(0);
        });
        test('subtask completion cannot bypass a dependency, including on checklist saves', async () => {
            const task = buildTask({ status: 'todo', dependencies: [new mongoose.Types.ObjectId()], subTasks: [{ title: 'Complete', isCompleted: true }] });
            jest.spyOn(Task, 'find').mockReturnValue({ select() { return this; }, lean: async () => [{ title: 'Pending', status: 'todo' }] });
            await runSaveHooks(task);
            expect(task.status).toBe('in_progress');
            expect(task.progress).toBe(100);
            expect(task.statusHistory.map(entry => entry.to)).not.toContain('done');
        });
        test('preserves manual progress without subtasks', async () => {
            const task = buildTask({ progress: 65 });
            await runSaveHooks(task);
            expect(task.progress).toBe(65);
        });

        test.each([true, false])('never revives a deleted task with completed=%s subtasks', async (isCompleted) => {
            const task = buildTask({ status: 'deleted', subTasks: [{ title: 'one', isCompleted }] });
            task.$locals.previousStatus = 'in_progress';
            await runSaveHooks(task);
            await runSaveHooks(task);
            expect(task.status).toBe('deleted');
            expect(task.statusHistory).toHaveLength(1);
            expect(task.statusHistory[0]).toMatchObject({ from: 'in_progress', to: 'deleted' });
        });
        test('records creation with the initial team, assignees and due date', async () => {
            const dueDate = new Date('2025-04-30T12:00:00Z');
            const task = buildTask({ dueDate });

            await runSaveHooks(task);

            expect(task.statusHistory).toHaveLength(1);
            expect(task.statusHistory[0]).toMatchObject({ from: null, to: 'todo', dueDate });
            expect(task.statusHistory[0].teamId.toString()).toBe(task.teamId.toString());
            expect(task.statusHistory[0].assignedTo[0].toString()).toBe(task.assignedTo[0].toString());
        });

        test('records a transition when the status changes', async () => {
            const task = buildTask({ status: 'todo' });
            task.$locals.previousStatus = 'todo';
            task.status = 'in_progress';

            await runSaveHooks(task);

            expect(task.statusHistory).toHaveLength(1);
            expect(task.statusHistory[0]).toMatchObject({
                from: 'todo',
                to: 'in_progress'
            });
            expect(task.statusHistory[0].at).toBeInstanceOf(Date);
        });

        test('records the user who performed the transition', async () => {
            const actor = new mongoose.Types.ObjectId();
            const task = buildTask({ status: 'todo' });
            task.$locals.previousStatus = 'todo';
            task.$locals.statusChangedBy = actor;
            task.$locals.reviewApproved = true;
            task.status = 'done';

            await runSaveHooks(task);

            expect(task.statusHistory[0].by.toString()).toBe(actor.toString());
        });

        test('snapshots the team and assignees at the time of the transition', async () => {
            const task = buildTask({ status: 'todo' });
            const teamId = task.teamId;
            const assignee = task.assignedTo[0];
            task.$locals.previousStatus = 'todo';
            task.$locals.reviewApproved = true;
            task.status = 'done';

            await runSaveHooks(task);

            expect(task.statusHistory[0].teamId.toString()).toBe(teamId.toString());
            expect(task.statusHistory[0].assignedTo[0].toString()).toBe(assignee.toString());
        });

        test('does not record a transition when the status is unchanged', async () => {
            const task = buildTask({ status: 'todo' });
            task.$locals.previousStatus = 'todo';
            task.status = 'todo';

            await runSaveHooks(task);

            expect(task.statusHistory).toHaveLength(0);
        });

        test('does not add duplicate history for the same transition', async () => {
            const task = buildTask({ status: 'todo' });
            task.$locals.previousStatus = 'todo';
            task.$locals.reviewApproved = true;
            task.status = 'done';

            await runSaveHooks(task);
            await runSaveHooks(task);

            expect(task.statusHistory).toHaveLength(1);
        });

        test('keeps every completion event when a task is reopened and completed again', async () => {
            const task = buildTask({ status: 'todo' });

            // First completion.
            task.$locals.previousStatus = 'todo';
            task.$locals.reviewApproved = true;
            task.status = 'done';
            await runSaveHooks(task);

            // Reopen.
            task.$locals.previousStatus = 'done';
            task.status = 'in_progress';
            await runSaveHooks(task);

            // Completed again.
            task.$locals.previousStatus = 'in_progress';
            task.$locals.reviewApproved = true;
            task.status = 'done';
            await runSaveHooks(task);

            expect(task.statusHistory).toHaveLength(3);
            expect(task.statusHistory.map((h) => h.to)).toEqual([
                'done',
                'in_progress',
                'done'
            ]);

            // The two completion events are both preserved.
            const completions = task.statusHistory.filter((h) => h.to === 'done');
            expect(completions).toHaveLength(2);
        });

        test('sets completedAt on completion and clears it on reopen', async () => {
            const task = buildTask({ status: 'todo' });

            task.$locals.previousStatus = 'todo';
            task.$locals.reviewApproved = true;
            task.status = 'done';
            await runSaveHooks(task);
            expect(task.completedAt).toBeInstanceOf(Date);

            task.$locals.previousStatus = 'done';
            task.status = 'in_progress';
            await runSaveHooks(task);
            expect(task.completedAt).toBeNull();
        });

        test('records the transition derived from completing all subtasks', async () => {
            const task = buildTask({ status: 'todo' });
            task.$locals.loadedStatus = 'todo';
            task.subTasks = [
                { title: 'one', isCompleted: true },
                { title: 'two', isCompleted: true }
            ];


            await runSaveHooks(task);

            expect(task.status).toBe('in_progress');
            expect(task.statusHistory).toHaveLength(1);
            expect(task.statusHistory[0]).toMatchObject({
                from: 'todo',
                to: 'in_progress'
            });
        });

        test('records a reopen derived from un-completing subtasks', async () => {
            const task = buildTask({ status: 'done' });
            task.$locals.loadedStatus = 'done';
            task.subTasks = [
                { title: 'one', isCompleted: false },
                { title: 'two', isCompleted: false }
            ];

            await runSaveHooks(task);

            expect(task.status).toBe('todo');
            expect(task.statusHistory).toHaveLength(1);
            expect(task.statusHistory[0]).toMatchObject({
                from: 'done',
                to: 'todo'
            });
        });
    });
});
