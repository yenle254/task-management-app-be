const express = require('express');
const router = express.Router();
const asyncHandler = require('../../middleware/async-handler.middleware');
const { protect, authorize } = require('../../middleware/auth.middleware');
const { validateRequest } = require('../../middleware/validate-request.middleware');
const { USER_ROLES } = require('../../utils/constants.utils');
const {
  assistantChatValidation,
  taskBreakdownValidation,
  taskSummaryValidation
} = require('../validators/ai.validators');
const {
  chatWithAssistant,
  createTaskBreakdown,
  getTaskSummary
} = require('../controllers/ai.controller');

// All AI Copilot routes require authentication
router.use(protect);

// 1. Personal HR & Task Assistant + Smart Workload Advisor + Chat-to-Action
router.post(
  '/assistant',
  assistantChatValidation,
  validateRequest,
  asyncHandler(chatWithAssistant)
);

// 2. AI Task Breakdown & Estimation (Team Lead & HR Manager)
router.post(
  '/task-breakdown',
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  taskBreakdownValidation,
  validateRequest,
  asyncHandler(createTaskBreakdown)
);

// 3. AI Task Summary (Status history, dependencies, review rounds & comments)
router.post(
  '/task-summary/:taskId',
  taskSummaryValidation,
  validateRequest,
  asyncHandler(getTaskSummary)
);

module.exports = router;

