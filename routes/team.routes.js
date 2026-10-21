const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/async-handler.middleware");
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
} = require("../controllers/team.controller");
const {
  getMemberProgress,
  getTeamPerformanceEndpoint,
  getTeamOverdue
} = require("../controllers/team-dashboard.controller");
const { protect, authorize } = require("../middleware/auth.middleware");
const { USER_ROLES } = require("../utils/constants.utils");

// IMPORTANT: Specific routes MUST come before parameterized routes
// Place /members before /:id to avoid route conflicts

// Get all members (must be before /:id routes)
router.get(
  "/members",
  protect,
  authorize(USER_ROLES.HR_MANAGER),
  asyncHandler(getAllMembers)
);

// Get available leaders (must be before /:id routes)
router.get(
  "/available-leaders",
  protect,
  authorize(USER_ROLES.HR_MANAGER),
  asyncHandler(getAvailableLeaders)
);

// General team routes
router.post("/", protect, authorize(USER_ROLES.HR_MANAGER), asyncHandler(createTeam));
router.get("/", protect, authorize(USER_ROLES.HR_MANAGER), asyncHandler(getAllTeams));
router.get("/:id", protect, authorize(USER_ROLES.HR_MANAGER), asyncHandler(getTeamById));
router.put("/:id", protect, authorize(USER_ROLES.HR_MANAGER), asyncHandler(updateTeam));
router.delete("/:id", protect, authorize(USER_ROLES.HR_MANAGER), asyncHandler(deleteTeam));

// Team member operations
router.post(
  "/:id/members",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  asyncHandler(addMember)
);

router.get(
  "/:id/members",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  asyncHandler(getTeamMembers)
);

router.delete(
  "/:id/members/:userId",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  asyncHandler(removeMember)
);

// Team leader operations
router.put(
  "/:id/leader",
  protect,
  authorize(USER_ROLES.HR_MANAGER),
  asyncHandler(assignTeamLead)
);

// Team dashboard routes (Team Lead / HR access)
router.get(
  "/:teamId/members/progress",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  asyncHandler(getMemberProgress)
);

router.get(
  "/:teamId/performance",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  asyncHandler(getTeamPerformanceEndpoint)
);

router.get(
  "/:teamId/overdue",
  protect,
  authorize(USER_ROLES.TEAM_LEAD, USER_ROLES.HR_MANAGER),
  asyncHandler(getTeamOverdue)
);

module.exports = router;
