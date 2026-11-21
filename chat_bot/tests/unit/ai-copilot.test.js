const {
  extractActionIntent,
  validateProposedActionAgainstContext,
  verifyNumericFidelity,
  buildLocalAssistantReply,
  buildLocalTaskBreakdown,
  buildLocalTaskSummary,
  streamReplyTokensToSocket
} = require('../../services/ai-assistant.service');
const {
  buildSingleTeamWorkload,
  clearAllContextCache,
  getContextCacheStats
} = require('../../services/ai-context.service');
const {
  predictIntents,
  retrieveFewShotExamples
} = require('../../services/ai-knowledge.service');
const {
  recordAssistantFeedback,
  getFeedbackRecords,
  clearConversationMemory
} = require('../../services/ai-conversation.service');
const {
  AI_TOOL_DECLARATIONS,
  executeCopilotTool,
  runToolsForIntent
} = require('../../services/ai-tools.service');
const {
  INTENT_DEFINITIONS,
  matchesIntentKeywords
} = require('../../utils/intent-keywords.config');
const { SUITABILITY_WEIGHTS } = require('../../config/ai.config');
const { safeParseJSON } = require('../../utils/vietnamese-nlp.utils');

describe('AI HR & Task Copilot v3 — Full Phase 0, Phase 1 & Phase 2 Verification', () => {
  beforeEach(() => {
    clearAllContextCache();
    clearConversationMemory();
  });

  const sampleEmployeeContext = {
    currentTimeISO: '2026-11-06T10:00:00.000Z',
    todayDate: '2026-11-06',
    tomorrowDate: '2026-11-07',
    user: {
      _id: '671f00000000000000000001',
      fullName: 'Nguyễn Văn A',
      email: 'nva@company.com',
      role: 'employee',
      teamName: 'Backend Team'
    },
    personalLeaves: {
      year: 2026,
      balance: { total: 12, used: 3, remaining: 9 },
      pendingCount: 1,
      pendingRequests: [
        {
          _id: '671f00000000000000000099',
          type: 'personal',
          startDate: '2026-11-10',
          endDate: '2026-11-10',
          numberOfDays: 1,
          status: 'pending_team_lead',
          reason: 'Việc gia đình'
        }
      ],
      approvedCount: 2,
      recentApproved: []
    },
    personalAttendance: {
      monthLabel: '11/2026',
      today: {
        clockIn: new Date('2026-11-06T08:50:00.000Z'),
        clockOut: null,
        status: 'present',
        workHours: null
      },
      monthStats: {
        totalDays: 5,
        presentDays: 4,
        lateDays: 1,
        absentDays: 0,
        totalWorkHours: 36.5,
        averageWorkHours: 7.3
      },
      lateDatesThisMonth: [
        { date: '2026-11-03', clockInTime: '09:18', workHours: 7.5 }
      ]
    },
    officePolicy: {
      name: 'Trụ sở chính Quận 1',
      address: '123 Nguyễn Huệ, Quận 1, TP.HCM',
      radiusMeters: 150,
      workingHours: { start: '09:00', end: '18:00' },
      coordinates: { lat: 10.7769, lng: 106.7009 }
    },
    personalTasks: {
      totalOpen: 2,
      completedCount: 6,
      completionRate: 75,
      onTimeRate: 100,
      overdueCount: 0,
      dueSoon48hCount: 1,
      blockedCount: 1,
      inProgressCount: 1,
      todoCount: 1,
      inReviewCount: 0,
      totalLoggedMinutes: 120,
      totalEstimatedMinutes: 420,
      overEstimateTasks: [],
      topPriorityTasks: [
        {
          _id: '671f00000000000000000010',
          title: 'Thiết kế Database',
          status: 'in_progress',
          priority: 'high',
          difficulty: 'hard',
          dueDate: '2026-11-08',
          isOverdue: false,
          isDueWithin48h: true,
          isBlocked: false,
          blockedByTitles: [],
          progress: 50,
          actualMinutes: 120,
          estimatedMinutes: 240,
          subTasksSummary: '2/4',
          pendingSubTaskTitles: ['Tạo bảng AuditLog', 'Đánh index tìm kiếm']
        }
      ],
      openTasksList: [
        {
          _id: '671f00000000000000000010',
          title: 'Thiết kế Database',
          status: 'in_progress',
          priority: 'high',
          difficulty: 'hard',
          dueDate: '2026-11-08',
          isOverdue: false,
          isDueWithin48h: true,
          isBlocked: false,
          blockedByTitles: [],
          progress: 50,
          actualMinutes: 120,
          estimatedMinutes: 240,
          subTasksSummary: '2/4',
          pendingSubTaskTitles: ['Tạo bảng AuditLog', 'Đánh index tìm kiếm']
        },
        {
          _id: '671f00000000000000000011',
          title: 'Tích hợp API Thanh toán',
          status: 'todo',
          priority: 'medium',
          difficulty: 'medium',
          dueDate: '2026-11-12',
          isOverdue: false,
          isDueWithin48h: false,
          isBlocked: true,
          blockedByTitles: ['Thiết kế Database'],
          progress: 0,
          actualMinutes: 0,
          estimatedMinutes: 180,
          subTasksSummary: '0/3',
          pendingSubTaskTitles: ['Cấu hình Webhook', 'Xử lý chữ ký bảo mật']
        }
      ],
      recentCompletedTitles: ['Cấu hình JWT Auth', 'Thiết lập CI/CD']
    },
    pendingApprovals: null,
    teamWorkloadAdvisor: null
  };

  test('1. [Phase 0.4] Prompt Injection & RBAC Action Allow-List Guard rejects foreign taskId or assigneeId', () => {
    // Untrusted LLM action pointing to a taskId NOT in user's openTasksList must be rejected!
    const forgedLogAction = {
      type: 'LOG_TIME',
      summary: 'Forged log time',
      payload: {
        taskId: '999999999999999999999999',
        taskTitle: 'Secret Admin Task',
        minutes: 60,
        note: 'injected'
      }
    };
    const filteredForged = validateProposedActionAgainstContext(
      forgedLogAction,
      null,
      sampleEmployeeContext
    );
    expect(filteredForged).toBeNull();

    // Valid taskId in user's openTasksList is allowed
    const validLogAction = {
      type: 'LOG_TIME',
      summary: 'Valid log time',
      payload: {
        taskId: '671f00000000000000000010',
        taskTitle: 'Thiết kế Database',
        minutes: 45,
        note: 'hoàn thành bảng Audit'
      }
    };
    const filteredValid = validateProposedActionAgainstContext(
      validLogAction,
      null,
      sampleEmployeeContext
    );
    expect(filteredValid).toBeTruthy();
    expect(filteredValid.payload.taskId).toBe('671f00000000000000000010');
  });

  test('2. [Phase 1.1] Unified Single-Config Intent Definitions cover all 20 intents with >=1 keyword', () => {
    expect(INTENT_DEFINITIONS.length).toBeGreaterThanOrEqual(20);
    for (const def of INTENT_DEFINITIONS) {
      expect(typeof def.intent).toBe('string');
      expect(Array.isArray(def.keywords)).toBe(true);
      expect(def.keywords.length).toBeGreaterThanOrEqual(1);
      expect(matchesIntentKeywords(def.keywords[0], def.intent)).toBe(true);
    }
  });

  test('3. [Phase 1.2] Numeric Fidelity Guardrail rejects LLM replies that hallucinate numbers', () => {
    const baseline = 'Số ngày phép còn lại của bạn là 9 ngày trên tổng 12 ngày.';
    const accurateParaphrase = 'Trong năm nay, tổng quỹ phép của bạn là 12 ngày và bạn hiện còn lại 9 ngày.';
    const hallucinatedReply = 'Trong năm nay, bạn còn lại 15 ngày phép trên tổng 20 ngày.';

    expect(verifyNumericFidelity(accurateParaphrase, baseline)).toBe(accurateParaphrase);
    expect(verifyNumericFidelity(hallucinatedReply, baseline)).toBe(baseline);
  });

  test('4. [Phase 1.3 & 1.4] Out-of-Domain Rejection & Calibrated Confidence + Margin work accurately', () => {
    const oodPreds = predictIntents('Tôi muốn đặt vé máy bay đi Đà Nẵng cuối tuần này', 2);
    expect(oodPreds[0].intent).toBe('out_of_domain');
    expect(oodPreds[0].isOutOfDomain).toBe(true);
    expect(typeof oodPreds[0].margin).toBe('number');
    expect(typeof oodPreds[0].isAmbiguous).toBe('boolean');

    const oodReply = buildLocalAssistantReply(
      'Giá vàng SJC hôm nay tăng hay giảm bao nhiêu?',
      sampleEmployeeContext
    );
    expect(oodReply.detectedIntent.intent).toBe('out_of_domain');
    expect(oodReply.reply).toContain('ngoài phạm vi công việc và nhân sự');
    expect(oodReply.reply).not.toContain('Thứ tự Ưu tiên Công việc');
  });

  test('5. [Phase 2.1] Configurable SUITABILITY_WEIGHTS regression & human-readable explanation', () => {
    const team = { _id: 'team_be', name: 'Backend Team', leaderId: 'lead_1' };
    const memberProgress = [
      {
        userId: 'emp_proven',
        userName: 'Phạm Hiệu Suất Cao',
        inProgressTasks: 1,
        todoTasks: 0,
        awaitingReviewTasks: 0,
        overdueTasks: 0,
        completedTasks: 9,
        totalTasks: 10,
        completionRate: 90,
        onTimeRate: 96,
        onTimeEligibleTasks: 9
      },
      {
        userId: 'emp_unproven',
        userName: 'Trần Mới Vào (0%)',
        inProgressTasks: 0,
        todoTasks: 0,
        awaitingReviewTasks: 0,
        overdueTasks: 0,
        completedTasks: 0,
        totalTasks: 0,
        completionRate: 0,
        onTimeRate: 0,
        onTimeEligibleTasks: 0
      }
    ];

    const wl = buildSingleTeamWorkload({
      team,
      memberProgress,
      tasksByMember: new Map(),
      leavesByMember: new Map(),
      callerUserId: 'lead_1',
      weights: SUITABILITY_WEIGHTS
    });

    expect(wl.provenRecommendees).toHaveLength(1);
    expect(wl.provenRecommendees[0].userId).toBe('emp_proven');
    expect(wl.provenRecommendees[0].suitabilityScore).toBe(176.9);
    expect(wl.provenRecommendees[0].explanation).toContain('Đề xuất vì hoàn thành 90%');
    expect(wl.unprovenAvailable[0].explanation).toContain('Chưa có lịch sử hoàn thành task');

    // Regression check: changing OVERDUE_PENALTY or IN_PROGRESS_PENALTY changes suitabilityScore deterministically
    const customWl = buildSingleTeamWorkload({
      team,
      memberProgress,
      tasksByMember: new Map(),
      leavesByMember: new Map(),
      callerUserId: 'lead_1',
      weights: { ...SUITABILITY_WEIGHTS, IN_PROGRESS_PENALTY: 25 }
    });
    expect(customWl.provenRecommendees[0].suitabilityScore).toBe(163.9);
  });

  test('6. [Phase 2.5 & Multi-Team] Multi-Team Smart Workload Advisor & Feedback Loop work end-to-end', () => {
    const fb = recordAssistantFeedback({
      userId: '671f00000000000000000001',
      message: 'Năm nay tôi còn bao nhiêu ngày phép?',
      predictedIntent: 'personal_leave_balance',
      rating: 'up',
      comment: 'Trả lời chính xác'
    });
    expect(fb.rating).toBe('up');
    expect(getFeedbackRecords().length).toBeGreaterThanOrEqual(1);

    const breakdown = buildLocalTaskBreakdown({
      title: 'Xây dựng API Quản lý Chấm công và Database Schema',
      description: 'Tối ưu kiến trúc MongoDB và phân quyền RBAC'
    });
    expect(breakdown.subTasks.length).toBeGreaterThanOrEqual(4);

    const summary = buildLocalTaskSummary({
      _id: '671f00000000000000000011',
      title: 'Tích hợp API Thanh toán',
      status: 'in_progress',
      priority: 'high',
      difficulty: 'hard',
      progress: 40,
      dueDate: '2026-11-12',
      isOverdue: false,
      estimatedMinutes: 240,
      actualMinutes: 90,
      assignees: ['Nguyễn Văn A'],
      subTasks: { total: 4, completed: 1, pendingTitles: ['Viết webhook xử lý giao dịch'] },
      checklists: [{ title: 'DoD', completedCount: 1, totalCount: 3, pendingItems: ['Unit test'] }],
      blockingDependencies: [{ _id: '1', title: 'Thiết kế Database', status: 'in_progress', dueDate: '2026-11-08' }],
      recentStatusHistory: [{ from: 'todo', to: 'in_progress', by: 'Nguyễn Văn A' }],
      recentReviewRounds: [],
      recentComments: [{ author: 'Trần Trưởng Nhóm', text: 'Chờ bảng Transaction xong nhé' }]
    });
    expect(summary.headline).toContain('Tích hợp API Thanh toán');
    expect(safeParseJSON('{"reply": "Test')).toEqual({ reply: 'Test' });
  });

  test('7. [Phase 2.4 & 2.2] RBAC-Verified Tool-Calling Dispatcher & Progressive Token Streaming work accurately', () => {
    expect(AI_TOOL_DECLARATIONS.length).toBeGreaterThanOrEqual(7);

    // Employee is denied access to manager tool get_team_workload
    const deniedTeamTool = executeCopilotTool(
      'get_team_workload',
      {},
      { _id: '671f00000000000000000001', role: 'employee' },
      sampleEmployeeContext
    );
    expect(deniedTeamTool.ok).toBe(false);
    expect(deniedTeamTool.error).toContain('RBAC_DENIED');

    // Employee can call get_personal_tasks and propose_log_time
    const personalTool = executeCopilotTool(
      'get_personal_tasks',
      { filter: 'priority' },
      { _id: '671f00000000000000000001', role: 'employee' },
      sampleEmployeeContext
    );
    expect(personalTool.ok).toBe(true);
    expect(personalTool.result.tasks[0].title).toBe('Thiết kế Database');

    const logTool = executeCopilotTool(
      'propose_log_time',
      { taskTitle: 'thiet ke db', minutes: 45, note: 'Tạo bảng AuditLog' },
      { _id: '671f00000000000000000001', role: 'employee' },
      sampleEmployeeContext
    );
    expect(logTool.ok).toBe(true);
    expect(logTool.result.proposedAction.type).toBe('LOG_TIME');
    expect(logTool.result.proposedAction.payload.minutes).toBe(45);

    const intentTools = runToolsForIntent(
      'action_log_time',
      'Log giúp tôi 30 phút cho task Thiết kế Database',
      { _id: '671f00000000000000000001', role: 'employee' },
      sampleEmployeeContext
    );
    expect(intentTools.length).toBeGreaterThanOrEqual(1);
    expect(intentTools[0].tool).toBe('propose_log_time');

    // Progressive token streaming emits multiple chunks with done: false followed by done: true
    const emittedFrames = [];
    const mockIo = {
      to: () => ({
        emit: (event, payload) => {
          emittedFrames.push({ event, payload });
        }
      })
    };

    const chunkCount = streamReplyTokensToSocket(
      mockIo,
      '671f00000000000000000001',
      'Một hai ba bốn năm sáu bảy tám chín mười một hai',
      { intent: 'personal_priority', confidence: 0.9 }
    );
    expect(chunkCount).toBe(3);
    expect(emittedFrames.length).toBe(4); // 3 chunks (done: false) + 1 final (done: true)
    expect(emittedFrames[0].event).toBe('ai_token');
    expect(emittedFrames[0].payload.done).toBe(false);
    expect(emittedFrames[0].payload.chunk).toContain('Một hai ba bốn năm');
    expect(emittedFrames[3].payload.done).toBe(true);
    expect(emittedFrames[3].payload.reply).toContain('Một hai ba bốn năm');
  });
});
