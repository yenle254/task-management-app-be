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
const { validateRequest } = require("../middleware/validateRequest");
const { USER_ROLES } = require("../utils/constants");
const {
  getUsersValidation,
  getUserByIdValidation,
  updateUserValidation,
  getUsersByTeamValidation
} = require("../validators");

router.get("/", protect, authorize(USER_ROLES.HR_MANAGER), getUsersValidation, validateRequest, getAllUsers);
router.get("/messaging/contacts", protect, getAllUsers);
router.get("/:id", protect, getUserByIdValidation, validateRequest, getUserById);
router.put("/:id", protect, authorize(USER_ROLES.HR_MANAGER), updateUserValidation, validateRequest, updateUser);
router.delete("/:id", protect, authorize(USER_ROLES.HR_MANAGER), getUserByIdValidation, validateRequest, deleteUser);
router.get("/team/:teamId", protect, getUsersByTeamValidation, validateRequest, getUsersByTeam);

module.exports = router;
