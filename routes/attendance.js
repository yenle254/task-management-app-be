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


router.use(protect);

// Clockin
router.post('/clockin', clockIn);

// Clockout
router.post('/clockout', clockOut);

// Get my attendance records
router.get('/my', getMyAttendance);

// Get today's attendance for current user
router.get('/today', getTodayAttendance);

// Get attendance by date range
router.get('/date', authorize('team_lead', 'hr_manager'), getAttendanceByDate);

// Get all attendance records (HR Manager only)
router.get('/', authorize('hr_manager'), getAllAttendance);

// Get team attendance records
router.get('/team/:teamId', authorize('team_lead', 'hr_manager'), getTeamAttendance);

// Get attendance statistics
router.get('/stats', getAttendanceStats);

// Update attendance record
router.put('/:id', authorize('hr_manager'), updateAttendance);

module.exports = router;