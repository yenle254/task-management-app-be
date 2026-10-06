/**
 * Leave Service Unit Tests
 */
const mongoose = require('mongoose');
const {
  calculateLeaveDays,
  canApproveLeave,
  validateLeaveDates
} = require('../../../services/leave.service');

describe('LeaveService', () => {
  describe('calculateLeaveDays()', () => {
    it('should calculate 1 day for same start and end date', () => {
      const date = new Date('2024-06-15');
      const result = calculateLeaveDays(date, date);
      expect(result).toBe(1);
    });

    it('should calculate correct days for multiple days', () => {
      const startDate = new Date('2024-06-15');
      const endDate = new Date('2024-06-20');
      const result = calculateLeaveDays(startDate, endDate);
      expect(result).toBe(6);
    });

    it('should handle string dates', () => {
      const result = calculateLeaveDays('2024-06-15', '2024-06-17');
      expect(result).toBe(3);
    });

    it('should handle weekend days in calculation', () => {
      // June 2024: 15 is Saturday, 16 is Sunday
      const startDate = new Date('2024-06-14'); // Friday
      const endDate = new Date('2024-06-16'); // Sunday
      const result = calculateLeaveDays(startDate, endDate);
      expect(result).toBe(3); // Counts all days including weekends
    });
  });

  describe('canApproveLeave()', () => {
    const hrManagerId = new mongoose.Types.ObjectId();
    const teamLeadId = new mongoose.Types.ObjectId();
    const employeeId = new mongoose.Types.ObjectId();
    const teamId = new mongoose.Types.ObjectId();

    it('should return true for HR Manager', () => {
      const approver = { _id: hrManagerId, role: 'hr_manager' };
      const leave = { userId: { _id: employeeId } };

      const result = canApproveLeave(approver, leave);

      expect(result).toBe(true);
    });

    it('should return true for Team Lead approving same team member', () => {
      const approver = { _id: teamLeadId, role: 'team_lead', teamId: teamId };
      const leave = {
        userId: {
          _id: employeeId,
          teamId: teamId
        }
      };

      const result = canApproveLeave(approver, leave);

      expect(result).toBe(true);
    });

    it('should return true for Team Lead approving direct report', () => {
      const approver = { _id: teamLeadId, role: 'team_lead' };
      const leave = {
        userId: {
          _id: employeeId,
          managerId: teamLeadId
        }
      };

      const result = canApproveLeave(approver, leave);

      expect(result).toBe(true);
    });

    it('should return false for Team Lead approving different team member', () => {
      const approver = { _id: teamLeadId, role: 'team_lead', teamId: teamId };
      const leave = {
        userId: {
          _id: employeeId,
          teamId: new mongoose.Types.ObjectId() // different team
        }
      };

      const result = canApproveLeave(approver, leave);

      expect(result).toBe(false);
    });

    it('should return false for Employee', () => {
      const approver = { _id: employeeId, role: 'employee' };
      const leave = { userId: { _id: hrManagerId } };

      const result = canApproveLeave(approver, leave);

      expect(result).toBe(false);
    });
  });

  describe('validateLeaveDates()', () => {
    it('should return valid for future dates', () => {
      const futureStart = new Date();
      futureStart.setDate(futureStart.getDate() + 1);
      const futureEnd = new Date();
      futureEnd.setDate(futureEnd.getDate() + 3);

      const result = validateLeaveDates(futureStart, futureEnd);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Valid dates');
    });

    it('should return valid for today as start date', () => {
      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = validateLeaveDates(today, tomorrow);

      expect(result.valid).toBe(true);
    });

    it('should return invalid if end date is before start date', () => {
      const start = new Date();
      start.setDate(start.getDate() + 5);
      const end = new Date();
      end.setDate(end.getDate() + 2);

      const result = validateLeaveDates(start, end);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('End date must be after or equal to start date');
    });

    it('should return invalid if start date is in the past', () => {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      const end = new Date();
      end.setDate(end.getDate() + 1);

      const result = validateLeaveDates(start, end);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Start date must be today or in the future');
    });

    it('should return invalid if leave exceeds 30 days', () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      const end = new Date();
      end.setDate(end.getDate() + 35);

      const result = validateLeaveDates(start, end);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Leave request cannot exceed 30 days');
    });

    it('should return invalid for invalid date format', () => {
      const result = validateLeaveDates('invalid-date', '2024-06-20');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Invalid date format');
    });

    it('should return valid for exactly 30 days', () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      const end = new Date();
      end.setDate(end.getDate() + 30);

      const result = validateLeaveDates(start, end);

      expect(result.valid).toBe(true);
    });

    it('should return valid when start and end are same day (1 day leave)', () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      const end = new Date(start);

      const result = validateLeaveDates(start, end);

      expect(result.valid).toBe(true);
    });
  });
});
