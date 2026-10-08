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
const { strictLimiter } = require("../middleware/rate-limit.middleware");
const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyOTPValidation,
  resetPasswordValidation,
  changePasswordValidation,
  updateProfileValidation
} = require("../validators");

// Strict rate limit for sensitive auth endpoints
router.post("/register", strictLimiter, registerValidation, validateRequest, register);
router.post("/login", strictLimiter, loginValidation, validateRequest, login);
router.post("/forgot-password", strictLimiter, forgotPasswordValidation, validateRequest, forgotPassword);
router.post("/verify-otp", strictLimiter, verifyOTPValidation, validateRequest, verifyOTP);
router.post("/reset-password", strictLimiter, resetPasswordValidation, validateRequest, resetPassword);
router.post("/resend-otp", strictLimiter, forgotPasswordValidation, validateRequest, resendOTP);

// Protected routes (no rate limit on auth endpoints that require existing session)
router.put("/password", protect, changePasswordValidation, validateRequest, changePassword);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfileValidation, validateRequest, updateProfile);

module.exports = router;
