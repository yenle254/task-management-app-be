require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/user.model');

const {
  SYSTEM_ADMIN_EMAIL,
  SYSTEM_ADMIN_PASSWORD,
  SYSTEM_ADMIN_FULLNAME,
  SYSTEM_ADMIN_EMPLOYEE_ID,
  SYSTEM_ADMIN_DEPARTMENT,
  SYSTEM_ADMIN_POSITION,
  SYSTEM_ADMIN_PHONE,
} = process.env;

if (!SYSTEM_ADMIN_EMAIL || !SYSTEM_ADMIN_PASSWORD) {
  console.error('Missing required environment variables: SYSTEM_ADMIN_EMAIL, SYSTEM_ADMIN_PASSWORD');
  process.exit(1);
}

const adminData = {
  email: SYSTEM_ADMIN_EMAIL,
  password: SYSTEM_ADMIN_PASSWORD,
  role: 'system_admin',
  profile: {
    fullName: SYSTEM_ADMIN_FULLNAME || 'System Administrator',
    employeeId: SYSTEM_ADMIN_EMPLOYEE_ID || 'ADMIN001',
    department: SYSTEM_ADMIN_DEPARTMENT || 'System Administration',
    position: SYSTEM_ADMIN_POSITION || 'System Admin',
    phone: SYSTEM_ADMIN_PHONE || null,
    avatar: null,
  },
  teamId: null,
  managerId: null,
  isActive: true,
  leaveBalance: new Map([['2025', { total: 12, used: 0, remaining: 12 }]]),
};

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/tma_demo');
    console.log('Connected to MongoDB');

    const existingAdmin = await User.findOne({ email: adminData.email });

    if (existingAdmin) {
      console.log('System Admin already exists:', adminData.email);
      await mongoose.disconnect();
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminData.password, salt);

    const admin = new User({
      ...adminData,
      password: hashedPassword,
    });

    await admin.save();
    console.log('System Admin created successfully');
    console.log('Email:', adminData.email);
    console.log('Role: system_admin');

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

seedAdmin();
