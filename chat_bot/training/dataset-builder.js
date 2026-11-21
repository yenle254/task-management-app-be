const fs = require('node:fs');
const path = require('node:path');

/**
 * Strip Vietnamese diacritics to generate realistic no-accent user queries
 */
const stripDiacritics = (str = '') =>
  String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

/**
 * Seed examples across 16 core HR & Task Copilot intents + SOP Knowledge answers
 */
const SEED_INTENT_EXAMPLES = [
  // 1. workload_multi_team (Multi-Team Smart Workload Advisor)
  {
    intent: 'workload_multi_team',
    category: 'Smart Workload Advisor (Đa Team)',
    utterances: [
      'Tôi có một task độ khó Hard cần làm gấp trong 2 ngày tới, nên giao cho ai?',
      'Có việc gấp độ khó cao cần làm ngay, nên giao cho ai trong các team đang quản lý?',
      'Gợi ý nhân sự có hiệu suất cao nhất ở tất cả các team để giao task khẩn cấp',
      'Tôi đang quản lý nhiều team, mỗi team ai đang rảnh và có tỷ lệ hoàn thành cao nhất để nhận việc gấp?',
      'Đề xuất người phù hợp nhất trong các team để giao công việc khó cần hoàn thành gấp',
      'Ai trong các đội nhóm đang sẵn sàng nhận task khó và có tỷ lệ đúng hạn cao?'
    ],
    idealAnswer:
      'Phân tích toàn bộ các Team đang quản lý: Lọc nhân sự không có lịch nghỉ phép trong 2 ngày tới, ưu tiên người có tỷ lệ hoàn thành (completionRate > 0%) và tỷ lệ đúng hạn (onTimeRate) cao nhất của từng Team, đồng thời cảnh báo riêng nhóm nhân sự chưa có lịch sử hoàn thành (0%).'
  },

  // 2. workload_single_team (Single Team Workload & Assignment)
  {
    intent: 'workload_single_team',
    category: 'Smart Workload Advisor (Theo Team cụ thể)',
    utterances: [
      'Trong team Backend nên giao task gấp cho ai?',
      'Tình hình tải công việc của team Mobile hiện tại thế nào?',
      'Ai trong team Frontend đang quá tải hoặc đang rảnh để giao việc?',
      'Phân tích hiệu suất và khối lượng công việc của các thành viên trong team QA',
      'Team Marketing hiện có ai đang nghỉ phép hay quá hạn công việc không?'
    ],
    idealAnswer:
      'Lọc đúng Team được chỉ định theo tên, liệt kê trạng thái nghỉ phép 2 ngày tới, đề xuất Top nhân sự hiệu suất cao nhất của Team đó và bảng tải công việc chi tiết của từng thành viên.'
  },

  // 3. team_comparison (Cross-Team Performance Comparison)
  {
    intent: 'team_comparison',
    category: 'So sánh Hiệu suất giữa các Team',
    utterances: [
      'So sánh hiệu suất làm việc giữa các team trong công ty',
      'Team nào đang làm việc hiệu quả nhất và team nào có nhiều task quá hạn nhất?',
      'Bảng xếp hạng tỷ lệ hoàn thành đúng hạn của tất cả các team',
      'Đánh giá tổng quan tiến độ và năng suất của các đội nhóm đang quản lý',
      'Trong các team tôi quản lý, đội nào có tỷ lệ hoàn thành công việc cao nhất?'
    ],
    idealAnswer:
      'So sánh toàn bộ các Team đang quản lý theo Tỷ lệ hoàn thành trung bình, Tỷ lệ đúng hạn (onTimeRate), số lượng task đang mở và số lượng task quá hạn để chỉ ra Team dẫn đầu và Team cần hỗ trợ.'
  },

  // 4. employee_360_lookup (Specific Employee 360 Profile & Performance)
  {
    intent: 'employee_360_lookup',
    category: 'Tra cứu Hồ sơ 360° Nhân viên',
    utterances: [
      'Cho tôi xem hiệu suất và công việc hiện tại của nhân viên Nguyễn Văn A',
      'Đánh giá năng suất làm việc của bạn Trần Thị B trong team',
      'Nhân viên Lê Văn C đang làm bao nhiêu task, tỷ lệ hoàn thành đúng hạn là bao nhiêu?',
      'Kiểm tra tình hình công việc và lịch nghỉ phép của thành viên Phạm Văn D',
      'Thông tin tải công việc và tỷ lệ hoàn thành của nhân sự này thế nào?'
    ],
    idealAnswer:
      'Tra cứu hồ sơ 360° của nhân viên theo tên (Fuzzy Match): thuộc Team nào, tổng số task đã hoàn thành/đang làm/chờ làm/quá hạn, tỷ lệ hoàn thành (%), tỷ lệ đúng hạn (%), số task Hard đã xong và lịch nghỉ phép sắp tới.'
  },

  // 5. overdue_risk_radar (Overdue & Due-Soon 48h Risk Radar)
  {
    intent: 'overdue_risk_radar',
    category: 'Radar Cảnh báo Quá hạn & Sắp trễ hạn (48h)',
    utterances: [
      'Hiện tại có những task nào đang quá hạn hoặc sắp đến hạn trong 48 giờ tới?',
      'Cảnh báo các công việc có nguy cơ trễ deadline cần xử lý gấp',
      'Danh sách các task bị trễ hạn (overdue) và sắp hết hạn trong 2 ngày tới',
      'Tôi có công việc nào bị quá hạn hoặc sắp tới hạn chót mà tiến độ còn thấp không?',
      'Kiểm tra rủi ro trễ hạn các đầu việc trong tuần này'
    ],
    idealAnswer:
      'Quét toàn bộ các công việc đang mở để cảnh báo 2 nhóm: (1) Các task ĐÃ QUÁ HẠN (dueDate < hôm nay) và (2) Các task SẮP ĐẾN HẠN trong 48h tới nhưng chưa hoàn thành.'
  },

  // 6. dependency_bottleneck (Dependency & Blocker Analysis)
  {
    intent: 'dependency_bottleneck',
    category: 'Phân tích Điểm nghẽn Phụ thuộc (Dependencies)',
    utterances: [
      'Hiện tại có những công việc nào đang bị chặn bởi dependencies không?',
      'Tại sao task của tôi bị khóa hoặc chưa thể hoàn thành do phụ thuộc?',
      'Kiểm tra các điểm nghẽn (blockers) đang làm chậm tiến độ công việc',
      'Những task nào đang bị phụ thuộc vào công việc khác chưa xong?',
      'Danh sách các task bị blocked và công việc tiền đề cần giải quyết trước'
    ],
    idealAnswer:
      'Liệt kê tất cả các công việc đang có trạng thái isBlocked = true và chỉ rõ tên các task tiền đề (blocking dependencies) chưa đạt trạng thái done cần được ưu tiên tháo gỡ.'
  },

  // 7. time_tracking_variance (Time Tracking & Estimation Variance)
  {
    intent: 'time_tracking_variance',
    category: 'Thống kê Log Time & Chênh lệch Ước lượng',
    utterances: [
      'Tôi đã log tổng cộng bao nhiêu phút làm việc cho các task?',
      'Có công việc nào bị vượt quá thời gian dự kiến (estimatedMinutes) không?',
      'Thống kê thời gian thực tế đã làm (actualMinutes) so với ước lượng ban đầu',
      'Báo cáo tổng số giờ đã log vào task và các việc chưa ghi nhận thời gian',
      'So sánh thời gian ước tính và thời gian thực tế tiêu tốn của các đầu việc'
    ],
    idealAnswer:
      'Tổng hợp tổng số phút/giờ thực tế đã ghi nhận (actualMinutes) trên các task, so sánh với tổng thời gian ước lượng (estimatedMinutes) và chỉ ra các task bị vượt định mức thời gian hoặc chưa log giờ.'
  },

  // 8. task_detail_subtasks (Specific Task & Subtasks Deep Inspection + Coreference)
  {
    intent: 'task_detail_subtasks',
    category: 'Soi chi tiết 1 Task & Subtasks (Kèm nhớ "task đó")',
    utterances: [
      'Task Thiết kế Database còn những subtask nào chưa xong?',
      'Task đó hiện tại tiến độ bao nhiêu phần trăm và còn đầu việc nhỏ nào?',
      'Chi tiết công việc vừa rồi đã log bao nhiêu phút và hạn chót ngày nào?',
      'Kiểm tra danh sách subtasks chưa hoàn thành của task này',
      'Công việc tích hợp API còn vướng những bước subtask nào chưa tích?'
    ],
    idealAnswer:
      'Xác định Task mục tiêu (qua Fuzzy Match tên task hoặc đại từ "task đó" từ lịch sử chat), hiển thị trạng thái, tiến độ %, thời gian actual/estimated, phụ thuộc và danh sách cụ thể từng Subtask chưa hoàn thành.'
  },

  // 9. team_leave_calendar (Team Leave Schedule 14 Days)
  {
    intent: 'team_leave_calendar',
    category: 'Lịch Nghỉ phép của Team (14 ngày tới)',
    utterances: [
      'Trong 2 tuần tới các team có những ai xin nghỉ phép?',
      'Lịch nghỉ phép của các thành viên trong team tuần này và tuần sau',
      'Hiện tại trong đội nhóm có nhân viên nào đang nghỉ phép hoặc sắp nghỉ không?',
      'Kiểm tra danh sách nhân sự vắng mặt hoặc nghỉ phép trong các team',
      'Ai trong team đã được duyệt nghỉ phép trong những ngày tới?'
    ],
    idealAnswer:
      'Tổng hợp lịch nghỉ phép (đã duyệt approved và đang chờ duyệt pending) của toàn bộ thành viên trong các Team đang quản lý trong 14 ngày tới.'
  },

  // 10. manager_approvals_inbox (Manager Pending Leave & Task Review Approvals)
  {
    intent: 'manager_approvals_inbox',
    category: 'Hộp thư Chờ Phê duyệt của Quản lý',
    utterances: [
      'Hiện tại có đơn nghỉ phép hay task nào đang chờ tôi duyệt không?',
      'Kiểm tra hộp thư phê duyệt của quản lý: có bao nhiêu task in_review và đơn xin nghỉ?',
      'Danh sách các công việc nhân viên đã gửi duyệt (in_review) chờ nghiệm thu',
      'Có những ai đang nộp đơn xin nghỉ phép chờ Team Lead hoặc HR phê duyệt?',
      'Hôm nay tôi cần duyệt những đơn từ hoặc nghiệm thu công việc nào?'
    ],
    idealAnswer:
      'Thống kê hộp thư chờ duyệt của Team Lead / HR Manager gồm: danh sách đơn nghỉ phép chờ duyệt (tên nhân viên, loại phép, số ngày, lý do) và danh sách Task ở trạng thái in_review chờ nghiệm thu.'
  },

  // 11. personal_performance (Personal Completed Tasks & On-Time Performance)
  {
    intent: 'personal_performance',
    category: 'Hiệu suất Cá nhân & Task Đã hoàn thành',
    utterances: [
      'Từ trước đến nay tôi đã hoàn thành được bao nhiêu task và tỷ lệ đúng hạn là bao nhiêu?',
      'Thống kê hiệu suất làm việc cá nhân và tỷ lệ hoàn thành công việc của tôi',
      'Tôi đã làm xong những công việc nào gần đây, có bị trễ hạn không?',
      'Đánh giá năng suất cá nhân: số task đã done và tỷ lệ on-time của tôi',
      'Báo cáo kết quả hoàn thành nhiệm vụ cá nhân của tôi'
    ],
    idealAnswer:
      'Báo cáo tổng số task cá nhân đã hoàn thành (done), tổng số task đang mở, tỷ lệ hoàn thành chung (completionRate %), tỷ lệ hoàn thành đúng hạn (onTimeRate %) và danh sách các task vừa hoàn thành gần nhất.'
  },

  // 12. personal_leave_balance (Personal Leave Balance & My Requests)
  {
    intent: 'personal_leave_balance',
    category: 'Tra cứu Quỹ phép Năm Cá nhân',
    utterances: [
      'Năm nay tôi còn bao nhiêu ngày phép?',
      'Kiểm tra quỹ nghỉ phép năm và các đơn xin nghỉ phép đang chờ duyệt của tôi',
      'Tôi đã dùng mấy ngày phép trong năm nay và còn lại bao nhiêu ngày?',
      'Đơn xin nghỉ phép của tôi đã được sếp duyệt chưa hay vẫn đang chờ?',
      'Cho tôi xem số ngày phép còn lại và lịch sử xin nghỉ phép cá nhân'
    ],
    idealAnswer:
      'Đọc từ user.leaveBalance năm hiện tại: Tổng số ngày phép được cấp, số ngày đã sử dụng, số ngày còn lại và danh sách chi tiết các đơn đang chờ duyệt (pending_team_lead / pending_hr).'
  },

  // 13. attendance_summary (Monthly Attendance & Late Days Summary)
  {
    intent: 'attendance_summary',
    category: 'Tổng hợp Chấm công Tháng & Đi muộn',
    utterances: [
      'Tháng này tôi đi làm đủ công chưa, có đi muộn ngày nào không?',
      'Kiểm tra bảng chấm công tháng này và trạng thái check-in hôm nay của tôi',
      'Tháng này tôi làm được tổng cộng bao nhiêu giờ và bị trễ những ngày nào?',
      'Hôm nay tôi đã chấm công vào ca (check-in) và ra ca (check-out) chưa?',
      'Thống kê số ngày đi làm đúng giờ, đi muộn và vắng mặt trong tháng'
    ],
    idealAnswer:
      'Tổng hợp trạng thái chấm công hôm nay (giờ check-in/out), tổng số ngày có mặt/đi muộn/vắng mặt từ đầu tháng, tổng số giờ làm việc và liệt kê chính xác từng ngày bị ghi nhận đi muộn (late).'
  },

  // 14. office_gps_policy (Office GPS Check-in Policy)
  {
    intent: 'office_gps_policy',
    category: 'Quy định Chấm công GPS Văn phòng',
    utterances: [
      'Quy định chấm công GPS của văn phòng tôi là gì?',
      'Bán kính cho phép check-in GPS và địa chỉ văn phòng ở đâu?',
      'Khung giờ làm việc tiêu chuẩn của công ty bắt đầu và kết thúc lúc mấy giờ?',
      'Tôi phải đứng trong phạm vi bao nhiêu mét quanh văn phòng mới chấm công được?',
      'Thông tin tọa độ, địa chỉ và quy định giờ giấc chấm công của văn phòng'
    ],
    idealAnswer:
      'Đọc từ bảng Office đang active: Tên văn phòng, địa chỉ, bán kính mét cho phép chấm công GPS (Haversine radius) và khung giờ làm việc tiêu chuẩn (workingHours.start - workingHours.end).'
  },

  // 15. system_sop_guide (System Workflow & SOP Knowledge Base)
  {
    intent: 'system_sop_guide',
    category: 'Hướng dẫn Quy trình Nghiệp vụ Hệ thống (SOP)',
    utterances: [
      'Tại sao tôi không thể chuyển trực tiếp trạng thái task sang Done?',
      'Quy trình gửi duyệt công việc (Submit for Review) và nghiệm thu hoạt động như thế nào?',
      'Quy trình phê duyệt đơn xin nghỉ phép 2 cấp (Team Lead và HR) diễn ra thế nào?',
      'Tại sao khi task đang ở trạng thái in_review thì tôi không sửa được nội dung hay subtasks?',
      'Cách hệ thống tự động tính phần trăm tiến độ (progress) từ subtasks và quy định auto clock-out lúc 18h là gì?'
    ],
    idealAnswer:
      'Giải thích chuẩn quy trình SOP của hệ thống: (1) Task phải qua bước Submit for Review (trạng thái in_review, khóa chỉnh sửa nội dung để bảo toàn dữ liệu) rồi được Team Lead/HR Approve mới chuyển sang Done; ngoài ra mọi Dependencies và Subtasks phải hoàn tất. (2) Nghỉ phép duyệt 2 bước: Nhân viên -> Team Lead (pending_team_lead) -> HR Manager (pending_hr) -> Approved (trừ quỹ phép tự động). (3) Quên check-out qua ngày mới sẽ được hệ thống Auto Clock-out về 18:00.'
  },

  // 16. daily_briefing_overview (Daily Executive Briefing & Capabilities)
  {
    intent: 'daily_briefing_overview',
    category: 'Tóm tắt Nhanh Đầu ngày (Daily Briefing) & Giới thiệu',
    utterances: [
      'Tóm tắt nhanh tình hình công việc và nhân sự hôm nay cho tôi',
      'Báo cáo tổng quan đầu ngày của tôi có những gì cần lưu ý?',
      'Hôm nay tôi có những việc gì quan trọng cần giải quyết?',
      'Bạn có thể giúp gì cho tôi? Giới thiệu các tính năng của Trợ lý AI Copilot',
      'Tổng hợp nhanh toàn bộ thông tin task, chấm công và ngày phép của tôi hôm nay'
    ],
    idealAnswer:
      'Tạo bản Daily Executive Briefing toàn diện cho người đang đăng nhập: (1) Chấm công hôm nay, (2) Số task đang mở/quá hạn và Top 2 việc cần làm ngay, (3) Số ngày phép còn lại, và (4) Số đơn/task đang chờ duyệt cùng gợi ý điều phối các Team (nếu là Quản lý).'
  },

  // 17. priority_tasks (Personal Priority Tasks Ordering)
  {
    intent: 'priority_tasks',
    category: 'Thứ tự Ưu tiên Công việc Cá nhân',
    utterances: [
      'Hôm nay tôi cần ưu tiên làm task nào trước?',
      'Sắp xếp thứ tự ưu tiên các công việc đang mở của tôi theo hạn chót và mức độ quan trọng',
      'Danh sách các công việc tôi được giao đang cần làm ngay',
      'Tôi nên tập trung giải quyết đầu việc nào đầu tiên trong hôm nay?',
      'Liệt kê các task đang mở của tôi mà không bị chặn bởi dependencies'
    ],
    idealAnswer:
      'Sắp xếp các task đang mở của người dùng theo thứ tự: Không bị chặn bởi Dependencies -> Đang quá hạn -> Độ ưu tiên (High > Medium > Low) -> Hạn chót gần nhất.'
  },

  // 18. action_log_time (Chat-to-Action: Log Time)
  {
    intent: 'action_log_time',
    category: 'Chat-to-Action: Ghi nhận thời gian làm việc',
    utterances: [
      'Log giúp tôi 60 phút làm việc cho task Thiết kế Database với ghi chú: hoàn thành bảng Audit',
      'Ghi nhận 45 phút vào công việc tích hợp API với note đã viết xong controller',
      'Chấm giờ làm 90 phút cho task đó với nội dung kiểm thử thành công',
      'Cập nhật thời gian 2 giờ làm việc cho task hiện tại ghi chú fix bug giao diện',
      'Log 30 phut cho task thiet ke db voi ghi chu xong schema'
    ],
    idealAnswer:
      'Bóc tách số phút, ghi chú và khớp tên Task (hoặc "task đó") để sinh thẻ xác nhận LOG_TIME ngay trong khung chat.'
  },

  // 19. action_create_leave (Chat-to-Action: Submit Leave Request)
  {
    intent: 'action_create_leave',
    category: 'Chat-to-Action: Tạo đơn xin nghỉ phép',
    utterances: [
      'Tạo đơn xin nghỉ phép ngày mai vì lý do cá nhân',
      'Nộp đơn xin nghỉ ốm hôm nay do bị sốt cao cần đi khám',
      'Đăng ký nghỉ phép năm 2 ngày từ ngày mai vì lý do gia đình có việc',
      'Xin nghỉ phép ngày kia vì lý do giải quyết thủ tục giấy tờ',
      'Tao don xin nghi phep ngay mai vi ly do ca nhan'
    ],
    idealAnswer:
      'Bóc tách loại nghỉ phép (personal/sick/vacation), ngày bắt đầu, ngày kết thúc và lý do để sinh thẻ xác nhận CREATE_LEAVE ngay trong khung chat.'
  }
];

