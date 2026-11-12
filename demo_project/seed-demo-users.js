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
  // ===== 5 leader bổ sung (@gmail.com) — teamIndex 2..6 =====
  {
    email: 'leader.minhquan@gmail.com',
    fullName: 'Đỗ Minh Quân',
    employeeId: 'LEAD003',
    department: 'Phát triển phần mềm',
    position: 'Team Lead',
    teamName: 'Nhóm Mobile',
  },
  {
    email: 'leader.thuha@gmail.com',
    fullName: 'Vũ Thu Hà',
    employeeId: 'LEAD004',
    department: 'Kiểm thử phần mềm',
    position: 'QA Lead',
    teamName: 'Nhóm Kiểm thử',
  },
  {
    email: 'leader.ducthang@gmail.com',
    fullName: 'Bùi Đức Thắng',
    employeeId: 'LEAD005',
    department: 'Hạ tầng & DevOps',
    position: 'DevOps Lead',
    teamName: 'Nhóm DevOps',
  },
  {
    email: 'leader.ngoclan@gmail.com',
    fullName: 'Ngô Ngọc Lan',
    employeeId: 'LEAD006',
    department: 'Thiết kế sản phẩm',
    position: 'Design Lead',
    teamName: 'Nhóm Thiết kế UI/UX',
  },
  {
    email: 'leader.hoanglong@gmail.com',
    fullName: 'Đặng Hoàng Long',
    employeeId: 'LEAD007',
    department: 'Phân tích dữ liệu',
    position: 'Data Lead',
    teamName: 'Nhóm Dữ liệu',
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
  // ===== 15 employee bổ sung (@gmail.com) — 3 người / team mới =====
  // Nhóm Mobile (teamIndex 2)
  { email: 'nv.thanhtung@gmail.com', fullName: 'Nguyễn Thanh Tùng', employeeId: 'EMP004', department: 'Phát triển phần mềm', position: 'Mobile Developer', teamIndex: 2 },
  { email: 'nv.khanhlinh@gmail.com', fullName: 'Trần Khánh Linh', employeeId: 'EMP005', department: 'Phát triển phần mềm', position: 'Mobile Developer', teamIndex: 2 },
  { email: 'nv.quochuy@gmail.com', fullName: 'Lý Quốc Huy', employeeId: 'EMP006', department: 'Phát triển phần mềm', position: 'Mobile Developer', teamIndex: 2 },
  // Nhóm Kiểm thử (teamIndex 3)
  { email: 'nv.maianh@gmail.com', fullName: 'Phan Mai Anh', employeeId: 'EMP007', department: 'Kiểm thử phần mềm', position: 'QA Engineer', teamIndex: 3 },
  { email: 'nv.vanhieu@gmail.com', fullName: 'Hồ Văn Hiếu', employeeId: 'EMP008', department: 'Kiểm thử phần mềm', position: 'QA Engineer', teamIndex: 3 },
  { email: 'nv.thuytrang@gmail.com', fullName: 'Đinh Thùy Trang', employeeId: 'EMP009', department: 'Kiểm thử phần mềm', position: 'Automation Tester', teamIndex: 3 },
  // Nhóm DevOps (teamIndex 4)
  { email: 'nv.ducanh@gmail.com', fullName: 'Trịnh Đức Anh', employeeId: 'EMP010', department: 'Hạ tầng & DevOps', position: 'DevOps Engineer', teamIndex: 4 },
  { email: 'nv.minhtri@gmail.com', fullName: 'Cao Minh Trí', employeeId: 'EMP011', department: 'Hạ tầng & DevOps', position: 'System Engineer', teamIndex: 4 },
  { email: 'nv.baongoc@gmail.com', fullName: 'Lâm Bảo Ngọc', employeeId: 'EMP012', department: 'Hạ tầng & DevOps', position: 'Cloud Engineer', teamIndex: 4 },
  // Nhóm Thiết kế UI/UX (teamIndex 5)
  { email: 'nv.phuongthao@gmail.com', fullName: 'Mai Phương Thảo', employeeId: 'EMP013', department: 'Thiết kế sản phẩm', position: 'UI Designer', teamIndex: 5 },
  { email: 'nv.giabao@gmail.com', fullName: 'Tạ Gia Bảo', employeeId: 'EMP014', department: 'Thiết kế sản phẩm', position: 'UX Designer', teamIndex: 5 },
  { email: 'nv.hongnhung@gmail.com', fullName: 'Dương Hồng Nhung', employeeId: 'EMP015', department: 'Thiết kế sản phẩm', position: 'UI Designer', teamIndex: 5 },
  // Nhóm Dữ liệu (teamIndex 6)
  { email: 'nv.tuankiet@gmail.com', fullName: 'Châu Tuấn Kiệt', employeeId: 'EMP016', department: 'Phân tích dữ liệu', position: 'Data Analyst', teamIndex: 6 },
  { email: 'nv.myduyen@gmail.com', fullName: 'Kiều Mỹ Duyên', employeeId: 'EMP017', department: 'Phân tích dữ liệu', position: 'Data Engineer', teamIndex: 6 },
  { email: 'nv.vietdung@gmail.com', fullName: 'Tôn Việt Dũng', employeeId: 'EMP018', department: 'Phân tích dữ liệu', position: 'Data Scientist', teamIndex: 6 },
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
