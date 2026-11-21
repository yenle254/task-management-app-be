/**
 * RBAC-Verified Tool-Calling Service for AI HR & Task Copilot (Phase 2.4)
 * Allows LLMs (Gemini functionDeclarations / Ollama tools) or deterministic dispatchers
 * to invoke controlled, RBAC-scoped tools instead of reading raw untrusted database dumps.
 */
const { USER_ROLES } = require('../../utils/constants.utils');
const { fuzzyMatchEntity } = require('../utils/vietnamese-nlp.utils');

const AI_TOOL_DECLARATIONS = [
  {
    name: 'get_personal_tasks',
    description: 'Lấy danh sách công việc cá nhân đang mở, quá hạn, bị chặn hoặc đã hoàn thành của người dùng hiện tại.',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['all', 'priority', 'overdue', 'blocked', 'time_variance'],
          description: 'Bộ lọc danh sách task cần truy vấn'
        }
      }
    }
  },
  {
    name: 'get_leave_and_attendance',
    description: 'Lấy quỹ ngày phép năm, danh sách đơn chờ duyệt và thống kê chấm công tháng của người dùng hiện tại.',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['both', 'leaves', 'attendance'],
          description: 'Phần thông tin nhân sự cần lấy'
        }
      }
    }
  },
  {
    name: 'get_office_gps_policy',
    description: 'Lấy quy định chấm công GPS, địa chỉ, bán kính cho phép và giờ làm việc của văn phòng.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_team_workload',
    description: 'Phân tích tải công việc, lịch nghỉ phép và đề xuất nhân sự hiệu suất cao nhất (chỉ dành cho Team Lead và HR Manager).',
    parameters: {
      type: 'object',
      properties: {
        teamName: {
          type: 'string',
          description: 'Tên Team cụ thể cần phân tích (để trống nếu muốn phân tích tất cả các Team đang quản lý)'
        }
      }
    }
  },
  {
    name: 'get_manager_approvals',
    description: 'Kiểm tra hộp thư đơn nghỉ phép và công việc in_review đang chờ quản lý phê duyệt (Team Lead / HR Manager).',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'propose_log_time',
    description: 'Chuẩn bị lệnh ghi nhận thời gian làm việc (Log Time) cho một công việc thuộc quyền của người dùng.',
    parameters: {
      type: 'object',
      properties: {
        taskTitle: { type: 'string', description: 'Tên công việc cần log giờ' },
        minutes: { type: 'number', description: 'Số phút làm việc (1-1440)' },
        note: { type: 'string', description: 'Ghi chú nội dung đã thực hiện' }
      },
      required: ['minutes']
    }
  },
  {
    name: 'propose_create_leave',
    description: 'Chuẩn bị lệnh tạo đơn xin nghỉ phép cho người dùng hiện tại.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['personal', 'sick', 'vacation'] },
        startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD' },
        endDate: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD' },
        reason: { type: 'string', description: 'Lý do xin nghỉ phép' }
      },
      required: ['startDate', 'endDate']
    }
  }
];

/**
 * Convert tool declarations into Ollama `tools` array format
 */
const OLLAMA_TOOLS = AI_TOOL_DECLARATIONS.map((decl) => ({
  type: 'function',
  function: decl
}));

/**
 * Execute an AI tool call with strict RBAC enforcement against the authenticated user's context
 * @param {string} toolName
 * @param {Object} args
 * @param {Object} user - req.user
 * @param {Object} context - RBAC-built context
 * @returns {{ ok: boolean, tool: string, error?: string, result?: Object }}
 */
