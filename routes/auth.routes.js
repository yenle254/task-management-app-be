const express = require("express");
const router = express.Router();
const {
  register,
  login,
  forgotPassword,
  verifyOTP,
  resetPassword,
  resendOTP,
  getMe,
  updateProfile,
  changePassword,
} = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");
const { validateRequest } = require("../middleware/validate-request.middleware");
const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyOTPValidation,
  resetPasswordValidation,
  changePasswordValidation,
  updateProfileValidation
} = require("../validators");

router.post("/register", registerValidation, validateRequest, register);
router.post("/login", loginValidation, validateRequest, login);

router.post("/forgot-password", forgotPasswordValidation, validateRequest, forgotPassword);
router.post("/verify-otp", verifyOTPValidation, validateRequest, verifyOTP);
router.post("/reset-password", resetPasswordValidation, validateRequest, resetPassword);
router.post("/resend-otp", forgotPasswordValidation, validateRequest, resendOTP);

router.put("/password", protect, changePasswordValidation, validateRequest, changePassword);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfileValidation, validateRequest, updateProfile);

module.exports = router;
