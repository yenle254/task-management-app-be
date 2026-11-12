/**
 * Seed DỮ LIỆU GIẢ LẬP cho 5 team / 20 tài khoản @gmail.com (tạo bởi seed-demo-users.js).
 *
 * Mỗi team (1 leader + 3 employee) nhận:
 *   - 20 task phủ toàn bộ tính năng: epic parent/child, dependencies (bị block + đã thỏa),
 *     watchers, checklists, subtasks, comments, attachments, estimate/storyPoints,
 *     time entries (actualMinutes), review workflow (in_review, changes_requested,
 *     vòng 2, approved), done (rải nhiều tuần cho biểu đồ thống kê, đúng hạn/trễ hạn),
 *     reopened, overdue, soft delete, sự kiện calendar/timeline, đa người nhận.
 *   - 6 đơn nghỉ đủ trạng thái (draft, pending_team_lead, pending_hr, approved,
 *     rejected, cancelled) + leaveBalance nhất quán.
 *   - Chấm công 14 ngày gần nhất (đúng giờ, đi muộn, auto clock-out, hôm nay chưa về).
 *   - Hội thoại chat (lead <-> member, member <-> member, lead <-> lead) có tin chưa đọc.
 *   - Notifications đủ mọi loại (task_*, review_*, leave_*, attendance_reminder).
 *
 * Idempotent: chạy lại sẽ xóa dữ liệu cũ của các tài khoản @gmail.com demo rồi tạo mới.
 * Chạy độc lập: node demo_project/seed-gmail-users-data.js
 * (seed-task-users.js cũng tự gọi file này ở cuối.)
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
const UPLOADS = path.join(__dirname, '..', 'uploads');

// ============================ Cấu hình team ============================
const TEAMS = [
  {
    key: 'mobile', teamName: 'Nhóm Mobile', lead: 'leader.minhquan@gmail.com',
    members: ['nv.thanhtung@gmail.com', 'nv.khanhlinh@gmail.com', 'nv.quochuy@gmail.com'],
  },
  {
    key: 'qa', teamName: 'Nhóm Kiểm thử', lead: 'leader.thuha@gmail.com',
    members: ['nv.maianh@gmail.com', 'nv.vanhieu@gmail.com', 'nv.thuytrang@gmail.com'],
  },
  {
    key: 'devops', teamName: 'Nhóm DevOps', lead: 'leader.ducthang@gmail.com',
    members: ['nv.ducanh@gmail.com', 'nv.minhtri@gmail.com', 'nv.baongoc@gmail.com'],
  },
  {
    key: 'design', teamName: 'Nhóm Thiết kế UI/UX', lead: 'leader.ngoclan@gmail.com',
    members: ['nv.phuongthao@gmail.com', 'nv.giabao@gmail.com', 'nv.hongnhung@gmail.com'],
  },
  {
    key: 'data', teamName: 'Nhóm Dữ liệu', lead: 'leader.hoanglong@gmail.com',
    members: ['nv.tuankiet@gmail.com', 'nv.myduyen@gmail.com', 'nv.vietdung@gmail.com'],
  },
];

// 20 tiêu đề theo chủ đề mỗi team — thứ tự khớp với 20 "slot" tính năng bên dưới.
// [title, description, tag]
const THEMES = {
  mobile: [
    ['Ứng dụng mobile v2.0 (epic)', 'Epic tổng: nâng cấp app React Native lên v2.0.', 'epic'],
    ['Màn hình đăng nhập sinh trắc học', 'Face ID / vân tay cho iOS và Android.', 'auth'],
    ['Màn hình danh sách task dạng Kanban', 'Kéo thả task giữa các cột trạng thái.', 'ui'],
    ['Push notification qua Expo', 'Đăng ký token và xử lý thông báo foreground/background.', 'notification'],
    ['Chế độ offline + đồng bộ', 'Cache dữ liệu và đồng bộ lại khi có mạng.', 'offline'],
    ['Fix crash khi mở ảnh đính kèm', 'App crash trên Android 14 khi mở file PNG lớn.', 'bug'],
    ['Cập nhật icon & splash screen', 'Theo bộ nhận diện mới của công ty.', 'ui'],
    ['Tối ưu thời gian khởi động app', 'Giảm cold start xuống dưới 2 giây.', 'performance'],
    ['Tích hợp bản đồ chấm công', 'Hiển thị vị trí văn phòng và bán kính check-in.', 'attendance'],
    ['Màn hình hồ sơ cá nhân', 'Sửa avatar, số điện thoại, đổi mật khẩu.', 'profile'],
    ['Màn hình chat 1-1', 'Gửi tin nhắn, ảnh và trạng thái đã đọc.', 'chat'],
    ['Dark mode toàn ứng dụng', 'Theme sáng/tối theo hệ thống.', 'ui'],
    ['Demo app cho khách hàng', 'Buổi demo v2.0 với khách hàng.', 'meeting'],
    ['Nghiên cứu chuyển sang New Architecture', 'Đánh giá Fabric/TurboModules.', 'research'],
    ['Màn hình lịch & timeline task', 'Calendar view và Gantt timeline.', 'ui'],
    ['Widget màn hình chính (đã hủy)', 'Đã hủy do đổi ưu tiên.', 'ui'],
    ['Đa ngôn ngữ Việt/Anh', 'i18n toàn bộ chuỗi giao diện.', 'i18n'],
    ['Phát hành bản beta lên TestFlight', 'Build và gửi bản beta cho tester.', 'release'],
    ['Viết test E2E với Detox', 'Phủ luồng đăng nhập, tạo task, chấm công.', 'test'],
    ['Rà soát accessibility', 'Kích thước chữ, tương phản, screen reader.', 'a11y'],
  ],
  qa: [
    ['Kế hoạch kiểm thử release Q4 (epic)', 'Epic: toàn bộ hoạt động QA cho release Q4.', 'epic'],
    ['Viết test case module Task', 'Test case CRUD, review, dependency.', 'testcase'],
    ['Kiểm thử module Nghỉ phép', 'Luồng 2 bước Team Lead -> HR.', 'leave'],
    ['Regression test module Chấm công', 'GPS, đi muộn, auto clock-out.', 'regression'],
    ['Kiểm thử hiệu năng API', 'Load test 500 CCU bằng k6.', 'performance'],
    ['Bug: thông báo bị gửi trùng', 'User nhận 2 notification cho 1 sự kiện.', 'bug'],
    ['Cập nhật bộ dữ liệu test', 'Dữ liệu test cho môi trường staging.', 'data'],
    ['Báo cáo chất lượng sprint 12', 'Tổng hợp bug theo mức độ.', 'report'],
    ['Automation test đăng nhập', 'Script Playwright cho web admin.', 'automation'],
    ['Kiểm thử bảo mật OWASP Top 10', 'SQL injection, XSS, IDOR.', 'security'],
    ['Smoke test bản hotfix 1.1.3', 'Kiểm tra nhanh trước khi phát hành.', 'smoke'],
    ['Kiểm thử tương thích thiết bị', 'Ma trận 12 thiết bị iOS/Android.', 'compatibility'],
    ['Họp bug triage hàng tuần', 'Phân loại và gán bug mới.', 'meeting'],
    ['Đánh giá công cụ quản lý test', 'So sánh TestRail và Zephyr.', 'research'],
    ['Kiểm thử luồng chat realtime', 'Socket reconnect, tin chưa đọc.', 'chat'],
    ['Test thủ công trình duyệt IE (đã hủy)', 'Đã hủy — không còn hỗ trợ IE.', 'legacy'],
    ['Kiểm thử phân quyền theo vai trò', 'HR, Team Lead, Employee.', 'security'],
    ['UAT với phòng nhân sự', 'Nghiệm thu cùng người dùng cuối.', 'uat'],
    ['Viết tài liệu quy trình QA', 'Quy trình từ test plan tới sign-off.', 'docs'],
    ['Kiểm thử API thống kê', 'So khớp số liệu dashboard.', 'api'],
  ],
  devops: [
    ['Chuyển hạ tầng lên Kubernetes (epic)', 'Epic: container hóa và triển khai lên K8s.', 'epic'],
    ['Viết Dockerfile cho backend', 'Multi-stage build, image < 200MB.', 'docker'],
    ['Helm chart cho các service', 'Chart cho API, worker, MongoDB.', 'k8s'],
    ['Cấu hình ingress + TLS', 'Cert-manager với Let\'s Encrypt.', 'network'],
    ['Autoscaling theo CPU', 'HPA cho API khi tải cao.', 'k8s'],
    ['Sự cố: disk đầy trên server log', 'Dọn log và cấu hình logrotate gấp.', 'incident'],
    ['Gia hạn chứng chỉ domain', 'Chứng chỉ sắp hết hạn.', 'security'],
    ['Sao lưu MongoDB hằng ngày', 'Backup tự động lên S3.', 'backup'],
    ['Pipeline CI GitHub Actions', 'Lint, test, build image.', 'ci'],
    ['Giám sát bằng Prometheus', 'Thu thập metric API và DB.', 'monitoring'],
    ['Dashboard Grafana', 'Biểu đồ latency, error rate.', 'monitoring'],
    ['Cảnh báo qua Slack', 'Alertmanager gửi cảnh báo.', 'alert'],
    ['Diễn tập khôi phục thảm họa', 'Khôi phục DB từ bản backup.', 'meeting'],
    ['Đánh giá chi phí cloud', 'Tối ưu chi phí hạ tầng năm sau.', 'cost'],
    ['Quản lý secret bằng Vault', 'Bỏ secret khỏi biến môi trường.', 'security'],
    ['Chuyển sang Jenkins (đã hủy)', 'Đã hủy — giữ GitHub Actions.', 'ci'],
    ['Môi trường staging tự động', 'Mỗi PR có môi trường preview.', 'ci'],
    ['Triển khai production v2.0', 'Rolling update không downtime.', 'release'],
    ['Hardening server', 'Firewall, SSH key, cập nhật bảo mật.', 'security'],
    ['Tài liệu runbook vận hành', 'Hướng dẫn xử lý sự cố thường gặp.', 'docs'],
  ],
  design: [
    ['Thiết kế lại hệ thống UI (epic)', 'Epic: design system mới cho web và mobile.', 'epic'],
    ['Bộ màu & typography', 'Palette, font, khoảng cách chuẩn.', 'design-system'],
    ['Thiết kế màn hình Dashboard', 'Dashboard cho HR và Team Lead.', 'ui'],
    ['Bộ component nút & form', 'Button, input, select, date picker.', 'component'],
    ['Prototype luồng tạo task', 'Prototype tương tác trên Figma.', 'prototype'],
    ['Sửa lỗi lệch layout trên tablet', 'Màn hình chi tiết task vỡ layout.', 'bug'],
    ['Bộ icon mới', '60 icon line style.', 'icon'],
    ['Phỏng vấn người dùng', 'Phỏng vấn 8 nhân viên về trải nghiệm app.', 'research'],
    ['Thiết kế màn hình chấm công', 'Nút check-in, bản đồ, lịch sử.', 'ui'],
    ['Thiết kế màn hình nghỉ phép', 'Form xin nghỉ và trạng thái duyệt.', 'ui'],
    ['Onboarding cho người dùng mới', '3 màn hình giới thiệu tính năng.', 'ui'],
    ['Thiết kế empty state', 'Minh họa khi không có dữ liệu.', 'illustration'],
    ['Review thiết kế với team dev', 'Bàn giao thiết kế sprint mới.', 'meeting'],
    ['Nghiên cứu xu hướng UI 2027', 'Tổng hợp xu hướng thiết kế.', 'research'],
    ['Style guide cho dark mode', 'Màu sắc và độ tương phản chế độ tối.', 'design-system'],
    ['Thiết kế landing page (đã hủy)', 'Đã hủy do đổi chiến lược marketing.', 'web'],
    ['Thiết kế màn hình thống kê', 'Biểu đồ hiệu suất cá nhân và team.', 'ui'],
    ['Usability test bản prototype', 'Test với 5 người dùng.', 'research'],
    ['Animation chuyển màn hình', 'Micro-interaction cho các thao tác chính.', 'motion'],
    ['Tài liệu hướng dẫn design system', 'Quy tắc sử dụng component.', 'docs'],
  ],
  data: [
    ['Kho dữ liệu nhân sự (epic)', 'Epic: xây dựng data warehouse cho HR.', 'epic'],
    ['Thiết kế schema data warehouse', 'Star schema cho task, nghỉ phép, chấm công.', 'schema'],
    ['ETL dữ liệu chấm công', 'Đồng bộ attendance hằng đêm.', 'etl'],
    ['ETL dữ liệu task', 'Trích xuất statusHistory phục vụ thống kê.', 'etl'],
    ['Báo cáo hiệu suất theo team', 'Dashboard Power BI cho ban giám đốc.', 'report'],
    ['Sai lệch số liệu giờ làm', 'Tổng giờ làm lệch so với hệ thống gốc.', 'bug'],
    ['Làm sạch dữ liệu nhân viên cũ', 'Chuẩn hóa phòng ban, chức danh.', 'cleaning'],
    ['Phân tích tỉ lệ đi muộn', 'Xu hướng đi muộn theo tháng.', 'analysis'],
    ['Mô hình dự đoán nghỉ việc', 'Thử nghiệm mô hình phân loại.', 'ml'],
    ['Phân tích thời gian hoàn thành task', 'Lead time và cycle time.', 'analysis'],
    ['Báo cáo nghỉ phép quý', 'Tổng hợp ngày nghỉ theo loại.', 'report'],
    ['Data dictionary', 'Mô tả các bảng và trường dữ liệu.', 'docs'],
    ['Trình bày kết quả phân tích', 'Báo cáo trước ban giám đốc.', 'meeting'],
    ['Đánh giá nền tảng BigQuery', 'So sánh chi phí và hiệu năng.', 'research'],
    ['Pipeline kiểm tra chất lượng dữ liệu', 'Great Expectations cho các bảng chính.', 'quality'],
    ['Báo cáo Excel thủ công (đã hủy)', 'Đã hủy — thay bằng dashboard.', 'report'],
    ['Phân quyền truy cập dữ liệu', 'Row-level security theo phòng ban.', 'security'],
    ['Báo cáo KPI tháng', 'KPI hoàn thành task từng nhân viên.', 'report'],
    ['Tối ưu truy vấn thống kê', 'Index và aggregation pipeline.', 'performance'],
    ['Hướng dẫn tự phục vụ dữ liệu', 'Tài liệu cho người dùng nghiệp vụ.', 'docs'],
  ],
};

// ============================ Helpers ============================
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n, hour = 9, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const hoursAgo = n => new Date(Date.now() - n * 60 * 60 * 1000);
const atMidnight = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d; };
const minutesOf = entries => entries.reduce((s, e) => s + e.minutes, 0);

// Tạo file đính kèm demo trong uploads (nếu chưa có) để link mở được trên giao diện.
function ensureDemoFile(filename, content) {
  if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
  const filePath = path.join(UPLOADS, filename);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content);
}
function demoImage(filename) {
  if (!fs.existsSync(UPLOADS)) return null;
  const target = path.join(UPLOADS, filename);
  if (!fs.existsSync(target)) {
    const png = fs.readdirSync(UPLOADS).find(f => f.toLowerCase().endsWith('.png') && f !== filename);
    if (!png) return null;
    fs.copyFileSync(path.join(UPLOADS, png), target);
  }
  return { name: filename, url: `/uploads/${filename}`, filename, type: 'image/png' };
}
function attachmentsFor(teamKey) {
  const spec = `demo-gmail-${teamKey}-spec.txt`;
  const report = `demo-gmail-${teamKey}-report.csv`;
  ensureDemoFile(spec, `Tài liệu đặc tả demo - team ${teamKey}\n\n1. Mục tiêu\n2. Phạm vi\n3. Tiêu chí nghiệm thu\n`);
  ensureDemoFile(report, 'hang_muc,trang_thai,ghi_chu\nPhan tich,Xong,OK\nTrien khai,Dang lam,\nKiem thu,Chua bat dau,\n');
  return {
    spec: { name: spec, url: `/uploads/${spec}`, filename: spec, type: 'text/plain' },
    report: { name: report, url: `/uploads/${report}`, filename: report, type: 'text/csv' },
    image: demoImage(`demo-gmail-${teamKey}-mockup.png`),
  };
}

// ============================ Resolve users/teams ============================
async function resolveTeamContexts() {
  const contexts = [];
  for (const cfg of TEAMS) {
    const emails = [cfg.lead, ...cfg.members];
    const users = await User.find({ email: { $in: emails } }).select('_id email role profile.fullName');
    const byEmail = Object.fromEntries(users.map(u => [u.email, u]));
    const missing = emails.filter(e => !byEmail[e]);
    const team = await Team.findOne({ name: cfg.teamName });
    if (missing.length || !team) {
      throw new Error(`Thiếu user/team @gmail.com (${missing.join(', ') || cfg.teamName}). Chạy 'node demo_project/seed-demo-users.js' trước.`);
    }
    contexts.push({
      cfg, team,
      lead: byEmail[cfg.lead],
      members: cfg.members.map(e => byEmail[e]),
    });
  }
  return contexts;
}

// ============================ Cleanup ============================
async function cleanGmailDemoData(contexts) {
  const teamIds = contexts.map(c => c.team._id);
  const userIds = contexts.flatMap(c => [c.lead._id, ...c.members.map(m => m._id)]);
  const r = {};
  r.tasks = (await Task.deleteMany({ teamId: { $in: teamIds }, tags: { $in: [DEMO_TAG] } })).deletedCount;
  r.leaves = (await Leave.deleteMany({ userId: { $in: userIds } })).deletedCount;
  r.attendance = (await Attendance.deleteMany({ userId: { $in: userIds } })).deletedCount;
  // Chỉ xóa hội thoại mà mọi người tham gia đều là tài khoản demo @gmail.com
  const convs = await Conversation.find({ participants: { $not: { $elemMatch: { $nin: userIds } } } }).select('_id');
  const convIds = convs.map(c => c._id);
  r.messages = (await Message.deleteMany({ conversationId: { $in: convIds } })).deletedCount;
  r.conversations = (await Conversation.deleteMany({ _id: { $in: convIds } })).deletedCount;
  r.notifications = (await Notification.deleteMany({ userId: { $in: userIds } })).deletedCount;
  const total = Object.values(r).reduce((s, n) => s + n, 0);
  if (total) console.log(`[gmail] Đã dọn ${total} tài liệu cũ ${JSON.stringify(r)}`);
}

// ============================ 1. TASKS ============================
/**
 * Xây 20 task cho 1 team. Dùng insertMany (bỏ qua hook save) nên mọi trường
 * dẫn xuất (progress, actualMinutes, completedAt, statusHistory, review) được
 * tính sẵn cho nhất quán với dữ liệu thật.
 */
