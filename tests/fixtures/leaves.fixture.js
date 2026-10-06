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
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
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
    status: 'pending'
  }),

  approved: createMockLeave({
    type: 'sick',
    status: 'approved',
    reviewedBy: new mongoose.Types.ObjectId(),
    reviewedAt: new Date()
  }),

  rejected: createMockLeave({
    type: 'personal',
    status: 'rejected',
    reviewedBy: new mongoose.Types.ObjectId(),
    reviewedAt: new Date(),
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
const LEAVE_STATUSES = ['pending', 'approved', 'rejected'];

module.exports = {
  createMockLeave,
  mockLeaves,
  LEAVE_TYPES,
  LEAVE_STATUSES
};
