const mongoose = require('mongoose');
jest.mock('../../../services/session.service', () => ({ revokeAllSessions: jest.fn().mockResolvedValue(), createSession: jest.fn().mockResolvedValue({ token: 'replacement', refreshToken: 'opaque' }) }));
jest.mock('../../../services/email.service', () => ({ sendResetPasswordEmail: jest.fn().mockResolvedValue() }));
jest.mock('../../../services/expo-push.service', () => ({ send: jest.fn() }));
jest.mock('../../../services/auth.service', () => ({ hashPassword: jest.fn().mockResolvedValue('hashed'), comparePassword: jest.fn().mockResolvedValue(true) }));
jest.mock('../../../config/jwt', () => ({ sendTokenResponse: jest.fn((user, status, res) => res.status(status).json({ success: true })) }));
const AuditLog = require('../../../models/audit-log.model');
const User = require('../../../models/user.model');
const Team = require('../../../models/team.model');
const Task = require('../../../models/task.model');
const Office = require('../../../models/office.model');
const Attendance = require('../../../models/attendance.model');
const teamService = require('../../../services/team.service');
const adminService = require('../../../services/admin.service');
const { comparePassword } = require('../../../services/auth.service');
const { sendResetPasswordEmail } = require('../../../services/email.service');
const { sendTokenResponse } = require('../../../config/jwt');
const auth = require('../../../controllers/auth.controller');
const admin = require('../../../controllers/admin.controller');
const teams = require('../../../controllers/team.controller');
const offices = require('../../../controllers/office.controller');
const attendance = require('../../../controllers/attendance.controller');
const oid = () => new mongoose.Types.ObjectId();
const tick = () => new Promise(resolve => setImmediate(resolve));
const chain = value => ({ select() { return this; }, populate() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
let rows, user;
const response = () => ({ statusCode: 200, status: jest.fn(function (code) { this.statusCode = code; return this; }), json: jest.fn() });
const req = (body = {}) => ({ body, params: { id: String(oid()) }, user: { _id: oid(), role: 'hr_manager' }, requestId: 'event-test', method: 'PUT', headers: {}, ip: '127.0.0.1' });
beforeEach(() => {
  rows = []; comparePassword.mockResolvedValue(true);
  user = { _id: oid(), email: 'member@example.com', role: 'employee', isActive: true, password: 'SecretPassword', profile: { fullName: 'Member' },
    resetPassword: { otp: '123456', otpExpires: new Date(Date.now() + 60000), attempts: 0 }, save: jest.fn().mockResolvedValue() };
  jest.spyOn(AuditLog, 'create').mockImplementation(async doc => { rows.push(doc); return doc; });
});
afterEach(async () => { await tick(); await tick(); });
test.each(['missing', 'password', 'inactive'])('login failure %s has safe metadata and correct reason', async branch => {
  if (branch === 'inactive') user.isActive = false;
  if (branch === 'password') comparePassword.mockResolvedValue(false);
  jest.spyOn(User, 'findOne').mockReturnValue(chain(branch === 'missing' ? null : user));
  const res = response(); await auth.login(req({ email: 'attacker@example.com', password: 'SuppliedSecret' }), res); await tick();
  expect(res.statusCode).toBe(401); expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ action: 'auth.login_failed', outcome: 'failure', reason: branch === 'inactive' ? 'deactivated' : 'invalid_email_or_password' });
  if (branch === 'missing') expect(rows[0].metadata.email).toBe('a***@example.com');
  expect(JSON.stringify(rows)).not.toContain('SuppliedSecret'); expect(JSON.stringify(rows)).not.toContain('SecretPassword');
});
test('register/login and existing admin HR creation emit correct actors/targets', async () => {
  jest.spyOn(User, 'findOne').mockReturnValueOnce(chain(null)).mockReturnValue(chain(user));
  jest.spyOn(User, 'create').mockResolvedValue(user);
  await auth.register(req({ email: user.email, password: 'Secret', role: 'hr_manager', profile: { fullName: 'Member', employeeId: 'E01' } }), response());
  expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'employee' }));
  await auth.login(req({ email: user.email, password: 'Secret' }), response());
  jest.spyOn(adminService, 'createHRAccount').mockResolvedValue(user);
  const request = req({ email: user.email, password: 'Secret', profile: { fullName: 'HR', employeeId: 'H01' } }); request.user.role = 'system_admin';
  await admin.createHRAccount(request, response()); await tick();
  expect(rows.map(row => row.action)).toEqual(['auth.register', 'auth.login_success', 'admin.hr_account_created']);
  expect(rows[0].actor.id).toBe(String(user._id)); expect(rows[2].actor.id).toBe(String(request.user._id)); expect(rows[2].severity).toBe('critical');
});
test('token response failure does not produce a successful login event', async () => {
  jest.spyOn(User, 'findOne').mockReturnValue(chain(user));
  sendTokenResponse.mockImplementationOnce(() => { throw new Error('mock token signing failed'); });
  const res = response(); await auth.login(req({ email: user.email, password: 'Secret' }), res); await tick();
  expect(res.statusCode).toBe(500); expect(rows).toHaveLength(0);
});
test('unauthenticated recovery identifies the target without impersonating it as actor', async () => {
  jest.spyOn(User, 'findOne').mockReturnValue(chain(user));
  const request = req({ email: user.email }); delete request.user;
  await auth.forgotPassword(request, response()); await tick();
  expect(rows[0]).toMatchObject({ actor: { id: null }, target: { id: String(user._id) }, metadata: { email: user.email } });
});
test.each(['forgotPassword', 'resendOTP'])('%s records saved OTP even when mocked email fails', async method => {
  jest.spyOn(User, 'findOne').mockReturnValue(chain(user));
  sendResetPasswordEmail.mockRejectedValueOnce(new Error('mock email unavailable'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = response(); await auth[method](req({ email: user.email }), res); await tick();
  expect(res.statusCode).toBe(200); expect(user.save).toHaveBeenCalled(); expect(rows[0].action).toBe('auth.password_reset_requested');
  expect(JSON.stringify(rows)).not.toContain(user.resetPassword.otp);
});
test.each([['invalid_otp', { otp: '111111' }], ['expired', { otpExpires: new Date(0) }], ['attempts_exhausted', { attempts: 5 }]])('OTP %s emits failure without OTP/token', async (reason, changes) => {
  Object.assign(user.resetPassword, changes); jest.spyOn(User, 'findOne').mockReturnValue(chain(user));
  await auth.verifyOTP(req({ email: user.email, otp: '123456' }), response()); await tick();
  expect(rows[0]).toMatchObject({ action: 'auth.otp_verify_failed', reason, outcome: 'failure' });
  expect(JSON.stringify(rows)).not.toContain('123456');
});
test('reset/change password success audit excludes all reset data', async () => {
  jest.spyOn(User, 'findOneAndUpdate').mockImplementation(() => chain(user));
  user.resetPassword = { resetToken: 'ResetSecret', resetTokenExpires: new Date(Date.now() + 60000) };
  jest.spyOn(User, 'findOne').mockReturnValue(chain(user)); jest.spyOn(User, 'findById').mockReturnValue(chain(user));
  await auth.resetPassword(req({ email: user.email, resetToken: 'ResetSecret', newPassword: 'NewSecret' }), response());
  await auth.changePassword(req({ oldPassword: 'OldSecret', newPassword: 'NewSecret' }), response()); await tick();
  expect(rows.map(row => row.action)).toEqual(['auth.password_reset_completed', 'auth.password_changed']);
  expect(JSON.stringify(rows)).not.toMatch(/ResetSecret|OldSecret|NewSecret|hashed/);
});
test.each([['createTeam', 'team.created'], ['updateTeam', 'team.updated'], ['addMember', 'team.member_added'], ['removeMember', 'team.member_removed'], ['assignTeamLead', 'team.lead_assigned']])('%s event carries whitelisted before/after', async (method, action) => {
  const leader = { _id: oid(), profile: { fullName: 'Leader' } }, member = { _id: oid(), profile: { fullName: 'Member' } };
  const before = { _id: oid(), name: 'Team before', leaderId: leader, memberIds: [leader] };
  const after = { ...before, name: 'Team after', memberIds: [leader, member] };
  jest.spyOn(Team, 'findById').mockReturnValue(chain(before)); jest.spyOn(teamService, method).mockResolvedValue(after);
  await teams[method](req({ name: 'Team after', leaderId: String(leader._id), userId: String(member._id) }), response()); await tick();
  expect(rows.map(row => row.action)).toContain(action);
  expect(rows.find(row => row.action === action).changes).toContainEqual({ field: 'name', from: method === 'createTeam' ? null : 'Team before', to: 'Team after' });
});
test('updateTeam changing leader also records team.lead_assigned', async () => {
  const before = { _id: oid(), name: 'Team', leaderId: oid(), memberIds: [] }, leader = oid();
  jest.spyOn(Team, 'findById').mockReturnValue(chain(before)); jest.spyOn(teamService, 'updateTeam').mockResolvedValue({ ...before, leaderId: leader });
  await teams.updateTeam(req({ leaderId: String(leader) }), response()); await tick();
  expect(rows.map(row => row.action)).toEqual(['team.updated', 'team.lead_assigned']);
});
test('team hard delete snapshots names/IDs before deletion; history does not query deleted team', async () => {
  const leader = { _id: oid(), profile: { fullName: 'Leader' } }, member = { _id: oid(), profile: { fullName: 'Member' }, password: 'secret' };
  let team = { _id: oid(), name: 'Deleted team', leaderId: leader, memberIds: [leader, member] };
  const find = jest.spyOn(Team, 'findById').mockImplementation(() => chain(team));
  jest.spyOn(Task, 'countDocuments').mockResolvedValue(0); jest.spyOn(Task, 'findOne').mockResolvedValue(null);
  jest.spyOn(User, 'updateMany').mockResolvedValue({ modifiedCount: 2 });
  jest.spyOn(Team, 'findByIdAndDelete').mockImplementation(async () => { const old = team; team = null; return old; });
  await teams.deleteTeam(req(), response()); await tick();
  expect(team).toBeNull(); expect(find).toHaveBeenCalledTimes(2); // pre-image + existing service guard, never post-delete
  expect(rows[0]).toMatchObject({ action: 'team.deleted', target: { label: 'Deleted team' }, metadata: { leader: { name: 'Leader' }, members: [{ name: 'Leader' }, { name: 'Member' }], activeTaskCount: 0 } });
  expect(JSON.stringify(rows)).not.toContain('password');
});
test('office CRUD/activation snapshots and whitelist remain readable after hard delete', async () => {
  const office = { _id: oid(), name: 'Office', location: { lat: 10, lng: 20 }, radius: 200, isActive: false, save: jest.fn().mockResolvedValue() };
  jest.spyOn(Office, 'create').mockResolvedValue(office); jest.spyOn(Office, 'findById').mockResolvedValue(office);
  jest.spyOn(Office, 'updateMany').mockResolvedValue({ modifiedCount: 1 });
  const remove = jest.spyOn(Office, 'findByIdAndDelete').mockResolvedValue(office);
  await offices.createOffice(req({ name: 'Office', location: office.location }), response());
  await offices.updateOffice(req({ radius: 300 }), response());
  await offices.setActiveOffice(req(), response());
  await offices.deleteOffice(req(), response()); await tick();
  expect(rows.map(row => row.action)).toEqual(['office.created', 'office.updated', 'office.activated', 'office.deleted']);
  expect(rows[1].changes).toEqual([{ field: 'radius', from: 200, to: 300 }]);
  expect(rows[3]).toMatchObject({ target: { label: 'Office' }, metadata: { name: 'Office', location: { lat: 10, lng: 20 } } });
  expect(remove).toHaveBeenCalledTimes(1);
});
test('attendance manual edit bounds whitelisted diff and handles missing reason without rejection', async () => {
  const doc = { _id: oid(), clockIn: new Date('2026-11-03T01:00:00Z'), status: 'late', location: { lat: 10, lng: 20 }, save: jest.fn().mockResolvedValue() };
  jest.spyOn(Attendance, 'findById').mockResolvedValue(doc);
  // Intentional hardening: unknown update fields now fail before mutation or audit writes.
  const rejected = response();
  await attendance.updateAttendance(req({ status: 'present', password: 'secret' }), rejected);
  expect(rejected.statusCode).toBe(400); expect(rows).toEqual([]);
  const res = response(); await attendance.updateAttendance(req({ status: 'present', location: { lat: 11, lng: 21 } }), res); await tick();
  expect(res.statusCode).toBe(200); expect(rows[0]).toMatchObject({ action: 'attendance.manual_updated', reason: null, metadata: { reasonMissing: true } });
  expect(rows[0].changes).toEqual([{ field: 'status', from: 'late', to: 'present' }, { field: 'location.lat', from: 10, to: 11 }, { field: 'location.lng', from: 20, to: 21 }]);
  expect(JSON.stringify(rows)).not.toMatch(/secret|huge/);
  await attendance.updateAttendance(req({ workHours: 8, reason: '  Clock correction  ' }), response()); await tick(); expect(rows[1].reason).toBe('Clock correction');
});
