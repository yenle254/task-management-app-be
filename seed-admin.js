/**
 * Quick seed script to create an admin account
 * Run: node seed-admin.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/user.model');

const adminData = {
  email: 'admin@tma.com',
  password: 'Admin123!',
  role: 'hr_manager',
  profile: {
    fullName: 'Admin User',
    employeeId: 'ADMIN001',
    department: 'Human Resources',
    position: 'HR Manager',
    phone: '0123456789',
    avatar: null,
  },
  teamId: null,
  managerId: null,
  isActive: true,
  leaveBalance: new Map([['2025', { total: 12, used: 0, remaining: 12 }]]),
};

async function seedAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/tma_demo');
    console.log('Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminData.email });
    if (existingAdmin) {
      console.log('Admin account already exists:', adminData.email);
      console.log('Password: Admin123!');
      await mongoose.disconnect();
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminData.password, salt);

    // Create admin user
    const admin = new User({
      ...adminData,
      password: hashedPassword,
    });

    await admin.save();
    console.log('Admin account created successfully!');
    console.log('Email:', adminData.email);
    console.log('Password: Admin123!');
    console.log('Role: HR Manager');

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

seedAdmin();
