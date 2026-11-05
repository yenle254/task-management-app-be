/**
 * Local demo administrator. No .env is loaded by this script.
 * hr_manager is the existing role for company-wide employees, tasks and progress.
 * These credentials are for the local demo only, not a production deployment.
 */
const ADMIN_ACCOUNT = {
  fullName: 'Demo Administrator',
  email: 'admin.demo@tma.test',
  password: 'DemoAdmin@2026!',
  employeeId: 'DEMO-HR-ADMIN-001',
};
const MONGO_URI = 'mongodb://127.0.0.1:27017/tma_demo';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const { PASSWORD, USER_ROLES } = require('../utils/constants.utils');

async function seedAdmin() {
  const email = ADMIN_ACCOUNT.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid demo admin email');
  if (ADMIN_ACCOUNT.password.length < PASSWORD.MIN_LENGTH || ADMIN_ACCOUNT.password.length > PASSWORD.MAX_LENGTH) {
    throw new Error('Demo admin password length is invalid');
  }
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    const existing = await User.findOne({
      $or: [{ email }, { 'profile.employeeId': ADMIN_ACCOUNT.employeeId }],
    });
    // Never replace an unrelated account, including the old system admin.
    if (existing && (existing.email !== email ||
        existing.profile.employeeId !== ADMIN_ACCOUNT.employeeId || existing.role !== USER_ROLES.HR_MANAGER)) {
      throw new Error('Email or employee ID belongs to another account. Choose a different demo identity. No account changed.');
    }
    const password = await bcrypt.hash(ADMIN_ACCOUNT.password, PASSWORD.SALT_ROUNDS);
    if (existing) {
      // Rerunning restores only this demo account's login, without replacing its data.
      existing.password = password;
      existing.isActive = true;
      existing.profile.fullName = ADMIN_ACCOUNT.fullName;
      await existing.save();
      console.log('Demo administrator login updated.');
    } else {
      await User.create({
        email, password, role: USER_ROLES.HR_MANAGER, isActive: true,
        profile: {
          fullName: ADMIN_ACCOUNT.fullName,
          employeeId: ADMIN_ACCOUNT.employeeId,
          department: 'Human Resources', position: 'Demo Administrator',
        },
        teamId: null, managerId: null,
        leaveBalance: new Map([[String(new Date().getFullYear()), { total: 12, used: 0, remaining: 12 }]]),
      });
      console.log('Demo administrator created.');
    }
    console.log('Email:', email);
    console.log('Role: hr_manager (employees, tasks, progress dashboard)');
    console.log('Password: use ADMIN_ACCOUNT.password at the top of this file.');
    return { email, role: USER_ROLES.HR_MANAGER };
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  seedAdmin().catch(error => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  });
}
module.exports = { seedAdmin, ADMIN_ACCOUNT, MONGO_URI };