/**
 * Generate workplace abbreviation & colloquial variants for Vietnamese augmentation
 */
const applyWorkplaceAugmentation = (text) => {
  const variants = new Set();
  variants.add(text);
  variants.add(stripDiacritics(text));

  // Common Vietnamese workplace shorthand transformations
  const shorthand = stripDiacritics(text)
    .toLowerCase()
    .replace(/\bdatabase\b/g, 'db')
    .replace(/\bkhong\b/g, 'ko')
    .replace(/\bduoc\b/g, 'dc')
    .replace(/\bnhan vien\b/g, 'nv')
    .replace(/\bquan ly\b/g, 'ql')
    .replace(/\bcong viec\b/g, 'cv')
    .replace(/\bnghi phep\b/g, 'phep')
    .replace(/\bphut\b/g, 'p');

  if (shorthand !== stripDiacritics(text).toLowerCase()) {
    variants.add(shorthand);
  }

  return [...variants];
};

/**
 * Build the complete JSONL dataset file (hr-copilot-dataset.jsonl)
 * @returns {{ count: number, datasetPath: string, examples: Array<Object> }}
 */
const buildDataset = () => {
  const examples = [];
  let idCounter = 1;

  for (const group of SEED_INTENT_EXAMPLES) {
    for (const rawUtterance of group.utterances) {
      const augmentedList = applyWorkplaceAugmentation(rawUtterance);
      for (let i = 0; i < augmentedList.length; i++) {
        examples.push({
          id: `sample_${String(idCounter++).padStart(3, '0')}`,
          intent: group.intent,
          category: group.category,
          variant: i === 0 ? 'canonical_vi' : i === 1 ? 'no_diacritics' : 'shorthand_vi',
          utterance: augmentedList[i],
          canonicalUtterance: rawUtterance,
          idealAnswer: group.idealAnswer
        });
      }
    }
  }

  const datasetPath = path.join(__dirname, 'hr-copilot-dataset.jsonl');
  const jsonlContent = examples.map((ex) => JSON.stringify(ex)).join('\n') + '\n';
  fs.writeFileSync(datasetPath, jsonlContent, 'utf8');

  return {
    count: examples.length,
    intentCount: SEED_INTENT_EXAMPLES.length,
    datasetPath,
    examples
  };
};

if (require.main === module) {
  const res = buildDataset();
  console.log(
    `[Dataset Builder] Generated ${res.count} training samples across ${res.intentCount} intents at ${res.datasetPath}`
  );
}

module.exports = {
  SEED_INTENT_EXAMPLES,
  buildDataset,
  stripDiacritics
};

