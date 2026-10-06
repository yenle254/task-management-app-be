/**
 * User Test Fixtures
 */
const mongoose = require('mongoose');

/**
 * Create a mock user object
 */
const createMockUser = (overrides = {}) => {
  const defaultUser = {
    _id: new mongoose.Types.ObjectId(),
    email: `user${Date.now()}@example.com`,
    password: '$2a$10$XQxBtMFjJ8zOqH8W7EKEKuZ8fE0dQVYbH6vKj5cLmN9oR0pW1qS2', // hashed 'password123'
    role: 'employee',
    isActive: true,
    profile: {
      fullName: 'Test User',
      employeeId: 'EMP001',
      department: 'IT',
      position: 'Developer',
      phone: '0123456789',
      avatar: null
    },
    teamId: null,
    managerId: null,
    leaveBalance: new Map([['2025', { total: 12, used: 0, remaining: 12 }]]),
    resetPassword: {},
    lastLogin: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  return { ...defaultUser, ...overrides };
};

/**
 * Predefined mock users for different roles
 */
const mockUsers = {
  employee: createMockUser({
    email: 'employee@example.com',
    role: 'employee',
    profile: { fullName: 'Employee User', employeeId: 'EMP001', department: 'IT', position: 'Developer' }
  }),

  teamLead: createMockUser({
    email: 'teamlead@example.com',
    role: 'team_lead',
    profile: { fullName: 'Team Lead User', employeeId: 'EMP002', department: 'IT', position: 'Team Lead' }
  }),

  hrManager: createMockUser({
    email: 'hrmanager@example.com',
    role: 'hr_manager',
    profile: { fullName: 'HR Manager User', employeeId: 'EMP003', department: 'HR', position: 'HR Manager' }
  })
};

/**
 * Create multiple mock users
 */
const createMockUsers = (count = 5, baseData = {}) => {
  return Array.from({ length: count }, (_, index) =>
    createMockUser({
      email: `user${index}@example.com`,
      profile: {
        fullName: `Test User ${index}`,
        employeeId: `EMP${String(index).padStart(3, '0')}`,
        department: baseData.department || 'IT',
        position: baseData.position || 'Developer',
        phone: `0123456${String(index).padStart(3, '0')}`,
        avatar: null
      },
      ...baseData
    })
  );
};

module.exports = {
  createMockUser,
  mockUsers,
  createMockUsers
};
