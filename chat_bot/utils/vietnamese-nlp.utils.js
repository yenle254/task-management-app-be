/**
 * Vietnamese text, fuzzy entity matching, multi-turn coreference & JSON repair utilities
 * for AI HR & Task Copilot v2
 */

const VI_STOP_WORDS = new Set([
  'task', 'cong', 'viec', 'cua', 'toi', 'cho', 'giup', 'la', 'gi', 'nao',
  'trong', 'voi', 'ghi', 'chu', 'note', 'phut', 'gio', 'ngay', 'thang',
  'nam', 'nay', 'do', 'vua', 'roi', 'hien', 'tai', 'can', 'lam', 'xem',
  'kiem', 'tra', 'bao', 'nhieu', 'con', 'khong', 'da', 'duoc', 'va', 'hoac'
]);

/**
 * Normalize Vietnamese diacritics for intent & entity matching
 * @param {string} text
 * @returns {string}
 */
const normalizeVi = (text = '') =>
  String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s/_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Tokenize normalized Vietnamese text into meaningful keywords
 * @param {string} text
 * @param {boolean} keepStopWords
 * @returns {Array<string>}
 */
const tokenizeVi = (text = '', keepStopWords = false) => {
  const norm = normalizeVi(text);
  if (!norm) return [];
  return norm
    .split(' ')
    .filter((tok) => tok.length > 1 && (keepStopWords || !VI_STOP_WORDS.has(tok)));
};

/**
 * Character bigram Dice similarity between two normalized strings
 * @param {string} a
 * @param {string} b
 * @returns {number} 0..1
 */