function buildTeamTasks(ctx, files) {
  const { team, lead } = ctx;
  const [m1, m2, m3] = ctx.members;
  const theme = THEMES[ctx.cfg.key];
  const teamId = team._id;

  const hist = (assignedTo, dueDate, steps) => {
    let from = null;
    return steps.map(([to, at, by]) => {
      const e = { from, to, at, by: by._id, teamId, assignedTo, dueDate: dueDate || null };
      from = to;
      return e;
    });
  };
  const entry = (u, minutes, note, at) => ({ userId: u._id, minutes, note, loggedAt: at });
  const comment = (u, text, at) => ({ userId: u._id, text, createdAt: at });
  const sub = (title, isCompleted) => ({ title, isCompleted });
  const approver = at => [{ userId: lead._id, role: 'team_lead', active: true, resolvedAt: at }];
  const reviewDone = (by, submittedAt, approvedAt, round = 1, extraRounds = []) => ({
    submittedBy: by._id, submittedAt, note: 'Đã hoàn thành, nhờ anh/chị review', currentRound: round,
    approverSnapshot: approver(submittedAt),
    rounds: [...extraRounds,
      { round, type: 'submitted', by: by._id, at: submittedAt, note: 'Đã hoàn thành, nhờ anh/chị review' },
      { round, type: 'approved', by: lead._id, at: approvedAt, note: 'Đạt yêu cầu' }],
  });

  const T = i => ({ title: theme[i][0], description: theme[i][1], tags: [DEMO_TAG, theme[i][2]] });
  const base = { teamId, assignedBy: lead._id };
  const tasks = [];
  const meta = [];
  const push = (doc, m = {}) => {
    const progress = doc.subTasks?.length
      ? Math.round(doc.subTasks.filter(s => s.isCompleted).length / doc.subTasks.length * 100)
      : doc.progress ?? 0;
    tasks.push({
      ...base, ...doc,
      progress: ['done', 'in_review'].includes(doc.status) ? 100 : progress,
      actualMinutes: minutesOf(doc.timeEntries || []),
      completedAt: doc.status === 'done' ? (doc.statusHistory.filter(h => h.to === 'done').at(-1)?.at || new Date()) : null,
    });
    meta.push(m);
  };

  // 0. Epic parent — in_progress, checklist một phần, watchers, estimate, comments
  {
    const due = daysFromNow(25); const to = [lead._id, m1._id, m2._id, m3._id];
    push({
      ...T(0), status: 'in_progress', priority: 'high', difficulty: 'hard',
      assignedTo: to, startDate: daysFromNow(-21), dueDate: due, progress: 45,
      estimatedMinutes: 2400, storyPoints: 21,
      checklists: [{
        title: 'Mốc chính', createdAt: hoursAgo(24 * 21),
        items: [
          { text: 'Chốt phạm vi', isCompleted: true, createdAt: hoursAgo(24 * 21) },
          { text: 'Hoàn thành giai đoạn 1', isCompleted: true, createdAt: hoursAgo(24 * 20) },
          { text: 'Hoàn thành giai đoạn 2', isCompleted: false, createdAt: hoursAgo(24 * 20) },
          { text: 'Nghiệm thu', isCompleted: false, createdAt: hoursAgo(24 * 20) },
        ],
      }],
      timeEntries: [entry(lead, 180, 'Lập kế hoạch epic', hoursAgo(24 * 20)), entry(lead, 90, 'Họp tiến độ', hoursAgo(24 * 6))],
      comments: [
        comment(lead, 'Mọi người cập nhật tiến độ các task con trước thứ 6 nhé.', hoursAgo(24 * 5)),
        comment(m1, 'Phần của em đã xong và được duyệt.', hoursAgo(24 * 4)),
        comment(m3, 'Em đang sửa theo góp ý review, dự kiến xong ngày mai.', hoursAgo(20)),
      ],
      attachments: [files.spec],
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 21), lead], ['in_progress', hoursAgo(24 * 19), lead]]),
    }, { watchers: [lead, m1, m2, m3] });
  }

  // 1. Child DONE — review approved, subtasks hoàn tất, time entries
  {
    const due = daysFromNow(-6, 17); const to = [m1._id];
    const sub1 = hoursAgo(24 * 8); const ok = hoursAgo(24 * 7);
    push({
      ...T(1), status: 'done', priority: 'high', difficulty: 'medium',
      assignedTo: to, startDate: daysFromNow(-18), dueDate: due,
      estimatedMinutes: 600, storyPoints: 5,
      subTasks: [sub('Phân tích yêu cầu', true), sub('Triển khai', true), sub('Tự kiểm tra', true)],
      timeEntries: [entry(m1, 240, 'Triển khai chính', hoursAgo(24 * 12)), entry(m1, 180, 'Hoàn thiện', hoursAgo(24 * 9)), entry(m1, 60, 'Sửa nhỏ', hoursAgo(24 * 8))],
      comments: [comment(lead, 'Làm tốt lắm!', ok)],
      review: reviewDone(m1, sub1, ok),
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 18), lead], ['in_progress', hoursAgo(24 * 15), m1], ['in_review', sub1, m1], ['done', ok, lead]]),
    }, { parent: 0 });
  }

  // 2. Child IN_REVIEW — chờ leader duyệt, có ảnh đính kèm
  {
    const due = daysFromNow(2, 17); const to = [m2._id]; const at = hoursAgo(26);
    push({
      ...T(2), status: 'in_review', priority: 'medium', difficulty: 'medium',
      assignedTo: to, startDate: daysFromNow(-10), dueDate: due,
      estimatedMinutes: 480, storyPoints: 5,
      subTasks: [sub('Bản nháp', true), sub('Hoàn thiện', true)],
      timeEntries: [entry(m2, 200, 'Thực hiện', hoursAgo(24 * 5)), entry(m2, 150, 'Hoàn thiện', hoursAgo(30))],
      attachments: [files.image, files.report].filter(Boolean),
      comments: [comment(m2, 'Em đã gửi review, anh/chị xem giúp em ạ.', at)],
      review: {
        submittedBy: m2._id, submittedAt: at, note: 'Sẵn sàng review', currentRound: 1, approverSnapshot: approver(at),
        rounds: [{ round: 1, type: 'submitted', by: m2._id, at, note: 'Sẵn sàng review' }],
      },
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 10), lead], ['in_progress', hoursAgo(24 * 8), m2], ['in_review', at, m2]]),
    }, { parent: 0, watchers: [lead] });
  }

  // 3. Child IN_PROGRESS — bị yêu cầu sửa (changes_requested)
  {
    const due = daysFromNow(4, 17); const to = [m3._id];
    const s = hoursAgo(50); const back = hoursAgo(28);
    push({
      ...T(3), status: 'in_progress', priority: 'high', difficulty: 'hard',
      assignedTo: to, startDate: daysFromNow(-9), dueDate: due,
      estimatedMinutes: 720, storyPoints: 8,
      subTasks: [sub('Triển khai cơ bản', true), sub('Xử lý trường hợp biên', true), sub('Sửa theo góp ý review', false)],
      timeEntries: [entry(m3, 300, 'Triển khai', hoursAgo(24 * 4)), entry(m3, 90, 'Sửa theo review', hoursAgo(10))],
      comments: [
        comment(lead, 'Cần bổ sung xử lý khi mất kết nối và thêm test case.', back),
        comment(m3, 'Dạ em sẽ bổ sung ngay.', hoursAgo(27)),
      ],
      review: {
        submittedBy: m3._id, submittedAt: s, note: 'Xong phần chính', currentRound: 1, approverSnapshot: approver(s),
        rounds: [
          { round: 1, type: 'submitted', by: m3._id, at: s, note: 'Xong phần chính' },
          { round: 1, type: 'changes_requested', by: lead._id, at: back, reason: 'Cần bổ sung xử lý khi mất kết nối và thêm test case.' },
        ],
      },
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 9), lead], ['in_progress', hoursAgo(24 * 7), m3], ['in_review', s, m3], ['in_progress', back, lead]]),
    }, { parent: 0 });
  }

  // 4. Child TODO — bị block bởi task 3 (dependency chưa xong)
  {
    const due = daysFromNow(12, 17); const to = [m1._id];
    push({
      ...T(4), status: 'todo', priority: 'medium', difficulty: 'hard',
      assignedTo: to, startDate: daysFromNow(5), dueDate: due,
      estimatedMinutes: 900, storyPoints: 8,
      checklists: [{ title: 'Chuẩn bị', createdAt: hoursAgo(48), items: [
        { text: 'Đọc tài liệu kỹ thuật', isCompleted: true, createdAt: hoursAgo(48) },
        { text: 'Chờ task phụ thuộc hoàn tất', isCompleted: false, createdAt: hoursAgo(48) },
      ] }],
      comments: [comment(m1, 'Task này phải chờ task phụ thuộc xong mới bắt đầu được.', hoursAgo(30))],
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 3), lead]]),
    }, { parent: 0, depends: [3] });
  }

  // 5. OVERDUE in_progress — ưu tiên cao, quá hạn 3 ngày
  {
    const due = daysFromNow(-3, 17); const to = [m2._id];
    push({
      ...T(5), status: 'in_progress', priority: 'high', difficulty: 'hard',
      assignedTo: to, startDate: daysFromNow(-8), dueDate: due, progress: 70,
      timeEntries: [entry(m2, 240, 'Điều tra nguyên nhân', hoursAgo(24 * 5)), entry(m2, 120, 'Thử nghiệm giải pháp', hoursAgo(24 * 2))],
      comments: [comment(lead, 'Task đã quá hạn, cần cập nhật tình hình gấp.', hoursAgo(24)), comment(m2, 'Em đã tìm ra nguyên nhân, đang sửa.', hoursAgo(20))],
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 8), lead], ['in_progress', hoursAgo(24 * 7), m2]]),
    }, { watchers: [lead, m1] });
  }

  // 6. OVERDUE todo — chưa bắt đầu, quá hạn 1 ngày
  {
    const due = daysFromNow(-1, 17); const to = [m3._id];
    push({
      ...T(6), status: 'todo', priority: 'medium', difficulty: 'easy',
      assignedTo: to, startDate: daysFromNow(-4), dueDate: due,
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 5), lead]]),
    });
  }

  // 7. DONE nhưng từng bị REOPEN (2 vòng review)
  {
    const due = daysFromNow(-12, 17); const to = [m1._id];
    const s1 = hoursAgo(24 * 22), a1 = hoursAgo(24 * 21), re = hoursAgo(24 * 17), s2 = hoursAgo(24 * 14), a2 = hoursAgo(24 * 13);
    push({
      ...T(7), status: 'done', priority: 'medium', difficulty: 'medium',
      assignedTo: to, startDate: daysFromNow(-28), dueDate: due,
      estimatedMinutes: 480, storyPoints: 3,
      timeEntries: [entry(m1, 300, 'Lần 1', hoursAgo(24 * 23)), entry(m1, 120, 'Sửa sau khi mở lại', hoursAgo(24 * 15))],
      comments: [comment(lead, 'Mở lại task vì phát hiện lỗi sau khi phát hành.', re)],
      review: reviewDone(m1, s2, a2, 2, [
        { round: 1, type: 'submitted', by: m1._id, at: s1, note: 'Hoàn thành lần 1' },
        { round: 1, type: 'approved', by: lead._id, at: a1, note: 'OK' },
      ]),
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 28), lead], ['in_progress', hoursAgo(24 * 26), m1], ['in_review', s1, m1], ['done', a1, lead],
        ['in_progress', re, lead], ['in_review', s2, m1], ['done', a2, lead]]),
    });
  }

  // 8–11. DONE rải theo tuần (biểu đồ thống kê) — có task đúng hạn & trễ hạn
  const doneSpread = [
    { i: 8, who: [m2], weeksAgo: 6, late: false, pr: 'low', df: 'easy', est: 240 },
    { i: 9, who: [m3], weeksAgo: 4, late: true, pr: 'medium', df: 'medium', est: 360 },
    { i: 10, who: [m1, m2], weeksAgo: 2, late: false, pr: 'high', df: 'hard', est: 900 },
    { i: 11, who: [m3], weeksAgo: 0, late: false, pr: 'medium', df: 'easy', est: 180 },
  ];
  for (const d of doneSpread) {
    const doneDay = -7 * d.weeksAgo - 1;
    const due = daysFromNow(d.late ? doneDay - 2 : doneDay + 2, 17);
    const to = d.who.map(u => u._id);
    const s = daysFromNow(doneDay, 10); const a = daysFromNow(doneDay, 15);
    const entries = d.who.map((u, k) => entry(u, Math.round(d.est * (k ? 0.4 : 0.8)), 'Thực hiện', daysFromNow(doneDay - 2, 14)));
    push({
      ...T(d.i), status: 'done', priority: d.pr, difficulty: d.df,
      assignedTo: to, startDate: daysFromNow(doneDay - 7), dueDate: due,
      estimatedMinutes: d.est, storyPoints: Math.max(1, Math.round(d.est / 120)),
      subTasks: [sub('Chuẩn bị', true), sub('Thực hiện', true)],
      timeEntries: entries,
      comments: d.late ? [comment(lead, 'Hoàn thành nhưng trễ hạn 2 ngày, lần sau báo sớm nhé.', a)] : [],
      review: reviewDone(d.who[0], s, a),
      statusHistory: hist(to, due, [['todo', daysFromNow(doneDay - 8), lead], ['in_progress', daysFromNow(doneDay - 7), d.who[0]], ['in_review', s, d.who[0]], ['done', a, lead]]),
    });
  }

  // 12. Sự kiện calendar — họp sắp tới (start/due cùng ngày), cả team
  {
    const due = daysFromNow(3, 15, 30); const to = [lead._id, m1._id, m2._id, m3._id];
    push({
      ...T(12), status: 'todo', priority: 'medium', difficulty: 'easy',
      assignedTo: to, startDate: daysFromNow(3, 14), dueDate: due,
      checklists: [{ title: 'Agenda', createdAt: hoursAgo(24), items: [
        { text: 'Cập nhật tiến độ', isCompleted: false, createdAt: hoursAgo(24) },
        { text: 'Rủi ro & vướng mắc', isCompleted: false, createdAt: hoursAgo(24) },
        { text: 'Kế hoạch tuần tới', isCompleted: false, createdAt: hoursAgo(24) },
      ] }],
      statusHistory: hist(to, due, [['todo', hoursAgo(24), lead]]),
    });
  }

  // 13. Dài hạn — leader tự nhận, ưu tiên thấp
  {
    const due = daysFromNow(45); const to = [lead._id];
    push({
      ...T(13), status: 'todo', priority: 'low', difficulty: 'medium',
      assignedTo: to, startDate: daysFromNow(15), dueDate: due, estimatedMinutes: 960, storyPoints: 5,
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 2), lead]]),
    });
  }

  // 14. In_progress — 2 checklist, subtasks một phần, watchers
  {
    const due = daysFromNow(8, 17); const to = [m2._id];
    push({
      ...T(14), status: 'in_progress', priority: 'medium', difficulty: 'medium',
      assignedTo: to, startDate: daysFromNow(-5), dueDate: due,
      estimatedMinutes: 600, storyPoints: 5,
      subTasks: [sub('Phác thảo', true), sub('Triển khai phần 1', true), sub('Triển khai phần 2', false), sub('Kiểm tra', false)],
      checklists: [
        { title: 'Yêu cầu', createdAt: hoursAgo(24 * 5), items: [
          { text: 'Thu thập yêu cầu', isCompleted: true, createdAt: hoursAgo(24 * 5) },
          { text: 'Xác nhận với leader', isCompleted: true, createdAt: hoursAgo(24 * 5) },
        ] },
        { title: 'Bàn giao', createdAt: hoursAgo(24 * 4), items: [
          { text: 'Viết hướng dẫn', isCompleted: false, createdAt: hoursAgo(24 * 4) },
          { text: 'Demo cho team', isCompleted: false, createdAt: hoursAgo(24 * 4) },
        ] },
      ],
      timeEntries: [entry(m2, 150, 'Phác thảo', hoursAgo(24 * 4)), entry(m2, 210, 'Phần 1', hoursAgo(24 * 2))],
      comments: [comment(m1, 'Mình có thể hỗ trợ phần 2 nếu cần.', hoursAgo(18))],
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 5), lead], ['in_progress', hoursAgo(24 * 4), m2]]),
    }, { watchers: [lead, m1, m3] });
  }

  // 15. Soft delete
  {
    const to = [m3._id];
    push({
      ...T(15), status: 'deleted', priority: 'low', difficulty: 'easy',
      assignedTo: to, dueDate: daysFromNow(-5),
      statusHistory: hist(to, daysFromNow(-5), [['todo', hoursAgo(24 * 20), lead], ['in_progress', hoursAgo(24 * 18), m3], ['deleted', hoursAgo(24 * 15), lead]]),
    });
  }

  // 16. IN_REVIEW vòng 2 (đã bị yêu cầu sửa 1 lần, nộp lại)
  {
    const due = daysFromNow(1, 17); const to = [m1._id];
    const s1 = hoursAgo(24 * 4), back = hoursAgo(24 * 3), s2 = hoursAgo(5);
    push({
      ...T(16), status: 'in_review', priority: 'high', difficulty: 'medium',
      assignedTo: to, startDate: daysFromNow(-12), dueDate: due,
      estimatedMinutes: 540, storyPoints: 5,
      timeEntries: [entry(m1, 280, 'Thực hiện', hoursAgo(24 * 6)), entry(m1, 100, 'Sửa theo review', hoursAgo(8))],
      comments: [comment(lead, 'Thiếu một số chuỗi chưa xử lý, em bổ sung nhé.', back), comment(m1, 'Em đã bổ sung, nhờ chị review lại.', s2)],
      review: {
        submittedBy: m1._id, submittedAt: s2, note: 'Đã sửa theo góp ý', currentRound: 2, approverSnapshot: approver(s2),
        rounds: [
          { round: 1, type: 'submitted', by: m1._id, at: s1, note: 'Lần 1' },
          { round: 1, type: 'changes_requested', by: lead._id, at: back, reason: 'Thiếu một số chuỗi chưa xử lý' },
          { round: 2, type: 'submitted', by: m1._id, at: s2, note: 'Đã sửa theo góp ý' },
        ],
      },
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 12), lead], ['in_progress', hoursAgo(24 * 10), m1], ['in_review', s1, m1], ['in_progress', back, lead], ['in_review', s2, m1]]),
    });
  }

  // 17. TODO hạn ngày mai — dependency đã thỏa (task 1 done), nhắc deadline
  {
    const due = daysFromNow(1, 12); const to = [m2._id, m3._id];
    push({
      ...T(17), status: 'todo', priority: 'high', difficulty: 'medium',
      assignedTo: to, startDate: daysFromNow(0), dueDate: due, estimatedMinutes: 240, storyPoints: 3,
      subTasks: [sub('Chuẩn bị bản build', false), sub('Kiểm tra lần cuối', false), sub('Phát hành', false)],
      attachments: [files.report],
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 2), lead]]),
    }, { depends: [1], watchers: [lead] });
  }

  // 18. In_progress dài (timeline) — nhiều time entries, phụ thuộc task 7 (đã done)
  {
    const due = daysFromNow(20, 17); const to = [m3._id];
    const entries = [10, 8, 6, 4, 2, 1].map(d => entry(m3, 60 + d * 10, `Làm việc ngày -${d}`, hoursAgo(24 * d)));
    push({
      ...T(18), status: 'in_progress', priority: 'medium', difficulty: 'hard',
      assignedTo: to, startDate: daysFromNow(-10), dueDate: due, progress: 35,
      estimatedMinutes: 1800, storyPoints: 13, timeEntries: entries,
      statusHistory: hist(to, due, [['todo', hoursAgo(24 * 11), lead], ['in_progress', hoursAgo(24 * 10), m3]]),
    }, { depends: [7] });
  }

  // 19. Todo không có hạn — tài liệu
  {
    const to = [m1._id];
    push({
      ...T(19), status: 'todo', priority: 'low', difficulty: 'easy',
      assignedTo: to, attachments: [files.spec],
      statusHistory: hist(to, null, [['todo', hoursAgo(24 * 3), lead]]),
    });
  }

  return { tasks, meta };
}

