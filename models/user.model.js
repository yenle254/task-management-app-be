const mongoose = require("mongoose");
const { PASSWORD } = require("../utils/constants.utils");

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
    password: { type: String, required: true, minLength: PASSWORD.MIN_LENGTH, select: false },
    role: {
      type: String,
      enum: ["system_admin", "hr_manager", "team_lead", "employee"],
      default: "employee",
      index: true,
    },
    profile: { type: ProfileSchema, required: true },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
      index: true,
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isActive: { type: Boolean, default: true, index: true },
    pushToken: { type: String, default: null, select: false },
    pushTokenPlatform: { type: String, enum: ['android', 'ios', 'web'], default: null },
    pushTokenUpdatedAt: { type: Date, default: null },
    notificationPreferences: {
      master: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sound: { type: Boolean, default: true },
      categories: {
        task: { inApp: { type: Boolean, default: true }, push: { type: Boolean, default: true },
          types: Object.fromEntries(require('../utils/notification-preferences.helper').REVIEW_TYPES.map(type => [type, { inApp: { type: Boolean, default: undefined }, push: { type: Boolean, default: undefined } }])) },
        leave: { inApp: { type: Boolean, default: true }, push: { type: Boolean, default: true } },
        attendance: { inApp: { type: Boolean, default: true }, push: { type: Boolean, default: true } }
      },
      reminderTimes: { clockIn: { type: String, default: null }, clockOut: { type: String, default: null } }
    },
    // Internal, durable claim-before-send receipts. Never accepted from the client.
    reminders: { type: Map, of: new mongoose.Schema({ firedAt: Date, refKey: String }, { _id: false }), default: {}, select: false },
    leaveBalance: {
      type: Map,
      of: {
        total: { type: Number, default: 12 },
        used: { type: Number, default: 0 },
        remaining: { type: Number, default: 12 },
      },
      default: {},
    },
    // Balance movement receipt is written atomically with the yearly balance.
    // Keys are server-generated UUIDs (or legacy_<leaveId> for old approvals).
    leaveBalanceOperations: { type: Map, of: new mongoose.Schema({
      leaveId: mongoose.Schema.Types.ObjectId, year: Number, days: Number,
      state: { type: String, enum: ['deducted', 'refunded'] }
    }, { _id: false }), default: {}, select: false },
    tokenVersion: { type: Number, default: 0, select: false, min: 0 },
    resetPassword: { type: ResetPasswordSchema, default: {}, select: false },
  },
  {
    timestamps: true,
    collection: "users"
  }
);

UserSchema.set('toJSON', { transform: (_doc, value) => {
  for (const key of ['password', 'resetPassword', 'tokenVersion', 'pushToken', 'reminders', 'leaveBalanceOperations']) delete value[key];
  return value;
} });

UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ role: 1, teamId: 1 });
UserSchema.index({ teamId: 1, isActive: 1 });

module.exports = mongoose.model("User", UserSchema);
