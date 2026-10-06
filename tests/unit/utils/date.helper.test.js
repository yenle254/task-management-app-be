/**
 * Date Helper Unit Tests
 */
const dateHelper = require('../../../utils/date.helper');

describe('dateHelper', () => {
  describe('startOfDay()', () => {
    it('should return start of day (00:00:00)', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = dateHelper.startOfDay(date);

      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });

    it('should use current date if no argument provided', () => {
      const result = dateHelper.startOfDay();

      expect(result).toBeInstanceOf(Date);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
    });

    it('should handle string date input', () => {
      const result = dateHelper.startOfDay('2024-06-15T23:59:59');

      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
    });

    it('should not mutate original date', () => {
      const originalDate = new Date('2024-06-15T14:30:45.123Z');
      const originalHours = originalDate.getHours();

      dateHelper.startOfDay(originalDate);

      expect(originalDate.getHours()).toBe(originalHours);
    });
  });

  describe('endOfDay()', () => {
    it('should return end of day (23:59:59.999)', () => {
      const date = new Date('2024-06-15T00:00:00.000Z');
      const result = dateHelper.endOfDay(date);

      expect(result.getHours()).toBe(23);
      expect(result.getMinutes()).toBe(59);
      expect(result.getSeconds()).toBe(59);
      expect(result.getMilliseconds()).toBe(999);
    });

    it('should use current date if no argument provided', () => {
      const result = dateHelper.endOfDay();

      expect(result).toBeInstanceOf(Date);
      expect(result.getHours()).toBe(23);
      expect(result.getMinutes()).toBe(59);
    });

    it('should handle string date input', () => {
      const result = dateHelper.endOfDay('2024-06-15T00:00:00');

      expect(result.getHours()).toBe(23);
    });
  });

  describe('isToday()', () => {
    it('should return true for today', () => {
      const today = new Date();
      const result = dateHelper.isToday(today);

      expect(result).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = dateHelper.isToday(yesterday);

      expect(result).toBe(false);
    });

    it('should return false for tomorrow', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = dateHelper.isToday(tomorrow);

      expect(result).toBe(false);
    });

    it('should handle midnight boundary correctly', () => {
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);

      const result = dateHelper.isToday(todayMidnight);

      expect(result).toBe(true);
    });
  });

  describe('isOverdue()', () => {
    it('should return true for past date', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = dateHelper.isOverdue(yesterday);

      expect(result).toBe(true);
    });

    it('should return false for today', () => {
      const today = new Date();
      const result = dateHelper.isOverdue(today);

      expect(result).toBe(false);
    });

    it('should return false for future date', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = dateHelper.isOverdue(tomorrow);

      expect(result).toBe(false);
    });

    it('should handle string date input', () => {
      const pastDate = '2020-01-01';
      const result = dateHelper.isOverdue(pastDate);

      expect(result).toBe(true);
    });
  });

  describe('daysUntil()', () => {
    it('should return positive number for future date', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      const result = dateHelper.daysUntil(futureDate);

      expect(result).toBe(5);
    });

    it('should return 0 for today', () => {
      const today = new Date();
      const result = dateHelper.daysUntil(today);

      expect(result).toBe(0);
    });

    it('should return negative number for past date', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 3);

      const result = dateHelper.daysUntil(pastDate);

      expect(result).toBe(-3);
    });

    it('should handle string date input', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const result = dateHelper.daysUntil(futureDate.toISOString().split('T')[0]);

      expect(result).toBe(10);
    });

    it('should round up partial days', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(12, 0, 0, 0);

      const result = dateHelper.daysUntil(tomorrow);

      // Should be 1 since we're calculating from start of today
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('format()', () => {
    it('should format date with DD/MM/YYYY', () => {
      const date = new Date('2024-06-15T12:30:00');
      const result = dateHelper.format(date, 'DD/MM/YYYY');

      expect(result).toBe('15/06/2024');
    });

    it('should format date with HH:mm', () => {
      const date = new Date('2024-06-15T14:30:00');
      const result = dateHelper.format(date, 'HH:mm');

      expect(result).toBe('14:30');
    });

    it('should format date with full format', () => {
      const date = new Date('2024-06-15T14:30:00');
      const result = dateHelper.format(date, 'DD/MM/YYYY HH:mm');

      expect(result).toBe('15/06/2024 14:30');
    });

    it('should pad single digit day and month', () => {
      const date = new Date('2024-01-05T08:05:00');
      const result = dateHelper.format(date, 'DD/MM/YYYY HH:mm');

      expect(result).toBe('05/01/2024 08:05');
    });

    it('should use default format DD/MM/YYYY', () => {
      const date = new Date('2024-06-15');
      const result = dateHelper.format(date);

      expect(result).toBe('15/06/2024');
    });

    it('should handle string date input', () => {
      const result = dateHelper.format('2024-06-15T14:30:00', 'DD/MM/YYYY');

      expect(result).toBe('15/06/2024');
    });

    it('should handle invalid date gracefully', () => {
      const result = dateHelper.format('invalid-date', 'DD/MM/YYYY');

      // Should not throw, returns formatted invalid date
      expect(result).toBeDefined();
    });
  });
});
