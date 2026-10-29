const { USER_ROLES } = require('../utils/constants.utils');
const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/async-handler.middleware');
const {
    submitLeave,
    submitDraft,
    editLeave,
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
} = require('../controllers/leave.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validateRequest } = require('../middleware/validate-request.middleware');
const {
  submitLeaveValidation,
  editLeaveValidation,
  pendingLeavesValidation,
  getLeavesValidation,
  getLeaveByIdValidation,
  processLeaveValidation,
  getLeaveBalanceValidation,
  getTeamLeavesValidation,
  cancelLeaveValidation
} = require('../validators/leave.validators');

// Apply authentication to all routes
router.use(protect);

// Leave balance
router.get('/balance', getLeaveBalanceValidation, validateRequest, asyncHandler(getLeaveBalance));

// My leaves
router.get('/my', getLeavesValidation, validateRequest, asyncHandler(getMyLeaves));

// Leave statistics (for dashboard)
router.get('/statistics', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), asyncHandler(getLeaveStatistics));

// Pending leaves (for approval)
router.get('/pending', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), pendingLeavesValidation, validateRequest, asyncHandler(getPendingLeaves));

// All leaves (HR Manager only)
router.get('/', authorize(USER_ROLES.HR_MANAGER), getLeavesValidation, validateRequest, asyncHandler(getAllLeaves));

// Team leaves
router.get('/team/:teamId', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), getTeamLeavesValidation, validateRequest, asyncHandler(getTeamLeaves));

// Submit leave
router.post('/', submitLeaveValidation, validateRequest, asyncHandler(submitLeave));
router.post('/:id/submit', editLeaveValidation, validateRequest, asyncHandler(submitDraft));
// Editing also resubmits atomically; there is no separate resubmit action.
router.put('/:id/edit', editLeaveValidation, validateRequest, asyncHandler(editLeave));

// Approve/Reject leave
router.put('/:id/approve', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), processLeaveValidation, validateRequest, asyncHandler(approveLeave));
router.put('/:id/reject', authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER), processLeaveValidation, validateRequest, asyncHandler(rejectLeave));

// Get leave by ID
router.get('/:id', getLeaveByIdValidation, validateRequest, asyncHandler(getLeaveById));

// Cancel leave (only pending)
router.delete('/:id', cancelLeaveValidation, validateRequest, asyncHandler(cancelLeave));

module.exports = router;







