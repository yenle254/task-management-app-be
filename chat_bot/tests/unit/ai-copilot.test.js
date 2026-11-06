const {
  extractActionIntent,
  buildLocalAssistantReply,
  buildLocalTaskBreakdown,
  buildLocalTaskSummary
} = require('../../services/ai-assistant.service');

describe('AI HR & Task Copilot (server/chat_bot)', () => {
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
          progress: 50
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
          progress: 50
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
          progress: 0
        }
      ]
    },
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

  test('4. Smart Workload Advisor recommends available team members and excludes members on leave', () => {
    const leadContext = {
      ...sampleEmployeeContext,
      user: { ...sampleEmployeeContext.user, role: 'team_lead' },
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
        recommendedAssignees: [
          {
            userId: 'u3',
            userName: 'Phạm Rảnh Rỗi',
            inProgressTasks: 0,
            todoTasks: 1,
            overdueTasks: 0,
            onTimeRate: 96,
            completionRate: 92
          }
        ],
        allMembersWorkload: [
          {
            userId: 'u3',
            userName: 'Phạm Rảnh Rỗi',
            inProgressTasks: 0,
            todoTasks: 1,
            overdueTasks: 0,
            onTimeRate: 96,
            hasApprovedLeaveNext2Days: false
          },
          {
            userId: 'u2',
            userName: 'Lê Nghỉ Phép',
            inProgressTasks: 1,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 85,
            hasApprovedLeaveNext2Days: true
          }
        ]
      }
    };

    const advisorRes = buildLocalAssistantReply(
      'Tôi có một task độ khó Hard cần làm gấp trong 2 ngày tới, nên giao cho ai trong team?',
      leadContext
    );
    expect(advisorRes.reply).toContain('Lê Nghỉ Phép');
    expect(advisorRes.reply).toContain('Phạm Rảnh Rỗi');
    expect(advisorRes.reply).toContain('96%');
    expect(advisorRes.proposedAction?.type).toBe('CREATE_TASK_DRAFT');
    expect(advisorRes.proposedAction?.payload?.assigneeId).toBe('u3');
  });

  test('5. Chat-to-Action extracts LOG_TIME and CREATE_LEAVE intents accurately', () => {
    const logIntent = extractActionIntent(
      'Log giúp tôi 60 phút làm việc cho task Thiết kế Database với ghi chú: hoàn thành bảng Audit',
      sampleEmployeeContext
    );
    expect(logIntent).toBeTruthy();
    expect(logIntent.type).toBe('LOG_TIME');
    expect(logIntent.payload.taskId).toBe('671f00000000000000000010');
    expect(logIntent.payload.minutes).toBe(60);
    expect(logIntent.payload.note).toBe('hoàn thành bảng Audit');

    const leaveIntent = extractActionIntent(
      'Tạo đơn xin nghỉ phép ngày mai vì lý do cá nhân',
      sampleEmployeeContext
    );
    expect(leaveIntent).toBeTruthy();
    expect(leaveIntent.type).toBe('CREATE_LEAVE');
    expect(leaveIntent.payload.type).toBe('personal');
    expect(leaveIntent.payload.startDate).toBe('2026-11-07');
    expect(leaveIntent.payload.endDate).toBe('2026-11-07');
  });
});

