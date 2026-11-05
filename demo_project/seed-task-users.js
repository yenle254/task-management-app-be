/**
 * Seed DEMO DỮ LIỆU PHỦ TOÀN BỘ TÍNH NĂNG ĐÃ TRIỂN KHAI backend.
 *
 * Yêu cầu chạy `node seed-demo-users.js` trước (5 user: 2 lead + 3 member, 2 team).
 * Script tạo dữ liệu demo (tag `demo` / marker riêng) cho các module:
 *
 *   1. Tasks — CRUD, status, priority, difficulty, tags, comments, attachments,
 *      subtasks, progress; advanced: parent/child, checklists, dependencies,
 *      watchers, estimate/storyPoints, time entries, statusHistory (kể cả
 *      reopened), soft delete; task overdue cho board/calendar/timeline.
 *   2. Leaves — đủ trạng thái workflow: draft, pending_team_lead, pending_hr,
 *      approved (kèm history + balance nhất quán), rejected, cancelled.
 *   3. Attendance — present (đúng giờ), late (trễ giờ), chưa về (thôi chưa
 *      clock-out), auto-clock-out; vị trí GPS quanh office.
 *   4. Conversations + Messages — 2 cuộc chat one-to-one kèm unreadCount,
 *      message đã/chưa đọc, kèm attachment.
 *   5. Notifications — đủ các loại: task_assigned, task_completed,
 *      comment_added, deadline_reminder, task_overdue, leave_pending,
 *      leave_approved, attendance_reminder (unread + read, relatedId trỏ thật).
 *   6. Office — 1 office active demo (bán kính + giờ làm việc cho GPS check-in).
 *
 * Idempotent: chạy lại sẽ xóa dữ liệu demo (marker `demo` / tên marker) rồi tạo mới.
 * Chạy: node seed-task-users.js
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..') });
const mongoose = require('mongoose');

const Task = require('../models/task.model');
const Team = require('../models/team.model');
const User = require('../models/user.model');
const Leave = require('../models/leave.model');
const Attendance = require('../models/attendance.model');
const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');
const Notification = require('../models/notification.model');
const Office = require('../models/office.model');

const DEMO_TAG = 'demo';
const YEAR = String(new Date().getFullYear());

// Seed attachment metadata only when the corresponding local file is available.
const demoAttachment = (filename, type) => {
  const filePath = path.join(__dirname, '..', 'uploads', filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping demo attachment ${filename}: put the original file in uploads to include it.`);
    return null;
  }
  return { name: filename, url: `/uploads/${filename}`, filename, type };
};

// ============================ Helpers ngày/giờ ============================
const daysFromNow = (n, hour = 9, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const hoursAgo = n => new Date(Date.now() - n * 60 * 60 * 1000);
const atMidnight = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d; };

async function resolveUsers() {
  const emails = [
    'lead1@test.com', 'lead2@test.com',
    'member1@test.com', 'member2@test.com', 'member3@test.com',
  ];
  const found = await User.find({ email: { $in: emails } }).select('_id email role teamId');
  const byEmail = Object.fromEntries(found.map(u => [u.email, u]));
  const missing = emails.filter(e => !byEmail[e]);
  if (missing.length) {
    throw new Error(`Thiếu user demo: ${missing.join(', ')}. Chạy 'node seed-demo-users.js' trước.`);
  }
  return {
    lead1: byEmail['lead1@test.com'],
    lead2: byEmail['lead2@test.com'],
    member1: byEmail['member1@test.com'],
    member2: byEmail['member2@test.com'],
    member3: byEmail['member3@test.com'],
  };
}

async function resolveTeams() {
  const teams = await Team.find({ name: { $in: ['Nhóm Phát triển A', 'Nhóm Phát triển B'] } });
  const byName = Object.fromEntries(teams.map(t => [t.name, t]));
  if (!byName['Nhóm Phát triển A'] || !byName['Nhóm Phát triển B']) {
    throw new Error(`Thiếu team demo. Chạy 'node seed-demo-users.js' trước.`);
  }
  return { a: byName['Nhóm Phát triển A'], b: byName['Nhóm Phát triển B'] };
}

// ============================ Dọn dữ liệu demo cũ ============================
async function cleanDemoData() {
  const results = {};
  results.tasks = await Task.deleteMany({ tags: { $in: [DEMO_TAG] } });
  results.leaves = await Leave.deleteMany({ reason: { $regex: `\\[${DEMO_TAG}\\]` } });
  // Demo users: email *@test.com (từ seed-demo-users.js) — attendance theo userId
  const demoUsers = await User.find({ email: { $regex: '^.*@test\\.com$' } }).select('_id').lean();
  results.attendance = await Attendance.deleteMany({ userId: { $in: demoUsers.map(d => d._id) } });
  results.messages = (await Message.deleteMany({
    conversationId: {
      $in: await Conversation.find({ lastMessage: { $regex: `\\[${DEMO_TAG}\\]` } }).select('_id'),
    },
  })).deletedCount;
  results.conversations = await Conversation.deleteMany({ lastMessage: { $regex: `\\[${DEMO_TAG}\\]` } });
  results.notifications = await Notification.deleteMany({ message: { $regex: `\\[${DEMO_TAG}\\]` } });
  results.office = await Office.deleteOne({ name: 'Văn phòng Demo' });
  const total = results.tasks.deletedCount + results.leaves.deletedCount + results.messages +
    results.conversations.deletedCount + results.notifications.deletedCount +
    results.attendance.deletedCount + results.office.deletedCount;
  if (total) console.log(`Đã dọn ${total} tài liệu demo cũ`);
}

// ============================ 1. TASKS ============================
const taskSpecs = () => {
  const daysFromNowLocal = daysFromNow;
  const history = (entries) => entries.map(([from, to, at, by, due]) => ({
    from, to, at, by, teamId: null, assignedTo: [], dueDate: due || null,
  }));
  const entry = (user, minutes, note, loggedAt) => ({ userId: user, minutes, note, loggedAt });
  const comment = (user, text, at) => ({ userId: user, text, createdAt: at });
  const subtask = (title, isCompleted) => ({ title, isCompleted });

  const specs = [];

  // ===== TEAM A (lead1 giao, assignee: member1/member2) =====

  // 1. Epic parent (in_progress, có children, estimate + storyPoints, time entries)
  specs.push({
    title: 'Hoàn thiện API Tasks (epic)',
    description: 'Epic phụ: schema, service, routes và tests cho nhóm task.',
    status: 'in_progress', priority: 'high', difficulty: 'hard',
    assignedBy: '@lead1', teamId: '@teamA',
    startDate: daysFromNowLocal(-14), dueDate: daysFromNowLocal(21),
    progress: 40, tags: [DEMO_TAG, 'backend', 'api'],
    estimatedMinutes: 480, storyPoints: 8,
    timeEntries: [
      entry('@lead1', 120, 'Thiết kế API', hoursAgo(24 * 5)),
      entry('@member1', 90, 'Đóng góp schema', hoursAgo(24 * 3)),
    ],
    comments: [comment('@member1', 'Mình đã xong phần schema, còn phần service.', hoursAgo(48))],
    statusHistory: history([[null, 'in_progress', hoursAgo(24 * 14), '@lead1']]),
  });

  // 2. Child (done, dependency = task 7, checklist hoàn tất)
  specs.push({
    title: 'Thiết kế schema subtask/checklist',
    description: 'Child của epic: hoàn thiện schema và validation.',
    status: 'done', priority: 'medium', difficulty: 'easy',
    assignedBy: '@lead1', teamId: '@teamA',
    startDate: daysFromNowLocal(-10), dueDate: daysFromNowLocal(-4), completedAt: daysFromNowLocal(-4),
    tags: [DEMO_TAG, 'backend'],
    checklists: [{
      title: 'Đầu việc schema',
      items: [
        { text: 'Schema checklist', isCompleted: true, createdAt: hoursAgo(24 * 9) },
        { text: 'Validators', isCompleted: true, createdAt: hoursAgo(24 * 8) },
      ],
      createdAt: hoursAgo(24 * 9),
    }],
    statusHistory: history([
      [null, 'in_progress', hoursAgo(24 * 10), '@member1'],
      ['in_progress', 'done', hoursAgo(24 * 4), '@member1'],
    ]),
    _meta: { linkTo: 0, dependsOn: 6 },
  });

  // 3. Child (in_progress, watchers, subtasks một phần)
  specs.push({
    title: 'Viết unit test API Tasks',
    description: 'Child của epic: phủ routes + services.',
    status: 'in_progress', priority: 'high', difficulty: 'medium',
    assignedBy: '@lead1', teamId: '@teamA',
    startDate: daysFromNowLocal(-7), dueDate: daysFromNowLocal(7),
    progress: 50, tags: [DEMO_TAG, 'test'],
    subTasks: [
      subtask('Routes test', true),
      subtask('Service test', false),
      subtask('Fix flaky tests', false),
    ],
    timeEntries: [entry('@member2', 60, 'Chạy bộ test', hoursAgo(24 * 2))],
    statusHistory: history([[null, 'in_progress', hoursAgo(24 * 7), '@member2']]),
    _meta: { linkTo: 0, watchers: ['@lead1', '@member1', '@member2'] },
  });

  // 4. Todo bị block bởi task 5 (dependency chưa done)
  specs.push({
    title: 'Chấm công GPS trong bán kính office',
    description: 'Cài location check bằng Haversine, phụ thuộc tài liệu API.',
    status: 'todo', priority: 'high', difficulty: 'medium',
    assignedBy: '@lead1', teamId: '@teamA',
    startDate: daysFromNowLocal(2), dueDate: daysFromNowLocal(9),
    tags: [DEMO_TAG, 'attendance'],
    statusHistory: history([
      [null, 'in_progress', hoursAgo(24 * 2), '@lead1', daysFromNowLocal(9)],
      ['in_progress', 'todo', hoursAgo(24), '@lead1', daysFromNowLocal(9)],
    ]),
    _meta: { dependsOn: 4 },
  });

  // 5. Todo
  specs.push({
    title: 'Tài liệu API Attendance',
    description: 'Tài liệu endpoint clock-in/clock-out cho frontend.',
    status: 'todo', priority: 'low', difficulty: 'easy',
    assignedBy: '@lead1', teamId: '@teamA',
    dueDate: daysFromNowLocal(5),
    tags: [DEMO_TAG, 'docs'],
    statusHistory: history([[null, 'todo', hoursAgo(24 * 3), '@lead1']]),
  });

  // 6. Overdue (in_progress, dueDate quá hạn) — cho filter/calendar overdue
  specs.push({
    title: 'Đẩy version 1.2 lên production',
    description: 'Hết hạn nhưng chưa xong — task overdue demo.',
    status: 'in_progress', priority: 'high', difficulty: 'hard',
    assignedBy: '@lead1', teamId: '@teamA',
    startDate: daysFromNowLocal(-20), dueDate: daysFromNowLocal(-3, 17),
    progress: 80, tags: [DEMO_TAG, 'release'],
    attachments: [demoAttachment('release-checklist.pdf', 'application/pdf')].filter(Boolean),
    comments: [comment('@member1', 'Còn bước smoke test.', hoursAgo(5))],
    statusHistory: history([[null, 'in_progress', hoursAgo(24 * 20), '@lead1']]),
  });

  // 7. Done (subtasks toàn bộ xong, actualMinutes tính từ time entries)
  specs.push({
    title: 'Cài đặt CI pipeline',
    description: 'Pipeline test + build tự động.',
    status: 'done', priority: 'medium', difficulty: 'easy',
    assignedBy: '@lead1', teamId: '@teamA',
    startDate: daysFromNowLocal(-30), dueDate: daysFromNowLocal(-15), completedAt: daysFromNowLocal(-15, 16),
    progress: 100, tags: [DEMO_TAG, 'devops'],
    estimatedMinutes: 240, storyPoints: 3,
    subTasks: [subtask('Cấu hình CI', true), subtask('Tự động test', true)],
    timeEntries: [
      entry('@member1', 90, 'Cài CI', hoursAgo(24 * 20)),
      entry('@member1', 60, 'Chạy test tự động', hoursAgo(24 * 16)),
    ],
    statusHistory: history([
      [null, 'in_progress', hoursAgo(24 * 30), '@member1'],
      ['in_progress', 'done', hoursAgo(24 * 15), '@member1'],
    ]),
  });

  // 8. Soft delete
  specs.push({
    title: 'Prototype chat realtime (đã hủy)',
    description: 'Task bị xóa mềm — status deleted.',
    status: 'deleted', priority: 'low', difficulty: 'easy',
    assignedBy: '@lead1', teamId: '@teamA',
    tags: [DEMO_TAG],
    statusHistory: history([
      [null, 'in_progress', hoursAgo(24 * 25), '@member2'],
      ['in_progress', 'deleted', hoursAgo(24 * 20), '@lead1'],
    ]),
  });

  // 9. Calendar/timeline event sắp tới
  specs.push({
    title: 'Họp tổng kết sprint',
    description: 'Lên kế hoạch demo cuối sprint.',
    status: 'todo', priority: 'medium', difficulty: 'easy',
    assignedBy: '@lead1', teamId: '@teamA',
    startDate: daysFromNowLocal(4, 14), dueDate: daysFromNowLocal(4, 15),
    tags: [DEMO_TAG, 'meeting'],
    statusHistory: history([[null, 'todo', hoursAgo(24), '@lead1']]),
  });

  // ===== TEAM B (lead2 giao, assignee: member3) =====

  // 10. Parent (in_progress, checklist một phần + child)
  specs.push({
    title: 'Bổ sung module Leave (epic)',
    description: 'Epic: workflow nghỉ phép 2 bước TL -> HR.',
    status: 'in_progress', priority: 'medium', difficulty: 'medium',
    assignedBy: '@lead2', teamId: '@teamB',
    startDate: daysFromNowLocal(-6), dueDate: daysFromNowLocal(30),
    progress: 30, tags: [DEMO_TAG, 'leave'],
    checklists: [{
      title: 'Workflow',
      items: [
        { text: 'Draft/submit', isCompleted: true, createdAt: hoursAgo(24 * 6) },
        { text: 'Approve TL', isCompleted: true, createdAt: hoursAgo(24 * 4) },
        { text: 'Approve HR', isCompleted: false, createdAt: hoursAgo(24 * 4) },
      ],
      createdAt: hoursAgo(24 * 6),
    }],
    statusHistory: history([[null, 'in_progress', hoursAgo(24 * 6), '@lead2']]),
  });

  // 11. Child (done, watcher)
  specs.push({
    title: 'Approval workflow team lead',
    description: 'Bước phê duyệt của TL trong module Leave.',
    status: 'done', priority: 'medium', difficulty: 'medium',
    assignedBy: '@lead2', teamId: '@teamB',
    startDate: daysFromNowLocal(-5), dueDate: daysFromNowLocal(-1), completedAt: daysFromNowLocal(-1, 15),
    progress: 100, tags: [DEMO_TAG, 'leave'],
    timeEntries: [entry('@member3', 120, 'Hoàn tất approve TL', hoursAgo(24 * 2))],
    statusHistory: history([
      [null, 'in_progress', hoursAgo(24 * 5), '@member3'],
      ['in_progress', 'done', hoursAgo(24), '@member3'],
    ]),
    _meta: { linkTo: 9, watchers: ['@lead2'] },
  });

  // 12. In_progress bị block (dependency task 10 chưa done)
  specs.push({
    title: 'Fix bug OTP email reset password',
    description: 'Sửa OTP không gửi khi email trùng. Phụ thuộc epic Leave.',
    status: 'in_progress', priority: 'high', difficulty: 'medium',
    assignedBy: '@lead2', teamId: '@teamB',
    startDate: daysFromNowLocal(-2), dueDate: daysFromNowLocal(3),
    progress: 20, tags: [DEMO_TAG, 'auth', 'bug'],
    comments: [comment('@lead2', 'Ưu tiên cao, user báo OTP không nhận.', hoursAgo(12))],
    statusHistory: history([[null, 'in_progress', hoursAgo(24 * 2), '@lead2']]),
    _meta: { dependsOn: 9 },
  });

  // 13. Done (reopened rồi done lần 2 — lịch sử nhiều transitions)
  specs.push({
    title: 'Rà soát báo cáo HR quý',
    description: 'Đã hoàn thành, từng bị mở lại rồi đóng lần 2.',
    status: 'done', priority: 'low', difficulty: 'easy',
    assignedBy: '@lead2', teamId: '@teamB',
    startDate: daysFromNowLocal(-40), dueDate: daysFromNowLocal(-10), completedAt: daysFromNowLocal(-8, 11),
    progress: 100, tags: [DEMO_TAG, 'report'],
    estimatedMinutes: 60, storyPoints: 1,
    subTasks: [subtask('Xác thực số liệu', true), subtask('Gửi HR', true)],
    statusHistory: history([
      [null, 'in_progress', hoursAgo(24 * 40), '@member3'],
      ['in_progress', 'done', hoursAgo(24 * 20), '@member3'],
      ['done', 'in_progress', hoursAgo(24 * 12), '@lead2'],
      ['in_progress', 'done', hoursAgo(24 * 8), '@member3'],
    ]),
  });

  // 14. Todo dài hạn
  specs.push({
    title: 'Kế hoạch OKR quý sau',
    description: 'Thảo luận mục tiêu quý tới.',
    status: 'todo', priority: 'low', difficulty: 'easy',
    assignedBy: '@lead2', teamId: '@teamB',
    dueDate: daysFromNowLocal(60),
    tags: [DEMO_TAG, 'planning'],
    statusHistory: history([[null, 'todo', hoursAgo(24), '@lead2']]),
  });

  return specs;
};

async function seedTasks(u, t) {
  const teamA = t.a._id, teamB = t.b._id;
  const ref = key => u[String(key).replace(/^@/, '')]._id;
  const teamRef = key => (key === '@teamA' ? teamA : teamB);

  // Assignee theo chỉ số spec (trùng thứ tự taskSpecs) — giữ ổn định
  const ASSIGNEES = [
    ['lead1'], ['member1'], ['member2'], ['member1'], ['member2'],
    ['lead1', 'member1'], ['member1'], ['member2'], ['lead1', 'member1', 'member2'],
    ['lead2'], ['member3'], ['member3'], ['member3'], ['lead2'],
  ];

  const base = taskSpecs();
  const created = [];
  const metas = [];
  for (let i = 0; i < base.length; i++) {
    const { _meta, ...doc } = base[i];
    doc.teamId = teamRef(doc.teamId);
    doc.assignedBy = ref(doc.assignedBy);
    doc.assignedTo = ASSIGNEES[i].map(ref);
    doc.comments = (doc.comments || []).map(c => ({ userId: ref(c.userId), text: c.text, createdAt: c.createdAt }));
    doc.timeEntries = (doc.timeEntries || []).map(e => ({ userId: ref(e.userId), minutes: e.minutes, note: e.note, loggedAt: e.loggedAt }));
    doc.statusHistory = (doc.statusHistory || []).map(h => ({
      from: h.from, to: h.to, at: h.at, by: ref(h.by),
      teamId: doc.teamId, assignedTo: doc.assignedTo, dueDate: h.dueDate,
    }));
    created.push(await Task.create(doc));
    metas.push(_meta);
  }

  // Gắn liên kết (parent/dependency/watchers) sau khi mọi task đã có _id
  for (let i = 0; i < created.length; i++) {
    const _meta = metas[i];
    if (!_meta) continue;
    const task = created[i];
    if (_meta.linkTo !== undefined) task.parentTaskId = created[_meta.linkTo]._id;
    if (_meta.dependsOn !== undefined) task.dependencies = [created[_meta.dependsOn]._id];
    if (_meta.watchers) task.watchers = _meta.watchers.map(ref);
    await task.save();
  }
  return created;
}

// ============================ 2. LEAVES ============================
async function seedLeaves(u, t) {
  const YEAR_KEY = YEAR;
  const specs = [
    // Draft (chưa submit)
    {
      userId: u.member1._id, type: 'personal',
      startDate: daysFromNow(30), endDate: daysFromNow(30), numberOfDays: 1,
      reason: `[demo] Xin nghỉ 1 ngày cá nhân (draft, chưa submit)`,
      status: 'draft', revision: 0, currentStep: null, teamSnapshot: t.a._id, approverSnapshot: [], history: [],
    },
    // Pending team lead (team A)
    {
      userId: u.member1._id, type: 'sick',
      startDate: daysFromNow(2), endDate: daysFromNow(3), numberOfDays: 2,
      reason: `[demo] Nghỉ ốm 2 ngày — đang chờ TL phê duyệt`,
      status: 'pending_team_lead', revision: 1, currentStep: 'team_lead',
      teamSnapshot: t.a._id,
      approverSnapshot: [
        { role: 'team_lead', userId: u.lead1._id, resolvedAt: hoursAgo(24), active: true },
        { role: 'hr_manager', userId: u.member2._id, resolvedAt: hoursAgo(24), active: false },
      ],
      history: [{
        from: 'draft', to: 'pending_team_lead', action: 'submit', by: u.member1._id, at: hoursAgo(24),
        reason: '[demo] Nghỉ ốm 2 ngày', revision: 0, snapshot: null,
      }],
    },
    // Pending HR (team B — member3 không có TL snapshot demo, đi thẳng HR)
    {
      userId: u.member3._id, type: 'vacation',
      startDate: daysFromNow(10), endDate: daysFromNow(14), numberOfDays: 5,
      reason: `[demo] Nghỉ phép 5 ngày — đang chờ HR`,
      status: 'pending_hr', revision: 1, currentStep: 'hr',
      teamSnapshot: t.b._id,
      approverSnapshot: [{ role: 'hr_manager', userId: u.lead2._id, resolvedAt: hoursAgo(48), active: true }],
      history: [
        { from: 'draft', to: 'pending_team_lead', action: 'submit', by: u.member3._id, at: hoursAgo(72), reason: '[demo] Nghỉ phép 5 ngày', revision: 0, snapshot: null },
        { from: 'pending_team_lead', to: 'pending_hr', action: 'approve_team_lead', by: u.lead2._id, at: hoursAgo(48), reason: 'Đồng ý, chờ HR duyệt', revision: 1, snapshot: null },
      ],
    },
    // Approved (đồng thời trừ balance — user member2)
    {
      userId: u.member2._id, type: 'vacation',
      startDate: daysFromNow(6), endDate: daysFromNow(7), numberOfDays: 2,
      reason: `[demo] Nghỉ phép cuối tuần — đã được HR duyệt`,
      status: 'approved', revision: 2, currentStep: null,
      teamSnapshot: t.a._id,
      approverSnapshot: [
        { role: 'team_lead', userId: u.lead1._id, resolvedAt: hoursAgo(96), active: true },
        { role: 'hr_manager', userId: u.lead2._id, resolvedAt: hoursAgo(96), active: true },
      ],
      approvedBy: u.lead2._id, approvedAt: hoursAgo(72),
      history: [
        { from: 'draft', to: 'pending_team_lead', action: 'submit', by: u.member2._id, at: hoursAgo(120), reason: '[demo] Nghỉ phép', revision: 0, snapshot: null },
        { from: 'pending_team_lead', to: 'pending_hr', action: 'approve_team_lead', by: u.lead1._id, at: hoursAgo(96), reason: null, revision: 1, snapshot: null },
        { from: 'pending_hr', to: 'approved', action: 'approve', by: u.lead2._id, at: hoursAgo(72), reason: null, revision: 2, snapshot: null },
      ],
    },
    // Rejected
    {
      userId: u.member3._id, type: 'personal',
      startDate: daysFromNow(1), endDate: daysFromNow(1), numberOfDays: 1,
      reason: `[demo] Nghỉ 1 ngày đột xuất — bị từ chối (viện dẫn trùng deadline)`,
      status: 'rejected', revision: 1, currentStep: null,
      teamSnapshot: t.b._id,
      approverSnapshot: [{ role: 'hr_manager', userId: u.lead2._id, resolvedAt: hoursAgo(50), active: true }],
      rejectionReason: 'Trùng deadline release, xin đổi lịch',
      history: [
        { from: 'draft', to: 'pending_hr', action: 'submit', by: u.member3._id, at: hoursAgo(60), reason: null, revision: 0, snapshot: null },
        { from: 'pending_hr', to: 'rejected', action: 'reject', by: u.lead2._id, at: hoursAgo(50), reason: 'Trùng deadline release, xin đổi lịch', revision: 1, snapshot: null },
      ],
    },
    // Cancelled (đã submit rồi chủ rút đơn)
    {
      userId: u.member1._id, type: 'vacation',
      startDate: daysFromNow(20), endDate: daysFromNow(21), numberOfDays: 2,
      reason: `[demo] Nghỉ 2 ngày — đã submit rồi cancel`,
      status: 'cancelled', revision: 1, currentStep: null,
      teamSnapshot: t.a._id,
      approverSnapshot: [{ role: 'team_lead', userId: u.lead1._id, resolvedAt: hoursAgo(120), active: true }],
      history: [
        { from: 'draft', to: 'pending_team_lead', action: 'submit', by: u.member1._id, at: hoursAgo(120), reason: null, revision: 0, snapshot: null },
        { from: 'pending_team_lead', to: 'cancelled', action: 'cancel', by: u.member1._id, at: hoursAgo(24), reason: 'Đổi lịch khác', revision: 1, snapshot: null },
      ],
    },
  ];

  const leaves = await Leave.insertMany(specs);

  // Nhất quán balance: leave APPROVED (2 ngày) trừ vào balance member2
  await User.updateOne({ _id: u.member2._id }, {
    $set: { [`leaveBalance.${YEAR_KEY}.used`]: 2, [`leaveBalance.${YEAR_KEY}.remaining`]: 10 },
  });
  return leaves;
}

// ============================ 3. ATTENDANCE ============================
async function seedAttendance(u) {
  const OFFICE_LNGLAT = { lat: 21.0285, lng: 105.8315 }; // quanh HCM
  const near = (offsetM) => ({
    lat: +(OFFICE_LNGLAT.lat + offsetM / 111000).toFixed(6),
    lng: +(OFFICE_LNGLAT.lng + offsetM / (111000 * Math.cos(OFFICE_LNGLAT.lat * Math.PI / 180))).toFixed(6),
  });

  const day0 = atMidnight(0);
  const day1 = atMidnight(1);
  const day2 = atMidnight(-1);

  // present: vào 08:50, ra 17:45 (8h), chưa late
  const present = (user, date, inH, inM, outH, outM) => ({
    userId: user._id, date,
    clockIn: new Date(date.getTime() + inH * 3600000 + inM * 60000),
    clockOut: new Date(date.getTime() + outH * 3600000 + outM * 60000),
    location: near(20), status: 'present', workHours: 8,
  });
  // late: vào 09:20 (giờ làm việc bắt đầu 09:00)
  const late = (user, date) => ({
    userId: user._id, date,
    clockIn: new Date(date.getTime() + 9 * 3600000 + 20 * 60000),
    clockOut: null, location: near(50), status: 'late', workHours: null,
  });
  // Chưa clock-out (đang làm)
  const openDay = (user, date) => ({
    userId: user._id, date,
    clockIn: new Date(date.getTime() + 8 * 3600000 + 45 * 60000),
    clockOut: null, location: near(30), status: 'present', workHours: null,
  });
  // auto-clock-out
  const autoOut = (user, date) => ({
    userId: user._id, date,
    clockIn: new Date(date.getTime() + 9 * 3600000),
    clockOut: new Date(date.getTime() + 17 * 3600000 + 50 * 60000),
    location: near(10), status: 'present', workHours: 5.5, autoClockOut: true,
  });

  const records = [
    present(u.member1, day0, 8, 50, 17, 45),
    late(u.member2, day0),
    openDay(u.lead1, day0),
    present(u.member3, day1, 8, 30, 18, 10),
    autoOut(u.lead2, day2),
  ];
  return await Attendance.insertMany(records);
}

// ============================ 4. CONVERSATIONS + MESSAGES ============================
async function seedConversations(u) {
  const marker = `[${DEMO_TAG}]`;
  const makeConv = async (participants, lastMessage, lastMessageAt, unread) => {
    const conv = await Conversation.create({
      participants, lastMessage: `${marker} ${lastMessage}`, lastMessageAt,
      unreadCount: new Map(Object.entries(unread)),
    });
    return conv;
  };
  const msg = (conv, sender, text, { read = false, attachment = null } = {}) => ({
    conversationId: conv._id, senderId: sender._id, message: text,
    attachments: attachment ? [attachment] : [], isRead: read,
  });

  // Chat lead1 <-> member1: 4 tin, 2 tin đầu chưa đọc
  const conv1 = await makeConv(
    [u.lead1._id, u.member1._id],
    'Gửi bạn file checklist release rồi', hoursAgo(2),
    { [String(u.member1._id)]: 2, [String(u.lead1._id)]: 0 },
  );
  await Message.insertMany([
    { ...msg(conv1, u.member1, 'Anh ơi, phần API tasks gần xong rồi ạ, chỉ còn fix 2 test flaky.'), createdAt: hoursAgo(26) },
    { ...msg(conv1, u.lead1, 'Okay, gửi mình link PR nhé. Deadline thứ 6 này.', { read: true }), createdAt: hoursAgo(25) },
    { ...msg(conv1, u.member1, 'Em gửi file checklist rồi, anh xem giúp em.', { read: true, attachment: demoAttachment('release-checklist.pdf', 'application/pdf') }), createdAt: hoursAgo(3) },
    { ...msg(conv1, u.lead1, 'Gửi bạn file checklist release rồi', { read: true }), createdAt: hoursAgo(2) },
  ]);
  conv1.unreadCount = new Map(Object.entries({ [String(u.member1._id)]: 2, [String(u.lead1._id)]: 0 }));
  await conv1.save();

  // Chat lead2 <-> member3: 2 tin
  const conv2 = await makeConv(
    [u.lead2._id, u.member3._id],
    'Đơn nghỉ ngày mai anh duyệt giúp em', hoursAgo(5),
    { [String(u.member3._id)]: 1, [String(u.lead2._id)]: 0 },
  );
  await Message.insertMany([
    { ...msg(conv2, u.member3, 'Đơn nghỉ phép em vừa submit, anh xem giúp ạ.'), createdAt: hoursAgo(6) },
    { ...msg(conv2, u.lead2, 'Đơn nghỉ ngày mai anh duyệt giúp em', { read: true }), createdAt: hoursAgo(5) },
  ]);
  conv2.unreadCount = new Map(Object.entries({ [String(u.member3._id)]: 1, [String(u.lead2._id)]: 0 }));
  await conv2.save();

  return [conv1, conv2];
}

// ============================ 5. NOTIFICATIONS ============================
async function seedNotifications(u, tasks, leaves) {
  const n = (userId, type, title, message, relatedId = null, isRead = false) => ({
    userId, type, title, message: `[demo] ${message}`, relatedId, isRead,
  });
  const [task] = tasks;
  const approved = leaves.find(l => l.status === 'approved');
  const pending = leaves.find(l => l.status === 'pending_team_lead');
  return await Notification.insertMany([
    n(u.member1._id, 'task_assigned', 'Task mới được giao', 'Bạn được giao "Hoàn thiện API Tasks (epic)".', task._id),
    n(u.member1._id, 'task_completed', 'Task đã hoàn thành', 'Task "Cài đặt CI pipeline" đã được đánh dấu hoàn thành.', tasks[6]._id, true),
    n(u.member2._id, 'comment_added', 'Bình luận mới', 'Lê Văn Cường bình luận: "Mình đã xong phần schema, còn phần service."', tasks[2]._id),
    n(u.lead1._id, 'deadline_reminder', 'Nhắc hạn chót', 'Task "Họp tổng kết sprint" đến hạn trong 4 ngày.', tasks[8]._id),
    n(u.member1._id, 'task_overdue', 'Task quá hạn', 'Task "Đẩy version 1.2 lên production" đã quá hạn.', tasks[5]._id),
    n(u.lead1._id, 'leave_pending', 'Đơn nghỉ chờ duyệt', 'Có đơn nghỉ ốm 2 ngày đang chờ anh phê duyệt.', pending?._id),
    n(u.member2._id, 'leave_approved', 'Đơn nghỉ được duyệt', 'Đơn nghỉ phép 2 ngày đã được HR duyệt.', approved?._id, true),
    n(u.lead2._id, 'attendance_reminder', 'Nhắc chấm công', 'Chưa thấy chấm công hôm nay, vui lòng check-in.', null, true),
  ]);
}

// ============================ 6. OFFICE ============================
async function seedOffice() {
  const office = await Office.findOne({ name: 'Văn phòng Demo' });
  if (office) return office;
  return await Office.create({
    name: 'Văn phòng Demo',
    address: '105 Nguyễn Văn Trỗi, Phú Nhuận, TP. HCM',
    location: { lat: 21.0285, lng: 105.8315 },
    radius: 300,
    workingHours: { start: '09:00', end: '18:00' },
    isActive: true,
  });
}

// ============================ MAIN ============================
async function seed() {
  await mongoose.connect(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/tma_demo');
  console.log('Connected to MongoDB');

  const u = await resolveUsers();
  const t = await resolveTeams();

  await cleanDemoData();

  const tasks = await seedTasks(u, t);
  const leaves = await seedLeaves(u, t);
  const attendance = await seedAttendance(u);
  const conversations = await seedConversations(u);
  const notifications = await seedNotifications(u, tasks, leaves);
  const office = await seedOffice();

  const taskStatus = await Task.aggregate([
    { $match: { tags: { $in: [DEMO_TAG] } } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const leaveStatus = await Leave.aggregate([
    { $match: { reason: { $regex: `\\[${DEMO_TAG}\\]` } } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const fmt = arr => Object.fromEntries(arr.map(x => [x._id, x.n]));

  console.log('\n=== Seed dữ liệu demo thành công ===');
  console.log(`Tasks: ${tasks.length} (theo status: ${JSON.stringify(fmt(taskStatus))})`);
  console.log(`Leaves: ${leaves.length} (theo status: ${JSON.stringify(fmt(leaveStatus))})`);
  console.log(`Attendance: ${attendance.length} bản ghi`);
  console.log(`Conversations: ${conversations.length} (${await Message.countDocuments({})} messages)`);
  console.log(`Notifications: ${notifications.length}`);
  console.log(`Office active: "${office.name}" (radius ${office.radius}m, ${office.workingHours.start}-${office.workingHours.end})`);
  console.log('Chạy lại script sẽ tự dọn dữ liệu demo và tạo mới (idempotent).');
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error('Seed demo error:', error);
  await mongoose.disconnect();
  process.exit(1);
});
