const teamService = require("../services/teamService");

/**
 * * @desc    Create a new team
 * * @route   POST /api/teams
 * * @access  Private (HR Manager)
 */

const createTeam = async (req, res) => {
  try {
    const { name, description, leaderId } = req.body;

    if (!name || !leaderId) {
      return res.status(400).json({
        success: false,
        error: "Team name and leader ID are required",
      });
    }

    const team = await teamService.createTeam({
      name,
      description,
      leaderId,
    });

    res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: team,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Get all teams
 * @route   GET /api/teams
 * @access  Private
 */
const getAllTeams = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const result = await teamService.getAllTeams(
      parseInt(page),
      parseInt(limit)
    );

    res.status(200).json({
      success: true,
      data: result.teams,
      pagination: result.pagination,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Get team by ID
 * @route   GET /api/teams/:id
 * @access  Private
 */

const getTeamById = async (req, res) => {
  try {
    const { id } = req.params;
    const team = await teamService.getTeamById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found",
      });
    }
    res.status(200).json({
      success: true,
      data: team,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Update team info
 * @route   PUT /api/teams/:id
 * @access  Private (HR Manager)
 */

const updateTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, leaderId } = req.body;

    const team = await teamService.updateTeam(id, {
      name,
      description,
      leaderId,
    });
    res.status(200).json({
      success: true,
      message: "Team updated successfully",
      data: team,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 *  @desc DELETE team by ID
 *  @route DELETE /api/teams/:id
 *  @access Private (HR Manager)
 */

const deleteTeam = async (req, res) => {
  try {
    const { id } = req.params;

    await teamService.deleteTeam(id);

    res.status(200).json({
      success: true,
      message: "Team deleted successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Add member to team
 * @route   POST /api/teams/:id/members
 * @access  Private (Team Lead, HR Manager)
 */
const addMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const team = await teamService.addMember(id, userId);

    res.status(200).json({
      success: true,
      message: "Member added successfully",
      data: team,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Remove member from team
 * @route   DELETE /api/teams/:id/members/:userId
 * @access  Private (Team Lead, HR Manager)
 */
const removeMember = async (req, res) => {
  try {
    const { id, userId } = req.params;

    const team = await teamService.removeMember(id, userId);

    res.status(200).json({
      success: true,
      message: "Member removed successfully",
      data: team,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Assign new team leader
 * @route   PUT /api/teams/:id/leader
 * @access  Private (HR Manager)
 */
const assignTeamLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { leaderId } = req.body;

    if (!leaderId) {
      return res.status(400).json({
        success: false,
        error: "Leader ID is required",
      });
    }

    const team = await teamService.assignTeamLead(id, leaderId);

    res.status(200).json({
      success: true,
      message: "Team leader assigned successfully",
      data: team,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Get all members (HR only)
 * @route   GET /api/teams/members
 * @access  Private (HR Manager)
 */
const getAllMembers = async (req, res) => {
  try {
    if (req.user.role !== "hr_manager") {
      return res.status(403).json({
        success: false,
        error: "Only HR managers can view all members"
      });
    }

    const members = await teamService.getAllMembers();

    res.status(200).json({
      success: true,
      data: members
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};


/**
 * @desc    Get members of a team
 * @route   GET /api/teams/:id/members
 * @access  Private (Team Lead, HR Manager)
 */
const getTeamMembers = async (req, res) => {
  try {
    let teamId = req.params.id;

    if (req.user.role === "team_lead") {
      teamId = req.user.teamId;
    }

    const members = await teamService.getTeamMembers(teamId);

    res.status(200).json({
      success: true,
      data: members
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * @desc    Get available leaders (team_lead only) with leading status
 * @route   GET /api/teams/available-leaders
 * @access  Private (HR Manager)
 */
const getAvailableLeaders = async (req, res) => {
  try {
    const { excludeTeamId = null } = req.query;
    const leaders = await teamService.getAvailableLeaders(excludeTeamId);

    res.status(200).json({
      success: true,
      data: leaders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  createTeam,
  getAllTeams,
  getTeamById,
    updateTeam,
    deleteTeam,
  addMember,
  removeMember,
  assignTeamLead,
  getTeamMembers,
  getAllMembers,
  getAvailableLeaders
};
