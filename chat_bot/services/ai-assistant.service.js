const axios = require('axios');
const logger = require('../../utils/logger.utils');
const {
  AI_CONFIG,
  ASSISTANT_RESPONSE_SCHEMA,
  TASK_BREAKDOWN_SCHEMA,
  TASK_SUMMARY_SCHEMA
} = require('../config/ai.config');
const {
  normalizeVi,
  formatDateISO,
  getRoleSuggestedQuestions
} = require('../utils/vietnamese-nlp.utils');

let ollamaStatusCache = { available: null, checkedAt: 0 };

const isOllamaRunning = async () => {
  const now = Date.now();
  if (ollamaStatusCache.available !== null && now - ollamaStatusCache.checkedAt < 30000) {
    return ollamaStatusCache.available;
  }
  try {
    await axios.get(`${AI_CONFIG.OLLAMA_BASE_URL}/api/tags`, { timeout: 400 });
    ollamaStatusCache = { available: true, checkedAt: now };
    return true;
  } catch (_err) {
    ollamaStatusCache = { available: false, checkedAt: now };
    return false;
  }
};

/**
 * Call Local Ollama Chat API with Structured JSON Schema
 */
const callOllamaJSON = async (systemPrompt, userPrompt) => {
  if (AI_CONFIG.PROVIDER === 'local_only') return null;
  if (!(await isOllamaRunning())) return null;

  const response = await axios.post(
    `${AI_CONFIG.OLLAMA_BASE_URL}/api/chat`,
    {
      model: AI_CONFIG.OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      format: 'json',
      stream: false,
      keep_alive: '30m',
      options: {
        temperature: 0.2,
        num_ctx: 1536,
        num_predict: 280
      }
    },
    { timeout: AI_CONFIG.OLLAMA_TIMEOUT_MS }
  );

  const content = response.data?.message?.content;
  if (!content) return null;
  return JSON.parse(content);
};

/**
 * Call Gemini REST API if GEMINI_API_KEY is configured
 */
const callGeminiJSON = async (systemPrompt, userPrompt, schema) => {
  const apiKey = process.env.GEMINI_API_KEY || AI_CONFIG.GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await axios.post(
    url,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    },
    { timeout: 15000 }
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  return JSON.parse(text);
};

/**
 * Execute LLM call with automatic fallback chain:
 * 1. Ollama (qwen2.5:3b)
 * 2. Gemini (if GEMINI_API_KEY is set)
 * 3. Smart Local Vietnamese NLP Engine (Zero-latency, 100% reliable)
 */
const invokeStructuredAI = async ({ systemPrompt, userPrompt, schema, fallbackFn }) => {
  const providerPref = (process.env.AI_PROVIDER || AI_CONFIG.PROVIDER).toLowerCase();

  if (providerPref === 'gemini' && process.env.GEMINI_API_KEY) {
    try {
      const data = await callGeminiJSON(systemPrompt, userPrompt, schema);
      if (data) return { data, provider: `gemini (${AI_CONFIG.GEMINI_MODEL})` };
    } catch (err) {
      logger.warn('Gemini call failed, falling back', { message: err.message });
    }
  }

  if (providerPref === 'ollama' || providerPref === 'auto') {
    try {
      const data = await callOllamaJSON(systemPrompt, userPrompt, schema);
      if (data) return { data, provider: `ollama (${AI_CONFIG.OLLAMA_MODEL})` };
    } catch (err) {
      logger.debug('Ollama not reachable or timed out, using fallback', {
        message: err.message
      });
    }
  }

  if (providerPref === 'auto' && process.env.GEMINI_API_KEY) {
    try {
      const data = await callGeminiJSON(systemPrompt, userPrompt, schema);
      if (data) return { data, provider: `gemini (${AI_CONFIG.GEMINI_MODEL})` };
    } catch (err) {
      logger.warn('Gemini fallback failed', { message: err.message });
    }
  }

  return {
    data: fallbackFn(),
    provider: 'smart-local-copilot'
  };
};

/**
 * Extract Chat-to-Action intent (LOG_TIME or CREATE_LEAVE) from natural Vietnamese message
 */