async function seedTasks(contexts) {
  const all = [];
  for (const ctx of contexts) {
    const files = attachmentsFor(ctx.cfg.key);
    const { tasks, meta } = buildTeamTasks(ctx, files);
    // createdAt = thời điểm tạo trong statusHistory (insertMany giữ giá trị truyền vào)
    tasks.forEach(t => { t.createdAt = t.statusHistory[0]?.at || new Date(); });
    const created = await Task.insertMany(tasks);
    const ops = [];
    meta.forEach((m, i) => {
      const set = {};
      if (m.parent !== undefined) set.parentTaskId = created[m.parent]._id;
      if (m.depends) set.dependencies = m.depends.map(d => created[d]._id);
      if (m.watchers) set.watchers = m.watchers.map(u => u._id);
      if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: created[i]._id }, update: { $set: set } } });
    });
    if (ops.length) await Task.bulkWrite(ops);
    ctx.tasks = created;
    all.push(...created);
  }
  return all;
}

// ============================ 2. LEAVES ============================
async function seedLeaves(contexts, hr) {
  const all = [];
  for (const ctx of contexts) {
    const { lead, team } = ctx;
    const [m1, m2, m3] = ctx.members;
    const hrUser = hr || lead;
    const snap = (at, withTl = true) => [
      ...(withTl ? [{ role: 'team_lead', userId: lead._id, resolvedAt: at, active: true }] : []),
      { role: 'hr_manager', userId: hrUser._id, resolvedAt: at, active: true },
    ];
    const H = (from, to, action, by, at, reason = null, revision = 0) => ({ from, to, action, by: by._id, at, reason, revision, snapshot: null });
    const specs = [
      { userId: m1._id, type: 'personal', startDate: atMidnight(25), endDate: atMidnight(25), numberOfDays: 1,
        reason: 'Về quê dự đám cưới người thân', status: 'draft', revision: 0, currentStep: null, teamSnapshot: team._id, approverSnapshot: [], history: [] },
      { userId: m2._id, type: 'sick', startDate: atMidnight(2), endDate: atMidnight(3), numberOfDays: 2,
        reason: 'Khám sức khỏe định kỳ và nghỉ ngơi theo chỉ định bác sĩ', status: 'pending_team_lead', revision: 0, currentStep: 'team_lead',
        teamSnapshot: team._id, approverSnapshot: snap(hoursAgo(20)), history: [H('draft', 'pending_team_lead', 'submit', m2, hoursAgo(20))] },
      { userId: m3._id, type: 'vacation', startDate: atMidnight(9), endDate: atMidnight(13), numberOfDays: 5,
        reason: 'Du lịch cùng gia đình', status: 'pending_hr', revision: 1, currentStep: 'hr',
        teamSnapshot: team._id, approverSnapshot: snap(hoursAgo(72)),
        history: [H('draft', 'pending_team_lead', 'submit', m3, hoursAgo(72)), H('pending_team_lead', 'pending_hr', 'approve_team_lead', lead, hoursAgo(40), 'Đồng ý, chuyển HR', 1)] },
      { userId: m1._id, type: 'vacation', startDate: atMidnight(5), endDate: atMidnight(6), numberOfDays: 2,
        reason: 'Nghỉ phép năm', status: 'approved', revision: 2, currentStep: null,
        teamSnapshot: team._id, approverSnapshot: snap(hoursAgo(120)), approvedBy: hrUser._id, approvedAt: hoursAgo(80),
        history: [H('draft', 'pending_team_lead', 'submit', m1, hoursAgo(120)), H('pending_team_lead', 'pending_hr', 'approve_team_lead', lead, hoursAgo(100), null, 1),
          H('pending_hr', 'approved', 'approve', hrUser, hoursAgo(80), null, 2)] },
      { userId: m2._id, type: 'personal', startDate: atMidnight(1), endDate: atMidnight(1), numberOfDays: 1,
        reason: 'Giải quyết việc cá nhân', status: 'rejected', revision: 1, currentStep: null,
        teamSnapshot: team._id, approverSnapshot: snap(hoursAgo(60)), rejectionReason: 'Trùng lịch phát hành, vui lòng chọn ngày khác',
        history: [H('draft', 'pending_team_lead', 'submit', m2, hoursAgo(60)), H('pending_team_lead', 'rejected', 'reject', lead, hoursAgo(50), 'Trùng lịch phát hành, vui lòng chọn ngày khác', 1)] },
      { userId: m3._id, type: 'vacation', startDate: atMidnight(18), endDate: atMidnight(19), numberOfDays: 2,
        reason: 'Nghỉ phép (đã rút đơn)', status: 'cancelled', revision: 1, currentStep: null,
        teamSnapshot: team._id, approverSnapshot: snap(hoursAgo(96)),
        history: [H('draft', 'pending_team_lead', 'submit', m3, hoursAgo(96)), H('pending_team_lead', 'cancelled', 'cancel', m3, hoursAgo(30), 'Đổi kế hoạch', 1)] },
      // Leader xin nghỉ — đi thẳng HR
      { userId: lead._id, type: 'sick', startDate: atMidnight(-20), endDate: atMidnight(-20), numberOfDays: 1,
        reason: 'Sốt, nghỉ 1 ngày', status: 'approved', revision: 1, currentStep: null,
        teamSnapshot: team._id, approverSnapshot: snap(hoursAgo(24 * 21), false), approvedBy: hrUser._id, approvedAt: hoursAgo(24 * 21),
        history: [H('draft', 'pending_hr', 'submit', lead, hoursAgo(24 * 22)), H('pending_hr', 'approved', 'approve', hrUser, hoursAgo(24 * 21), null, 1)] },
    ];
    const leaves = await Leave.insertMany(specs);
    ctx.leaves = leaves;
    all.push(...leaves);
  }

  // leaveBalance nhất quán với đơn approved
  const used = {};
  all.filter(l => l.status === 'approved').forEach(l => { used[l.userId] = (used[l.userId] || 0) + l.numberOfDays; });
  for (const ctx of contexts) {
    for (const u of [ctx.lead, ...ctx.members]) {
      const n = used[u._id] || 0;
      await User.updateOne({ _id: u._id }, { $set: { [`leaveBalance.${YEAR}`]: { total: 12, used: n, remaining: 12 - n } } });
    }
  }
  return all;
}

