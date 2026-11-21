const {
  generateAssistantReply,
  generateTaskBreakdown,
  summarizeTask
} = require('../services/ai-assistant.service');
const { buildTaskSummaryContext } = require('../services/ai-context.service');
const { recordAssistantFeedback } = require('../services/ai-conversation.service');

/**
 * @desc    Chat with Internal AI HR & Task Copilot (RBAC-scoped context + Chat-to-Action)
 * @route   POST /api/ai/assistant
 * @access  Private (All authenticated roles: employee, team_lead, hr_manager, system_admin)
 */
const chatWithAssistant = async (req, res) => {
  const { message, history = [], forceRefresh = false } = req.body;

  const result = await generateAssistantReply({
    user: req.user,
    message,
    history,
    forceRefresh: Boolean(forceRefresh),
    io: req.app?.get?.('io') || null
  });

  return res.status(200).json({
    success: true,
    data: result
  });
};

/**
 * @desc    AI Task Breakdown (Suggest subTasks, checklist, difficulty, priority, estimatedMinutes, storyPoints)
 * @route   POST /api/ai/task-breakdown
 * @access  Private (Team Lead, HR Manager)
 */
const createTaskBreakdown = async (req, res) => {
  const { title, description = '' } = req.body;

  const breakdown = await generateTaskBreakdown({
    title,
    description
  });

  return res.status(200).json({
    success: true,
    data: breakdown
  });
};

/**
 * @desc    Summarize Task status, blockers, dependencies, statusHistory, and recent comments
 * @route   POST /api/ai/task-summary/:taskId
 * @access  Private (RBAC verified via canUserAccessTask)
 */
const getTaskSummary = async (req, res) => {
  const { taskId } = req.params;

  const resolved = await buildTaskSummaryContext(req.user, taskId);
  if (!resolved.ok) {
    return res.status(resolved.status || 400).json({
      success: false,
      error: resolved.error
    });
  }

  const summary = await summarizeTask(resolved.taskContext);

  return res.status(200).json({
    success: true,
    data: summary
  });
};

/**
 * @desc    Submit user feedback (thumbs up/down) for model governance & retraining (Phase 2.5)
 * @route   POST /api/ai/feedback
 * @access  Private
 */
const submitAssistantFeedback = async (req, res) => {
  const { message, predictedIntent, rating, confirmedAction, comment } = req.body;

  const entry = recordAssistantFeedback({
    userId: req.user._id,
    message,
    predictedIntent,
    rating,
    confirmedAction,
    comment
  });

  return res.status(201).json({
    success: true,
    data: entry
  });
};

module.exports = {
  chatWithAssistant,
  createTaskBreakdown,
  getTaskSummary,
  submitAssistantFeedback
};
