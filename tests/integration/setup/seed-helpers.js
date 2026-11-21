const request = require('supertest');
const mongoose = require('mongoose');
const User = require('../../../models/user.model');
const Team = require('../../../models/team.model');
const Task = require('../../../models/task.model');
const { hashPassword } = require('../../../services/auth.service');

const DEFAULT_PASSWORD = 'Password123!';
let cachedDefaultHash = null;

async function getDefaultPasswordHash() {
  if (!cachedDefaultHash) {
    cachedDefaultHash = await hashPassword(DEFAULT_PASSWORD);
  }
  return cachedDefaultHash;
}

/**
 * Create a user directly in MongoDB with a real bcrypt hash.
 */
async function createUser(overrides = {}) {
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const passwordHash = overrides.rawPassword
    ? await hashPassword(overrides.rawPassword)
    : overrides.password || (await getDefaultPasswordHash());

  const doc = {
    email: overrides.email || `user_${suffix}@integration.test`,
    password: passwordHash,
    role: overrides.role || 'employee',
    teamId: overrides.teamId ?? null,
    managerId: overrides.managerId ?? null,
    isActive: overrides.isActive ?? true,
    profile: {
      fullName: overrides.fullName || `Test User ${suffix}`,
      employeeId: overrides.employeeId || `EMP_${suffix.toUpperCase()}`,
      department: overrides.department || 'Engineering',
      position: overrides.position || 'Developer',
      phone: overrides.phone || '0901234567',
      avatar: overrides.avatar || null,
      ...(overrides.profile || {}),
    },
    ...(overrides.resetPassword ? { resetPassword: overrides.resetPassword } : {}),
  };

  return User.create(doc);
}

/**
 * Perform a real HTTP login via Supertest and return the issued token pair and response body.
 */
async function loginUser(app, email, password = DEFAULT_PASSWORD, extraBody = {}) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password, ...extraBody });
  if (res.status !== 200) {
    throw new Error(`Expected 200 on login for ${email}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Seed a standard organization topology for task & authorization tests:
 * - hr: hr_manager
 * - leadA: team_lead of teamA
 * - leadB: team_lead of teamB
 * - employee: employee in teamA
 * - peer: second employee in teamA
 * - outsider: employee in teamB
 * - admin: system_admin
 */
async function seedOrganization(app) {
  const teamAId = new mongoose.Types.ObjectId();
  const teamBId = new mongoose.Types.ObjectId();

  const [hr, leadA, leadB, employee, peer, outsider, admin] = await Promise.all([
    createUser({ email: 'hr@org.test', role: 'hr_manager', fullName: 'HR Manager', employeeId: 'HR001' }),
    createUser({ email: 'leada@org.test', role: 'team_lead', teamId: teamAId, fullName: 'Lead Alpha', employeeId: 'LEAD001' }),
    createUser({ email: 'leadb@org.test', role: 'team_lead', teamId: teamBId, fullName: 'Lead Beta', employeeId: 'LEAD002' }),
    createUser({ email: 'emp@org.test', role: 'employee', teamId: teamAId, fullName: 'Employee One', employeeId: 'EMP001' }),
    createUser({ email: 'peer@org.test', role: 'employee', teamId: teamAId, fullName: 'Employee Peer', employeeId: 'EMP002' }),
    createUser({ email: 'outsider@org.test', role: 'employee', teamId: teamBId, fullName: 'Employee Outsider', employeeId: 'EMP003' }),
    createUser({ email: 'admin@org.test', role: 'system_admin', fullName: 'System Admin', employeeId: 'ADM001' }),
  ]);

  const [teamA, teamB] = await Team.create([
    {
      _id: teamAId,
      name: 'Alpha Team',
      description: 'Primary engineering team',
      leaderId: leadA._id,
      memberIds: [employee._id, peer._id],
    },
    {
      _id: teamBId,
      name: 'Beta Team',
      description: 'Secondary team',
      leaderId: leadB._id,
      memberIds: [outsider._id],
    },
  ]);

  const users = { hr, leadA, leadB, employee, peer, outsider, admin };
  const tokens = {};
  const sessions = {};

  if (app) {
    for (const [key, user] of Object.entries(users)) {
      const pair = await loginUser(app, user.email, DEFAULT_PASSWORD);
      tokens[key] = pair.token;
      sessions[key] = pair;
    }
  }

  return {
    users,
    teams: { teamA, teamB },
    tokens,
    sessions,
    password: DEFAULT_PASSWORD,
  };
}

/**
 * Helper to create a Task document via Mongoose (triggering real pre/post save hooks).
 */
async function createTaskDoc(overrides = {}) {
  return Task.create({
    title: overrides.title || 'Integration Test Task',
    description: overrides.description || 'Task created in integration test',
    teamId: overrides.teamId,
    assignedBy: overrides.assignedBy,
    assignedTo: overrides.assignedTo || [],
    status: overrides.status || 'todo',
    priority: overrides.priority || 'medium',
    difficulty: overrides.difficulty || 'medium',
    progress: overrides.progress ?? 0,
    dueDate: overrides.dueDate !== undefined ? overrides.dueDate : new Date('2026-11-30T12:00:00.000Z'),
    startDate: overrides.startDate !== undefined ? overrides.startDate : new Date('2026-11-01T00:00:00.000Z'),
    tags: overrides.tags || [],
    subTasks: overrides.subTasks || [],
    dependencies: overrides.dependencies || [],
    parentTaskId: overrides.parentTaskId || null,
  });
}

module.exports = {
  DEFAULT_PASSWORD,
  createUser,
  loginUser,
  seedOrganization,
  createTaskDoc,
};