const extractActionIntent = (message, context) => {
  const raw = String(message || '').trim();
  const norm = normalizeVi(raw);

  const isLogTime =
    (norm.includes('log') ||
      norm.includes('ghi nhan') ||
      norm.includes('cap nhat thoi gian') ||
      norm.includes('cham gio')) &&
    (norm.includes('phut') || norm.includes('gio') || norm.includes('min') || /\b\d+\s*(p|m|h)\b/.test(norm));

  if (isLogTime) {
    let minutes = 60;
    const minMatch = norm.match(/(\d+)\s*(phut|min|p\b)/);
    const hourMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*(gio|tieng|h\b)/);
    if (minMatch) {
      minutes = Math.min(Math.max(parseInt(minMatch[1], 10), 1), 1440);
    } else if (hourMatch) {
      minutes = Math.min(
        Math.max(Math.round(parseFloat(hourMatch[1].replace(',', '.')) * 60), 1),
        1440
      );
    }

    let note = '';
    const noteMatch = raw.match(/(?:ghi\s*chú|note|nội\s*dung)\s*[:=-]?\s*(.+)$/i);
    if (noteMatch) {
      note = noteMatch[1].trim();
    }

    const openTasks = context.personalTasks?.openTasksList || [];
    let matchedTask = null;

    for (const t of openTasks) {
      const tNorm = normalizeVi(t.title);
      if (tNorm && norm.includes(tNorm)) {
        matchedTask = t;
        break;
      }
    }

    if (!matchedTask && openTasks.length > 0) {
      const taskPhraseMatch = raw.match(
        /(?:task|công\s*việc|việc)\s+["']?([^"':]+?)(?:\s+với\s+ghi\s*chú|\s+ghi\s*chú|\s+note|$)/i
      );
      const targetHint = taskPhraseMatch ? normalizeVi(taskPhraseMatch[1]) : '';
      if (targetHint) {
        matchedTask =
          openTasks.find((t) => {
            const tNorm = normalizeVi(t.title);
            return tNorm.includes(targetHint) || targetHint.includes(tNorm);
          }) || null;
      }
    }

    if (!matchedTask && openTasks.length > 0) {
      matchedTask = openTasks[0];
    }

    if (matchedTask) {
      return {
        type: 'LOG_TIME',
        summary: `Log ${minutes} phút cho task "${matchedTask.title}"${note ? ` (Ghi chú: ${note})` : ''}`,
        payload: {
          taskId: matchedTask._id,
          taskTitle: matchedTask.title,
          minutes,
          note: note || `Cập nhật ${minutes} phút làm việc qua AI Copilot`
        }
      };
    }
  }

  const isCreateLeave =
    (norm.includes('tao don') ||
      norm.includes('nop don') ||
      norm.includes('xin nghi') ||
      norm.includes('dang ky nghi') ||
      norm.includes('nghi phep')) &&
    !norm.includes('con bao nhieu') &&
    !norm.includes('may ngay') &&
    !norm.includes('kiem tra') &&
    !norm.includes('ai dang');

  if (isCreateLeave) {
    let leaveType = 'personal';
    if (norm.includes('om') || norm.includes('benh') || norm.includes('kham') || norm.includes('sick')) {
      leaveType = 'sick';
    } else if (norm.includes('du lich') || norm.includes('nghi mat') || norm.includes('phep nam') || norm.includes('vacation')) {
      leaveType = 'vacation';
    }

    const now = new Date();
    let startDate = context.tomorrowDate;
    let endDate = context.tomorrowDate;

    const explicitDates = raw.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?)\b/g);
    if (explicitDates && explicitDates.length >= 1) {
      const parseToken = (token) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
        const parts = token.split('/');
        const day = String(parts[0]).padStart(2, '0');
        const month = String(parts[1]).padStart(2, '0');
        const year = parts[2] || now.getFullYear();
        return `${year}-${month}-${day}`;
      };
      startDate = parseToken(explicitDates[0]);
      endDate = explicitDates.length >= 2 ? parseToken(explicitDates[1]) : startDate;
    } else if (norm.includes('hom nay')) {
      startDate = context.todayDate;
      endDate = context.todayDate;
    } else if (norm.includes('ngay kia') || norm.includes('ngay mot')) {
      const d = formatDateISO(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));
      startDate = d;
      endDate = d;
    }

    const daysMatch = norm.match(/(\d+)\s*ngay/);
    if (daysMatch && (!explicitDates || explicitDates.length < 2)) {
      const numDays = Math.min(Math.max(parseInt(daysMatch[1], 10), 1), 30);
      const startObj = new Date(startDate);
      const endObj = new Date(startObj.getTime() + (numDays - 1) * 24 * 60 * 60 * 1000);
      endDate = formatDateISO(endObj);
    }

    let reason = 'Giải quyết việc cá nhân';
    const reasonMatch = raw.match(/(?:vì\s*lý\s*do|lý\s*do|vì|do)\s*[:=-]?\s*(.+)$/i);
    if (reasonMatch) {
      reason = reasonMatch[1].trim();
    } else if (leaveType === 'sick') {
      reason = 'Nghỉ ốm / khám sức khỏe';
    }

    const typeLabel =
      leaveType === 'sick'
        ? 'Nghỉ ốm (Sick)'
        : leaveType === 'vacation'
          ? 'Nghỉ phép năm (Vacation)'
          : 'Nghỉ việc riêng (Personal)';

    return {
      type: 'CREATE_LEAVE',
      summary: `Tạo đơn ${typeLabel} từ ${startDate} đến ${endDate}`,
      payload: {
        type: leaveType,
        startDate,
        endDate,
        reason
      }
    };
  }

  return null;
};

