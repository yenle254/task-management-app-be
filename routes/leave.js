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
const { validateRequest } = require('../middleware/validateRequest');
const {
  submitLeaveValidation,
  getLeavesValidation,
  getLeaveByIdValidation,
  processLeaveValidation,
  getLeaveBalanceValidation,
  getTeamLeavesValidation,
  cancelLeaveValidation
} = require('../validators');

// Apply authentication to all routes
router.use(protect);

// Leave balance
router.get('/balance', getLeaveBalanceValidation, validateRequest, getLeaveBalance);

// My leaves
router.get('/my', getLeavesValidation, validateRequest, getMyLeaves);

// Leave statistics (for dashboard)
router.get('/statistics', authorize('team_lead', 'hr_manager'), getLeaveStatistics);

// Pending leaves (for approval)
router.get('/pending', authorize('team_lead', 'hr_manager'), getPendingLeaves);

// All leaves (HR Manager only)
router.get('/', authorize('hr_manager'), getLeavesValidation, validateRequest, getAllLeaves);

// Team leaves
router.get('/team/:teamId', authorize('team_lead', 'hr_manager'), getTeamLeavesValidation, validateRequest, getTeamLeaves);

// Submit leave
router.post('/', submitLeaveValidation, validateRequest, submitLeave);

// Approve/Reject leave
router.put('/:id/approve', authorize('team_lead', 'hr_manager'), processLeaveValidation, validateRequest, approveLeave);
router.put('/:id/reject', authorize('team_lead', 'hr_manager'), processLeaveValidation, validateRequest, rejectLeave);

// Get leave by ID
router.get('/:id', getLeaveByIdValidation, validateRequest, getLeaveById);

// Cancel leave (only pending)
router.delete('/:id', cancelLeaveValidation, validateRequest, cancelLeave);

module.exports = router;







