const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth.middleware");
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

router.get("/overview", getOverviewStats);
router.get("/employees-by-department", getEmployeesByDepartment);
router.get("/attendance", getAttendanceStats);
router.get("/leaves", getLeaveStats);
router.get("/tasks", getTaskStats);
router.get("/team-performance", getTeamPerformance);

module.exports = router;