const executeCopilotTool = (toolName, args = {}, user, context) => {
  const isManager = [USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER].includes(user?.role);

  switch (toolName) {
    case 'get_personal_tasks': {
      const pt = context.personalTasks;
      const filter = args.filter || 'all';
      let tasks = pt.openTasksList || [];
      if (filter === 'priority') tasks = pt.topPriorityTasks || [];
      else if (filter === 'overdue') tasks = tasks.filter((t) => t.isOverdue || t.isDueWithin48h);
      else if (filter === 'blocked') tasks = tasks.filter((t) => t.isBlocked);

      return {
        ok: true,
        tool: toolName,
        result: {
          totalOpen: pt.totalOpen,
          completedCount: pt.completedCount,
          completionRate: pt.completionRate,
          onTimeRate: pt.onTimeRate,
          overdueCount: pt.overdueCount,
          blockedCount: pt.blockedCount,
          totalLoggedMinutes: pt.totalLoggedMinutes,
          overEstimateTasks: pt.overEstimateTasks,
          tasks: tasks.slice(0, 8)
        }
      };
    }

    case 'get_leave_and_attendance': {
      return {
        ok: true,
        tool: toolName,
        result: {
          leaves: context.personalLeaves,
          attendance: context.personalAttendance
        }
      };
    }

    case 'get_office_gps_policy': {
      return {
        ok: true,
        tool: toolName,
        result: context.officePolicy || { message: 'Chưa cấu hình văn phòng GPS active' }
      };
    }

    case 'get_team_workload': {
      if (!isManager || !context.teamWorkloadAdvisor) {
        return {
          ok: false,
          tool: toolName,
          error: 'RBAC_DENIED: Chỉ Team Lead và HR Manager mới được phép truy vấn tải công việc của Team.'
        };
      }
      const adv = context.teamWorkloadAdvisor;
      const teamsList = adv.teamsWorkload || [adv];
      if (args.teamName) {
        const matched = fuzzyMatchEntity(args.teamName, teamsList, (t) => t.teamName, 0.4);
        if (matched.item) {
          return { ok: true, tool: toolName, result: { teams: [matched.item] } };
        }
      }
      return {
        ok: true,
        tool: toolName,
        result: {
          managedTeamsCount: adv.managedTeamsCount,
          teams: teamsList,
          crossTeamTopPerformers: adv.crossTeamProvenRecommendees
        }
      };
    }

    case 'get_manager_approvals': {
      if (!isManager || !context.pendingApprovals) {
        return {
          ok: false,
          tool: toolName,
          error: 'RBAC_DENIED: Chỉ Team Lead và HR Manager mới có hộp thư phê duyệt.'
        };
      }
      return {
        ok: true,
        tool: toolName,
        result: context.pendingApprovals
      };
    }

    case 'propose_log_time': {
      const openTasks = context.personalTasks?.openTasksList || [];
      const matched = args.taskTitle
        ? fuzzyMatchEntity(args.taskTitle, openTasks, (t) => t.title, 0.25).item
        : openTasks[0];
      if (!matched) {
        return { ok: false, tool: toolName, error: 'Không tìm thấy công việc hợp lệ trong danh sách của bạn.' };
      }
      const minutes = Math.min(Math.max(Number(args.minutes) || 60, 1), 1440);
      return {
        ok: true,
        tool: toolName,
        result: {
          proposedAction: {
            type: 'LOG_TIME',
            summary: `Log ${minutes} phút cho task "${matched.title}"`,
            payload: {
              taskId: matched._id,
              taskTitle: matched.title,
              minutes,
              note: args.note || `Cập nhật ${minutes} phút làm việc qua AI Copilot`
            }
          }
        }
      };
    }

    case 'propose_create_leave': {
      const leaveType = ['personal', 'sick', 'vacation'].includes(args.type)
        ? args.type
        : 'personal';
      const startDate = args.startDate || context.tomorrowDate;
      const endDate = args.endDate || startDate;
      return {
        ok: true,
        tool: toolName,
        result: {
          proposedAction: {
            type: 'CREATE_LEAVE',
            summary: `Tạo đơn nghỉ phép (${leaveType}) từ ${startDate} đến ${endDate}`,
            payload: {
              type: leaveType,
              startDate,
              endDate,
              reason: args.reason || 'Giải quyết việc cá nhân'
            }
          }
        }
      };
    }

    default:
      return { ok: false, tool: toolName, error: `Unknown tool: ${toolName}` };
  }
};

/**
 * Automatically map a classified intent to the minimal RBAC tool call(s)
 * so only the relevant tool output is loaded for that intent.
 */
const runToolsForIntent = (intent, message, user, context) => {
  const outputs = [];
  const invoke = (name, args = {}) => outputs.push(executeCopilotTool(name, args, user, context));

  if (['workload_multi_team', 'workload_single_team', 'team_comparison', 'employee_360_lookup', 'team_leave_calendar'].includes(intent)) {
    invoke('get_team_workload');
  } else if (intent === 'manager_approvals_inbox') {
    invoke('get_manager_approvals');
  } else if (['personal_leave_balance', 'attendance_summary'].includes(intent)) {
    invoke('get_leave_and_attendance');
  } else if (intent === 'office_gps_policy') {
    invoke('get_office_gps_policy');
  } else if (intent === 'action_log_time') {
    invoke('propose_log_time', { taskTitle: message });
  } else if (intent === 'action_create_leave') {
    invoke('propose_create_leave', { reason: message });
  } else if (intent === 'daily_briefing_overview') {
    invoke('get_personal_tasks', { filter: 'priority' });
    invoke('get_leave_and_attendance');
    if ([USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER].includes(user?.role)) {
      invoke('get_manager_approvals');
    }
  } else {
    invoke('get_personal_tasks', { filter: 'all' });
  }

  return outputs;
};

module.exports = {
  AI_TOOL_DECLARATIONS,
  OLLAMA_TOOLS,
  executeCopilotTool,
  runToolsForIntent
};
