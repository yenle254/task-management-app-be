/**
 * Attendance Test Fixtures
 */
const mongoose = require('mongoose');

/**
 * Create a mock attendance record object
 */
const createMockAttendance = (overrides = {}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const defaultAttendance = {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    date: today,
    clockIn: new Date(today.getTime() + 9 * 60 * 60 * 1000), // 9:00 AM
    clockOut: new Date(today.getTime() + 18 * 60 * 60 * 1000), // 6:00 PM
    status: 'present',
    workHours: 9,
    location: {
      clockIn: { lat: 10.8231, lng: 106.6297 },
      clockOut: { lat: 10.8231, lng: 106.6297 }
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };

  return { ...defaultAttendance, ...overrides };
};

/**
 * Predefined mock attendance records
 */
const mockAttendance = {
  present: createMockAttendance({
    status: 'present',
    clockIn: new Date(new Date().setHours(8, 30, 0, 0)),
    clockOut: new Date(new Date().setHours(17, 30, 0, 0)),
    workHours: 9
  }),

  late: createMockAttendance({
    status: 'late',
    clockIn: new Date(new Date().setHours(9, 30, 0, 0)),
    clockOut: new Date(new Date().setHours(18, 0, 0, 0)),
    workHours: 8.5
  }),

  absent: createMockAttendance({
    status: 'absent',
    clockIn: null,
    clockOut: null,
    workHours: 0
  })
};

/**
 * Attendance statuses
 */
const ATTENDANCE_STATUSES = ['present', 'late', 'absent'];

module.exports = {
  createMockAttendance,
  mockAttendance,
  ATTENDANCE_STATUSES
};
