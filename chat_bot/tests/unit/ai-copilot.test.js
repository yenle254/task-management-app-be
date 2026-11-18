const {
  extractActionIntent,
  buildLocalAssistantReply,
  buildLocalTaskBreakdown,
  buildLocalTaskSummary
} = require('../../services/ai-assistant.service');
const {
  fuzzyMatchEntity,
  resolveContextualEntity,
  safeParseJSON
} = require('../../utils/vietnamese-nlp.utils');

describe('AI HR & Task Copilot v2 (server/chat_bot)', () => {
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
      blockedCount: 1,
      inProgressCount: 1,
      todoCount: 1,
      inReviewCount: 0,
      topPriorityTasks: [
        {
          _id: '671f00000000000000000010',
          title: 'Thiết kế Database',
          status: 'in_progress',
          priority: 'high',
          difficulty: 'hard',
          dueDate: '2026-11-08',
          isOverdue: false,
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
          isBlocked: true,
          blockedByTitles: ['Thiết kế Database'],
          progress: 0,
          actualMinutes: 0,
          estimatedMinutes: 180,
          subTasksSummary: '0/3',
          pendingSubTaskTitles: ['Cấu hình Webhook', 'Xử lý chữ ký bảo mật']
        }
      ]
    },
    pendingApprovals: null,
    teamWorkloadAdvisor: null
  };

  test('1. AI Task Breakdown generates subtasks, checklist, difficulty, and estimate', () => {
    const breakdown = buildLocalTaskBreakdown({
      title: 'Xây dựng API Quản lý Chấm công và Database Schema',
      description: 'Tối ưu kiến trúc MongoDB và phân quyền RBAC'
    });

    expect(['easy', 'medium', 'hard']).toContain(breakdown.difficulty);
    expect(breakdown.estimatedMinutes).toBeGreaterThan(0);
    expect(breakdown.storyPoints).toBeGreaterThan(0);
    expect(breakdown.subTasks.length).toBeGreaterThanOrEqual(4);
    expect(breakdown.checklist.items.length).toBeGreaterThanOrEqual(3);
  });

  test('2. AI Task Summary summarizes blockers, statusHistory, and next steps', () => {
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
    expect(summary.blockers[0]).toContain('Thiết kế Database');
    expect(summary.recentActivitySummary).toContain('Trần Trưởng Nhóm');
    expect(summary.nextSteps.length).toBeGreaterThan(0);
  });

  test('3. Personal HR & Task queries return accurate real-time data from context', () => {
    const leaveRes = buildLocalAssistantReply('Năm nay tôi còn bao nhiêu ngày phép?', sampleEmployeeContext);
    expect(leaveRes.reply).toContain('9 ngày');
    expect(leaveRes.reply).toContain('pending_team_lead');

    const attRes = buildLocalAssistantReply('Tháng này tôi đi làm đủ công chưa, có đi muộn ngày nào không?', sampleEmployeeContext);
    expect(attRes.reply).toContain('2026-11-03');
    expect(attRes.reply).toContain('36.5 giờ');

    const gpsRes = buildLocalAssistantReply('Quy định chấm công GPS của văn phòng tôi là gì?', sampleEmployeeContext);
    expect(gpsRes.reply).toContain('150 mét');
    expect(gpsRes.reply).toContain('123 Nguyễn Huệ');

    const taskRes = buildLocalAssistantReply('Hôm nay tôi cần ưu tiên làm task nào trước?', sampleEmployeeContext);
    expect(taskRes.reply).toContain('Thiết kế Database');
    expect(taskRes.reply).toContain('Tích hợp API Thanh toán');
  });

  test('4. Smart Workload Advisor prioritizes proven high-completion performers over 0% unproven members', () => {
    const leadContext = {
      ...sampleEmployeeContext,
      user: { ...sampleEmployeeContext.user, role: 'team_lead' },
      pendingApprovals: {
        pendingLeaveCount: 1,
        pendingLeaves: [
          {
            _id: 'lv1',
            employeeName: 'Lê Nghỉ Phép',
            type: 'personal',
            startDate: '2026-11-06',
            endDate: '2026-11-07',
            numberOfDays: 2,
            status: 'pending_team_lead',
            reason: 'Việc riêng'
          }
        ],
        tasksInReviewCount: 1,
        tasksInReview: [
          {
            _id: 't99',
            title: 'Tối ưu Index MongoDB',
            priority: 'high',
            dueDate: '2026-11-07',
            assignees: ['Phạm Hiệu Suất Cao']
          }
        ]
      },
      teamWorkloadAdvisor: {
        teamId: 'team1',
        teamName: 'Core Engineering',
        totalMembers: 3,
        membersOnLeaveNext2Days: [
          {
            userId: 'u2',
            userName: 'Lê Nghỉ Phép',
            upcomingLeaves: [{ startDate: '2026-11-06', endDate: '2026-11-07' }]
          }
        ],
        provenRecommendees: [
          {
            userId: 'u3',
            userName: 'Phạm Hiệu Suất Cao',
            isUnproven: false,
            completedTasks: 9,
            completedHardTasks: 3,
            totalTasks: 10,
            inProgressTasks: 1,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 96,
            completionRate: 90
          }
        ],
        unprovenAvailable: [
          {
            userId: 'u4',
            userName: 'Trần Mới Vào (0%)',
            isUnproven: true,
            completedTasks: 0,
            totalTasks: 0,
            inProgressTasks: 0,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 0,
            completionRate: 0
          }
        ],
        recommendedAssignees: [
          {
            userId: 'u3',
            userName: 'Phạm Hiệu Suất Cao',
            isUnproven: false,
            completedTasks: 9,
            totalTasks: 10,
            inProgressTasks: 1,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 96,
            completionRate: 90
          },
          {
            userId: 'u4',
            userName: 'Trần Mới Vào (0%)',
            isUnproven: true,
            completedTasks: 0,
            totalTasks: 0,
            inProgressTasks: 0,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 0,
            completionRate: 0
          }
        ],
        allMembersWorkload: [
          {
            userId: 'u3',
            userName: 'Phạm Hiệu Suất Cao',
            isUnproven: false,
            completedTasks: 9,
            totalTasks: 10,
            inProgressTasks: 1,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 96,
            completionRate: 90,
            hasApprovedLeaveNext2Days: false
          },
          {
            userId: 'u4',
            userName: 'Trần Mới Vào (0%)',
            isUnproven: true,
            completedTasks: 0,
            totalTasks: 0,
            inProgressTasks: 0,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 0,
            completionRate: 0,
            hasApprovedLeaveNext2Days: false
          },
          {
            userId: 'u2',
            userName: 'Lê Nghỉ Phép',
            isUnproven: false,
            completedTasks: 4,
            totalTasks: 5,
            inProgressTasks: 1,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 85,
            completionRate: 80,
            hasApprovedLeaveNext2Days: true
          }
        ]
      }
    };

    const advisorRes = buildLocalAssistantReply(
      'Tôi có một task độ khó Hard cần làm gấp trong 2 ngày tới, nên giao cho ai trong team?',
      leadContext
    );
    expect(advisorRes.reply).toContain('Phạm Hiệu Suất Cao');
    expect(advisorRes.reply).toContain('90%');
    expect(advisorRes.reply).toContain('96%');
    expect(advisorRes.reply).toContain('Trần Mới Vào (0%)');
    expect(advisorRes.reply).toContain('Không ưu tiên giao việc Gấp/Hard');
    expect(advisorRes.proposedAction?.type).toBe('CREATE_TASK_DRAFT');
    expect(advisorRes.proposedAction?.payload?.assigneeId).toBe('u3');

    const approvalRes = buildLocalAssistantReply(
      'Hiện tại có đơn nghỉ phép hay task nào đang chờ tôi duyệt không?',
      leadContext
    );
    expect(approvalRes.reply).toContain('Tối ưu Index MongoDB');
    expect(approvalRes.reply).toContain('Lê Nghỉ Phép');
  });

  test('5. Chat-to-Action & Multi-turn Coreference + Fuzzy Matching work accurately', () => {
    // Abbreviated & diacritic-free fuzzy match: "task thiet ke db" -> "Thiết kế Database"
    const fuzzyLog = extractActionIntent(
      'Log giup toi 45 phut cho task thiet ke db voi ghi chu: hoàn thành bảng Audit',
      sampleEmployeeContext
    );
    expect(fuzzyLog).toBeTruthy();
    expect(fuzzyLog.type).toBe('LOG_TIME');
    expect(fuzzyLog.payload.taskId).toBe('671f00000000000000000010');
    expect(fuzzyLog.payload.minutes).toBe(45);

    // Multi-turn coreference: previous turn discussed "Tích hợp API Thanh toán"
    const history = [
      { role: 'user', content: 'Kiểm tra task Tích hợp API Thanh toán' },
      { role: 'assistant', content: 'Task Tích hợp API Thanh toán hiện đang ở trạng thái todo...' }
    ];
    const corefReply = buildLocalAssistantReply(
      'Task đó còn những subtask nào chưa xong?',
      sampleEmployeeContext,
      history
    );
    expect(corefReply.reply).toContain('Tích hợp API Thanh toán');
    expect(corefReply.reply).toContain('Cấu hình Webhook');

    // Compound multi-intent question (Priority tasks + Leave balance in a single question)
    const compoundReply = buildLocalAssistantReply(
      'Hôm nay tôi cần ưu tiên làm task nào và năm nay tôi còn bao nhiêu ngày phép?',
      sampleEmployeeContext
    );
    expect(compoundReply.reply).toContain('Thiết kế Database');
    expect(compoundReply.reply).toContain('9 ngày');

    // Truncated JSON repair
    const repaired = safeParseJSON('{"reply": "Xin chào bạn, đây là câu trả lời bị cắt ngang');
    expect(repaired).toEqual({ reply: 'Xin chào bạn, đây là câu trả lời bị cắt ngang' });
  });
});
