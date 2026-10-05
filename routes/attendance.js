const express = require('express');
const router = express.Router();
const {
    clockIn,
    clockOut,
    getMyAttendance,
    getAttendanceByDate,
    getAllAttendance,
    getTeamAttendance,
    getAttendanceStats,
    updateAttendance,
    getTodayAttendance
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validateRequest');
const {
  clockInValidation,
  getAttendanceValidation,
  getTeamAttendanceValidation,
  updateAttendanceValidation
} = require('../validators');


router.use(protect);

// Clockin
router.post('/clockin', clockInValidation, validateRequest, clockIn);

// Clockout
router.post('/clockout', clockOut);

// Get my attendance records
router.get('/my', getAttendanceValidation, validateRequest, getMyAttendance);

// Get today's attendance for current user
router.get('/today', getTodayAttendance);

// Get attendance by date range
router.get('/date', authorize('team_lead', 'hr_manager'), getAttendanceByDate);

// Get all attendance records (HR Manager only)
router.get('/', authorize('hr_manager'), getAttendanceValidation, validateRequest, getAllAttendance);

// Get team attendance records
router.get('/team/:teamId', authorize('team_lead', 'hr_manager'), getTeamAttendanceValidation, validateRequest, getTeamAttendance);

// Get attendance statistics
router.get('/stats', getAttendanceStats);

// Update attendance record
router.put('/:id', authorize('hr_manager'), updateAttendanceValidation, validateRequest, updateAttendance);

module.exports = router;