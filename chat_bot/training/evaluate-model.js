const fs = require('node:fs');
const path = require('node:path');
const { trainIntentClassifier } = require('./train-classifier');
const { getTrainedModel, predictIntents } = require('../services/ai-knowledge.service');

/**
 * Independent Benchmark & Adversarial Out-of-Domain Evaluation Suite (58 queries:
 * 48 in-domain queries with typos/no-diacritics/shorthand + 10 Out-of-Domain adversarial queries)
 */
const BENCHMARK_TEST_SET = [
  // 1. workload_multi_team
  { query: 'Tôi có một task độ khó Hard cần làm gấp trong 2 ngày tới, nên giao cho ai?', expected: 'workload_multi_team' },
  { query: 'Co viec gap do kho cao can lam ngay, nen giao cho ai trong cac team dang quan ly?', expected: 'workload_multi_team' },
  { query: 'Gợi ý nhân sự có hiệu suất cao nhất ở tất cả các team để giao task khẩn cấp', expected: 'workload_multi_team' },

  // 2. workload_single_team
  { query: 'Trong team Backend nên giao task gấp cho ai?', expected: 'workload_single_team' },
  { query: 'Tinh hinh tai cong viec cua team Mobile hien tai the nao?', expected: 'workload_single_team' },
  { query: 'Ai trong team Frontend đang rảnh để giao việc?', expected: 'workload_single_team' },

  // 3. team_comparison
  { query: 'So sánh hiệu suất làm việc giữa các team trong công ty', expected: 'team_comparison' },
  { query: 'Team nao dang lam viec hieu qua nhat va team nao nhieu task qua han nhat?', expected: 'team_comparison' },
  { query: 'Bảng xếp hạng tỷ lệ hoàn thành đúng hạn của tất cả các team', expected: 'team_comparison' },

  // 4. employee_360_lookup
  { query: 'Cho tôi xem hiệu suất và công việc hiện tại của nhân viên Nguyễn Văn A', expected: 'employee_360_lookup' },
  { query: 'Nhan vien Le Van C dang lam bao nhieu task, ty le hoan thanh dung han la bao nhieu?', expected: 'employee_360_lookup' },
  { query: 'Đánh giá năng suất làm việc của bạn Trần Thị B trong team', expected: 'employee_360_lookup' },

  // 5. overdue_risk_radar
  { query: 'Hiện tại có những task nào đang quá hạn hoặc sắp đến hạn trong 48 giờ tới?', expected: 'overdue_risk_radar' },
  { query: 'Canh bao cac cong viec co nguy co tre deadline can xu ly gap', expected: 'overdue_risk_radar' },
  { query: 'Danh sách các task bị overdue và sắp hết hạn trong 2 ngày tới', expected: 'overdue_risk_radar' },

  // 6. dependency_bottleneck
  { query: 'Hiện tại có những công việc nào đang bị chặn bởi dependencies không?', expected: 'dependency_bottleneck' },
  { query: 'Kiem tra cac diem nghen blockers dang lam cham tien do cong viec', expected: 'dependency_bottleneck' },
  { query: 'Danh sách các task bị blocked và công việc tiền đề cần giải quyết trước', expected: 'dependency_bottleneck' },

  // 7. time_tracking_variance
  { query: 'Tôi đã log tổng cộng bao nhiêu phút làm việc cho các task?', expected: 'time_tracking_variance' },
  { query: 'Co cong viec nao bi vuot qua thoi gian du kien estimatedMinutes khong?', expected: 'time_tracking_variance' },
  { query: 'So sánh thời gian ước tính và thời gian thực tế actualMinutes của các đầu việc', expected: 'time_tracking_variance' },

  // 8. task_detail_subtasks
  { query: 'Task Thiết kế Database còn những subtask nào chưa xong?', expected: 'task_detail_subtasks' },
  { query: 'Task do hien tai tien do bao nhieu phan tram va con dau viec nho nao?', expected: 'task_detail_subtasks' },
  { query: 'Kiểm tra danh sách subtasks chưa hoàn thành của task này', expected: 'task_detail_subtasks' },

  // 9. team_leave_calendar
  { query: 'Trong 2 tuần tới các team có những ai xin nghỉ phép?', expected: 'team_leave_calendar' },
  { query: 'Lich nghi phep cua cac thanh vien trong team tuan nay va tuan sau', expected: 'team_leave_calendar' },
  { query: 'Ai trong team đã được duyệt nghỉ phép trong những ngày tới?', expected: 'team_leave_calendar' },

  // 10. manager_approvals_inbox
  { query: 'Hiện tại có đơn nghỉ phép hay task nào đang chờ tôi duyệt không?', expected: 'manager_approvals_inbox' },
  { query: 'Kiem tra hop thu phe duyet cua quan ly co bao nhieu task in_review', expected: 'manager_approvals_inbox' },
  { query: 'Danh sách các công việc nhân viên đã gửi duyệt chờ nghiệm thu', expected: 'manager_approvals_inbox' },

  // 11. personal_performance
  { query: 'Từ trước đến nay tôi đã hoàn thành được bao nhiêu task và tỷ lệ đúng hạn là bao nhiêu?', expected: 'personal_performance' },
  { query: 'Thong ke hieu suat lam viec ca nhan va ty le hoan thanh cong viec cua toi', expected: 'personal_performance' },
  { query: 'Báo cáo kết quả hoàn thành nhiệm vụ cá nhân của tôi', expected: 'personal_performance' },

  // 12. personal_leave_balance
  { query: 'Năm nay tôi còn bao nhiêu ngày phép?', expected: 'personal_leave_balance' },
  { query: 'Toi da dung may ngay phep trong nam nay va con lai bao nhieu ngay?', expected: 'personal_leave_balance' },

  // 13. attendance_summary
  { query: 'Tháng này tôi đi làm đủ công chưa, có đi muộn ngày nào không?', expected: 'attendance_summary' },
  { query: 'Thong ke so ngay di lam dung gio, di muon va vang mat trong thang', expected: 'attendance_summary' },

  // 14. office_gps_policy
  { query: 'Quy định chấm công GPS của văn phòng tôi là gì?', expected: 'office_gps_policy' },
  { query: 'Ban kinh cho phep check-in GPS va dia chi van phong o dau?', expected: 'office_gps_policy' },

  // 15. system_sop_guide
  { query: 'Tại sao tôi không thể chuyển trực tiếp trạng thái task sang Done?', expected: 'system_sop_guide' },
  { query: 'Quy trinh phe duyet don xin nghi phep 2 cap Team Lead va HR dien ra the nao?', expected: 'system_sop_guide' },
  { query: 'Quy trình gửi duyệt công việc Submit for Review hoạt động như thế nào?', expected: 'system_sop_guide' },

  // 16. daily_briefing_overview
  { query: 'Tóm tắt nhanh tình hình công việc và nhân sự hôm nay cho tôi', expected: 'daily_briefing_overview' },
  { query: 'Ban co the giup gi cho toi? Gioi thieu cac tinh nang cua Tro ly AI Copilot', expected: 'daily_briefing_overview' },

  // 17. priority_tasks
  { query: 'Hôm nay tôi cần ưu tiên làm task nào trước?', expected: 'priority_tasks' },
  { query: 'Sap xep thu tu uu tien cac cong viec dang mo cua toi theo han chot', expected: 'priority_tasks' },

  // 18. action_log_time
  { query: 'Log giúp tôi 60 phút làm việc cho task Thiết kế Database với ghi chú: hoàn thành bảng Audit', expected: 'action_log_time' },

  // 19. action_create_leave
  { query: 'Tạo đơn xin nghỉ phép ngày mai vì lý do cá nhân', expected: 'action_create_leave' },

  // 20. out_of_domain (Phase 1.3: Adversarial & Out-of-Domain Queries)
  { query: 'Tôi muốn đặt vé máy bay khứ hồi đi Phú Quốc tuần sau', expected: 'out_of_domain', isOOD: true },
  { query: 'Giá vàng SJC 9999 hôm nay tăng hay giảm bao nhiêu?', expected: 'out_of_domain', isOOD: true },
  { query: 'Dự báo thời tiết Hà Nội ngày mai có mưa bão không?', expected: 'out_of_domain', isOOD: true },
  { query: 'Tỷ số trận bóng đá Champions League đêm qua thế nào?', expected: 'out_of_domain', isOOD: true },
  { query: 'Chỉ giúp tôi công thức nấu phở bò Nam Định ngon nhất', expected: 'out_of_domain', isOOD: true },
  { query: 'Hãy sáng tác một bài thơ thất ngôn bát cú về mùa xuân', expected: 'out_of_domain', isOOD: true },
  { query: 'Giá Bitcoin và Ethereum trên sàn Binance hiện tại là bao nhiêu USD?', expected: 'out_of_domain', isOOD: true },
  { query: 'Xem bói tử vi tuổi Giáp Thân năm nay hợp màu gì?', expected: 'out_of_domain', isOOD: true },
  { query: 'Chiều nay rạp CGV có chiếu phim hành động nào hay không?', expected: 'out_of_domain', isOOD: true },
  { query: 'Kể cho tôi nghe một câu chuyện cổ tích Việt Nam', expected: 'out_of_domain', isOOD: true }
];