const bigramSimilarity = (a = '', b = '') => {
  const s1 = a.replace(/\s+/g, '');
  const s2 = b.replace(/\s+/g, '');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1 : 0;

  const bigrams1 = new Map();
  for (let i = 0; i < s1.length - 1; i++) {
    const bg = s1.slice(i, i + 2);
    bigrams1.set(bg, (bigrams1.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bg = s2.slice(i, i + 2);
    const count = bigrams1.get(bg) || 0;
    if (count > 0) {
      bigrams1.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (s1.length - 1 + (s2.length - 1));
};

/**
 * Fuzzy match a user query against a list of candidate objects (Tasks, Users, Teams)
 * Supports diacritic-free, abbreviated, or reordered Vietnamese keywords.
 *
 * @param {string} queryText
 * @param {Array<Object>} candidates
 * @param {Function} getTextFn - (candidate) => string
 * @param {number} minScore
 * @returns {{ item: Object|null, score: number }}
 */
const fuzzyMatchEntity = (
  queryText,
  candidates = [],
  getTextFn = (x) => x?.title || x?.userName || '',
  minScore = 0.28
) => {
  if (!queryText || !Array.isArray(candidates) || candidates.length === 0) {
    return { item: null, score: 0 };
  }

  const normQuery = normalizeVi(queryText);
  const queryTokens = tokenizeVi(queryText, false);
  let bestItem = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const rawTarget = String(getTextFn(candidate) || '');
    const normTarget = normalizeVi(rawTarget);
    if (!normTarget) continue;

    let score = 0;

    // 1. Direct normalized substring containment
    if (normQuery.includes(normTarget)) {
      score = Math.max(score, 0.92 + Math.min(normTarget.length / 100, 0.08));
    } else if (normTarget.includes(normQuery) && normQuery.length >= 4) {
      score = Math.max(score, 0.78);
    }

    // 2. Meaningful token overlap + prefix abbreviation matching (e.g. "db" -> "database")
    const targetTokens = tokenizeVi(rawTarget, true);
    if (queryTokens.length > 0 && targetTokens.length > 0) {
      let matchedTokens = 0;
      for (const tTok of targetTokens) {
        if (VI_STOP_WORDS.has(tTok)) continue;
        const exactTok = queryTokens.includes(tTok);
        const prefixTok = queryTokens.some(
          (qTok) =>
            (qTok.length >= 2 && tTok.startsWith(qTok)) ||
            (tTok.length >= 2 && qTok.startsWith(tTok)) ||
            (qTok === 'db' && tTok === 'database') ||
            (qTok === 'api' && tTok.includes('api'))
        );
        if (exactTok) matchedTokens += 1;
        else if (prefixTok) matchedTokens += 0.75;
      }

      const relevantTargetCount =
        targetTokens.filter((t) => !VI_STOP_WORDS.has(t)).length || targetTokens.length;
      const tokenCoverage = matchedTokens / relevantTargetCount;
      const bgScore = bigramSimilarity(queryTokens.join(' '), targetTokens.join(' '));
      const combined = tokenCoverage * 0.75 + bgScore * 0.25;
      if (matchedTokens >= 1) {
        score = Math.max(score, combined);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestItem = candidate;
    }
  }

  if (bestScore >= minScore) {
    return { item: bestItem, score: Math.round(bestScore * 100) / 100 };
  }
  return { item: null, score: 0 };
};

/**
 * Resolve an entity from the current message OR from recent conversation history
 * when the user uses anaphoric references ("task đó", "task này", "việc vừa rồi", "người đó")
 *
 * @param {string} message
 * @param {Array<{role: string, content: string}>} history
 * @param {Array<Object>} candidates
 * @param {Function} getTextFn
 * @returns {Object|null}
 */
const resolveContextualEntity = (
  message,
  history = [],
  candidates = [],
  getTextFn = (x) => x?.title || x?.userName || ''
) => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  // 1. Try direct match in current message first
  const direct = fuzzyMatchEntity(message, candidates, getTextFn, 0.32);
  if (direct.item) return direct.item;

  // 2. Check if message contains contextual pronouns or refers to previous turns
  const norm = normalizeVi(message);
  const hasCorefPronoun =
    norm.includes('task do') ||
    norm.includes('task nay') ||
    norm.includes('viec do') ||
    norm.includes('viec nay') ||
    norm.includes('viec vua roi') ||
    norm.includes('task vua roi') ||
    norm.includes('task tren') ||
    norm.includes('task dau tien') ||
    norm.includes('task so 1') ||
    norm.includes('nguoi do') ||
    norm.includes('nhan vien do') ||
    norm.includes('ban do') ||
    norm.includes('hien tai');

  const recentTurns = [...(history || [])].slice(-4).reverse();
  for (const turn of recentTurns) {
    if (!turn?.content) continue;
    const matchInTurn = fuzzyMatchEntity(turn.content, candidates, getTextFn, 0.38);
    if (matchInTurn.item) {
      return matchInTurn.item;
    }
  }

  if (hasCorefPronoun && candidates.length > 0) {
    return candidates[0];
  }

  return null;
};

/**
 * Safely parse and repair potentially truncated JSON output from local LLMs
 * @param {string} rawText
 * @returns {Object|null}
 */
const safeParseJSON = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return null;

  // Strip markdown code block wrappers if present
  let cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_err) {
    // Extract first '{' to last '}' or attempt bracket closure repair
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1) return null;
    cleaned = cleaned.slice(firstBrace);

    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace !== -1) {
      try {
        return JSON.parse(cleaned.slice(0, lastBrace + 1));
      } catch (_innerErr) {
        // Continue to structural repair
      }
    }

    // Attempt structural repair for truncated string/array/object
    let repaired = cleaned;
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      repaired += '"';
    }

    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      const prev = i > 0 ? repaired[i - 1] : '';
      if (ch === '"' && prev !== '\\') inString = !inString;
      if (!inString) {
        if (ch === '{') openBraces++;
        else if (ch === '}') openBraces = Math.max(0, openBraces - 1);
        else if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets = Math.max(0, openBrackets - 1);
      }
    }

    repaired = repaired.replace(/,\s*$/, '');
    while (openBrackets > 0) {
      repaired += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      repaired += '}';
      openBraces--;
    }

    try {
      return JSON.parse(repaired);
    } catch (_finalErr) {
      return null;
    }
  }
};

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
      'Hiện tại có đơn nghỉ phép hay task nào đang chờ tôi duyệt không?',
      'Tình hình tải công việc và hiệu suất hoàn thành của team thế nào?',
      'Hôm nay tôi cần ưu tiên làm task nào trước?'
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
  tokenizeVi,
  bigramSimilarity,
  fuzzyMatchEntity,
  resolveContextualEntity,
  safeParseJSON,
  formatDateISO,
  getRoleSuggestedQuestions
};
