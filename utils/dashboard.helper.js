const { TASK_STATUS, USER_ROLES } = require('../utils/constants.utils');

/**
 * Shared query helpers for dashboard/statistics endpoints.
 *
 * Date range convention: ranges are INCLUSIVE on both ends. `endDate` is
 * normalized to the last millisecond of the day (23:59:59.999) so that data
 * recorded at the end of the day is never lost.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Match a date-only string: YYYY-MM-DD.
 */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a date string into a Date, or return null when invalid.
 *
 * A date-only string ("2025-01-01") is parsed as LOCAL midnight, not UTC
 * midnight. `new Date('2025-01-01')` is specified by the language to be UTC,
 * which in a timezone behind UTC lands on the previous local day and would
 * shift every range one day early. Strings carrying an explicit time or
 * timezone offset are parsed as-is, since the caller expressed intent.
 *
 * @param {string|undefined} value
 * @returns {Date|null}
 */
const parseDate = (value) => {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    const [year, month, day] = value.trim().split('-').map(Number);
    const d = new Date(year, month - 1, day);
    // Reject overflow dates such as 2025-02-31.
    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    ) {
      return null;
    }
    return d;
  }

  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Validate a query date range.
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Object} { valid, error }
 */
const validateDateRange = (startDate, endDate) => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (startDate && !start) {
    return { valid: false, error: 'Invalid startDate format' };
  }
  if (endDate && !end) {
    return { valid: false, error: 'Invalid endDate format' };
  }
  if (start && end && start > end) {
    return { valid: false, error: 'startDate must be before or equal to endDate' };
  }
  return { valid: true, error: null };
};

/**
 * Normalize start to 00:00:00.000 and end to 23:59:59.999 (inclusive).
 * @param {Date} start
 * @param {Date} end
 * @returns {Object} { startDate, endDate }
 */
const normalizeRange = (start, end) => {
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(23, 59, 59, 999);
  return { startDate: s, endDate: e };
};

/**
 * Resolve the effective date range for a dashboard request.
 *
 * Priority: explicit startDate/endDate > period=week|month > current month.
 *
 * @param {Object} query - { period, startDate, endDate }
 * @param {Date} now
 * @returns {Object} { startDate, endDate, period, source }
 */
const resolveDateRange = (query = {}, now = new Date()) => {
  const { period, startDate, endDate } = query;

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  // Explicit range wins over period.
  if (start && end) {
    const { startDate: s, endDate: e } = normalizeRange(start, end);
    return { startDate: s, endDate: e, period: period || 'custom', source: 'explicit' };
  }

  if (period === 'week') {
    // Week starts on Monday.
    const day = (now.getDay() + 6) % 7;
    const s = new Date(now);
    s.setDate(now.getDate() - day);
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return { startDate: s, endDate: e, period: 'week', source: 'period' };
  }

  // Default: current month.
  const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startDate: s, endDate: e, period: period || 'month', source: 'period' };
};

/**
 * Validate the `period` query param.
 * @param {string} period
 * @returns {Object} { valid, error }
 */
const validatePeriod = (period) => {
  if (period === undefined || period === null || period === '') return { valid: true, error: null };
  if (!['week', 'month'].includes(period)) {
    return { valid: false, error: "Invalid period. Must be 'week' or 'month'" };
  }
  return { valid: true, error: null };
};

/**
 * Validate month (1-12) and year query params.
 * @param {string} month
 * @param {string} year
 * @returns {Object} { valid, error, month, year }
 */
const validateMonthYear = (month, year) => {
  const now = new Date();
  let m = month;
  let y = year;

  if (m !== undefined && m !== null && m !== '') {
    const parsed = Number(m);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
      return { valid: false, error: 'Invalid month. Must be between 1 and 12' };
    }
    m = parsed;
  } else {
    m = now.getMonth() + 1;
  }

  if (y !== undefined && y !== null && y !== '') {
    const parsed = Number(y);
    if (!Number.isInteger(parsed) || parsed < 1970 || parsed > now.getFullYear() + 1) {
      return { valid: false, error: 'Invalid year' };
    }
    y = parsed;
  } else {
    y = now.getFullYear();
  }

  return { valid: true, error: null, month: m, year: y };
};

/**
 * Compute a percentage safely (never NaN / Infinity).
 * @param {number} numerator
 * @param {number} denominator
 * @param {number} [decimals]
 * @returns {number}
 */
const percentage = (numerator, denominator, decimals = 2) => {
  if (!denominator || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  const value = (numerator / denominator) * 100;
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

/**
 * Terminal task statuses — tasks that no longer represent outstanding work.
 * `deleted` is excluded by the schema enum itself.
 */
const TERMINAL_STATUSES = [TASK_STATUS.DONE];
const OPEN_STATUSES = [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS];

/**
 * Build a MongoDB date filter for a range, applying it to the given field.
 * @param {Object} query - Query object to mutate
 * @param {string} field - Date field name
 * @param {Date} startDate
 * @param {Date} endDate
 */
const applyDateFilter = (query, field, startDate, endDate) => {
  if (!startDate && !endDate) return;
  const range = {};
  if (startDate) range.$gte = startDate;
  if (endDate) {
    const inclusiveEnd = new Date(endDate);
    inclusiveEnd.setHours(23, 59, 59, 999);
    range.$lte = inclusiveEnd;
  }
  query[field] = range;
};

/**
 * Check whether a user may read a team's stats.
 * Team Lead must be the actual leader of that team. HR Manager may read any.
 *
 * @param {Object} user - Authenticated user document
 * @param {Object} team - Team document
 * @returns {boolean}
 */
const canAccessTeamStats = (user, team) => {
  if (!user || !team) return false;
  if (user.role === USER_ROLES.HR_MANAGER) return true;
  if (user.role === USER_ROLES.TEAM_LEAD) {
    return (
      team.leaderId &&
      team.leaderId.toString() === user._id.toString()
    );
  }
  return false;
};

module.exports = {
  DAY_MS,
  parseDate,
  validateDateRange,
  validatePeriod,
  validateMonthYear,
  normalizeRange,
  resolveDateRange,
  percentage,
  applyDateFilter,
  canAccessTeamStats,
  TERMINAL_STATUSES,
  OPEN_STATUSES
};