/**
 * Compute Expected Calibration Error (ECE) over 5 probability bins (Phase 1.4)
 */
const computeECE = (detailedResults, numBins = 5) => {
  const bins = Array.from({ length: numBins }, () => ({ count: 0, confSum: 0, accSum: 0 }));
  const n = detailedResults.length || 1;

  for (const r of detailedResults) {
    const conf = Math.min(Math.max(r.confidence || 0, 0), 0.9999);
    const binIdx = Math.floor(conf * numBins);
    bins[binIdx].count += 1;
    bins[binIdx].confSum += conf;
    bins[binIdx].accSum += r.pass ? 1 : 0;
  }

  let ece = 0;
  for (const b of bins) {
    if (b.count > 0) {
      const avgConf = b.confSum / b.count;
      const avgAcc = b.accSum / b.count;
      ece += (b.count / n) * Math.abs(avgAcc - avgConf);
    }
  }
  return Number(ece.toFixed(4));
};

const evaluateModelAndWriteReport = () => {
  const trainRes = trainIntentClassifier();
  // Reload freshly trained weights
  getTrainedModel(true);

  const t0 = performance.now();

  let correct = 0;
  let oodTotal = 0;
  let oodRejected = 0;
  let marginSum = 0;
  const perIntent = {};
  const detailedResults = [];

  for (const item of BENCHMARK_TEST_SET) {
    if (!perIntent[item.expected]) {
      perIntent[item.expected] = { tp: 0, fp: 0, fn: 0, total: 0 };
    }
    perIntent[item.expected].total += 1;
    if (item.isOOD) oodTotal += 1;
  }

  for (const item of BENCHMARK_TEST_SET) {
    const preds = predictIntents(item.query, 2);
    const top1 = preds[0]?.intent || 'unknown';
    const conf = preds[0]?.confidence || 0;
    const margin = preds[0]?.margin || 0;
    const isAmbiguous = Boolean(preds[0]?.isAmbiguous);
    const isMatch = top1 === item.expected;

    marginSum += margin;
    if (item.isOOD && top1 === 'out_of_domain') {
      oodRejected += 1;
    }

    if (isMatch) {
      correct += 1;
      perIntent[item.expected].tp += 1;
    } else {
      perIntent[item.expected].fn += 1;
      if (!perIntent[top1]) perIntent[top1] = { tp: 0, fp: 0, fn: 0, total: 0 };
      perIntent[top1].fp += 1;
    }

    detailedResults.push({
      query: item.query,
      expected: item.expected,
      predicted: top1,
      confidence: conf,
      margin,
      isAmbiguous,
      pass: isMatch
    });
  }

  const totalTimeMs = performance.now() - t0;
  const avgLatencyMs = Number((totalTimeMs / BENCHMARK_TEST_SET.length).toFixed(3));
  const accuracy = Number(((correct / BENCHMARK_TEST_SET.length) * 100).toFixed(2));
  const oodRejectionRate = Number(((oodRejected / (oodTotal || 1)) * 100).toFixed(2));
  const avgMargin = Number((marginSum / BENCHMARK_TEST_SET.length).toFixed(3));
  const ece = computeECE(detailedResults, 5);

  const intentRows = [];
  let sumPrecision = 0;
  let sumRecall = 0;
  let sumF1 = 0;
  const evaluatedIntents = Object.keys(perIntent);

  for (const intent of evaluatedIntents) {
    const m = perIntent[intent];
    const precision = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : 1;
    const recall = m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : 1;
    const f1 =
      precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    sumPrecision += precision;
    sumRecall += recall;
    sumF1 += f1;

    intentRows.push({
      intent,
      samples: m.total,
      precision: (precision * 100).toFixed(1),
      recall: (recall * 100).toFixed(1),
      f1: (f1 * 100).toFixed(1)
    });
  }

  const macroPrecision = ((sumPrecision / evaluatedIntents.length) * 100).toFixed(2);
  const macroRecall = ((sumRecall / evaluatedIntents.length) * 100).toFixed(2);
  const macroF1 = ((sumF1 / evaluatedIntents.length) * 100).toFixed(2);

  const reportDir = path.join(__dirname, '..', '..', 'report');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'ai-copilot-training-report.md');

  const md = [
    `# Báo cáo Huấn luyện & Đánh giá Thực nghiệm Model AI HR & Task Copilot v3`,
    ``,
    `> **Thời gian huấn luyện**: \`${new Date().toISOString()}\`  `,
    `> **Kiến trúc Model**: Hybrid Multinomial Naive Bayes + TF-IDF Unigram/Bigram/Trigram Cosine Centroid + Temperature-Scaled Softmax Calibration + OOD Rejection Guard  `,
    `> **File trọng số xuất ra**: \`server/chat_bot/training/trained-intent-model.json\`  `,
    `> **Tập dữ liệu huấn luyện**: \`server/chat_bot/training/hr-copilot-dataset.jsonl\` (**${trainRes.stats.totalSamples} mẫu huấn luyện**, **${trainRes.stats.intentCount} lớp ngữ cảnh Intent (gồm cả \`out_of_domain\`)**, **${trainRes.stats.vocabularySize} đặc trưng N-gram**)`,
    ``,
    `---`,
    ``,
    `## 1. Tổng hợp Kết quả Kiểm định Thực nghiệm & Adversarial OOD Benchmark`,
    ``,
    `| Chỉ số Đánh giá (Metric) | Giá trị Đạt được | Ghi chú |`,
    `| :--- | :--- | :--- |`,
    `| **Tổng số mẫu huấn luyện (Training Samples)** | **${trainRes.stats.totalSamples} mẫu** | Có dấu, Không dấu, Viết tắt công sở & Mẫu OOD |`,
    `| **Kích thước Từ điển Đặc trưng (N-gram Vocab)** | **${trainRes.stats.vocabularySize} cụm từ** | Unigram + Bigram + Trigram có trọng số Smoothed IDF |`,
    `| **Tập Kiểm định Độc lập (Test Benchmark)** | **${BENCHMARK_TEST_SET.length} câu hỏi** | 48 câu In-Domain + 10 câu Adversarial Out-of-Domain |`,
    `| **Overall Accuracy (Độ chính xác tổng thể)** | **${accuracy}% (${correct}/${BENCHMARK_TEST_SET.length})** | Phân loại chính xác Top-1 Intent |`,
    `| **OOD Rejection Rate (Tỷ lệ chặn câu ngoài phạm vi)** | **${oodRejectionRate}% (${oodRejected}/${oodTotal})** | Chặn chính xác câu hỏi thời tiết, giá vàng, bóng đá, thơ... |`,
    `| **Macro Precision / Recall / F1-Score** | **${macroPrecision}% / ${macroRecall}% / ${macroF1}%** | Đạt độ cân bằng trên toàn bộ ${evaluatedIntents.length} lớp |`,
    `| **Expected Calibration Error (ECE - 5 bins)** | **${ece}** | Đã hiệu chuẩn xác suất bằng Temperature-Scaled Softmax |`,
    `| **Khoảng cách Top-1 vs Top-2 trung bình (Avg Margin)** | **${avgMargin}** | Ngưỡng cảnh báo mơ hồ \`isAmbiguous < 0.08\` |`,
    `| **Tốc độ Suy luận Trung bình (Inference Latency)** | **${avgLatencyMs} ms / câu** | Chạy trực tiếp trên CPU Node.js (0 MB GPU) |`,
    ``,
    `---`,
    ``,
    `## 2. Bảng Đánh giá Precision / Recall / F1-Score theo từng Ngữ cảnh (${evaluatedIntents.length} Intents)`,
    ``,
    `| STT | Mã Ngữ cảnh (Intent Class) | Số mẫu Test | Precision (%) | Recall (%) | F1-Score (%) |`,
    `| :-- | :--- | :---: | :---: | :---: | :---: |`,
    ...intentRows.map(
      (r, idx) =>
        `| ${idx + 1} | \`${r.intent}\` | ${r.samples} | ${r.precision}% | ${r.recall}% | **${r.f1}%** |`
    ),
    ``,
    `---`,
    ``,
    `## 3. Chi tiết Kiểm thử từng Câu hỏi trong Tập Benchmark (${BENCHMARK_TEST_SET.length} câu)`,
    ``,
    `| # | Câu hỏi Thực tế (In-Domain & Adversarial OOD) | Nhãn Kỳ vọng | Model Dự đoán | Confidence | Margin | Kết quả |`,
    `| :-: | :--- | :--- | :--- | :---: | :---: | :---: |`,
    ...detailedResults.map(
      (d, idx) =>
        `| ${idx + 1} | ${d.query} | \`${d.expected}\` | \`${d.predicted}\` | ${d.confidence} | ${d.margin} | ${
          d.pass ? '✅ PASS' : '❌ FAIL'
        } |`
    ),
    ``
  ].join('\n');

  fs.writeFileSync(reportPath, md, 'utf8');

  return {
    accuracy,
    oodRejectionRate,
    macroPrecision,
    macroRecall,
    macroF1,
    ece,
    avgMargin,
    avgLatencyMs,
    reportPath,
    trainStats: trainRes.stats
  };
};

if (require.main === module) {
  const res = evaluateModelAndWriteReport();
  console.log('[Model Evaluation Complete]', JSON.stringify(res, null, 2));
}

module.exports = { evaluateModelAndWriteReport, BENCHMARK_TEST_SET, computeECE };
