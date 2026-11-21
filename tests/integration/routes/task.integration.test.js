const request = require('supertest');
const mongoose = require('mongoose');
const Task = require('../../../models/task.model');
const AuditLog = require('../../../models/audit-log.model');
const Notification = require('../../../models/notification.model');
const auditService = require('../../../services/audit.service');

const { connectTestDB, clearTestDB, disconnectTestDB } = require('../setup/mongo-env');
const { createTestApp } = require('../setup/test-app');
const { seedOrganization, createTaskDoc } = require('../setup/seed-helpers');

describe('Task, Review Workflow & Write Lock Integration Tests (Real MongoDB)', () => {
  let testEnv;
  let app;
  let org;

  beforeAll(async () => {
    await connectTestDB();
    testEnv = createTestApp();
    app = testEnv.app;
  });

  beforeEach(async () => {
    await clearTestDB();
    testEnv.clearOutbox();
    org = await seedOrganization(app);
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  const api = (role, method, path) =>
    request(app)[method](`/api/tasks${path}`).set('Authorization', `Bearer ${org.tokens[role]}`);

  describe('1. Role-Based CRUD & Task Initialization', () => {
    test('hr_manager and team_lead can create tasks with normalized deduplicated tags, difficulty, estimates, and initial statusHistory', async () => {
      const res = await api('leadA', 'post', '').send({
        title: 'Build Integration Suite',
        description: 'End-to-end MongoDB verification',
        teamId: String(org.teams.teamA._id),
        assignedTo: [String(org.users.employee._id)],
        priority: 'high',
        difficulty: 'hard',
        tags: [' Backend ', 'backend', 'Backend', 'CI'],
        estimatedMinutes: 120,
        storyPoints: 5,
        startDate: '2026-11-01T00:00:00.000Z',
        dueDate: '2026-11-25T23:59:59.000Z',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const taskId = res.body.data._id;

      const dbTask = await Task.findById(taskId).lean();
      expect(dbTask).toBeTruthy();
      expect(dbTask.difficulty).toBe('hard');
      expect(dbTask.priority).toBe('high');
      expect(dbTask.estimatedMinutes).toBe(120);
      expect(dbTask.storyPoints).toBe(5);
      expect(dbTask.tags).toEqual(['Backend', 'backend', 'CI']);

      // Mongoose pre('save') hook initializes statusHistory
      expect(dbTask.statusHistory).toHaveLength(1);
      expect(dbTask.statusHistory[0]).toMatchObject({
        from: null,
        to: 'todo',
        teamId: org.teams.teamA._id,
      });

      // Verify task_write_locks is released after creation
      expect(await mongoose.connection.collection('task_write_locks').countDocuments()).toBe(0);
    });

    test('employee and system_admin are forbidden (403) from creating tasks or modifying planning fields', async () => {
      const payload = {
        title: 'Unauthorized Task',
        teamId: String(org.teams.teamA._id),
        assignedTo: [String(org.users.employee._id)],
      };

      expect((await api('employee', 'post', '').send(payload)).status).toBe(403);
      expect((await api('admin', 'post', '').send(payload)).status).toBe(403);

      const task = await createTaskDoc({
        title: 'Planned Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        priority: 'medium',
      });

      // Employee cannot update planning fields via PUT /api/tasks/:id
      const updateRes = await api('employee', 'put', `/${task._id}`).send({
        priority: 'high',
        dueDate: '2026-12-31T00:00:00.000Z',
      });
      expect(updateRes.status).toBe(403);

      const dbTask = await Task.findById(task._id).lean();
      expect(dbTask.priority).toBe('medium');
    });
  });

  describe('2. Subtasks, Checklists, Time Entries & Auto-Status Derivation', () => {
    test('completing subtasks updates progress and moves status todo -> in_progress, but 100% subtasks never bypasses review into done', async () => {
      const task = await createTaskDoc({
        title: 'Subtask Driven Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'todo',
      });

      const sub1Res = await api('employee', 'post', `/${task._id}/subtasks`).send({ title: 'Subtask 1' });
      const sub2Res = await api('employee', 'post', `/${task._id}/subtasks`).send({ title: 'Subtask 2' });
      expect(sub1Res.status).toBe(201);
      expect(sub2Res.status).toBe(201);

      const sub1Id = sub1Res.body.data.subtask._id;
      const sub2Id = sub2Res.body.data.subtask._id;

      // Toggle first subtask -> status becomes in_progress, progress becomes 50%
      const toggle1 = await api('employee', 'put', `/${task._id}/subtasks/${sub1Id}`).send({});
      expect(toggle1.status).toBe(200);

      let dbTask = await Task.findById(task._id).lean();
      expect(dbTask.status).toBe('in_progress');
      expect(dbTask.progress).toBe(50);

      // Toggle second subtask -> progress becomes 100%, but status stays in_progress (cannot jump to done without review)
      const toggle2 = await api('employee', 'put', `/${task._id}/subtasks/${sub2Id}`).send({});
      expect(toggle2.status).toBe(200);

      dbTask = await Task.findById(task._id).lean();
      expect(dbTask.progress).toBe(100);
      expect(dbTask.status).toBe('in_progress');
      expect(dbTask.completedAt).toBeNull();

      // Direct status transition to 'done' via PUT /:id/status is rejected for employee (must submit for review)
      const directDone = await api('employee', 'put', `/${task._id}/status`).send({ status: 'done' });
      expect(directDone.status).toBe(400);
    });

    test('checklist CRUD operations do not alter task progress or status', async () => {
      const task = await createTaskDoc({
        title: 'Checklist Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
      });

      await api('employee', 'put', `/${task._id}/progress`).send({ progress: 35 });

      const addCl = await api('employee', 'post', `/${task._id}/checklists`).send({ title: 'QA Steps' });
      expect(addCl.status).toBe(201);
      const checklistId = addCl.body.data.checklist._id;

      const addItem = await api('employee', 'post', `/${task._id}/checklists/${checklistId}/items`).send({ text: 'Run linter' });
      expect(addItem.status).toBe(200);
      const itemId = addItem.body.data.checklist.items[0]._id;

      const toggleItem = await api('employee', 'patch', `/${task._id}/checklists/${checklistId}/items/${itemId}`).send({ isCompleted: true });
      expect(toggleItem.status).toBe(200);

      const dbTask = await Task.findById(task._id).lean();
      expect(dbTask.checklists[0].items[0].isCompleted).toBe(true);
      expect(dbTask.progress).toBe(35);
      expect(dbTask.status).toBe('in_progress');
    });

    test('withTaskWriteLock serializes concurrent time-entry logs and preserves all entries and actualMinutes sum', async () => {
      const task = await createTaskDoc({
        title: 'Concurrent Time Logging Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
      });

      // Fire 6 concurrent time-entry additions
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, idx) =>
          api('employee', 'post', `/${task._id}/time-entries`).send({
            minutes: 15,
            note: `Session ${idx + 1}`,
          })
        )
      );

      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      const dbTask = await Task.findById(task._id).lean();
      expect(dbTask.timeEntries).toHaveLength(6);
      expect(dbTask.actualMinutes).toBe(90);
      expect(await mongoose.connection.collection('task_write_locks').countDocuments()).toBe(0);
    });
  });

  describe('3. Task Review Workflow & Mutation Guards', () => {
    test('full review lifecycle: incomplete subtask blocks submit -> submit locks mutations (409) -> request-changes -> resubmit -> approve records rounds, statusHistory, AuditLog, and Notifications', async () => {
      const task = await createTaskDoc({
        title: 'Feature Review Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'in_progress',
        subTasks: [{ title: 'Write unit tests', isCompleted: false }],
      });

      // 1. Incomplete subtask blocks submission
      const blockedSubmit = await api('employee', 'post', `/${task._id}/submit`).send({ note: 'Try early' });
      expect(blockedSubmit.status).toBe(400);

      // Complete subtask and submit
      const subId = task.subTasks[0]._id;
      await api('employee', 'put', `/${task._id}/subtasks/${subId}`).send({});

      const submit1 = await api('employee', 'post', `/${task._id}/submit`).send({ note: 'Ready for review round 1' });
      expect(submit1.status).toBe(200);
      expect(submit1.body.data.status).toBe('in_review');

      // 2. While in_review, content mutations are locked (409)
      for (const [method, suffix, body] of [
        ['put', '/progress', { progress: 50 }],
        ['put', '/status', { status: 'in_progress' }],
        ['post', '/subtasks', { title: 'New subtask' }],
        ['post', '/checklists', { title: 'New checklist' }],
        ['post', '/tags', { tags: ['locked'] }],
      ]) {
        const lockedRes = await api('employee', method, `/${task._id}${suffix}`).send(body);
        expect(lockedRes.status).toBe(409);
      }

      // 3. Unauthorized reviewers (assignee self-approve, other team lead, system_admin) get 403
      expect((await api('employee', 'post', `/${task._id}/approve`).send({})).status).toBe(403);
      expect((await api('leadB', 'post', `/${task._id}/approve`).send({})).status).toBe(403);
      expect((await api('admin', 'post', `/${task._id}/approve`).send({})).status).toBe(403);

      // 4. Empty rejection reason is rejected with 400
      expect((await api('leadA', 'post', `/${task._id}/request-changes`).send({ reason: '   ' })).status).toBe(400);

      // 5. Team lead requests changes with valid reason
      const rejectReason = 'Please add edge-case handling for expired tokens';
      const rejectRes = await api('leadA', 'post', `/${task._id}/request-changes`).send({ reason: rejectReason });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('in_progress');

      // 6. Employee resubmits (Round 2) and HR approves
      const submit2 = await api('employee', 'post', `/${task._id}/submit`).send({ note: 'Fixed edge cases' });
      expect(submit2.status).toBe(200);

      const approveRes = await api('hr', 'post', `/${task._id}/approve`).send({ note: 'LGTM' });
      expect(approveRes.status).toBe(200);

      // 7. Verify persisted MongoDB state
      const dbTask = await Task.findById(task._id).lean();
      expect(dbTask.status).toBe('done');
      expect(dbTask.progress).toBe(100);
      expect(dbTask.completedAt).toBeInstanceOf(Date);
      expect(dbTask.review.currentRound).toBe(2);
      expect(dbTask.review.rounds.map((r) => r.type)).toEqual([
        'submitted',
        'changes_requested',
        'submitted',
        'approved',
      ]);
      expect(dbTask.review.rounds[1].reason).toBe(rejectReason);
      expect(dbTask.statusHistory.map((h) => h.to)).toEqual([
        'in_progress',
        'in_review',
        'in_progress',
        'in_review',
        'done',
      ]);

      // 8. Verify AuditLog and Notification documents in MongoDB
      await auditService.flush();
      const auditEvents = await AuditLog.find({ 'target.id': String(task._id) }).sort({ at: 1 }).lean();
      const actions = auditEvents.map((e) => e.action);
      expect(actions).toContain('task.submitted_for_review');
      expect(actions).toContain('task.review_rejected');
      expect(actions).toContain('task.review_approved');

      const rejectedAudit = auditEvents.find((e) => e.action === 'task.review_rejected');
      expect(rejectedAudit.reason).toBe(rejectReason);

      const submittedNotifs = await Notification.countDocuments({
        relatedId: task._id,
        type: 'task_submitted_for_review',
      });
      const approvedNotifs = await Notification.countDocuments({
        relatedId: task._id,
        type: 'task_review_approved',
      });
      expect(submittedNotifs).toBeGreaterThanOrEqual(2);
      expect(approvedNotifs).toBeGreaterThanOrEqual(1);
    });

    test('self-review is forbidden even for HR Manager or Team Lead when they are assignees', async () => {
      const hrTask = await createTaskDoc({
        title: 'HR Assigned To Self',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.hr._id],
        status: 'in_progress',
      });

      const subRes = await api('hr', 'post', `/${hrTask._id}/submit`).send({});
      expect(subRes.status).toBe(200);

      // HR cannot approve their own task
      const selfApprove = await api('hr', 'post', `/${hrTask._id}/approve`).send({});
      expect(selfApprove.status).toBe(403);

      // Team Lead of teamA can approve it
      const leadApprove = await api('leadA', 'post', `/${hrTask._id}/approve`).send({});
      expect(leadApprove.status).toBe(200);
    });
  });

  describe('4. Concurrent Review Decisions & Write Lock Serialization', () => {
    test('concurrent POST /:id/approve and POST /:id/request-changes on the same task result in exactly one 200 and one 409 with zero lingering locks', async () => {
      const task = await createTaskDoc({
        title: 'Concurrent Review Decision Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'in_progress',
      });

      await api('employee', 'post', `/${task._id}/submit`).send({ note: 'Ready' });

      const [resApprove, resReject] = await Promise.all([
        api('leadA', 'post', `/${task._id}/approve`).send({ note: 'Lead approves' }),
        api('hr', 'post', `/${task._id}/request-changes`).send({ reason: 'HR requests changes' }),
      ]);

      expect([resApprove.status, resReject.status].sort()).toEqual([200, 409]);

      const dbTask = await Task.findById(task._id).lean();
      expect(dbTask.review.rounds).toHaveLength(2);
      expect(['done', 'in_progress']).toContain(dbTask.status);

      const lockCount = await mongoose.connection.collection('task_write_locks').countDocuments();
      expect(lockCount).toBe(0);
    });
  });

  describe('5. Hierarchy (Parent/Child), Dependencies & Write Lock Rollback Compensation', () => {
    test('enforces single-level hierarchy, blocks dependency cycles (including concurrent inverse requests), and gates approval on incomplete dependencies/children', async () => {
      const parent = await createTaskDoc({
        title: 'Parent Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'in_progress',
      });
      const child = await createTaskDoc({
        title: 'Child Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'in_progress',
      });
      const grandChild = await createTaskDoc({
        title: 'Grandchild Candidate',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'in_progress',
      });
      const blocker = await createTaskDoc({
        title: 'Blocker Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'in_progress',
      });
      const otherTeamTask = await createTaskDoc({
        title: 'Other Team Task',
        teamId: org.teams.teamB._id,
        assignedBy: org.users.leadB._id,
        assignedTo: [org.users.outsider._id],
      });

      // Link child -> parent
      expect((await api('employee', 'post', `/${child._id}/parent`).send({ parentTaskId: String(parent._id) })).status).toBe(200);

      // Reject 2nd level hierarchy (grandChild -> child) and cycle (parent -> child) and cross-team parent
      expect((await api('employee', 'post', `/${grandChild._id}/parent`).send({ parentTaskId: String(child._id) })).status).toBe(400);
      expect((await api('employee', 'post', `/${parent._id}/parent`).send({ parentTaskId: String(child._id) })).status).toBe(400);
      expect((await api('hr', 'post', `/${child._id}/parent`).send({ parentTaskId: String(otherTeamTask._id) })).status).toBe(400);

      // Link child depends on blocker
      expect((await api('employee', 'post', `/${child._id}/dependencies`).send({ dependencyIds: [String(blocker._id)] })).status).toBe(200);
      // Reject direct dependency cycle (blocker -> child)
      expect((await api('employee', 'post', `/${blocker._id}/dependencies`).send({ dependencyIds: [String(child._id)] })).status).toBe(400);

      // Concurrent inverse dependencies on two fresh tasks cannot commit a cycle
      const raceA = await createTaskDoc({ title: 'Race A', teamId: org.teams.teamA._id, assignedBy: org.users.leadA._id, assignedTo: [org.users.employee._id] });
      const raceB = await createTaskDoc({ title: 'Race B', teamId: org.teams.teamA._id, assignedBy: org.users.leadA._id, assignedTo: [org.users.employee._id] });
      await Promise.all([
        api('employee', 'post', `/${raceA._id}/dependencies`).send({ dependencyIds: [String(raceB._id)] }),
        api('employee', 'post', `/${raceB._id}/dependencies`).send({ dependencyIds: [String(raceA._id)] }),
      ]);
      const [dbRaceA, dbRaceB] = await Promise.all([Task.findById(raceA._id).lean(), Task.findById(raceB._id).lean()]);
      expect(Boolean(dbRaceA.dependencies.length && dbRaceB.dependencies.length)).toBe(false);

      // Parent cannot be approved while child is incomplete
      await api('employee', 'post', `/${parent._id}/submit`).send({});
      expect((await api('leadA', 'post', `/${parent._id}/approve`).send({})).status).toBe(400);

      // Child can be submitted, but cannot be approved while blocker dependency is incomplete
      await api('employee', 'post', `/${child._id}/submit`).send({});
      expect((await api('leadA', 'post', `/${child._id}/approve`).send({})).status).toBe(400);

      // Complete blocker -> approve child -> approve parent
      await api('employee', 'post', `/${blocker._id}/submit`).send({});
      expect((await api('leadA', 'post', `/${blocker._id}/approve`).send({})).status).toBe(200);
      expect((await api('leadA', 'post', `/${child._id}/approve`).send({})).status).toBe(200);
      expect((await api('leadA', 'post', `/${parent._id}/approve`).send({})).status).toBe(200);

      expect((await Task.findById(parent._id).lean()).status).toBe('done');
    });

    test('write lock journalTaskSave rolls back child changes if a downstream operation fails mid-transaction', async () => {
      const parent = await createTaskDoc({
        title: 'Rollback Parent',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'todo',
      });
      const child = await createTaskDoc({
        title: 'Rollback Child',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        status: 'in_progress',
      });

      // Link child -> parent while both are valid
      expect((await api('employee', 'post', `/${child._id}/parent`).send({ parentTaskId: String(parent._id) })).status).toBe(200);
      // Submit child for review
      expect((await api('employee', 'post', `/${child._id}/submit`).send({ note: 'Ready for approve' })).status).toBe(200);

      // Corrupt parent document in MongoDB (remove required 'title') so parent.save() inside post('save') -> syncParentTask throws ValidationError AFTER child.save()
      await Task.collection.updateOne({ _id: parent._id }, { $unset: { title: 1 } });

      const beforeChild = await Task.collection.findOne({ _id: child._id });
      expect(beforeChild.status).toBe('in_review');

      // Approve child: child transitions in_review -> done and saves, then post('save') calls syncParentTask which tries to transition parent todo -> in_progress and fails validation!
      const failedRes = await api('leadA', 'post', `/${child._id}/approve`).send({ note: 'Should rollback' });
      expect([400, 500]).toContain(failedRes.status);

      // Verify child document was rolled back to its exact before-image ('in_review') and lock was released
      const afterChild = await Task.collection.findOne({ _id: child._id });
      expect(afterChild.status).toBe('in_review');
      expect(afterChild.completedAt).toBeNull();
      expect(afterChild.statusHistory).toEqual(beforeChild.statusHistory);
      expect(afterChild.review.rounds).toEqual(beforeChild.review.rounds);
      expect(await mongoose.connection.collection('task_write_locks').countDocuments()).toBe(0);
    });
  });

  describe('6. Queries: List Filters, Board, Calendar, Timeline & Pending Approval Queue', () => {
    test('enforces role scopes and filters across /my, /board, /calendar, /timeline, and /pending-approval on real MongoDB documents', async () => {
      const task1 = await createTaskDoc({
        title: 'Alpha Early Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        priority: 'high',
        tags: ['release', 'v1'],
        startDate: new Date('2026-11-05T00:00:00.000Z'),
        dueDate: new Date('2026-11-10T12:00:00.000Z'),
        status: 'todo',
      });
      const task2 = await createTaskDoc({
        title: 'Beta Later Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        priority: 'low',
        tags: ['release'],
        startDate: new Date('2026-11-12T00:00:00.000Z'),
        dueDate: new Date('2026-11-20T12:00:00.000Z'),
        status: 'in_progress',
      });
      await createTaskDoc({
        title: 'Undated Task',
        teamId: org.teams.teamA._id,
        assignedBy: org.users.leadA._id,
        assignedTo: [org.users.employee._id],
        priority: 'medium',
        tags: ['backlog'],
        startDate: null,
        dueDate: null,
        status: 'todo',
      });

      // 1. GET /api/tasks/my with tags (AND semantics) and priority sort
      const myTagFiltered = await api('employee', 'get', '/my?tags=release,v1');
      expect(myTagFiltered.status).toBe(200);
      expect(myTagFiltered.body.total).toBe(1);
      expect(myTagFiltered.body.data[0]._id).toBe(String(task1._id));

      // 2. GET /api/tasks/board sorts dueDate ascending with null dueDate last
      expect((await api('employee', 'get', '/board')).status).toBe(403);
      const boardRes = await api('leadA', 'get', `/board?teamId=${org.teams.teamA._id}`);
      expect(boardRes.status).toBe(200);
      expect(boardRes.body.data.todo.map((t) => t.title)).toEqual(['Alpha Early Task', 'Undated Task']);

      // 3. GET /api/tasks/calendar and /timeline enforce date range & scope permissions
      expect((await api('employee', 'get', '/calendar?from=2026-11-01&to=2026-11-30&scope=team')).status).toBe(403);
      const calSelf = await api('employee', 'get', '/calendar?from=2026-11-01&to=2026-11-30');
      expect(calSelf.status).toBe(200);
      expect(calSelf.body.count).toBe(2);

      const timelineHr = await api('hr', 'get', '/timeline?from=2026-11-01&to=2026-11-30&scope=team');
      expect(timelineHr.status).toBe(200);
      expect(timelineHr.body.count).toBe(2);

      // 4. Submit task2 and check /api/tasks/pending-approval & /pending-approval/stats
      await api('employee', 'post', `/${task2._id}/submit`).send({ note: 'Check queue' });

      expect((await api('employee', 'get', '/pending-approval')).status).toBe(403);
      const queueLeadA = await api('leadA', 'get', '/pending-approval');
      expect(queueLeadA.status).toBe(200);
      expect(queueLeadA.body.total).toBe(1);
      expect(queueLeadA.body.data[0]._id).toBe(String(task2._id));

      const queueStats = await api('hr', 'get', '/pending-approval/stats');
      expect(queueStats.status).toBe(200);
      expect(queueStats.body.data.pending).toBe(1);
      expect(queueStats.body.data.byTeam[0]).toMatchObject({
        teamId: String(org.teams.teamA._id),
        teamName: 'Alpha Team',
        pending: 1,
      });
    });
  });
});
