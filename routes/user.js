const express = require("express");
const router = express.Router();
const {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUsersByTeam,
} = require("../controllers/userController");
const { protect, authorize } = require("../middleware/auth");
const { USER_ROLES } = require("../utils/constants");

router.get("/", protect, authorize(USER_ROLES.HR_MANAGER), getAllUsers);
router.get("/messaging/contacts", protect, getAllUsers); // For messaging - all authenticated users
router.get("/:id", protect, getUserById);
router.put("/:id", protect, authorize(USER_ROLES.HR_MANAGER), updateUser);
router.delete("/:id", protect, authorize(USER_ROLES.HR_MANAGER), deleteUser);
router.get("/team/:teamId", protect, getUsersByTeam);

module.exports = router;
