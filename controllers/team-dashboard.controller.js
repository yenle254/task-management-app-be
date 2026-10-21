const {
  resolveAccessibleTeam,
  getTeamMemberProgress,
  getTeamPerformance,
  getTeamOverdueTasks
} = require('../services/team-dashboard.service');
const {
  validateDateRange,
  parseDate,
  normalizeRange
} = require('../utils/dashboard.helper');
const { PAGINATION } = require('../utils/constants.utils');

/**
 * @desc    Get per-member task progress for a team
 * @route   GET /api/teams/:teamId/members/progress
 * @access  Private (Team Lead of that team, HR Manager)
 */
const getMemberProgress = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { startDate, endDate } = req.query;

    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) {
      return res.status(400).json({ success: false, error: rangeCheck.error });
    }

    if ((startDate && !endDate) || (!startDate && endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Both startDate and endDate are required when specifying a date range'
      });
    }

    const access = await resolveAccessibleTeam(req.user, teamId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        error: access.error
      });
    }

    let range = { startDate: null, endDate: null };
    if (startDate && endDate) {
      range = normalizeRange(parseDate(startDate), parseDate(endDate));
    }

    const progress = await getTeamMemberProgress(
      access.team,
      range.startDate,
      range.endDate
    );

    res.json({
      success: true,
      count: progress.length,
      data: progress
    });
  } catch (error) {
    console.error('Get member progress error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Get aggregated performance summary for a team
 * @route   GET /api/teams/:teamId/performance
 * @access  Private (Team Lead of that team, HR Manager)
 */
const getTeamPerformanceEndpoint = async (req, res) => {
  try {
    const { teamId } = req.params;

    const access = await resolveAccessibleTeam(req.user, teamId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        error: access.error
      });
    }

    const performance = await getTeamPerformance(access.team);

    res.json({
      success: true,
      data: performance
    });
  } catch (error) {
    console.error('Get team performance error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Get overdue tasks for a team (oldest deadline first)
 * @route   GET /api/teams/:teamId/overdue
 * @access  Private (Team Lead of that team, HR Manager)
 */
const getTeamOverdue = async (req, res) => {
  try {
    const { teamId } = req.params;
    const {
      page = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT
    } = req.query;

    const parsedPage = Math.max(parseInt(page) || 1, 1);
    const parsedLimit = Math.min(
      Math.max(parseInt(limit) || PAGINATION.DEFAULT_LIMIT, 1),
      PAGINATION.MAX_LIMIT
    );

    const access = await resolveAccessibleTeam(req.user, teamId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        error: access.error
      });
    }

    const result = await getTeamOverdueTasks(
      access.team,
      parsedPage,
      parsedLimit
    );

    res.json({
      success: true,
      count: result.tasks.length,
      total: result.pagination.total,
      page: result.pagination.page,
      pages: result.pagination.pages,
      data: result.tasks
    });
  } catch (error) {
    console.error('Get team overdue error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getMemberProgress,
  getTeamPerformanceEndpoint,
  getTeamOverdue
};
