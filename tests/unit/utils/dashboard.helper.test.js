const {
  parseDate,
  validateDateRange,
  validatePeriod,
  validateMonthYear,
  normalizeRange,
  resolveDateRange,
  percentage,
  applyDateFilter,
  canAccessTeamStats
} = require('../../../utils/dashboard.helper');
const { USER_ROLES } = require('../../../utils/constants.utils');

describe('dashboard.helper', () => {
  describe('parseDate()', () => {
    test('returns null for empty input', () => {
      expect(parseDate(undefined)).toBeNull();
      expect(parseDate(null)).toBeNull();
      expect(parseDate('')).toBeNull();
    });

    test('returns null for an invalid date string', () => {
      expect(parseDate('not-a-date')).toBeNull();
    });

    test('returns a Date for a valid date string', () => {
      const d = parseDate('2025-03-10');
      expect(d).toBeInstanceOf(Date);
      expect(d.getFullYear()).toBe(2025);
    });
  });

  describe('validateDateRange()', () => {
    test('accepts an empty range', () => {
      const res = validateDateRange(undefined, undefined);
      expect(res.valid).toBe(true);
    });

    test('accepts a valid range', () => {
      const res = validateDateRange('2025-01-01', '2025-01-31');
      expect(res.valid).toBe(true);
    });

    test('rejects an invalid startDate', () => {
      const res = validateDateRange('bad', '2025-01-31');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/startDate/i);
    });

    test('rejects an invalid endDate', () => {
      const res = validateDateRange('2025-01-01', 'bad');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/endDate/i);
    });

    test('rejects startDate after endDate', () => {
      const res = validateDateRange('2025-02-01', '2025-01-01');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/before or equal/i);
    });
  });

  describe('validatePeriod()', () => {
    test('accepts week and month', () => {
      expect(validatePeriod('week').valid).toBe(true);
      expect(validatePeriod('month').valid).toBe(true);
    });

    test('accepts an omitted period', () => {
      expect(validatePeriod(undefined).valid).toBe(true);
    });

    test('rejects an unknown period', () => {
      const res = validatePeriod('year');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/week.*month/i);
    });
  });

  describe('validateMonthYear()', () => {
    test('defaults to the current month and year', () => {
      const res = validateMonthYear(undefined, undefined);
      const now = new Date();
      expect(res.valid).toBe(true);
      expect(res.month).toBe(now.getMonth() + 1);
      expect(res.year).toBe(now.getFullYear());
    });

    test('rejects month 0 and month 13', () => {
      expect(validateMonthYear(0, 2025).valid).toBe(false);
      expect(validateMonthYear(13, 2025).valid).toBe(false);
    });

    test('accepts month 1 and 12', () => {
      expect(validateMonthYear(1, 2025).valid).toBe(true);
      expect(validateMonthYear(12, 2025).valid).toBe(true);
    });

    test('rejects a non-numeric month', () => {
      expect(validateMonthYear('abc', 2025).valid).toBe(false);
    });
  });

  describe('normalizeRange()', () => {
    test('expands the end date to the last millisecond of the day', () => {
      const { startDate, endDate } = normalizeRange(
        new Date('2025-03-10T13:00:00'),
        new Date('2025-03-10T02:00:00')
      );
      expect(startDate.getHours()).toBe(0);
      expect(startDate.getMinutes()).toBe(0);
      expect(startDate.getSeconds()).toBe(0);
      expect(endDate.getHours()).toBe(23);
      expect(endDate.getMinutes()).toBe(59);
      expect(endDate.getSeconds()).toBe(59);
      expect(endDate.getMilliseconds()).toBe(999);
    });
  });

  describe('resolveDateRange()', () => {
    const now = new Date('2025-06-15T10:00:00');

    test('defaults to the current month', () => {
      const range = resolveDateRange({}, now);
      expect(range.period).toBe('month');
      expect(range.startDate.getDate()).toBe(1);
      expect(range.startDate.getMonth()).toBe(5);
      expect(range.endDate.getMonth()).toBe(5);
    });

    test('uses period=week for the current week (Monday start)', () => {
      const range = resolveDateRange({ period: 'week' }, now);
      expect(range.period).toBe('week');
      expect(range.startDate.getDay()).toBe(1);
      expect(range.endDate.getDay()).toBe(0);
    });

    test('explicit startDate/endDate take priority over period', () => {
      const range = resolveDateRange(
        { period: 'week', startDate: '2025-01-01', endDate: '2025-01-31' },
        now
      );
      expect(range.source).toBe('explicit');
      expect(range.startDate.getMonth()).toBe(0);
      expect(range.endDate.getMonth()).toBe(0);
    });

    test('keeps the end of the last day of the month inclusive', () => {
      const range = resolveDateRange(
        { startDate: '2025-01-01', endDate: '2025-01-31' },
        now
      );
      expect(range.endDate.getDate()).toBe(31);
      expect(range.endDate.getHours()).toBe(23);
    });
  });

  describe('percentage()', () => {
    test('computes a percentage', () => {
      expect(percentage(1, 4)).toBe(25);
    });

    test('returns 0 instead of dividing by zero', () => {
      expect(percentage(0, 0)).toBe(0);
      expect(percentage(5, 0)).toBe(0);
    });

    test('returns 0 for non-finite inputs', () => {
      expect(percentage(NaN, 10)).toBe(0);
      expect(percentage(Infinity, 10)).toBe(0);
    });
  });

  describe('applyDateFilter()', () => {
    test('does nothing when no dates are given', () => {
      const query = {};
      applyDateFilter(query, 'createdAt', null, null);
      expect(query.createdAt).toBeUndefined();
    });

    test('applies both bounds', () => {
      const query = {};
      const start = new Date('2025-01-01');
      const end = new Date('2025-01-31');
      applyDateFilter(query, 'createdAt', start, end);
      expect(query.createdAt).toEqual({ $gte: start, $lte: end });
    });

    test('applies a single bound', () => {
      const query = {};
      const start = new Date('2025-01-01');
      applyDateFilter(query, 'createdAt', start, null);
      expect(query.createdAt).toEqual({ $gte: start });
    });
  });

  describe('canAccessTeamStats()', () => {
    const team = { leaderId: 'leader-1' };

    test('HR Manager can access any team', () => {
      const user = { _id: 'someone-else', role: USER_ROLES.HR_MANAGER };
      expect(canAccessTeamStats(user, team)).toBe(true);
    });

    test('Team Lead can access a team they lead', () => {
      const user = { _id: 'leader-1', role: USER_ROLES.TEAM_LEAD };
      expect(canAccessTeamStats(user, team)).toBe(true);
    });

    test('Team Lead cannot access a team they do not lead', () => {
      const user = { _id: 'other-lead', role: USER_ROLES.TEAM_LEAD };
      expect(canAccessTeamStats(user, team)).toBe(false);
    });

    test('Employee cannot access team stats', () => {
      const user = { _id: 'leader-1', role: USER_ROLES.EMPLOYEE };
      expect(canAccessTeamStats(user, team)).toBe(false);
    });

    test('system_admin is not granted access', () => {
      const user = { _id: 'admin', role: USER_ROLES.SYSTEM_ADMIN };
      expect(canAccessTeamStats(user, team)).toBe(false);
    });
  });
});