/**
 * Local fallback generator for /api/ai/assistant using real MongoDB context
 */
const buildLocalAssistantReply = (message, context) => {
  const norm = normalizeVi(message);
  const proposedAction = extractActionIntent(message, context);
  const suggestedQuestions = getRoleSuggestedQuestions(context.user.role);

  if (proposedAction?.type === 'LOG_TIME') {
    const p = proposedAction.payload;
    return {
      reply:
        `Tôi đã chuẩn bị lệnh **ghi nhận thời gian làm việc** từ cơ sở dữ liệu cho bạn:\n` +
        `• **Công việc**: ${p.taskTitle}\n` +
        `• **Thời lượng**: ${p.minutes} phút\n` +
        `• **Ghi chú**: "${p.note}"\n\n` +
        `Bạn hãy bấm nút **"Xác nhận thực hiện"** bên dưới để lưu trực tiếp vào hệ thống nhé!`,
      suggestedQuestions,
      proposedAction
    };
  }

  if (proposedAction?.type === 'CREATE_LEAVE') {
    const p = proposedAction.payload;
    const balance = context.personalLeaves.balance;
    return {
      reply:
        `Tôi đã trích xuất thông tin **đơn xin nghỉ phép** cho bạn (Số ngày phép năm còn lại của bạn là **${balance.remaining}/${balance.total} ngày**):\n` +
        `• **Loại phép**: ${p.type === 'sick' ? 'Nghỉ ốm (sick)' : p.type === 'vacation' ? 'Nghỉ phép năm (vacation)' : 'Cá nhân (personal)'}\n` +
        `• **Từ ngày**: ${p.startDate} đến ${p.endDate}\n` +
        `• **Lý do**: "${p.reason}"\n\n` +
        `Vui lòng nhấn **"Xác nhận thực hiện"** ngay bên dưới để gửi đơn phê duyệt.`,
      suggestedQuestions,
      proposedAction
    };
  }

  const isWorkloadQuery =
    norm.includes('giao cho ai') ||
    norm.includes('nen giao') ||
    norm.includes('dieu phoi') ||
    norm.includes('qua tai') ||
    norm.includes('tai cong viec') ||
    norm.includes('trong team') ||
    (norm.includes('hard') && norm.includes('task'));

  if (isWorkloadQuery) {
    if (!context.teamWorkloadAdvisor) {
      return {
        reply:
          'Tính năng **Trợ lý Điều phối & Gợi ý Giao việc (Smart Workload Advisor)** chỉ dành cho **Team Lead** hoặc **HR Manager** có quản lý đội nhóm.',
        suggestedQuestions,
        proposedAction: null
      };
    }

    const adv = context.teamWorkloadAdvisor;
    const onLeaveLines =
      adv.membersOnLeaveNext2Days.length > 0
        ? adv.membersOnLeaveNext2Days
            .map(
              (m) =>
                `  - ❌ **${m.userName}**: Đang có lịch nghỉ phép đã duyệt (${m.upcomingLeaves
                  .map((l) => `${l.startDate} → ${l.endDate}`)
                  .join(', ')}) → **Loại trừ**`
            )
            .join('\n')
        : '  - ✅ Không có thành viên nào nghỉ phép trong 2 ngày tới.';

    const topRecs = adv.recommendedAssignees.slice(0, 2);
    const recLines =
      topRecs.length > 0
        ? topRecs
            .map(
              (m, idx) =>
                `  ${idx + 1}. 🌟 **${m.userName}** — Đang mở: **${m.inProgressTasks} in_progress**, **${m.todoTasks} todo**, Quá hạn: **${m.overdueTasks}** | Tỷ lệ đúng hạn: **${m.onTimeRate}%** (Hoàn thành: ${m.completionRate}%)`
            )
            .join('\n')
        : '  - Hiện tất cả thành viên đều đang bận hoặc có lịch nghỉ phép.';

    const allLines = adv.allMembersWorkload
      .map(
        (m) =>
          `• **${m.userName}**: ${m.inProgressTasks} đang làm, ${m.todoTasks} chờ làm, ${m.overdueTasks} quá hạn, đúng hạn ${m.onTimeRate}%${
            m.hasApprovedLeaveNext2Days ? ' *(Đang nghỉ phép)*' : ''
          }`
      )
      .join('\n');

    const bestCandidate = topRecs[0];

    return {
      reply:
        `📊 **Phân tích Điều phối Công việc — Team ${adv.teamName}** *(Dữ liệu thời gian thực)*:\n\n` +
        `**1. Kiểm tra lịch nghỉ phép trong 2 ngày tới:**\n${onLeaveLines}\n\n` +
        `**2. Đề xuất nhân sự phù hợp nhất cho task gấp / độ khó cao:**\n${recLines}\n\n` +
        `**3. Tổng quan tải công việc toàn team (${adv.totalMembers} thành viên):**\n${allLines}`,
      suggestedQuestions,
      proposedAction: bestCandidate
        ? {
            type: 'CREATE_TASK_DRAFT',
            summary: `Mở màn hình Giao việc cho ${bestCandidate.userName}`,
            payload: {
              assigneeId: bestCandidate.userId,
              assigneeName: bestCandidate.userName,
              difficulty: norm.includes('hard') ? 'hard' : 'medium',
              priority: 'high'
            }
          }
        : null
    };
  }

  if (
    norm.includes('ngay phep') ||
    norm.includes('phep nam') ||
    norm.includes('con bao nhieu phep') ||
    norm.includes('don nghi')
  ) {
    const lv = context.personalLeaves;
    const pendingText =
      lv.pendingCount > 0
        ? `\n• **Đơn đang chờ duyệt (${lv.pendingCount} đơn)**:\n` +
          lv.pendingRequests
            .map(
              (r) =>
                `  - ${r.type} (${r.startDate} → ${r.endDate}, ${r.numberOfDays} ngày) — Trạng thái: \`${r.status}\``
            )
            .join('\n')
        : '\n• **Đơn đang chờ duyệt**: Không có đơn nào đang chờ.';

    return {
      reply:
        `🌴 **Thông tin Quỹ Nghỉ phép năm ${lv.year} của ${context.user.fullName}**:\n` +
        `• **Tổng quỹ phép năm**: ${lv.balance.total} ngày\n` +
        `• **Đã sử dụng**: ${lv.balance.used} ngày\n` +
        `• **Số ngày phép còn lại**: **${lv.balance.remaining} ngày**` +
        pendingText,
      suggestedQuestions,
      proposedAction: null
    };
  }

  if (
    norm.includes('di muon') ||
    norm.includes('du cong') ||
    norm.includes('cham cong') ||
    norm.includes('gio lam') ||
    norm.includes('diem danh')
  ) {
    if (
      norm.includes('gps') ||
      norm.includes('ban kinh') ||
      norm.includes('quy dinh') ||
      norm.includes('van phong') ||
      norm.includes('dia chi')
    ) {
      const off = context.officePolicy;
      if (!off) {
        return {
          reply: 'Hiện tại hệ thống chưa cấu hình văn phòng chấm công GPS đang hoạt động (Active Office).',
          suggestedQuestions,
          proposedAction: null
        };
      }
      return {
        reply:
          `📍 **Quy định Chấm công GPS Văn phòng (${off.name})**:\n` +
          `• **Địa chỉ**: ${off.address}\n` +
          `• **Bán kính cho phép Check-in/Check-out**: **${off.radiusMeters} mét** tính từ tâm tọa độ (${off.coordinates?.lat}, ${off.coordinates?.lng})\n` +
          `• **Giờ làm việc tiêu chuẩn**: **${off.workingHours.start} – ${off.workingHours.end}** (Check-in sau ${off.workingHours.start} sẽ tính là đi muộn \`late\`).`,
        suggestedQuestions,
        proposedAction: null
      };
    }

    const att = context.personalAttendance;
    const stats = att.monthStats;
    const todayStatus = att.today
      ? `Đã check-in lúc ${new Date(att.today.clockIn).toTimeString().slice(0, 5)} (${
          att.today.status === 'late' ? 'Đi muộn' : 'Đúng giờ'
        })${att.today.clockOut ? `, đã check-out (${att.today.workHours || 0}h)` : ', chưa check-out'}`
      : 'Chưa ghi nhận check-in hôm nay';

    const lateList =
      att.lateDatesThisMonth.length > 0
        ? att.lateDatesThisMonth
            .map((d) => `  - Ngày **${d.date}** (Check-in lúc ${d.clockInTime || 'sau 09:00'})`)
            .join('\n')
        : '  - 🎉 Tuyệt vời! Tháng này bạn không đi muộn ngày nào.';

    return {
      reply:
        `🕒 **Tổng hợp Chấm công Tháng ${att.monthLabel} của ${context.user.fullName}**:\n` +
        `• **Hôm nay (${context.todayDate})**: ${todayStatus}\n` +
        `• **Số ngày có mặt**: **${stats.presentDays + stats.lateDays}/${stats.totalDays}** ngày làm việc (Đúng giờ: ${stats.presentDays}, Đi muộn: **${stats.lateDays}**, Vắng: ${stats.absentDays})\n` +
        `• **Tổng số giờ làm việc**: **${stats.totalWorkHours} giờ** (Trung bình ${stats.averageWorkHours} giờ/ngày)\n` +
        `• **Chi tiết các ngày đi muộn trong tháng**:\n${lateList}`,
      suggestedQuestions,
      proposedAction: null
    };
  }

  if (
    norm.includes('gps') ||
    norm.includes('ban kinh') ||
    norm.includes('quy dinh') ||
    norm.includes('van phong')
  ) {
    const off = context.officePolicy;
    if (!off) {
      return {
        reply: 'Hiện tại hệ thống chưa có cấu hình văn phòng GPS đang hoạt động.',
        suggestedQuestions,
        proposedAction: null
      };
    }
    return {
      reply:
        `📍 **Quy định Chấm công GPS Văn phòng (${off.name})**:\n` +
        `• **Địa chỉ**: ${off.address}\n` +
        `• **Bán kính cho phép Check-in**: **${off.radiusMeters} mét** quanh tọa độ (${off.coordinates?.lat}, ${off.coordinates?.lng})\n` +
        `• **Khung giờ làm việc**: **${off.workingHours.start} – ${off.workingHours.end}**.`,
      suggestedQuestions,
      proposedAction: null
    };
  }

  const pt = context.personalTasks;
  if (pt.totalOpen === 0) {
    return {
      reply:
        `Xin chào **${context.user.fullName}**! Hiện tại bạn **không có công việc (task) nào đang mở hoặc quá hạn**. Bạn có thể hỏi tôi về ngày phép, bảng chấm công tháng ${context.personalAttendance.monthLabel}, hoặc quy định văn phòng nhé!`,
      suggestedQuestions,
      proposedAction: null
    };
  }

  const topLines = pt.topPriorityTasks
    .map(
      (t, idx) =>
        `${idx + 1}. **[${t.priority.toUpperCase()}] ${t.title}**\n` +
        `   - Trạng thái: \`${t.status}\` | Tiến độ: ${t.progress}% | Hạn chót: **${t.dueDate || 'Chưa đặt'}**${
          t.isOverdue ? ' ⚠️ **(QUÁ HẠN)**' : ''
        }`
    )
    .join('\n');

  const blockedTasks = pt.openTasksList.filter((t) => t.isBlocked);
  const blockedNote =
    blockedTasks.length > 0
      ? `\n\n⛔ **Lưu ý các task đang bị chặn bởi Dependencies (${blockedTasks.length} task)**:\n` +
        blockedTasks
          .map((t) => `• **${t.title}** (Đang chờ: *${t.blockedByTitles.join(', ')}*)`)
          .join('\n')
      : '';

  return {
    reply:
      `📌 **Thứ tự Ưu tiên Công việc của ${context.user.fullName}** *(Đang mở: ${pt.totalOpen} task | Quá hạn: ${pt.overdueCount} | Đang làm: ${pt.inProgressCount})*:\n\n` +
      `Dựa trên hạn chót (\`dueDate\`), mức độ ưu tiên (\`priority\`) và kiểm tra phụ thuộc (\`dependencies\`), bạn nên tập trung làm trước:\n` +
      `${topLines}${blockedNote}`,
    suggestedQuestions,
    proposedAction: null
  };
};

