const express = require("express");
const router = express.Router();
const {
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
} = require("../controllers/teamController");
const { protect, authorize } = require("../middleware/auth");
const { USER_ROLES } = require("../utils/constants");

// IMPORTANT: Specific routes MUST come before parameterized routes
// Place /members before /:id to avoid route conflicts

// Get all members (must be before /:id routes)
router.get(
  "/members",
  protect,
  authorize(USER_ROLES.HR_MANAGER),
  getAllMembers
);

// Get available leaders (must be before /:id routes)
router.get(
  "/available-leaders",
  protect,
  authorize(USER_ROLES.HR_MANAGER),
  getAvailableLeaders
);

// General team routes
router.post("/", protect, authorize(USER_ROLES.HR_MANAGER), createTeam);
router.get("/", protect, authorize(USER_ROLES.HR_MANAGER), getAllTeams);
router.get("/:id", protect, authorize(USER_ROLES.HR_MANAGER), getTeamById);
router.put("/:id", protect, authorize(USER_ROLES.HR_MANAGER), updateTeam);
router.delete("/:id", protect, authorize(USER_ROLES.HR_MANAGER), deleteTeam);

// Team member operations
router.post(
  "/:id/members",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  addMember
);

router.get(
  "/:id/members",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  getTeamMembers
);

router.delete(
  "/:id/members/:userId",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  removeMember
);

// Team leader operations
router.put(
  "/:id/leader",
  protect,
  authorize(USER_ROLES.HR_MANAGER),
  assignTeamLead
);

module.exports = router;
