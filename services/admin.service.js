const User = require('../models/user.model');
const { hashPassword } = require('./auth.service');

/**
 * Create HR Manager account (only system_admin can call this)
 * @param {Object} hrData - { email, password, profile: { fullName, employeeId, department, position, phone } }
 * @returns {Object} Created user (without password)
 */
const createHRAccount = async (hrData) => {
  const { email, password, profile } = hrData;

  // Check unique email
  const existingEmail = await User.findOne({ email: email.toLowerCase() });
  if (existingEmail) {
    throw new Error('Email already registered');
  }

  // Check unique employeeId
  const existingEmployeeId = await User.findOne({ 'profile.employeeId': profile.employeeId });
  if (existingEmployeeId) {
    throw new Error('Employee ID already exists');
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create HR Manager account - role hardcoded
  const user = await User.create({
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    role: 'hr_manager',
    profile: {
      fullName: profile.fullName.trim(),
      employeeId: profile.employeeId.trim(),
      department: profile.department?.trim() || null,
      position: profile.position?.trim() || null,
      phone: profile.phone?.trim() || null,
      avatar: null,
    },
    teamId: null,
    managerId: null,
    isActive: true,
    leaveBalance: new Map([['2025', { total: 12, used: 0, remaining: 12 }]]),
  });

  // Return user without password
  const userObj = user.toObject();
  delete userObj.password;
  return userObj;
};

/**
 * Check if email exists
 * @param {String} email
 * @returns {Boolean}
 */
const isEmailTaken = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  return !!user;
};

/**
 * Check if employeeId exists
 * @param {String} employeeId
 * @returns {Boolean}
 */
const isEmployeeIdTaken = async (employeeId) => {
  const user = await User.findOne({ 'profile.employeeId': employeeId });
  return !!user;
};

module.exports = {
  createHRAccount,
  isEmailTaken,
  isEmployeeIdTaken,
};
