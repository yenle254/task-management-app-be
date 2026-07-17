const User = require("../models/User");
const Team = require("../models/Team");
const { hashPassword, comparePassword } = require("../services/authService");
const { sendTokenResponse } = require("../config/jwt");
const { sendResetPasswordEmail } = require("../services/emailService");
const {
  generateOTP,
  isOTPExpired,
  getOTPExpireTime,
} = require("../utils/otpHelper");

/**
 * @desc    Register user & get token
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = async (req, res) => {
  try {
    const { email, password, role, profile } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "Email already registered",
      });
    }

    const hashedPassword = await hashPassword(password);

    const user = await User.create({
      email,
      password: hashedPassword,
      role: role || "employee",
      profile: {
        fullName: profile.fullName,
        employeeId: profile.employeeId,
        department: profile.department || null,
        position: profile.position || null,
        phone: profile.phone || null,
        avatar: profile.avatar || null,
      },
      teamId: null,
      managerId: null,
      isActive: true,
      leaveBalance: new Map([["2025", { total: 12, used: 0, remaining: 12 }]]),
    });

    sendTokenResponse(user, 201, res);
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    const isMatch = await comparePassword(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: "Account is deactivated",
      });
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Forgot password - Send OTP to email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "No account found with this email",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: "Account is deactivated",
      });
    }

    const otp = generateOTP();
    const otpExpires = getOTPExpireTime();

    user.resetPassword = {
      otp: otp,
      otpExpires: otpExpires,
      attempts: 0,
    };
    await user.save();

    try {
      await sendResetPasswordEmail(user.email, otp, user.profile.fullName);
    } catch (emailError) {
      console.error("Failed to send email:", emailError);
    }

    res.status(200).json({
      success: true,
      message: "Verification code sent to your email",
      data: {
        email: user.email,
        expiresIn: "10 minutes",
      },
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process request. Please try again.",
    });
  }
};

/**
 * @desc    Verify OTP code
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        error: "Email and OTP are required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    if (!user.resetPassword || !user.resetPassword.otp) {
      return res.status(400).json({
        success: false,
        error: "No password reset request found. Please request a new code.",
      });
    }

    if (user.resetPassword.attempts >= 5) {
      user.resetPassword = {};
      await user.save();

      return res.status(429).json({
        success: false,
        error: "Too many attempts. Please request a new verification code.",
      });
    }

    if (isOTPExpired(user.resetPassword.otpExpires)) {
      user.resetPassword = {};
      await user.save();

      return res.status(400).json({
        success: false,
        error: "Verification code has expired. Please request a new one.",
      });
    }

    if (user.resetPassword.otp !== otp) {
      user.resetPassword.attempts += 1;
      await user.save();

      const remainingAttempts = 5 - user.resetPassword.attempts;
      return res.status(400).json({
        success: false,
        error: `Invalid verification code. ${remainingAttempts} attempts remaining.`,
      });
    }

    const resetToken = require("crypto").randomBytes(32).toString("hex");
    user.resetPassword.otp = null;
    user.resetPassword.resetToken = resetToken;
    user.resetPassword.resetTokenExpires = new Date(
      Date.now() + 15 * 60 * 1000
    ); 
    await user.save();

    res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      data: {
        resetToken: resetToken,
        expiresIn: "15 minutes",
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to verify code. Please try again.",
    });
  }
};

/**
 * @desc    Reset password with token
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
const resetPassword = async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;

    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Email, reset token and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Kiểm tra reset token
    if (
      !user.resetPassword ||
      !user.resetPassword.resetToken ||
      user.resetPassword.resetToken !== resetToken
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired reset token. Please start over.",
      });
    }

    // Kiểm tra token hết hạn
    if (new Date() > new Date(user.resetPassword.resetTokenExpires)) {
      user.resetPassword = {};
      await user.save();

      return res.status(400).json({
        success: false,
        error: "Reset token has expired. Please request a new code.",
      });
    }

    // Hash password mới và lưu
    user.password = await hashPassword(newPassword);
    user.resetPassword = {}; // Xóa tất cả dữ liệu reset
    await user.save();

    res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now login with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to reset password. Please try again.",
    });
  }
};

/**
 * @desc    Resend OTP code
 * @route   POST /api/auth/resend-otp
 * @access  Public
 */
const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "No account found with this email",
      });
    }

    // Tạo OTP mới
    const otp = generateOTP();
    const otpExpires = getOTPExpireTime();

    user.resetPassword = {
      otp: otp,
      otpExpires: otpExpires,
      attempts: 0,
    };
    await user.save();

    // Gửi email
    try {
      await sendResetPasswordEmail(user.email, otp, user.profile.fullName);
    } catch (emailError) {
      console.error("Failed to send email:", emailError);
    }

    res.status(200).json({
      success: true,
      message: "New verification code sent to your email",
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resend code. Please try again.",
    });
  }
};

/**
 * @desc    Change user password
 * @route   PUT /api/auth/password
 * @access  Private
 */
const changePassword = async (req, res) => {
  try {
    const userId = req.user._id;
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(userId).select("+password");
    const isMatch = await comparePassword(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: "Old password is incorrect",
      });
    }

    user.password = await hashPassword(newPassword);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Get current logged in user
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("teamId", "name")
      .populate("managerId", "email profile.fullName");

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc Update user profile
 * @route PUT /api/auth/profile
 * @access Private
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fullName, department, position, phone, avatar } = req.body;

    const updateFields = {};
    if (fullName !== undefined)
      updateFields["profile.fullName"] = fullName.trim();
    if (department !== undefined)
      updateFields["profile.department"] = department;
    if (position !== undefined) updateFields["profile.position"] = position;
    if (phone !== undefined) updateFields["profile.phone"] = phone;
    if (avatar !== undefined) updateFields["profile.avatar"] = avatar;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  register,
  login,
  forgotPassword,
  verifyOTP,
  resetPassword,
  resendOTP,
  changePassword,
  getMe,
  updateProfile,
};
