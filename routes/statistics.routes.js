const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth.middleware");
const asyncHandler = require("../middleware/async-handler.middleware");
const { USER_ROLES } = require("../utils/constants.utils");
const {
  getOverviewStats,
  getEmployeesByDepartment,
  getAttendanceStats,
  getLeaveStats,
  getTaskStats,
  getTeamPerformance,
} = require("../controllers/statistics.controller");

router.use(protect);
router.use(authorize(USER_ROLES.HR_MANAGER));

router.get("/overview", asyncHandler(getOverviewStats));
router.get("/employees-by-department", asyncHandler(getEmployeesByDepartment));
router.get("/attendance", asyncHandler(getAttendanceStats));
router.get("/leaves", asyncHandler(getLeaveStats));
router.get("/tasks", asyncHandler(getTaskStats));
router.get("/team-performance", asyncHandler(getTeamPerformance));

module.exports = router;