/**
 * Main entry point for Chat Assistant (/api/ai/assistant)
 */
const generateAssistantReply = async ({ user, message, history = [] }) => {
  const { buildUserCopilotContext } = require('./ai-context.service');
  const context = await buildUserCopilotContext(user);

  const detectedAction = extractActionIntent(message, context);
  const localBaseline = buildLocalAssistantReply(message, context);

  const systemPrompt =
    `Bạn là Trợ lý ảo Nội bộ AI HR & Task Copilot. Dựa vào BÁO CÁO DỮ LIỆU THẬT TỪ MONGODB dưới đây của ${context.user.fullName} (role: ${context.user.role}), hãy trả lời câu hỏi của người dùng bằng tiếng Việt tự nhiên, giữ nguyên chính xác 100% số liệu và tên task/nhân sự. Trả về JSON đúng mẫu: {"reply":"...","suggestedQuestions":["..."]}.`;

  const recentHistoryText = (history || [])
    .slice(-2)
    .map((h) => `${h.role === 'assistant' ? 'AI' : 'User'}: ${h.content}`)
    .join('\n');

  const userPrompt =
    `BÁO CÁO DỮ LIỆU THẬT TỪ MONGODB:\n${localBaseline.reply}\n\n` +
    (recentHistoryText ? `HỘI THOẠI GẦN ĐÂY:\n${recentHistoryText}\n\n` : '') +
    `CÂU HỎI CỦA NGƯỜI DÙNG: "${message}"`;

  const result = await invokeStructuredAI({
    systemPrompt,
    userPrompt,
    schema: ASSISTANT_RESPONSE_SCHEMA,
    fallbackFn: () => localBaseline
  });

  const payload = result.data || localBaseline;
  const replyText =
    typeof payload.reply === 'string' && payload.reply.trim().length > 10
      ? payload.reply.trim()
      : localBaseline.reply;

  const finalAction =
    detectedAction ||
    (payload.proposedAction && payload.proposedAction.type !== 'NONE' && payload.proposedAction.payload
      ? payload.proposedAction
      : localBaseline.proposedAction);

  const finalSuggestions =
    Array.isArray(payload.suggestedQuestions) && payload.suggestedQuestions.length > 0
      ? payload.suggestedQuestions
      : localBaseline.suggestedQuestions;

  return {
    reply: replyText,
    suggestedQuestions: finalSuggestions.slice(0, 4),
    proposedAction: finalAction || null,
    provider: result.provider,
    contextSummary: {
      role: context.user.role,
      openTasks: context.personalTasks.totalOpen,
      remainingLeaveDays: context.personalLeaves.balance.remaining
    }
  };
};

