const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/async-handler.middleware");
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
const { strictLimiter, authLimiter } = require("../middleware/rate-limit.middleware");
const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyOTPValidation,
  resetPasswordValidation,
  changePasswordValidation,
  updateProfileValidation
} = require("../validators");

// Keep registration at 5/15min; other public auth endpoints share a separate 30/15min budget.
router.post("/register", strictLimiter, registerValidation, validateRequest, asyncHandler(register));
router.post("/login", authLimiter, loginValidation, validateRequest, asyncHandler(login));
router.post("/forgot-password", authLimiter, forgotPasswordValidation, validateRequest, asyncHandler(forgotPassword));
router.post("/verify-otp", authLimiter, verifyOTPValidation, validateRequest, asyncHandler(verifyOTP));
router.post("/reset-password", authLimiter, resetPasswordValidation, validateRequest, asyncHandler(resetPassword));
router.post("/resend-otp", authLimiter, forgotPasswordValidation, validateRequest, asyncHandler(resendOTP));

// Protected routes (no rate limit on auth endpoints that require existing session)
router.put("/password", protect, changePasswordValidation, validateRequest, asyncHandler(changePassword));
router.get("/me", protect, asyncHandler(getMe));
router.put("/profile", protect, updateProfileValidation, validateRequest, asyncHandler(updateProfile));

const sessionController = require('../controllers/session.controller');
const { param } = require('express-validator');
const { refreshTokenValidation, logoutValidation } = require('../validators/auth.validators');
const { refreshLimiter } = require('../middleware/rate-limit.middleware');
router.post('/refresh', refreshLimiter, refreshTokenValidation, validateRequest, sessionController.refresh);
router.post('/logout', refreshLimiter, logoutValidation, validateRequest, sessionController.logout);
router.post('/logout-all', protect, sessionController.logoutAll);
router.get('/sessions', protect, sessionController.list);
router.delete('/sessions/:sessionId', protect, param('sessionId').isUUID(), validateRequest, sessionController.revoke);
module.exports = router;
