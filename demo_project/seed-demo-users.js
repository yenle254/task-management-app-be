const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const Team = require('../models/team.model');

const PASSWORD = 'Test@123';
const YEAR = String(new Date().getFullYear());

const LEADS = [
  {
    email: 'lead1@test.com',
    fullName: 'Nguyễn Văn An',
    employeeId: 'LEAD001',
    department: 'Phát triển phần mềm',
    position: 'Team Lead',
    teamName: 'Nhóm Phát triển A',
  },
  {
    email: 'lead2@test.com',
    fullName: 'Trần Thị Bình',
    employeeId: 'LEAD002',
    department: 'Phát triển phần mềm',
    position: 'Team Lead',
    teamName: 'Nhóm Phát triển B',
  },
];

const MEMBERS = [
  {
    email: 'member1@test.com',
    fullName: 'Lê Văn Cường',
    employeeId: 'EMP001',
    department: 'Phát triển phần mềm',
    position: 'Software Engineer',
    teamIndex: 0,
  },
  {
    email: 'member2@test.com',
    fullName: 'Phạm Thị Dung',
    employeeId: 'EMP002',
    department: 'Phát triển phần mềm',
    position: 'Software Engineer',
    teamIndex: 0,
  },
  {
    email: 'member3@test.com',
    fullName: 'Hoàng Văn Em',
    employeeId: 'EMP003',
    department: 'Kiểm thử phần mềm',
    position: 'QA Engineer',
    teamIndex: 1,
  },
];

async function upsertUser(data, role, teamId, managerId) {
  const existing = await User.findOne({ email: data.email });
  const password = await bcrypt.hash(PASSWORD, 10);

  if (existing) {
    existing.role = role;
    existing.teamId = teamId;
    existing.managerId = managerId;
    existing.isActive = true;
    existing.profile.fullName = data.fullName;
    existing.profile.employeeId = data.employeeId;
    existing.profile.department = data.department;
    existing.profile.position = data.position;
    await existing.save();
    return { user: existing, created: false };
  }

  const user = await User.create({
    email: data.email,
    password,
    role,
    teamId,
    managerId,
    isActive: true,
    profile: {
      fullName: data.fullName,
      employeeId: data.employeeId,
      department: data.department,
      position: data.position,
      phone: null,
      avatar: null,
    },
    leaveBalance: new Map([[YEAR, { total: 12, used: 0, remaining: 12 }]]),
  });
  return { user, created: true };
}

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/tma_demo');
    console.log('Connected to MongoDB');

    const results = { leads: [], members: [] };

    // 1. Tạo team + lead
    const teamIds = [];
    const leadUsers = [];
    for (const lead of LEADS) {
      const { user } = await upsertUser(lead, 'team_lead', null, null);
      leadUsers.push(user);

      let team = await Team.findOne({ name: lead.teamName });
      if (!team) {
        team = await Team.create({
          name: lead.teamName,
          description: `Team demo của ${lead.fullName}`,
          leaderId: user._id,
          memberIds: [user._id],
        });
      } else {
        team.leaderId = user._id;
      }
      teamIds.push(team._id);
      results.leads.push({ email: lead.email, password: PASSWORD, role: 'team_lead', team: team.name });
    }

    // 2. Gán lead vào team + tạo member
    for (let i = 0; i < leadUsers.length; i++) {
      const team = await Team.findById(teamIds[i]);
      if (!team.memberIds.some((id) => id.equals(leadUsers[i]._id))) {
        team.memberIds.push(leadUsers[i]._id);
      }
      await team.save();
      await User.updateOne({ _id: leadUsers[i]._id }, { $set: { teamId: team._id } });
    }

    for (const member of MEMBERS) {
      const teamIndex = member.teamIndex;
      const team = await Team.findById(teamIds[teamIndex]);
      const managerId = team.leaderId;
      const { user } = await upsertUser(member, 'employee', team._id, managerId);

      if (!team.memberIds.some((id) => id.equals(user._id))) {
        team.memberIds.push(user._id);
        await team.save();
      }
      results.members.push({
        email: member.email,
        password: PASSWORD,
        role: 'employee',
        team: team.name,
        manager: leadUsers[teamIndex].email,
      });
    }

    console.log('\n=== Seed demo users thành công ===');
    console.log(JSON.stringify(results, null, 2));
    console.log(`\nMật khẩu chung: ${PASSWORD}`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

seed();