/**
 * Local fallback generator for Task Breakdown (/api/ai/task-breakdown)
 */
const buildLocalTaskBreakdown = ({ title = '', description = '' }) => {
  const combined = `${title} ${description}`.trim();
  const norm = normalizeVi(combined);

  let difficulty = 'medium';
  let priority = 'medium';
  let estimatedMinutes = 180;
  let storyPoints = 3;
  const tags = [];
  let subTasks = [];
  let checklistItems = [
    'Kiểm tra đầy đủ các trường hợp biên (edge cases)',
    'Đảm bảo phân quyền RBAC và bảo mật dữ liệu',
    'Tự kiểm thử trước khi gửi duyệt (Submit for Review)'
  ];

  if (
    norm.includes(' gap') ||
    norm.includes('khan') ||
    norm.includes('urgent') ||
    norm.includes('production') ||
    norm.includes('bao mat') ||
    norm.includes('security')
  ) {
    priority = 'high';
  }

  if (
    norm.includes('kien truc') ||
    norm.includes('migration') ||
    norm.includes('refactor') ||
    norm.includes('toi uu') ||
    norm.includes('he thong') ||
    norm.includes('ai ') ||
    description.length > 250
  ) {
    difficulty = 'hard';
    estimatedMinutes = 360;
    storyPoints = 8;
  } else if (
    norm.includes('sua loi nho') ||
    norm.includes('typo') ||
    norm.includes('cap nhat text') ||
    norm.includes('doi mau')
  ) {
    difficulty = 'easy';
    estimatedMinutes = 60;
    storyPoints = 1;
  }

  if (
    norm.includes('database') ||
    norm.includes('schema') ||
    norm.includes('mongo') ||
    norm.includes('api') ||
    norm.includes('backend')
  ) {
    tags.push('backend', 'database', 'api');
    subTasks = [
      { title: `Phân tích yêu cầu & thiết kế Schema/Model cho "${title}"` },
      { title: 'Xây dựng Service xử lý logic nghiệp vụ và kiểm tra quyền RBAC' },
      { title: 'Viết Controller, Route và bộ Validator kiểm tra dữ liệu đầu vào' },
      { title: 'Tối ưu Index truy vấn và xử lý các mã lỗi HTTP chuẩn' },
      { title: 'Viết Unit/Integration Test và cập nhật tài liệu Swagger API' }
    ];
    checklistItems = [
      'Pass toàn bộ validator với dữ liệu hợp lệ và không hợp lệ',
      'Kiểm tra phân quyền RBAC (employee / team_lead / hr_manager)',
      'Không làm lộ thông tin nhạy cảm trong response lỗi',
      'Đã viết test tự động và chạy pass'
    ];
  } else if (
    norm.includes('man hinh') ||
    norm.includes('ui') ||
    norm.includes('frontend') ||
    norm.includes('mobile') ||
    norm.includes('react') ||
    norm.includes('giao dien')
  ) {
    tags.push('frontend', 'mobile-ui', 'ux');
    subTasks = [
      { title: `Thiết kế bố cục Component và trạng thái hiển thị cho "${title}"` },
      { title: 'Kết nối API Service và quản lý State (Loading / Error / Empty)' },
      { title: 'Xử lý Validation biểu mẫu và phản hồi người dùng (Alert/Modal)' },
      { title: 'Kiểm tra tương thích giao diện trên cả iOS và Android' }
    ];
    checklistItems = [
      'Hiển thị mượt mà khi dữ liệu rỗng hoặc lỗi mạng',
      'Không bị che khuất bởi bàn phím (KeyboardAvoidingView)',
      'Đồng bộ màu sắc và kiểu chữ với hệ thống Design'
    ];
  } else if (
    norm.includes('nhan su') ||
    norm.includes('hr') ||
    norm.includes('cham cong') ||
    norm.includes('nghi phep') ||
    norm.includes('tuyen dung') ||
    norm.includes('bao cao')
  ) {
    tags.push('hr-ops', 'report', 'workflow');
    subTasks = [
      { title: `Rà soát quy định và thu thập dữ liệu đầu vào cho "${title}"` },
      { title: 'Tổng hợp số liệu chấm công / nghỉ phép / hiệu suất liên quan' },
      { title: 'Đối chiếu dữ liệu bất thường và lập bảng tổng kết' },
      { title: 'Trình quản lý rà soát và lưu trữ hồ sơ nội bộ' }
    ];
    checklistItems = [
      'Số liệu khớp 100% với hệ thống chấm công và nghỉ phép',
      'Đã kiểm tra các đơn chờ duyệt hoặc ngoại lệ',
      'Định dạng báo cáo rõ ràng, đầy đủ chữ ký/xác nhận'
    ];
  } else {
    tags.push('task', 'execution');
    subTasks = [
      { title: `Làm rõ phạm vi và tiêu chí hoàn thành của "${title}"` },
      { title: 'Thực hiện triển khai các hạng mục chính theo mô tả' },
      { title: 'Rà soát chất lượng, kiểm thử chéo và xử lý phát sinh' },
      { title: 'Hoàn thiện tài liệu ghi chú và gửi duyệt kết quả (Submit Review)' }
    ];
  }

  return {
    difficulty,
    priority,
    estimatedMinutes,
    storyPoints,
    tags: tags.slice(0, 5),
    subTasks,
    checklist: {
      title: 'Checklist Tiêu chí Hoàn thành (Definition of Done)',
      items: checklistItems
    },
    reasoning: `Ước lượng tự động dựa trên độ phức tạp của "${title}" (${estimatedMinutes} phút ~ ${storyPoints} Story Points, độ khó ${difficulty.toUpperCase()}).`
  };
};

