const fs = require('node:fs');
const path = require('node:path');
const { extractNGrams, trainIntentClassifier } = require('../training/train-classifier');
const { normalizeVi } = require('../utils/vietnamese-nlp.utils');

let cachedModel = null;

/**
 * Load trained intent model weights from disk (or train on-the-fly if missing)
 * @returns {Object}
 */
const getTrainedModel = () => {
  if (cachedModel) return cachedModel;
  const modelPath = path.join(__dirname, '..', 'training', 'trained-intent-model.json');
  if (!fs.existsSync(modelPath)) {
    trainIntentClassifier();
  }
  cachedModel = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  return cachedModel;
};

/**
 * Build L2-normalized TF-IDF vector for an input query
 */
const vectorizeQuery = (message, model) => {
  const feats = extractNGrams(message);
  const tf = {};
  for (const f of feats) {
    tf[f] = (tf[f] || 0) + 1;
  }

  const vec = {};
  let normSq = 0;
  for (const [term, freq] of Object.entries(tf)) {
    const idf = model.idf[term];
    if (!idf) continue;
    const w = (1 + Math.log(freq)) * idf;
    vec[term] = w;
    normSq += w * w;
  }

  const norm = Math.sqrt(normSq) || 1;
  for (const term of Object.keys(vec)) {
    vec[term] = vec[term] / norm;
  }

  return { feats, vec };
};

/**
 * Cosine similarity between two sparse L2-normalized vectors
 */
const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB) return 0;
  let dot = 0;
  for (const [term, valA] of Object.entries(vecA)) {
    if (vecB[term]) {
      dot += valA * vecB[term];
    }
  }
  return dot;
};

/**
 * Predict top intents using Hybrid Ensemble (TF-IDF Cosine Centroid + Multinomial Naive Bayes + Structural Anchors)
 * @param {string} message
 * @param {number} topK
 * @returns {Array<{intent: string, confidence: number}>}
 */
