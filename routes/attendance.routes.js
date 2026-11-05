const { USER_ROLES } = require('../utils/constants.utils');
const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/async-handler.middleware');
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
} = require('../controllers/attendance.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validateRequest } = require('../middleware/validate-request.middleware');
const {
  clockInValidation,
  getAttendanceValidation,
  getTeamAttendanceValidation,
  updateAttendanceValidation
} = require('../validators');


router.use(protect);

// Keep both spellings while clients migrate to the documented kebab-case URLs.
router.post('/clockin', clockInValidation, validateRequest, asyncHandler(clockIn));
router.post('/clock-in', clockInValidation, validateRequest, asyncHandler(clockIn));

// Clockout
router.post('/clockout', asyncHandler(clockOut));
router.put('/clockout', asyncHandler(clockOut));
router.post('/clock-out', asyncHandler(clockOut));
router.put('/clock-out', asyncHandler(clockOut));

// Get my attendance records
router.get('/my', getAttendanceValidation, validateRequest, asyncHandler(getMyAttendance));

// Get today's attendance for current user
router.get('/today', asyncHandler(getTodayAttendance));

// Get attendance by date range
router.get('/date', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), asyncHandler(getAttendanceByDate));
router.get('/date/:date', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), asyncHandler(getAttendanceByDate));

// Get all attendance records (HR Manager only)
router.get('/', authorize(USER_ROLES.HR_MANAGER), getAttendanceValidation, validateRequest, asyncHandler(getAllAttendance));

// Get team attendance records
router.get('/team/:teamId', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), getTeamAttendanceValidation, validateRequest, asyncHandler(getTeamAttendance));

// Get attendance statistics
router.get('/stats', asyncHandler(getAttendanceStats));

// Update attendance record
router.put('/:id', authorize(USER_ROLES.HR_MANAGER), updateAttendanceValidation, validateRequest, asyncHandler(updateAttendance));

module.exports = router;
