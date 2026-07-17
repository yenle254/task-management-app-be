const express = require('express');
const router = express.Router();
const {
    submitLeave,
    getMyLeaves,
    getAllLeaves,
    getLeaveById,
    getPendingLeaves,
    getLeaveStatistics,
    approveLeave,
    rejectLeave,
    cancelLeave,
    getLeaveBalance,
    getTeamLeaves
} = require('../controllers/leaveController');
const { protect, authorize } = require('../middleware/auth');

// Apply authentication to all routes
router.use(protect);

// Leave balance
router.get('/balance', getLeaveBalance);

// My leaves
router.get('/my', getMyLeaves);

// Leave statistics (for dashboard)
router.get('/statistics', authorize('team_lead', 'hr_manager'), getLeaveStatistics);

// Pending leaves (for approval)
router.get('/pending', authorize('team_lead', 'hr_manager'), getPendingLeaves);

// All leaves (HR Manager only)
router.get('/', authorize('hr_manager'), getAllLeaves);

// Team leaves
router.get('/team/:teamId', authorize('team_lead', 'hr_manager'), getTeamLeaves);

// Submit leave
router.post('/', submitLeave);

// Approve/Reject leave
router.put('/:id/approve', authorize('team_lead', 'hr_manager'), approveLeave);
router.put('/:id/reject', authorize('team_lead', 'hr_manager'), rejectLeave);

// Get leave by ID
router.get('/:id', getLeaveById);

// Cancel leave (only pending)
router.delete('/:id', cancelLeave);

module.exports = router;







