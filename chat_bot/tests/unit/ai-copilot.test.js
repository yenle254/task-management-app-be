const {
  extractActionIntent,
  buildLocalAssistantReply,
  buildLocalTaskBreakdown,
  buildLocalTaskSummary
} = require('../../services/ai-assistant.service');
const {
  predictIntents,
  retrieveFewShotExamples
} = require('../../services/ai-knowledge.service');
const {
  safeParseJSON
} = require('../../utils/vietnamese-nlp.utils');

describe('AI HR & Task Copilot v3 (Multi-Team + Trained ML Classifier + 16 Contexts)', () => {
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

  test('1. AI Task Breakdown & Task Summary work accurately', () => {
    const breakdown = buildLocalTaskBreakdown({
      title: 'Xây dựng API Quản lý Chấm công và Database Schema',
      description: 'Tối ưu kiến trúc MongoDB và phân quyền RBAC'
    });
    expect(['easy', 'medium', 'hard']).toContain(breakdown.difficulty);
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
    expect(summary.blockers[0]).toContain('Thiết kế Database');
  });

  test('2. Multi-Team Smart Workload Advisor recommends top performers across ALL managed teams', () => {
    const multiTeamManagerContext = {
      ...sampleEmployeeContext,
      user: { ...sampleEmployeeContext.user, role: 'hr_manager' },
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
            status: 'pending_hr',
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
            assignees: ['Phạm Backend Giỏi']
          }
        ]
      },
      teamWorkloadAdvisor: {
        teamId: 'team_be',
        teamName: 'Backend Team',
        managedTeamsCount: 2,
        managedTeamNames: ['Backend Team', 'Mobile Team'],
        totalMembers: 4,
        teamsWorkload: [
          {
            teamId: 'team_be',
            teamName: 'Backend Team',
            totalMembers: 2,
            teamMetrics: {
              totalTasks: 10,
              completedTasks: 9,
              activeTasks: 1,
              overdueTasks: 0,
              completionRate: 90,
              onTimeRate: 96
            },
            membersOnLeaveNext2Days: [],
            provenRecommendees: [
              {
                userId: 'u_be_1',
                userName: 'Phạm Backend Giỏi',
                teamId: 'team_be',
                teamName: 'Backend Team',
                isUnproven: false,
                completedTasks: 9,
                completedHardTasks: 3,
                totalTasks: 10,
                inProgressTasks: 1,
                todoTasks: 0,
                overdueTasks: 0,
                onTimeRate: 96,
                completionRate: 90,
                suitabilityScore: 155
              }
            ],
            unprovenAvailable: [
              {
                userId: 'u_be_0',
                userName: 'Trần Mới Vào (0%)',
                teamId: 'team_be',
                teamName: 'Backend Team',
                isUnproven: true,
                completedTasks: 0,
                totalTasks: 0,
                inProgressTasks: 0,
                todoTasks: 0,
                overdueTasks: 0,
                onTimeRate: 0,
                completionRate: 0,
                suitabilityScore: 0
              }
            ],
            allMembersWorkload: [
              {
                userId: 'u_be_1',
                userName: 'Phạm Backend Giỏi',
                teamId: 'team_be',
                teamName: 'Backend Team',
                isUnproven: false,
                completedTasks: 9,
                totalTasks: 10,
                inProgressTasks: 1,
                todoTasks: 0,
                overdueTasks: 0,
                onTimeRate: 96,
                completionRate: 90,
                hasApprovedLeaveNext2Days: false,
                upcomingLeaves: []
              }
            ]
          },
          {
            teamId: 'team_mob',
            teamName: 'Mobile Team',
            totalMembers: 2,
            teamMetrics: {
              totalTasks: 12,
              completedTasks: 11,
              activeTasks: 0,
              overdueTasks: 0,
              completionRate: 92,
              onTimeRate: 100
            },
            membersOnLeaveNext2Days: [],
            provenRecommendees: [
              {
                userId: 'u_mob_1',
                userName: 'Hoàng Mobile Xuất Sắc',
                teamId: 'team_mob',
                teamName: 'Mobile Team',
                isUnproven: false,
                completedTasks: 11,
                completedHardTasks: 4,
                totalTasks: 12,
                inProgressTasks: 0,
                todoTasks: 0,
                overdueTasks: 0,
                onTimeRate: 100,
                completionRate: 92,
                suitabilityScore: 185
              }
            ],
            unprovenAvailable: [],
            allMembersWorkload: [
              {
                userId: 'u_mob_1',
                userName: 'Hoàng Mobile Xuất Sắc',
                teamId: 'team_mob',
                teamName: 'Mobile Team',
                isUnproven: false,
                completedTasks: 11,
                totalTasks: 12,
                inProgressTasks: 0,
                todoTasks: 0,
                overdueTasks: 0,
                onTimeRate: 100,
                completionRate: 92,
                hasApprovedLeaveNext2Days: false,
                upcomingLeaves: []
              }
            ]
          }
        ],
        crossTeamProvenRecommendees: [
          {
            userId: 'u_mob_1',
            userName: 'Hoàng Mobile Xuất Sắc',
            teamId: 'team_mob',
            teamName: 'Mobile Team',
            isUnproven: false,
            completedTasks: 11,
            totalTasks: 12,
            inProgressTasks: 0,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 100,
            completionRate: 92,
            suitabilityScore: 185
          },
          {
            userId: 'u_be_1',
            userName: 'Phạm Backend Giỏi',
            teamId: 'team_be',
            teamName: 'Backend Team',
            isUnproven: false,
            completedTasks: 9,
            totalTasks: 10,
            inProgressTasks: 1,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 96,
            completionRate: 90,
            suitabilityScore: 155
          }
        ],
        allMembersWorkload: [
          {
            userId: 'u_mob_1',
            userName: 'Hoàng Mobile Xuất Sắc',
            teamId: 'team_mob',
            teamName: 'Mobile Team',
            isUnproven: false,
            completedTasks: 11,
            totalTasks: 12,
            inProgressTasks: 0,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 100,
            completionRate: 92,
            hasApprovedLeaveNext2Days: false,
            upcomingLeaves: []
          },
          {
            userId: 'u_be_1',
            userName: 'Phạm Backend Giỏi',
            teamId: 'team_be',
            teamName: 'Backend Team',
            isUnproven: false,
            completedTasks: 9,
            totalTasks: 10,
            inProgressTasks: 1,
            todoTasks: 0,
            overdueTasks: 0,
            onTimeRate: 96,
            completionRate: 90,
            hasApprovedLeaveNext2Days: false,
            upcomingLeaves: []
          }
        ]
      }
    };

    // A. General urgent task question -> must list top performer of BOTH Backend Team and Mobile Team!
    const multiTeamReply = buildLocalAssistantReply(
      'Tôi có một task độ khó Hard cần làm gấp trong 2 ngày tới, nên giao cho ai?',
      multiTeamManagerContext
    );
    expect(multiTeamReply.reply).toContain('Backend Team');
    expect(multiTeamReply.reply).toContain('Phạm Backend Giỏi');
    expect(multiTeamReply.reply).toContain('Mobile Team');
    expect(multiTeamReply.reply).toContain('Hoàng Mobile Xuất Sắc');
    expect(multiTeamReply.reply).toContain('Trần Mới Vào (0%)');
    expect(multiTeamReply.proposedAction?.payload?.assigneeId).toBe('u_mob_1');

    // B. Single team targeted question -> filters specifically for Backend Team
    const singleTeamReply = buildLocalAssistantReply(
      'Trong team Backend nên giao task gấp cho ai?',
      multiTeamManagerContext
    );
    expect(singleTeamReply.reply).toContain('Team Backend Team');
    expect(singleTeamReply.reply).toContain('Phạm Backend Giỏi');
    expect(singleTeamReply.proposedAction?.payload?.assigneeId).toBe('u_be_1');

    // C. Cross-team comparison question
    const compareReply = buildLocalAssistantReply(
      'So sánh hiệu suất làm việc giữa các team trong công ty',
      multiTeamManagerContext
    );
    expect(compareReply.reply).toContain('Bảng Xếp hạng & So sánh Hiệu suất giữa các Team');
    expect(compareReply.reply).toContain('Mobile Team');
    expect(compareReply.reply).toContain('Backend Team');

    // D. Employee 360 lookup
    const emp360Reply = buildLocalAssistantReply(
      'Cho tôi xem hiệu suất và công việc hiện tại của nhân viên Phạm Backend Giỏi',
      multiTeamManagerContext
    );
    expect(emp360Reply.reply).toContain('Hồ sơ Hiệu suất 360° Nhân sự: Phạm Backend Giỏi');
    expect(emp360Reply.reply).toContain('96%');
  });

  test('3. Trained ML Intent Classifier, Few-Shot RAG, SOP Guide & Daily Briefing work accurately', () => {
    const preds = predictIntents('Tại sao tôi không thể chuyển trực tiếp trạng thái task sang Done?', 2);
    expect(preds[0].intent).toBe('system_sop_guide');

    const rag = retrieveFewShotExamples('Quy trình duyệt nghỉ phép 2 cấp hoạt động thế nào?', 2);
    expect(rag.length).toBeGreaterThan(0);

    const sopReply = buildLocalAssistantReply(
      'Tại sao tôi không thể chuyển trực tiếp trạng thái task sang Done?',
      sampleEmployeeContext
    );
    expect(sopReply.reply).toContain('Submit for Review');
    expect(sopReply.reply).toContain('in_review');

    const briefingReply = buildLocalAssistantReply(
      'Tóm tắt nhanh tình hình công việc và nhân sự hôm nay cho tôi',
      sampleEmployeeContext
    );
    expect(briefingReply.reply).toContain('Daily Briefing');
    expect(briefingReply.reply).toContain('Thiết kế Database');
  });

  test('4. Chat-to-Action, Fuzzy Matching, Multi-turn Coreference & JSON Repair work accurately', () => {
    const fuzzyLog = extractActionIntent(
      'Log giup toi 45 phut cho task thiet ke db voi ghi chu: hoàn thành bảng Audit',
      sampleEmployeeContext
    );
    expect(fuzzyLog).toBeTruthy();
    expect(fuzzyLog.type).toBe('LOG_TIME');
    expect(fuzzyLog.payload.taskId).toBe('671f00000000000000000010');

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

    const repaired = safeParseJSON('{"reply": "Xin chào bạn, đây là câu trả lời bị cắt ngang');
    expect(repaired).toEqual({ reply: 'Xin chào bạn, đây là câu trả lời bị cắt ngang' });
  });
});
