/**
 * Vietnamese text & date utilities for AI HR & Task Copilot
 */

/**
 * Normalize Vietnamese diacritics for intent matching
 * @param {string} text
 * @returns {string}
 */
const normalizeVi = (text = '') =>
  String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();

/**
 * Format date as YYYY-MM-DD in local time
 * @param {Date|string|null} date
 * @returns {string|null}
 */
const formatDateISO = (date) => {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Role-based default suggested questions
 * @param {string} role
 * @returns {Array<string>}
 */
const getRoleSuggestedQuestions = (role) => {
  if (role === 'team_lead' || role === 'hr_manager') {
    return [
      'Tôi có task độ khó Hard cần làm gấp trong 2 ngày tới, nên giao cho ai?',
      'Tình hình tải công việc và task quá hạn của team hiện tại thế nào?',
      'Hôm nay tôi cần ưu tiên làm task nào trước?',
      'Năm nay tôi còn bao nhiêu ngày phép?'
    ];
  }
  return [
    'Hôm nay tôi cần ưu tiên làm task nào trước?',
    'Năm nay tôi còn bao nhiêu ngày phép?',
    'Tháng này tôi đi làm đủ công chưa, có đi muộn ngày nào không?',
    'Quy định chấm công GPS của văn phòng tôi là gì?'
  ];
};

module.exports = {
  normalizeVi,
  formatDateISO,
  getRoleSuggestedQuestions
};