/**
 * Generate Subtasks, Checklist, Difficulty & Estimate (/api/ai/task-breakdown)
 */
const generateTaskBreakdown = async ({ title, description = '' }) => {
  const systemPrompt =
    `Bạn là AI Task Copilot. Trả về JSON đúng mẫu: {"difficulty":"easy|medium|hard","priority":"low|medium|high","estimatedMinutes":180,"storyPoints":3,"tags":["tag1"],"subTasks":[{"title":"..."}],"checklist":{"title":"Definition of Done","items":["..."]},"reasoning":"..."}. Nội dung tiếng Việt ngắn gọn (4 subTasks, 3 checklist items).`;

  const userPrompt = `Task: "${title}". Mô tả: "${description || 'Không có'}"`;

  const result = await invokeStructuredAI({
    systemPrompt,
    userPrompt,
    schema: TASK_BREAKDOWN_SCHEMA,
    fallbackFn: () => buildLocalTaskBreakdown({ title, description })
  });

  const raw = result.data || buildLocalTaskBreakdown({ title, description });
  const fallback = buildLocalTaskBreakdown({ title, description });

  return {
    difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty)
      ? raw.difficulty
      : fallback.difficulty,
    priority: ['low', 'medium', 'high'].includes(raw.priority)
      ? raw.priority
      : fallback.priority,
    estimatedMinutes:
      Number.isInteger(Number(raw.estimatedMinutes)) && Number(raw.estimatedMinutes) > 0
        ? Math.min(Number(raw.estimatedMinutes), 100000)
        : fallback.estimatedMinutes,
    storyPoints:
      Number.isFinite(Number(raw.storyPoints)) && Number(raw.storyPoints) >= 0
        ? Number(raw.storyPoints)
        : fallback.storyPoints,
    tags:
      Array.isArray(raw.tags) && raw.tags.length > 0
        ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
        : fallback.tags,
    subTasks:
      Array.isArray(raw.subTasks) && raw.subTasks.length > 0
        ? raw.subTasks
            .map((st) => ({ title: String(st?.title || st || '').trim() }))
            .filter((st) => st.title.length > 0)
        : fallback.subTasks,
    checklist: {
      title: raw.checklist?.title || fallback.checklist.title,
      items:
        Array.isArray(raw.checklist?.items) && raw.checklist.items.length > 0
          ? raw.checklist.items.map((i) => String(i).trim()).filter(Boolean)
          : fallback.checklist.items
    },
    reasoning: raw.reasoning || fallback.reasoning,
    provider: result.provider
  };
};

