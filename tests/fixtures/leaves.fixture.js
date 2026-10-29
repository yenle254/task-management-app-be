/**
 * Leave Test Fixtures
 */
const mongoose = require('mongoose');

/**
 * Create a mock leave request object
 */
const createMockLeave = (overrides = {}) => {
  const defaultLeave = {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    type: 'vacation',
    startDate: new Date(Date.now() + 86400000), // tomorrow
    endDate: new Date(Date.now() + 172800000), // day after tomorrow
    reason: 'Personal vacation',
    status: 'pending_team_lead',
    currentStep: 'team_lead',
    revision: 0,
    history: [],
    approverSnapshot: [],
    numberOfDays: 2,
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  return { ...defaultLeave, ...overrides };
};

/**
 * Predefined mock leave requests
 */
const mockLeaves = {
  pending: createMockLeave({
    type: 'vacation',
    status: 'pending_team_lead'
  }),

  approved: createMockLeave({
    type: 'sick',
    status: 'approved',
    currentStep: null,
    approvedBy: new mongoose.Types.ObjectId(),
    approvedAt: new Date()
  }),

  rejected: createMockLeave({
    type: 'personal',
    status: 'rejected',
    currentStep: null,
    approvedBy: new mongoose.Types.ObjectId(),
    approvedAt: new Date(),
    rejectionReason: 'Team requires your presence during this period'
  })
};

/**
 * Leave types
 */
const LEAVE_TYPES = ['sick', 'vacation', 'personal'];

/**
 * Leave statuses
 */
const LEAVE_STATUSES = ['draft', 'pending_team_lead', 'pending_hr', 'approved', 'rejected', 'cancelled'];

module.exports = {
  createMockLeave,
  mockLeaves,
  LEAVE_TYPES,
  LEAVE_STATUSES
};
