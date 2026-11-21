const request = require('supertest');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('../setup/mongo-env');
const { createTestApp } = require('../setup/test-app');
const { seedOrganization, createTaskDoc } = require('../setup/seed-helpers');
const {
  clearAllContextCache,
  getContextCacheStats
} = require('../../../chat_bot/services/ai-context.service');

describe('AI HR & Task Copilot Endpoints Integration Tests (/api/ai/*)', () => {
  let testEnv;
  let app;
  let org;

  beforeAll(async () => {
    process.env.AI_PROVIDER = 'local_only';
    await connectTestDB();
    testEnv = createTestApp();
    app = testEnv.app;
  });

  beforeEach(async () => {
    clearAllContextCache();
    await clearTestDB();
    testEnv.clearOutbox();
    org = await seedOrganization(app);
  });

  afterAll(async () => {
    delete process.env.ENABLE_AI_RATE_LIMIT_IN_TEST;
    delete process.env.AI_RATE_LIMIT_MAX;
    await disconnectTestDB();
  });

  const aiApi = (role, path) =>
    request(app)
      .post(`/api/ai${path}`)
      .set('Authorization', `Bearer ${org.tokens[role]}`);

  test('1. Unauthenticated requests to /api/ai/* are rejected with 401', async () => {
    const res = await request(app)
      .post('/api/ai/assistant')
      .send({ message: 'Hôm nay tôi cần làm task nào?' });
    expect(res.status).toBe(401);
  });

  test('2. Employee can query personal tasks & leave balance, and LRU cache serves consecutive requests within TTL', async () => {
    const createdTask = await createTaskDoc({
      title: 'Thiết kế Database Audit',
      teamId: org.teams.teamA._id,
      assignedBy: org.users.leadA._id,
      assignedTo: [org.users.employee._id],
      priority: 'high',
      difficulty: 'hard',
      status: 'in_progress'
    });

    const firstRes = await aiApi('employee', '/assistant').send({
      message: 'Hôm nay tôi cần ưu tiên làm task nào trước?'
    });
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.success).toBe(true);
    expect(firstRes.body.data.reply).toContain('Thiết kế Database Audit');
    expect(getContextCacheStats().misses).toBe(1);

    // Second consecutive call hits per-user LRU context cache (Phase 0.2)
    const secondRes = await aiApi('employee', '/assistant').send({
      message: 'Năm nay tôi còn bao nhiêu ngày phép?'
    });
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data.reply).toContain('12 ngày');
    expect(getContextCacheStats().hits).toBe(1);
    expect(getContextCacheStats().size).toBe(1);

    // Mutating task time-entries automatically invalidates the AI context cache
    const logTimeRes = await request(app)
      .post(`/api/tasks/${createdTask._id}/time-entries`)
      .set('Authorization', `Bearer ${org.tokens.employee}`)
      .send({ minutes: 30, note: 'Cập nhật schema' });
    expect(logTimeRes.status).toBe(201);
    expect(getContextCacheStats().size).toBe(0);
  });

  test('3. HR Manager Multi-Team Workload Advisor analyzes all teams and excludes 0% unproven members from #1 recommendation', async () => {
    // Employee One in Alpha Team completes 1 task via reviewApproved hook -> Proven performer (100% completion)
    const doc = await createTaskDoc({
      title: 'Completed Alpha Task 1',
      teamId: org.teams.teamA._id,
      assignedBy: org.users.leadA._id,
      assignedTo: [org.users.employee._id],
      status: 'in_review',
      difficulty: 'hard'
    });
    doc.$locals.reviewApproved = true;
    doc.status = 'done';
    await doc.save();

    const res = await aiApi('hr', '/assistant').send({
      message: 'Tôi có một task độ khó Hard cần làm gấp trong 2 ngày tới, nên giao cho ai?',
      forceRefresh: true
    });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain('Alpha Team');
    expect(res.body.data.reply).toContain('Beta Team');
    expect(res.body.data.reply).toContain('Employee One');
    expect(res.body.data.contextSummary.managedTeamsCount).toBe(2);
    expect(res.body.data.proposedAction?.type).toBe('CREATE_TASK_DRAFT');
    expect(res.body.data.proposedAction?.payload?.assigneeId).toBe(
      String(org.users.employee._id)
    );
  });

  test('4. RBAC enforcement on /api/ai/task-breakdown and /api/ai/task-summary/:taskId', async () => {
    // Employee cannot call /task-breakdown (403)
    const empBreakdown = await aiApi('employee', '/task-breakdown').send({
      title: 'Xây dựng API Quản lý Nghỉ phép'
    });
    expect(empBreakdown.status).toBe(403);

    // Team Lead can call /task-breakdown (200)
    const leadBreakdown = await aiApi('leadA', '/task-breakdown').send({
      title: 'Xây dựng API Quản lý Nghỉ phép',
      description: 'Duyệt 2 cấp Team Lead và HR'
    });
    expect(leadBreakdown.status).toBe(200);
    expect(leadBreakdown.body.data.subTasks.length).toBeGreaterThanOrEqual(4);

    // Create task in Alpha Team
    const alphaTask = await createTaskDoc({
      title: 'Alpha Confidential Task',
      teamId: org.teams.teamA._id,
      assignedBy: org.users.leadA._id,
      assignedTo: [org.users.employee._id]
    });

    // Outsider in Beta Team cannot summarize Alpha Team's task (403)
    const outsiderSummary = await aiApi(
      'outsider',
      `/task-summary/${alphaTask._id}`
    ).send({});
    expect(outsiderSummary.status).toBe(403);

    // Assignee in Alpha Team can summarize the task (200)
    const assigneeSummary = await aiApi(
      'employee',
      `/task-summary/${alphaTask._id}`
    ).send({});
    expect(assigneeSummary.status).toBe(200);
    expect(assigneeSummary.body.data.headline).toContain('Alpha Confidential Task');
  });

  test('5. Out-of-Domain query rejection, Feedback endpoint, and Per-User AI Rate Limiting (429)', async () => {
    const oodRes = await aiApi('employee', '/assistant').send({
      message: 'Tôi muốn đặt vé máy bay khứ hồi đi Phú Quốc tuần sau'
    });
    expect(oodRes.status).toBe(200);
    expect(oodRes.body.data.detectedIntent.intent).toBe('out_of_domain');

    const fbRes = await aiApi('employee', '/feedback').send({
      message: 'Năm nay tôi còn bao nhiêu ngày phép?',
      predictedIntent: 'personal_leave_balance',
      rating: 'up',
      comment: 'Chính xác'
    });
    expect(fbRes.status).toBe(201);

    // Enable per-user AI rate limit with max=2 for test verification (Phase 0.3)
    process.env.ENABLE_AI_RATE_LIMIT_IN_TEST = 'true';
    process.env.AI_RATE_LIMIT_MAX = '2';

    const r1 = await aiApi('peer', '/assistant').send({ message: 'Năm nay tôi còn bao nhiêu ngày phép?' });
    const r2 = await aiApi('peer', '/assistant').send({ message: 'Năm nay tôi còn bao nhiêu ngày phép?' });
    const r3 = await aiApi('peer', '/assistant').send({ message: 'Năm nay tôi còn bao nhiêu ngày phép?' });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body.success).toBe(false);
  });
});