const predictIntents = (message = '', topK = 3) => {
  const model = getTrainedModel();
  const { feats, vec } = vectorizeQuery(message, model);
  const norm = normalizeVi(message);
  const intents = Object.keys(model.classPriors);

  // 1. Compute Naive Bayes log-scores
  const nbLogScores = {};
  let maxLog = -Infinity;
  for (const intent of intents) {
    let score = model.classPriors[intent] || 0;
    const logProbs = model.classLogProbs[intent] || {};
    const defProb = model.defaultLogProbs[intent] || -10;
    for (const f of feats) {
      if (model.idf[f]) {
        score += logProbs[f] !== undefined ? logProbs[f] : defProb;
      }
    }
    nbLogScores[intent] = score;
    if (score > maxLog) maxLog = score;
  }

  // Softmax with temperature scaling to prevent extreme saturation
  const temp = 4.5;
  let sumExp = 0;
  const nbProbs = {};
  for (const intent of intents) {
    const e = Math.exp((nbLogScores[intent] - maxLog) / temp);
    nbProbs[intent] = e;
    sumExp += e;
  }
  for (const intent of intents) {
    nbProbs[intent] = nbProbs[intent] / (sumExp || 1);
  }

  // 2. Compute TF-IDF Centroid Cosine Similarity + Structural Domain Anchors
  const ensembleScores = intents.map((intent) => {
    const centroid = model.intentCentroids[intent] || {};
    const cos = cosineSimilarity(vec, centroid);
    let anchorBoost = 0;

    if (
      intent === 'workload_single_team' &&
      /\bteam\s+(backend|frontend|mobile|qa|hr|marketing|design|devops|core|ai|data|sale)\b/.test(norm) &&
      !norm.includes('so sanh') &&
      !norm.includes('team nao')
    ) {
      anchorBoost += 0.35;
    }
    if (
      intent === 'workload_multi_team' &&
      (norm.includes('giao cho ai') || norm.includes('nen giao') || norm.includes('cac team')) &&
      !/\bteam\s+(backend|frontend|mobile|qa|hr|marketing|design|devops)\b/.test(norm)
    ) {
      anchorBoost += 0.28;
    }
    if (
      intent === 'team_comparison' &&
      (norm.includes('so sanh') || norm.includes('team nao') || norm.includes('xep hang'))
    ) {
      anchorBoost += 0.35;
    }
    if (
      intent === 'employee_360_lookup' &&
      (norm.includes('nhan vien ') || norm.includes('nv ') || norm.includes('ban ') || norm.includes('thanh vien ')) &&
      (norm.includes('hieu suat') || norm.includes('nang suat') || norm.includes('cong viec') || norm.includes('bao nhieu task'))
    ) {
      anchorBoost += 0.32;
    }
    if (
      intent === 'overdue_risk_radar' &&
      (norm.includes('48') || norm.includes('sap den han') || norm.includes('sap het han') || norm.includes('nguy co tre') || norm.includes('qua han')) &&
      !norm.includes('team nao')
    ) {
      anchorBoost += 0.3;
    }
    if (
      intent === 'dependency_bottleneck' &&
      (norm.includes('dependencies') || norm.includes('dependency') || norm.includes('bi chan') || norm.includes('blocked') || norm.includes('diem nghen'))
    ) {
      anchorBoost += 0.38;
    }
    if (
      intent === 'time_tracking_variance' &&
      (norm.includes('estimatedminutes') || norm.includes('actualminutes') || norm.includes('vuot qua thoi gian') || norm.includes('log tong cong') || norm.includes('thoi gian uoc tinh'))
    ) {
      anchorBoost += 0.35;
    }
    if (
      intent === 'team_leave_calendar' &&
      (norm.includes('2 tuan toi') || norm.includes('tuan nay') || norm.includes('lich nghi phep cua') || norm.includes('ai xin nghi phep') || norm.includes('ai trong team da duoc duyet nghi'))
    ) {
      anchorBoost += 0.35;
    }
    if (
      intent === 'manager_approvals_inbox' &&
      (norm.includes('cho toi duyet') || norm.includes('hop thu phe duyet') || norm.includes('cho nghiem thu') || norm.includes('can duyet'))
    ) {
      anchorBoost += 0.35;
    }
    if (
      intent === 'personal_performance' &&
      (norm.includes('hoan thanh duoc bao nhieu') || norm.includes('nang suat ca nhan') || norm.includes('hieu suat lam viec ca nhan') || norm.includes('ket qua hoan thanh nhiem vu ca nhan'))
    ) {
      anchorBoost += 0.35;
    }
    if (
      intent === 'system_sop_guide' &&
      (norm.includes('tai sao') || norm.includes('quy trinh') || norm.includes('hoat dong nhu the nao') || norm.includes('auto clock') || norm.includes('submit for review'))
    ) {
      anchorBoost += 0.38;
    }
    if (
      intent === 'daily_briefing_overview' &&
      (norm.includes('tom tat nhanh') || norm.includes('bao cao tong quan dau ngay') || norm.includes('ban co the giup gi') || norm.includes('gioi thieu cac tinh nang') || norm.includes('tong hop nhanh toan bo'))
    ) {
      anchorBoost += 0.38;
    }

    const rawScore = cos * 0.65 + nbProbs[intent] * 0.35 + anchorBoost;
    return {
      intent,
      confidence: Number(Math.min(0.99, rawScore).toFixed(3))
    };
  });

  ensembleScores.sort((a, b) => b.confidence - a.confidence);
  return ensembleScores.slice(0, topK);
};

/**
 * Retrieve Top-K dynamic Few-Shot RAG examples from the trained knowledge index
 * @param {string} message
 * @param {number} topK
 * @returns {Array<{intent: string, category: string, sampleQuestion: string, idealAnswer: string, similarity: number}>}
 */