// ============================ 3. ATTENDANCE ============================
async function seedAttendance(contexts, office) {
  const center = office?.location || { lat: 21.0285, lng: 105.8315 };
  const near = m => ({
    lat: +(center.lat + m / 111000).toFixed(6),
    lng: +(center.lng + m / (111000 * Math.cos(center.lat * Math.PI / 180))).toFixed(6),
  });
  const users = contexts.flatMap(c => [c.lead, ...c.members]);
  const records = [];
  users.forEach((u, ui) => {
    for (let d = 14; d >= 0; d--) {
      const date = atMidnight(-d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue;
      const seed = (ui * 7 + d * 3) % 10;
      if (d > 0 && seed === 9) continue; // vắng (không có bản ghi)
      const late = seed === 3 || seed === 7;
      const inMin = late ? 9 * 60 + 10 + (ui % 4) * 8 : 8 * 60 + 30 + (ui % 5) * 5;
      const clockIn = new Date(date.getTime() + inMin * 60000);
      if (d === 0) {
        if (ui % 3 === 2) continue; // hôm nay chưa chấm công -> nhắc chấm công
        records.push({ userId: u._id, date, clockIn, clockOut: null, location: near(15 + ui), status: late ? 'late' : 'present', workHours: null });
        continue;
      }
      const auto = seed === 5;
      const outMin = auto ? 23 * 60 + 59 : 17 * 60 + 30 + (ui % 6) * 10;
      const clockOut = new Date(date.getTime() + outMin * 60000);
      const workHours = +((outMin - inMin - 60) / 60).toFixed(2);
      records.push({ userId: u._id, date, clockIn, clockOut, location: near(10 + ui * 3), status: late ? 'late' : 'present', workHours, autoClockOut: auto });
    }
  });
  return Attendance.insertMany(records);
}

async function ensureOffice() {
  const active = await Office.findOne({ isActive: true });
  if (active) return active;
  return Office.create({
    name: 'Văn phòng Demo', address: '105 Nguyễn Văn Trỗi, Phú Nhuận, TP. HCM',
    location: { lat: 21.0285, lng: 105.8315 }, radius: 300,
    workingHours: { start: '09:00', end: '18:00' }, isActive: true,
  });
}

// ============================ 4. CONVERSATIONS ============================
async function seedConversations(contexts) {
  let convCount = 0, msgCount = 0;
  const makeChat = async (a, b, lines) => {
    // lines: [senderIsA, text, hoursAgo, isRead]
    const msgs = lines.map(([fromA, text, h, read]) => ({ senderId: (fromA ? a : b)._id, message: text, isRead: read, createdAt: hoursAgo(h), updatedAt: hoursAgo(h) }));
    const last = msgs[msgs.length - 1];
    const unread = { [String(a._id)]: 0, [String(b._id)]: 0 };
    msgs.filter(m => !m.isRead).forEach(m => {
      const receiver = String(m.senderId) === String(a._id) ? b : a;
      unread[String(receiver._id)] += 1;
    });
    const conv = await Conversation.create({ participants: [a._id, b._id], lastMessage: last.message, lastMessageAt: last.createdAt, unreadCount: new Map(Object.entries(unread)) });
    await Message.insertMany(msgs.map(m => ({ ...m, conversationId: conv._id })));
    convCount += 1; msgCount += msgs.length;
  };

  for (const ctx of contexts) {
    const { lead, tasks } = ctx;
    const [m1, m2, m3] = ctx.members;
    await makeChat(lead, m1, [
      [true, `Chào em, tiến độ "${tasks[1].title}" thế nào rồi?`, 24 * 8, true],
      [false, 'Dạ em đã xong và gửi review rồi ạ.', 24 * 8 - 1, true],
      [true, 'Ok, anh đã duyệt. Em làm tiếp task tiếp theo nhé.', 24 * 7, true],
      [false, `Anh xem giúp em "${tasks[16].title}" vòng 2 nhé.`, 5, false],
    ]);
    await makeChat(lead, m2, [
      [true, `Task "${tasks[5].title}" đang quá hạn, em cập nhật giúp anh.`, 24, true],
      [false, 'Em đã tìm ra nguyên nhân, chiều nay sẽ xong ạ.', 20, true],
      [true, 'Ok, cần hỗ trợ thì báo anh.', 19, false],
    ]);
    await makeChat(lead, m3, [
      [false, 'Em vừa gửi đơn nghỉ phép 5 ngày, anh duyệt giúp em ạ.', 73, true],
      [true, 'Anh đã duyệt, chờ HR xác nhận nhé.', 40, true],
      [false, 'Em cảm ơn anh!', 39, true],
      [true, 'Nhớ sửa phần review task trước khi nghỉ nhé.', 3, false],
      [true, 'Bổ sung thêm test case giúp anh.', 2, false],
    ]);
    await makeChat(m1, m2, [
      [true, 'Phần 2 bạn có cần mình hỗ trợ không?', 18, true],
      [false, 'Có nha, chiều nay mình pair với nhau nhé.', 17, true],
      [true, 'Ok 3h chiều nhé!', 16, false],
    ]);
    await makeChat(m2, m3, [
      [true, 'Mai bạn có đi họp team không?', 6, true],
      [false, 'Có, 2h chiều thứ năm phải không?', 4, false],
    ]);
  }
  // Leader <-> leader (liên team)
  for (let i = 0; i < contexts.length - 1; i++) {
    const a = contexts[i].lead, b = contexts[i + 1].lead;
    await makeChat(a, b, [
      [true, 'Bên mình cần hỗ trợ từ team bạn cho release tới, trao đổi chút nhé?', 30, true],
      [false, 'Ok, mình rảnh sáng mai lúc 10h.', 28, true],
      [true, 'Chốt 10h sáng mai nhé, cảm ơn bạn!', 27, false],
    ]);
  }
  return { convCount, msgCount };
}

// ============================ 5. NOTIFICATIONS ============================
async function seedNotifications(contexts) {
  const docs = [];
  const n = (user, type, title, message, relatedId, isRead, h) => docs.push({
    userId: user._id, type, title, message, relatedId: relatedId || null, isRead, createdAt: hoursAgo(h), updatedAt: hoursAgo(h),
  });
  for (const ctx of contexts) {
    const { lead, tasks, leaves } = ctx;
    const [m1, m2, m3] = ctx.members;
    const t = tasks;
    const lv = s => leaves.find(l => l.status === s && String(l.userId) !== String(lead._id));
    // Employee
    n(m1, 'task_assigned', 'Task mới được giao', `Bạn được giao "${t[4].title}".`, t[4]._id, false, 70);
    n(m1, 'task_review_approved', 'Task đã được duyệt', `"${t[1].title}" đã được leader duyệt.`, t[1]._id, true, 24 * 7);
    n(m1, 'task_completed', 'Task hoàn thành', `"${t[10].title}" đã hoàn thành.`, t[10]._id, true, 24 * 15);
    n(m1, 'comment_added', 'Bình luận mới', `${lead.profile?.fullName || 'Leader'} bình luận trong "${t[0].title}".`, t[0]._id, false, 24 * 5);
    n(m1, 'leave_approved', 'Đơn nghỉ được duyệt', 'Đơn nghỉ phép 2 ngày của bạn đã được duyệt.', lv('approved')?._id, false, 80);
    n(m1, 'deadline_reminder', 'Sắp đến hạn', `"${t[16].title}" đến hạn vào ngày mai.`, t[16]._id, false, 4);
    n(m2, 'task_overdue', 'Task quá hạn', `"${t[5].title}" đã quá hạn.`, t[5]._id, false, 24 * 2);
    n(m2, 'task_updated', 'Task được cập nhật', `"${t[17].title}" vừa được cập nhật hạn chót.`, t[17]._id, false, 30);
    n(m2, 'leave_rejected', 'Đơn nghỉ bị từ chối', 'Đơn nghỉ 1 ngày bị từ chối: trùng lịch phát hành.', lv('rejected')?._id, true, 50);
    n(m2, 'deadline_reminder', 'Sắp đến hạn', `"${t[17].title}" đến hạn vào ngày mai.`, t[17]._id, false, 3);
    n(m2, 'attendance_reminder', 'Nhắc chấm công', 'Bạn chưa chấm công hôm nay.', null, true, 26);
    n(m3, 'task_review_requested', 'Yêu cầu chỉnh sửa', `Leader yêu cầu sửa "${t[3].title}".`, t[3]._id, false, 28);
    n(m3, 'task_overdue', 'Task quá hạn', `"${t[6].title}" đã quá hạn.`, t[6]._id, false, 10);
    n(m3, 'leave_starting', 'Sắp đến ngày nghỉ', 'Kỳ nghỉ của bạn bắt đầu sau 9 ngày (đang chờ HR duyệt).', lv('pending_hr')?._id, false, 12);
    n(m3, 'attendance_reminder', 'Nhắc chấm công', 'Bạn chưa chấm công hôm nay, vui lòng check-in.', null, false, 1);
    n(m3, 'task_assigned', 'Task mới được giao', `Bạn được giao "${t[18].title}".`, t[18]._id, true, 24 * 11);
    // Leader
    n(lead, 'task_submitted_for_review', 'Task chờ duyệt', `${m2.profile?.fullName || 'Nhân viên'} gửi duyệt "${t[2].title}".`, t[2]._id, false, 26);
    n(lead, 'task_submitted_for_review', 'Task chờ duyệt (vòng 2)', `${m1.profile?.fullName || 'Nhân viên'} gửi lại "${t[16].title}".`, t[16]._id, false, 5);
    n(lead, 'task_review_reminder', 'Nhắc duyệt task', `"${t[2].title}" đã chờ duyệt hơn 24 giờ.`, t[2]._id, false, 2);
    n(lead, 'task_review_withdrawn', 'Rút yêu cầu duyệt', `Một yêu cầu duyệt "${t[14].title}" đã được rút lại.`, t[14]._id, true, 24 * 3);
    n(lead, 'leave_pending', 'Đơn nghỉ chờ duyệt', `${m2.profile?.fullName || 'Nhân viên'} xin nghỉ ốm 2 ngày.`, lv('pending_team_lead')?._id, false, 20);
    n(lead, 'task_overdue', 'Task trong team quá hạn', `"${t[5].title}" của team đã quá hạn.`, t[5]._id, false, 24);
    n(lead, 'deadline_reminder', 'Sự kiện sắp tới', `"${t[12].title}" diễn ra sau 3 ngày.`, t[12]._id, true, 20);
    n(lead, 'task_completed', 'Task hoàn thành', `"${t[11].title}" đã hoàn thành.`, t[11]._id, true, 24 * 1);
    n(lead, 'comment_added', 'Bình luận mới', `${m3.profile?.fullName || 'Nhân viên'} bình luận trong "${t[0].title}".`, t[0]._id, false, 20);
  }
  return Notification.insertMany(docs);
}

// ============================ MAIN ============================
async function seedGmailData() {
  const contexts = await resolveTeamContexts();
  await cleanGmailDemoData(contexts);

  const hr = await User.findOne({ role: 'hr_manager', isActive: true }).select('_id email');
  if (!hr) console.warn('[gmail] Không tìm thấy hr_manager — bước HR của đơn nghỉ sẽ gán cho leader. Chạy seed-admin.js để có HR.');

  const office = await ensureOffice();
  const tasks = await seedTasks(contexts);
  const leaves = await seedLeaves(contexts, hr);
  const attendance = await seedAttendance(contexts, office);
  const chat = await seedConversations(contexts);
  const notifications = await seedNotifications(contexts);

  const byStatus = tasks.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }), {});
  console.log('\n=== Seed dữ liệu 5 team @gmail.com thành công ===');
  console.log(`Tasks: ${tasks.length} ${JSON.stringify(byStatus)}`);
  console.log(`Leaves: ${leaves.length}`);
  console.log(`Attendance: ${attendance.length} bản ghi (14 ngày)`);
  console.log(`Conversations: ${chat.convCount} (${chat.msgCount} messages)`);
  console.log(`Notifications: ${notifications.length}`);
}

module.exports = { seedGmailData };

if (require.main === module) {
  (async () => {
    try {
      await mongoose.connect(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/tma_demo');
      console.log('Connected to MongoDB');
      await seedGmailData();
    } catch (error) {
      console.error('Seed gmail data error:', error);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}

