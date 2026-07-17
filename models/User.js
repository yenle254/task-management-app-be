const mongoose = require("mongoose");

const ProfileSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, minLength: 3 },
    avatar: { type: String, default: null },
    phone: { type: String, default: null },
    department: { type: String, default: null },
    position: { type: String, default: null },
    employeeId: { type: String, required: true, unique: true },
  },
  { _id: false }
);

const ResetPasswordSchema = new mongoose.Schema(
  {
    otp: { type: String, default: null },
    otpExpires: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null }, 
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minLength: 6, select: false },
    role: {
      type: String,
      enum: ["hr_manager", "team_lead", "employee"],
      default: "employee",
    },
    profile: { type: ProfileSchema, required: true },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isActive: { type: Boolean, default: true },
    leaveBalance: {
      type: Map,
      of: {
        total: { type: Number, default: 12 },
        used: { type: Number, default: 0 },
        remaining: { type: Number, default: 12 },
      },
      default: {},
    },
    resetPassword: { type: ResetPasswordSchema, default: {} },
  },
  { timestamps: true, collection: "users" }
);

module.exports = mongoose.model("User", UserSchema);
