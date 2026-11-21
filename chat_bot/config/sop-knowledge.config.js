/**
 * Externalized SOP Knowledge Base Configuration (Phase 2.3)
 * Updating company policies or workflow guides only requires editing this configuration file.
 */
const SOP_KNOWLEDGE_DOCUMENTS = [
  {
    id: 'sop_task_review_gate',
    title: 'Quy trình Nghiệm thu Công việc & Khóa Trạng thái (Task Review Gate SOP)',
    keywords: ['done', 'in_review', 'review', 'submit for review', 'khoa', 'subtask', 'dependency', 'chuyen trang thai'],
    contentTemplate: () =>
      `📘 **Hướng dẫn Quy trình Nghiệp vụ Quản lý Công việc (Task Workflow & Review SOP)**:\n\n` +
      `1. **Tại sao không thể chuyển thẳng Task sang \`Done\`?**\n` +
      `   - Hệ thống áp dụng cơ chế **Kiểm soát chất lượng (Review Gate)**: Mọi công việc phải được nhân viên bấm **"Submit for Review"** để chuyển sang trạng thái \`in_review\`.\n` +
      `   - Khi ở \`in_review\`, nội dung Task/Subtasks/Checklists sẽ được **khóa tạm thời (Locked)** để tránh sửa đổi dữ liệu trong lúc Quản lý đang chấm duyệt (chỉ mở phần Bình luận trao đổi).\n` +
      `   - Sau khi **Team Lead** hoặc **HR Manager** nhấn **"Approve"**, Task mới chính thức chuyển sang \`done\` và ghi nhận thời điểm \`completedAt\`.\n` +
      `2. **Điều kiện bắt buộc để hoàn thành Task**:\n` +
      `   - Tất cả các **Dependencies (Task tiền đề)** phải ở trạng thái \`done\`.\n` +
      `   - Các **Subtasks** bên trong được tự động tính phần trăm tiến độ (\`progress = số subtask xong / tổng số subtask * 100%\`).`
  },
  {
    id: 'sop_leave_two_step_approval',
    title: 'Quy trình Phê duyệt Nghỉ phép 2 Cấp (2-Step Leave Approval SOP)',
    keywords: ['phep', '2 cap', 'duyet don', 'pending_team_lead', 'pending_hr', 'leavebalance', 'nghi phep'],
    contentTemplate: () =>
      `📘 **Hướng dẫn Quy trình Phê duyệt Nghỉ phép 2 Cấp (Leave Approval Workflow SOP)**:\n\n` +
      `1. **Bước 1 — Nhân viên tạo đơn**: Có thể lưu nháp (\`draft\`) hoặc gửi duyệt ngay. Hệ thống kiểm tra ngày hợp lệ (tối đa 30 ngày/đơn) và số dư quỹ phép năm (\`leaveBalance\`).\n` +
      `2. **Bước 2 — Trưởng nhóm duyệt (\`pending_team_lead\`)**: Đơn của nhân viên trong Team sẽ vào hộp thư của Team Lead. Sau khi Team Lead duyệt, đơn chuyển sang bước HR.\n` +
      `3. **Bước 3 — Quản lý Nhân sự duyệt cuối (\`pending_hr\` → \`approved\`)**: HR Manager phê duyệt bước cuối. Ngay khi \`approved\`, hệ thống tự động trừ số ngày phép vào \`leaveBalance.used\` và cập nhật \`leaveBalance.remaining\` theo cơ chế Atomic Transaction chống trùng lặp.`
  },
  {
    id: 'sop_general_overview',
    title: 'Cẩm nang Tổng quan Quy trình Nghiệp vụ Hệ thống (General System SOP)',
    keywords: ['auto clock', 'cham cong', 'quy trinh', 'huong dan', 'cam nang'],
    contentTemplate: (context) => {
      const off = context?.officePolicy;
      return (
        `📘 **Cẩm nang Quy trình Nghiệp vụ Hệ thống (HR & Task Management SOP)**:\n\n` +
        `• **Quy trình Công việc (Task Lifecycle)**: \`todo\` → \`in_progress\` (tự động cập nhật % theo Subtasks) → \`in_review\` (Gửi duyệt, khóa chỉnh sửa) → \`done\` (Sau khi Team Lead/HR Approve và không còn Dependency nào chặn).\n` +
        `• **Quy trình Nghỉ phép 2 Cấp**: Nộp đơn → \`pending_team_lead\` (Team Lead duyệt) → \`pending_hr\` (HR Manager duyệt) → \`approved\` (Tự động khấu trừ quỹ phép năm).\n` +
        `• **Quy định Chấm công GPS & Auto Clock-out**: Check-in trong bán kính **${off?.radiusMeters || 100}m** tại **${off?.name || 'Văn phòng'}** (Giờ chuẩn **${off?.workingHours?.start || '09:00'} – ${off?.workingHours?.end || '18:00'}**, sau ${off?.workingHours?.start || '09:00'} tính là \`late\`). Nếu quên check-out qua ngày hôm sau, hệ thống tự động **Auto Clock-out ở mốc 18:00**.`
      );
    }
  }
];

module.exports = {
  SOP_KNOWLEDGE_DOCUMENTS
};

