const {
  resolveAccessibleTeam,
  getTeamMemberProgress,
  getTeamPerformance,
  getTeamOverdueTasks
} = require('../services/team-dashboard.service');
const {
  validateDateRange,
  validatePeriod,
  parseDate,
  normalizeRange
} = require('../utils/dashboard.helper');
const { getTaskEventTrend } = require('../services/task-history.service');
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

const getTeamPerformanceTrend = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { startDate, endDate, period } = req.query;
    const periodCheck = validatePeriod(period);
    if (!periodCheck.valid) return res.status(400).json({ success: false, error: periodCheck.error });
    const rangeCheck = validateDateRange(startDate, endDate);
    if (!rangeCheck.valid) return res.status(400).json({ success: false, error: rangeCheck.error });
    if (Boolean(startDate) !== Boolean(endDate)) return res.status(400).json({ success: false, error: 'Both startDate and endDate are required' });
    const access = await resolveAccessibleTeam(req.user, teamId);
    if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
    const now = new Date();
    let range;
    if (startDate && endDate) range = normalizeRange(parseDate(startDate), parseDate(endDate));
    else if (period === 'week') {
      const start = new Date(now); start.setDate(now.getDate() - (now.getDay() + 6) % 7); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
      range = { startDate: start, endDate: end };
    } else {
      range = { startDate: new Date(now.getFullYear(), now.getMonth() - 5, 1), endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) };
    }
    const grouping = period === 'week' ? 'week' : 'month';
    const trend = await getTaskEventTrend({ teamId: access.team._id.toString() }, grouping, range.startDate, range.endDate);
    return res.json({ success: true, data: { period: { ...range, period: grouping }, trend } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
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

    const parsePositiveInteger = (value) => {
      if (!/^\d+$/.test(String(value))) return null;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const parsedPage = parsePositiveInteger(page);
    const parsedLimit = parsePositiveInteger(limit);
    if (parsedPage === null || parsedLimit === null || parsedLimit > PAGINATION.MAX_LIMIT) {
      return res.status(400).json({
        success: false,
        error: `page must be a positive integer and limit must be between 1 and ${PAGINATION.MAX_LIMIT}`
      });
    }

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
  getTeamPerformanceTrend,
  getTeamOverdue
};
