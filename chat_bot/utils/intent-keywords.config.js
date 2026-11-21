/**
 * Unified Single Source of Truth for Intent Definitions, Keywords, Anchors, and Seed Utterances (Phase 1.1 & 1.3)
 * Canonical path: server/chat_bot/utils/intent-keywords.config.js
 * Adding a new intent only requires adding an entry to INTENT_DEFINITIONS here.
 */

const INTENT_DEFINITIONS = [
  // 1. workload_multi_team
  {
    intent: 'workload_multi_team',
    category: 'Smart Workload Advisor (Đa Team)',
    keywords: [
      'giao cho ai',
      'nen giao',
      'dieu phoi',
      'cac team',
      'tat ca cac team',
      'nhieu team',
      'task gap',
      'viec gap',
      'do kho hard'
    ],
    anchorBoost: (norm) =>
      (norm.includes('giao cho ai') ||
        norm.includes('nen giao') ||
        norm.includes('cac team') ||
        norm.includes('nhieu team')) &&
      !/\bteam\s+(backend|frontend|mobile|qa|hr|marketing|design|devops|alpha|beta)\b/.test(norm)
        ? 0.28
        : 0,
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

  // 2. workload_single_team
  {
    intent: 'workload_single_team',
    category: 'Smart Workload Advisor (Theo Team cụ thể)',
    keywords: [
      'trong team',
      'tai cong viec cua team',
      'team backend',
      'team mobile',
      'team frontend',
      'team qa',
      'team marketing',
      'qua tai'
    ],
    anchorBoost: (norm) =>
      /\bteam\s+(backend|frontend|mobile|qa|hr|marketing|design|devops|core|ai|data|sale|alpha|beta)\b/.test(
        norm
      ) &&
      !norm.includes('so sanh') &&
      !norm.includes('team nao')
        ? 0.35
        : 0,
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

  // 3. team_comparison
  {
    intent: 'team_comparison',
    category: 'So sánh Hiệu suất giữa các Team',
    keywords: [
      'so sanh hieu suat',
      'so sanh giua cac team',
      'team nao dang lam viec hieu qua',
      'team nao nhieu task qua han',
      'xep hang ty le hoan thanh',
      'doi nao co ty le hoan thanh'
    ],
    anchorBoost: (norm) =>
      norm.includes('so sanh') || norm.includes('team nao') || norm.includes('xep hang')
        ? 0.35
        : 0,
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

  // 4. employee_360_lookup
  {
    intent: 'employee_360_lookup',
    category: 'Tra cứu Hồ sơ 360° Nhân viên',
    keywords: [
      'hieu suat va cong viec hien tai cua nhan vien',
      'nang suat lam viec cua ban',
      'nhan vien',
      'thanh vien',
      'ho so hieu suat'
    ],
    anchorBoost: (norm) =>
      (norm.includes('nhan vien ') ||
        norm.includes('nv ') ||
        norm.includes('ban ') ||
        norm.includes('thanh vien ')) &&
      (norm.includes('hieu suat') ||
        norm.includes('nang suat') ||
        norm.includes('cong viec') ||
        norm.includes('bao nhieu task'))
        ? 0.32
        : 0,
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

  // 5. overdue_risk_radar
  {
    intent: 'overdue_risk_radar',
    category: 'Radar Cảnh báo Quá hạn & Sắp trễ hạn (48h)',
    keywords: [
      '48 gio',
      '48h',
      'sap den han',
      'sap het han',
      'nguy co tre',
      'tre deadline',
      'overdue'
    ],
    anchorBoost: (norm) =>
      (norm.includes('48') ||
        norm.includes('sap den han') ||
        norm.includes('sap het han') ||
        norm.includes('nguy co tre') ||
        norm.includes('overdue')) &&
      !norm.includes('team nao')
        ? 0.32
        : 0,
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

  // 6. dependency_bottleneck
  {
    intent: 'dependency_bottleneck',
    category: 'Phân tích Điểm nghẽn Phụ thuộc (Dependencies)',
    keywords: [
      'dependencies',
      'dependency',
      'bi chan',
      'blocked',
      'diem nghen',
      'blockers',
      'phu thuoc'
    ],
    anchorBoost: (norm) =>
      (norm.includes('dependencies') ||
        norm.includes('dependency') ||
        norm.includes('bi chan') ||
        norm.includes('blocked') ||
        norm.includes('diem nghen')) &&
      !norm.includes('khong bi chan')
        ? 0.38
        : 0,
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

  // 7. time_tracking_variance
  {
    intent: 'time_tracking_variance',
    category: 'Thống kê Log Time & Chênh lệch Ước lượng',
    keywords: [
      'log tong cong bao nhieu',
      'vuot qua thoi gian du kien',
      'estimatedminutes',
      'actualminutes',
      'thoi gian uoc tinh'
    ],
    anchorBoost: (norm) =>
      norm.includes('estimatedminutes') ||
      norm.includes('actualminutes') ||
      norm.includes('vuot qua thoi gian') ||
      norm.includes('log tong cong') ||
      norm.includes('thoi gian uoc tinh')
        ? 0.35
        : 0,
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

  // 8. task_detail_subtasks
  {
    intent: 'task_detail_subtasks',
    category: 'Soi chi tiết 1 Task & Subtasks (Kèm nhớ "task đó")',
    keywords: [
      'subtask',
      'subtasks',
      'dau viec nho',
      'task do',
      'task nay',
      'viec do',
      'viec vua roi',
      'chua xong'
    ],
    anchorBoost: (norm) =>
      (norm.includes('subtask') ||
        norm.includes('dau viec nho') ||
        norm.includes('task do') ||
        norm.includes('task nay')) &&
      !norm.includes('tai sao') &&
      !norm.includes('log ')
        ? 0.32
        : 0,
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

  // 9. team_leave_calendar
  {
    intent: 'team_leave_calendar',
    category: 'Lịch Nghỉ phép của Team (14 ngày tới)',
    keywords: [
      '2 tuan toi',
      'lich nghi phep cua cac thanh vien',
      'ai xin nghi phep',
      'ai trong team da duoc duyet nghi',
      'nhan su vang mat'
    ],
    anchorBoost: (norm) =>
      norm.includes('2 tuan toi') ||
      norm.includes('tuan nay va tuan sau') ||
      norm.includes('lich nghi phep cua') ||
      norm.includes('ai xin nghi phep') ||
      norm.includes('ai trong team da duoc duyet nghi')
        ? 0.35
        : 0,
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

  // 10. manager_approvals_inbox
  {
    intent: 'manager_approvals_inbox',
    category: 'Hộp thư Chờ Phê duyệt của Quản lý',
    keywords: [
      'cho toi duyet',
      'cho duyet',
      'can duyet',
      'hop thu phe duyet',
      'cho nghiem thu',
      'task in_review'
    ],
    anchorBoost: (norm) =>
      norm.includes('cho toi duyet') ||
      norm.includes('hop thu phe duyet') ||
      norm.includes('cho nghiem thu') ||
      norm.includes('can duyet')
        ? 0.35
        : 0,
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

  // 11. personal_performance
  {
    intent: 'personal_performance',
    category: 'Hiệu suất Cá nhân & Task Đã hoàn thành',
    keywords: [
      'hoan thanh duoc bao nhieu task',
      'hieu suat lam viec ca nhan',
      'nang suat ca nhan',
      'ket qua hoan thanh nhiem vu ca nhan',
      'so task da done'
    ],
    anchorBoost: (norm) =>
      norm.includes('hoan thanh duoc bao nhieu') ||
      norm.includes('nang suat ca nhan') ||
      norm.includes('hieu suat lam viec ca nhan') ||
      norm.includes('ket qua hoan thanh nhiem vu ca nhan')
        ? 0.35
        : 0,
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

  // 12. personal_leave_balance
  {
    intent: 'personal_leave_balance',
    category: 'Tra cứu Quỹ phép Năm Cá nhân',
    keywords: [
      'con bao nhieu ngay phep',
      'ngay phep',
      'phep nam',
      'quy phep',
      'dung may ngay phep',
      'don xin nghi phep cua toi'
    ],
    anchorBoost: (norm) =>
      norm.includes('con bao nhieu ngay phep') ||
      norm.includes('dung may ngay phep') ||
      norm.includes('quy nghi phep nam')
        ? 0.35
        : 0,
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

  // 13. attendance_summary
  {
    intent: 'attendance_summary',
    category: 'Tổng hợp Chấm công Tháng & Đi muộn',
    keywords: [
      'di muon',
      'du cong',
      'bang cham cong thang',
      'di lam dung gio',
      'vang mat trong thang',
      'check-in hom nay'
    ],
    anchorBoost: (norm) =>
      norm.includes('di muon') ||
      norm.includes('du cong') ||
      norm.includes('vang mat trong thang')
        ? 0.35
        : 0,
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

  // 14. office_gps_policy
  {
    intent: 'office_gps_policy',
    category: 'Quy định Chấm công GPS Văn phòng',
    keywords: [
      'gps',
      'ban kinh',
      'quy dinh cham cong',
      'dia chi van phong',
      'toa do',
      'pham vi bao nhieu met'
    ],
    anchorBoost: (norm) =>
      norm.includes('gps') ||
      norm.includes('ban kinh') ||
      norm.includes('dia chi van phong')
        ? 0.35
        : 0,
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

  // 15. system_sop_guide
  {
    intent: 'system_sop_guide',
    category: 'Hướng dẫn Quy trình Nghiệp vụ Hệ thống (SOP)',
    keywords: [
      'tai sao toi khong the chuyen',
      'quy trinh gui duyet',
      'quy trinh phe duyet',
      'submit for review',
      'auto clock-out',
      '2 cap'
    ],
    anchorBoost: (norm) =>
      norm.includes('tai sao') ||
      norm.includes('quy trinh') ||
      norm.includes('hoat dong nhu the nao') ||
      norm.includes('auto clock') ||
      norm.includes('submit for review')
        ? 0.38
        : 0,
    utterances: [
      'Tại sao tôi không thể chuyển trực tiếp trạng thái task sang Done?',
      'Quy trình gửi duyệt công việc (Submit for Review) và nghiệm thu hoạt động như thế nào?',
      'Quy trình phê duyệt đơn xin nghỉ phép 2 cấp (Team Lead và HR) diễn ra thế nào?',
      'Tại sao khi task đang ở trạng thái in_review thì tôi không sửa được nội dung hay subtasks?',
      'Cách hệ thống tự động tính phần trăm tiến độ (progress) từ subtasks và quy định auto clock-out lúc 18h là gì?'
    ],
    idealAnswer:
      'Giải thích chuẩn quy trình SOP của hệ thống từ cấu hình sop-knowledge.config.js.'
  },

  // 16. daily_briefing_overview
  {
    intent: 'daily_briefing_overview',
    category: 'Tóm tắt Nhanh Đầu ngày (Daily Briefing) & Giới thiệu',
    keywords: [
      'tom tat nhanh',
      'bao cao tong quan dau ngay',
      'ban co the giup gi',
      'gioi thieu cac tinh nang',
      'tong hop nhanh toan bo'
    ],
    anchorBoost: (norm) =>
      norm.includes('tom tat nhanh') ||
      norm.includes('bao cao tong quan dau ngay') ||
      norm.includes('ban co the giup gi') ||
      norm.includes('gioi thieu cac tinh nang') ||
      norm.includes('tong hop nhanh toan bo')
        ? 0.38
        : 0,
    utterances: [
      'Tóm tắt nhanh tình hình công việc và nhân sự hôm nay cho tôi',
      'Báo cáo tổng quan đầu ngày của tôi có những gì cần lưu ý?',
      'Hôm nay tôi có những việc gì quan trọng cần giải quyết?',
      'Bạn có thể giúp gì cho tôi? Giới thiệu các tính năng của Trợ lý AI Copilot',
      'Tổng hợp nhanh toàn bộ thông tin task, chấm công và ngày phép của tôi hôm nay'
    ],
    idealAnswer:
      'Tạo bản Daily Executive Briefing toàn diện cho người đang đăng nhập.'
  },

  // 17. priority_tasks
  {
    intent: 'priority_tasks',
    category: 'Thứ tự Ưu tiên Công việc Cá nhân',
    keywords: [
      'uu tien',
      'task nao truoc',
      'cong viec cua toi',
      'task cua toi',
      'thu tu uu tien',
      'khong bi chan boi dependencies'
    ],
    anchorBoost: (norm) =>
      norm.includes('uu tien') ||
      norm.includes('task nao truoc') ||
      norm.includes('khong bi chan boi dependencies')
        ? 0.32
        : 0,
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

  // 18. action_log_time
  {
    intent: 'action_log_time',
    category: 'Chat-to-Action: Ghi nhận thời gian làm việc',
    keywords: [
      'log giup toi',
      'ghi nhan',
      'cham gio lam',
      'cap nhat thoi gian',
      'phut lam viec cho task'
    ],
    anchorBoost: (norm) =>
      (norm.includes('log') || norm.includes('ghi nhan') || norm.includes('cham gio')) &&
      (norm.includes('phut') || norm.includes('gio')) &&
      !norm.includes('tong cong bao nhieu')
        ? 0.42
        : 0,
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

  // 19. action_create_leave
  {
    intent: 'action_create_leave',
    category: 'Chat-to-Action: Tạo đơn xin nghỉ phép',
    keywords: [
      'tao don xin nghi',
      'nop don xin nghi',
      'dang ky nghi phep',
      'xin nghi phep ngay mai',
      'xin nghi om'
    ],
    anchorBoost: (norm) =>
      (norm.includes('tao don') ||
        norm.includes('nop don') ||
        norm.includes('xin nghi') ||
        norm.includes('dang ky nghi')) &&
      !norm.includes('con bao nhieu') &&
      !norm.includes('quy trinh')
        ? 0.42
        : 0,
    utterances: [
      'Tạo đơn xin nghỉ phép ngày mai vì lý do cá nhân',
      'Nộp đơn xin nghỉ ốm hôm nay do bị sốt cao cần đi khám',
      'Đăng ký nghỉ phép năm 2 ngày từ ngày mai vì lý do gia đình có việc',
      'Xin nghỉ phép ngày kia vì lý do giải quyết thủ tục giấy tờ',
      'Tao don xin nghi phep ngay mai vi ly do ca nhan'
    ],
    idealAnswer:
      'Bóc tách loại nghỉ phép (personal/sick/vacation), ngày bắt đầu, ngày kết thúc và lý do để sinh thẻ xác nhận CREATE_LEAVE ngay trong khung chat.'
  },

  // 20. out_of_domain (Phase 1.3: Out-of-Domain / Non-HR/Task Rejection Class)
  {
    intent: 'out_of_domain',
    category: 'Ngoài phạm vi hệ thống HR & Task (Out-of-Domain)',
    keywords: [
      'thoi tiet',
      'gia vang',
      've may bay',
      'bong da',
      'nau an',
      'pho bo',
      'lam tho',
      'chung khoan',
      'bitcoin',
      'xem boi',
      'chieu phim',
      'co tich',
      'ca nhac'
    ],
    anchorBoost: (norm) =>
      norm.includes('thoi tiet') ||
      norm.includes('gia vang') ||
      norm.includes('ve may bay') ||
      norm.includes('bong da') ||
      norm.includes('nau pho') ||
      norm.includes('cong thuc nau') ||
      norm.includes('viet bai tho') ||
      norm.includes('bai tho') ||
      norm.includes('lam tho') ||
      norm.includes('chung khoan') ||
      norm.includes('bitcoin') ||
      norm.includes('ket qua xo so') ||
      norm.includes('xem boi') ||
      norm.includes('chieu phim') ||
      norm.includes('co tich')
        ? 0.55
        : 0,
    utterances: [
      'Dự báo thời tiết Hà Nội và TP.HCM ngày mai thế nào?',
      'Giá vàng SJC và tỷ giá ngoại tệ hôm nay bao nhiêu?',
      'Tôi muốn đặt vé máy bay đi Đà Nẵng cuối tuần này',
      'Kết quả trận bóng đá Ngoại hạng Anh tối qua thế nào?',
      'Hướng dẫn công thức nấu phở bò và làm bánh ngọt tại nhà',
      'Hãy viết giúp tôi một bài thơ lục bát về mùa thu',
      'Giá Bitcoin và thị trường chứng khoán hôm nay tăng hay giảm?',
      'Xem bói tử vi cung hoàng đạo của tôi trong tuần này'
    ],
    idealAnswer:
      'Từ chối lịch sự câu hỏi ngoài phạm vi và hướng dẫn người dùng quay lại các tính năng Quản lý Nhân sự & Công việc (Tasks, Nghỉ phép, Chấm công GPS, Điều phối Team).'
  }
];

const INTENT_MAP = Object.fromEntries(
  INTENT_DEFINITIONS.map((def) => [def.intent, def])
);

/**
 * Helper to check if normalized text matches any configured keyword of a given intent
 */
const matchesIntentKeywords = (normText, intentName) => {
  const def = INTENT_MAP[intentName];
  if (!def || !Array.isArray(def.keywords)) return false;
  return def.keywords.some((kw) => normText.includes(kw));
};

module.exports = {
  INTENT_DEFINITIONS,
  INTENT_MAP,
  matchesIntentKeywords
};