/**
 * Local fallback generator for Task Status Summary (/api/ai/task-summary/:taskId)
 */
const buildLocalTaskSummary = (tc) => {
  const headline = `Task "${tc.title}" đang ở trạng thái [${tc.status.toUpperCase()}] — Tiến độ ${tc.progress}%${
    tc.isOverdue ? ' (ĐANG QUÁ HẠN)' : ''
  }`;

  const timeComparison =
    tc.estimatedMinutes != null
      ? `Thời gian đã log: ${tc.actualMinutes}/${tc.estimatedMinutes} phút dự kiến.`
      : `Thời gian đã log: ${tc.actualMinutes} phút (chưa đặt ước lượng).`;

  const statusAnalysis =
    `Giao cho: ${tc.assignees.join(', ') || 'Chưa gán'} | Độ ưu tiên: ${tc.priority.toUpperCase()} | Độ khó: ${tc.difficulty.toUpperCase()} | Hạn chót: ${tc.dueDate || 'Chưa đặt'}. ` +
    `Subtasks đã hoàn thành: ${tc.subTasks.completed}/${tc.subTasks.total}. ${timeComparison}`;

  const blockers = [];
  if (tc.blockingDependencies.length > 0) {
    for (const dep of tc.blockingDependencies) {
      blockers.push(
        `Bị chặn bởi Dependency chưa hoàn thành: "${dep.title}" (trạng thái: ${dep.status}, hạn: ${dep.dueDate || 'N/A'})`
      );
    }
  }
  if (tc.isOverdue) {
    blockers.push(`Task đã quá hạn chót (${tc.dueDate}) nhưng chưa hoàn thành.`);
  }
  const latestChangesRequested = [...(tc.recentReviewRounds || [])]
    .reverse()
    .find((r) => r.type === 'changes_requested');
  if (latestChangesRequested) {
    blockers.push(
      `Vòng duyệt thứ ${latestChangesRequested.round} yêu cầu chỉnh sửa bởi ${latestChangesRequested.by}: "${
        latestChangesRequested.reason || latestChangesRequested.note || 'Cần bổ sung/chỉnh sửa'
      }"`
    );
  }
  if (blockers.length === 0) {
    blockers.push('Không có điểm nghẽn (Dependency hay từ chối duyệt) nào đang chặn task này.');
  }

  const lastTransition = tc.recentStatusHistory.at(-1);
  const lastComment = tc.recentComments.at(-1);
  const recentActivitySummary =
    (lastTransition
      ? `Chuyển trạng thái gần nhất: ${lastTransition.from || 'Khởi tạo'} → ${lastTransition.to} bởi ${lastTransition.by}. `
      : '') +
    (lastComment
      ? `Bình luận mới nhất từ ${lastComment.author}: "${lastComment.text}".`
      : 'Chưa có bình luận trao đổi nào.');

  const nextSteps = [];
  if (tc.blockingDependencies.length > 0) {
    nextSteps.push(
      `Ưu tiên hoàn thành hoặc tháo gỡ ${tc.blockingDependencies.length} task phụ thuộc đang chặn trước.`
    );
  }
  if (tc.subTasks.pendingTitles.length > 0) {
    nextSteps.push(
      `Hoàn thành ${tc.subTasks.pendingTitles.length} subtask còn lại (ưu tiên: "${tc.subTasks.pendingTitles[0]}").`
    );
  }
  const pendingChecklistCount = tc.checklists.reduce(
    (acc, cl) => acc + cl.pendingItems.length,
    0
  );
  if (pendingChecklistCount > 0) {
    nextSteps.push(`Rà soát và tích hoàn thành ${pendingChecklistCount} mục trong Checklist.`);
  }
  if (tc.status === 'in_progress' && tc.blockingDependencies.length === 0) {
    nextSteps.push('Ghi nhận thời gian làm việc (Log time) và gửi duyệt (Submit for Review) khi hoàn tất.');
  } else if (tc.status === 'in_review') {
    nextSteps.push('Đang chờ Team Lead / HR Manager phê duyệt kết quả (Approve / Request Changes).');
  }
  if (nextSteps.length === 0) {
    nextSteps.push('Tiếp tục theo dõi tiến độ định kỳ.');
  }

  return {
    headline,
    statusAnalysis,
    blockers,
    recentActivitySummary,
    nextSteps
  };
};

/**
 * Summarize Task Status, Blockers, History & Comments (/api/ai/task-summary/:taskId)
 */
const summarizeTask = async (taskContext) => {
  const systemPrompt =
    `Bạn là Trợ lý Kỹ thuật AI. Trả về JSON tiếng Việt ngắn gọn theo mẫu: {"headline":"...","statusAnalysis":"...","blockers":["..."],"recentActivitySummary":"...","nextSteps":["..."]}.`;

  const userPrompt = `DỮ LIỆU CHI TIẾT TASK:\n${JSON.stringify(taskContext)}`;

  const result = await invokeStructuredAI({
    systemPrompt,
    userPrompt,
    schema: TASK_SUMMARY_SCHEMA,
    fallbackFn: () => buildLocalTaskSummary(taskContext)
  });

  const data = result.data || buildLocalTaskSummary(taskContext);
  return {
    ...buildLocalTaskSummary(taskContext),
    ...data,
    provider: result.provider
  };
};

module.exports = {
  generateAssistantReply,
  generateTaskBreakdown,
  summarizeTask,
  extractActionIntent,
  buildLocalAssistantReply,
  buildLocalTaskBreakdown,
  buildLocalTaskSummary
};