const retrieveFewShotExamples = (message = '', topK = 2) => {
  const model = getTrainedModel();
  const { vec } = vectorizeQuery(message, model);

  const scored = (model.ragCards || []).map((card) => ({
    intent: card.intent,
    category: card.category,
    sampleQuestion: card.sampleQuestion,
    idealAnswer: card.idealAnswer,
    similarity: Number(cosineSimilarity(vec, card.vector).toFixed(3))
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
};

/**
 * Generate comprehensive System SOP & Workflow Guide answers
 */
const buildSystemSopReply = (message, context) => {
  const norm = normalizeVi(message);
  const off = context.officePolicy;

  if (norm.includes('done') || norm.includes('in_review') || norm.includes('review') || norm.includes('khoa') || norm.includes('subtask')) {
    return (
      `📘 **Hướng dẫn Quy trình Nghiệp vụ Quản lý Công việc (Task Workflow & Review SOP)**:\n\n` +
      `1. **Tại sao không thể chuyển thẳng Task sang \`Done\`?**\n` +
      `   - Hệ thống áp dụng cơ chế **Kiểm soát chất lượng (Review Gate)**: Mọi công việc phải được nhân viên bấm **"Submit for Review"** để chuyển sang trạng thái \`in_review\`.\n` +
      `   - Khi ở \`in_review\`, nội dung Task/Subtasks/Checklists sẽ được **khóa tạm thời (Locked)** để tránh sửa đổi dữ liệu trong lúc Quản lý đang chấm duyệt (chỉ mở phần Bình luận trao đổi).\n` +
      `   - Sau khi **Team Lead** hoặc **HR Manager** nhấn **"Approve"**, Task mới chính thức chuyển sang \`done\` và ghi nhận thời점 \`completedAt\`.\n` +
      `2. **Điều kiện bắt buộc để hoàn thành Task**:\n` +
      `   - Tất cả các **Dependencies (Task tiền đề)** phải ở trạng thái \`done\`.\n` +
      `   - Các **Subtasks** bên trong được tự động tính phần trăm tiến độ (\`progress = số subtask xong / tổng số subtask * 100%\`).`
    );
  }

  if (norm.includes('phep') || norm.includes('2 cap') || norm.includes('duyet don')) {
    return (
      `📘 **Hướng dẫn Quy trình Phê duyệt Nghỉ phép 2 Cấp (Leave Approval Workflow SOP)**:\n\n` +
      `1. **Bước 1 — Nhân viên tạo đơn**: Có thể lưu nháp (\`draft\`) hoặc gửi duyệt ngay. Hệ thống kiểm tra ngày hợp lệ (tối đa 30 ngày/đơn) và số dư quỹ phép năm (\`leaveBalance\`).\n` +
      `2. **Bước 2 — Trưởng nhóm duyệt (\`pending_team_lead\`)**: Đơn của nhân viên trong Team sẽ vào hộp thư của Team Lead. Sau khi Team Lead duyệt, đơn chuyển sang bước HR.\n` +
      `3. **Bước 3 — Quản lý Nhân sự duyệt cuối (\`pending_hr\` → \`approved\`)**: HR Manager phê duyệt bước cuối. Ngay khi \`approved\`, hệ thống tự động trừ số ngày phép vào \`leaveBalance.used\` và cập nhật \`leaveBalance.remaining\` theo cơ chế Atomic Transaction chống trùng lặp.`
    );
  }

  return (
    `📘 **Cẩm nang Quy trình Nghiệp vụ Hệ thống (HR & Task Management SOP)**:\n\n` +
    `• **Quy trình Công việc (Task Lifecycle)**: \`todo\` → \`in_progress\` (tự động cập nhật % theo Subtasks) → \`in_review\` (Gửi duyệt, khóa chỉnh sửa) → \`done\` (Sau khi Team Lead/HR Approve và không còn Dependency nào chặn).\n` +
    `• **Quy trình Nghỉ phép 2 Cấp**: Nộp đơn → \`pending_team_lead\` (Team Lead duyệt) → \`pending_hr\` (HR Manager duyệt) → \`approved\` (Tự động khấu trừ quỹ phép năm).\n` +
    `• **Quy định Chấm công GPS & Auto Clock-out**: Check-in trong bán kính **${off?.radiusMeters || 100}m** tại **${off?.name || 'Văn phòng'}** (Giờ chuẩn **${off?.workingHours?.start || '09:00'} – ${off?.workingHours?.end || '18:00'}**, sau ${off?.workingHours?.start || '09:00'} tính là \`late\`). Nếu quên check-out qua ngày hôm sau, hệ thống tự động **Auto Clock-out ở mốc 18:00**.`
  );
};

module.exports = {
  getTrainedModel,
  predictIntents,
  retrieveFewShotExamples,
  buildSystemSopReply
};

