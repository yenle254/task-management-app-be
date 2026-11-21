const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../../../models/user.model');
const RefreshSession = require('../../../models/refresh-session.model');
const AuditLog = require('../../../models/audit-log.model');
const tokenService = require('../../../services/token.service');
const auditService = require('../../../services/audit.service');
const userService = require('../../../services/user.service');

const { connectTestDB, clearTestDB, disconnectTestDB } = require('../setup/mongo-env');
const { createTestApp } = require('../setup/test-app');
const { createUser, loginUser, DEFAULT_PASSWORD } = require('../setup/seed-helpers');

describe('Auth & Session Integration Tests (Real MongoDB)', () => {
  let testEnv;
  let app;
  let io;
  let sentEmails;

  beforeAll(async () => {
    await connectTestDB();
    testEnv = createTestApp();
    app = testEnv.app;
    io = testEnv.io;
    sentEmails = testEnv.sentEmails;
  });

  beforeEach(async () => {
    await clearTestDB();
    testEnv.clearOutbox();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  describe('1. Registration & Sensitive Field Protection', () => {
    test('POST /api/auth/register creates employee account, ignores injected role/tokenVersion/isActive, and strips sensitive fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'NewUser@Integration.Test',
          password: 'Password123!',
          role: 'hr_manager',
          tokenVersion: 5,
          isActive: false,
          profile: {
            fullName: 'New Registered User',
            employeeId: 'REG_001',
            department: 'Product',
            position: 'Analyst',
            phone: '0912345678',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.user.role).toBe('employee');
      expect(res.body.user.email).toBe('newuser@integration.test');

      for (const secretField of ['password', 'tokenVersion', 'resetPassword', 'pushToken', 'reminders', 'leaveBalanceOperations']) {
        expect(res.body.user).not.toHaveProperty(secretField);
      }

      // Verify actual document in MongoDB
      const dbUser = await User.findById(res.body.user._id).select('+password +tokenVersion +resetPassword').lean();
      expect(dbUser).toBeTruthy();
      expect(dbUser.role).toBe('employee');
      expect(dbUser.tokenVersion).toBe(0);
      expect(dbUser.isActive).toBe(true);
      expect(dbUser.password).not.toBe('Password123!');
      expect(dbUser.password).toMatch(/^\$2[ab]\$/);

      // Verify GET /api/auth/me never exposes sensitive fields
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${res.body.token}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.email).toBe('newuser@integration.test');
      for (const secretField of ['password', 'tokenVersion', 'resetPassword']) {
        expect(meRes.body.data).not.toHaveProperty(secretField);
      }

      await auditService.flush();
      const auditDoc = await AuditLog.findOne({ action: 'auth.register', 'target.id': String(dbUser._id) }).lean();
      expect(auditDoc).toBeTruthy();
      expect(auditDoc.outcome).toBe('success');
    });

    test('POST /api/auth/register enforces unique email and unique profile.employeeId in MongoDB', async () => {
      await createUser({
        email: 'existing@integration.test',
        employeeId: 'EMP_DUP_01',
      });

      // Duplicate email
      const dupEmailRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'EXISTING@integration.test',
          password: 'Password123!',
          profile: {
            fullName: 'Duplicate Email User',
            employeeId: 'EMP_UNIQUE_02',
          },
        });
      expect(dupEmailRes.status).toBe(400);

      // Duplicate employeeId (enforced by MongoDB unique index on profile.employeeId)
      const dupEmpIdRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'unique2@integration.test',
          password: 'Password123!',
          profile: {
            fullName: 'Duplicate EmployeeId User',
            employeeId: 'EMP_DUP_01',
          },
        });
      expect([400, 500]).toContain(dupEmpIdRes.status);
      expect(await User.countDocuments({})).toBe(1);
    });
  });

  describe('2. Login & RefreshSession Creation', () => {
    test('POST /api/auth/login issues 15m JWT, stores only SHA-256 tokenHash in refresh_sessions, and records audit logs', async () => {
      const user = await createUser({
        email: 'login@integration.test',
        rawPassword: 'CorrectPassword123!',
        resetPassword: { otp: '654321', resetToken: 'secret-reset-token' },
      });

      // Wrong password attempt
      const failRes = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'WrongPassword123!' });
      expect(failRes.status).toBe(401);

      // Valid login attempt
      const successRes = await request(app)
        .post('/api/auth/login')
        .set('User-Agent', 'JestIntegrationAgent/1.0')
        .send({ email: user.email, password: 'CorrectPassword123!', deviceName: 'Work Laptop' });

      expect(successRes.status).toBe(200);
      const { token, refreshToken, expiresIn, user: returnedUser } = successRes.body;
      expect(expiresIn).toBe(900);
      expect(returnedUser.resetPassword).toBeUndefined();
      expect(returnedUser.password).toBeUndefined();
      expect(returnedUser.tokenVersion).toBeUndefined();

      // Verify JWT claims
      const decoded = jwt.decode(token);
      expect(decoded.sub).toBe(String(user._id));
      expect(decoded.ver).toBe(0);
      expect(decoded.typ).toBe('access');
      expect(decoded.sid).toEqual(expect.any(String));
      expect(decoded.exp - decoded.iat).toBe(900);

      // Verify RefreshSession in MongoDB stores only SHA-256 hash and has TTL index
      const rawSessionDoc = await RefreshSession.collection.findOne({ sessionId: decoded.sid });
      expect(rawSessionDoc).toBeTruthy();
      expect(rawSessionDoc.tokenHash).toBe(tokenService.hashRefreshToken(refreshToken));
      expect(JSON.stringify(rawSessionDoc)).not.toContain(refreshToken);
      expect(rawSessionDoc.deviceName).toBe('Work Laptop');

      const indexes = await RefreshSession.collection.indexes();
      expect(indexes.some((idx) => idx.key.expiresAt === 1 && idx.expireAfterSeconds === 0)).toBe(true);

      // Verify AuditLogs in MongoDB
      await auditService.flush();
      const failedAudit = await AuditLog.findOne({ action: 'auth.login_failed', 'target.id': String(user._id) }).lean();
      const successAudit = await AuditLog.findOne({ action: 'auth.login_success', 'target.id': String(user._id) }).lean();
      expect(failedAudit).toBeTruthy();
      expect(failedAudit.outcome).toBe('failure');
      expect(successAudit).toBeTruthy();
      expect(successAudit.outcome).toBe('success');
    });

    test('POST /api/auth/login rejects deactivated user and records deactivated failure audit', async () => {
      const inactiveUser = await createUser({
        email: 'inactive@integration.test',
        isActive: false,
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: inactiveUser.email, password: DEFAULT_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/deactivated/i);

      await auditService.flush();
      const auditDoc = await AuditLog.findOne({ action: 'auth.login_failed', 'target.id': String(inactiveUser._id) }).lean();
      expect(auditDoc).toBeTruthy();
      expect(auditDoc.reason).toBe('deactivated');
    });
  });

  describe('3. Refresh Token Rotation, Grace Window & Replay Detection', () => {
    test('10 concurrent POST /api/auth/refresh requests with the same token yield exactly one 200 and nine 409 responses', async () => {
      const user = await createUser({ email: 'concurrent.refresh@integration.test' });
      const initialPair = await loginUser(app, user.email);

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: initialPair.refreshToken })
        )
      );

      const okResponses = responses.filter((r) => r.status === 200);
      const conflictResponses = responses.filter((r) => r.status === 409);

      expect(okResponses).toHaveLength(1);
      expect(conflictResponses).toHaveLength(9);
      for (const conflict of conflictResponses) {
        expect(conflict.body.code).toBe('refresh_retry');
      }

      const winner = okResponses[0].body;
      expect(winner.refreshToken).not.toBe(initialPair.refreshToken);

      // Subsequent rotation with the winning token succeeds
      const nextRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: winner.refreshToken });
      expect(nextRes.status).toBe(200);

      // User tokenVersion remains 0 (no false token_reuse penalty during grace window)
      const freshUser = await User.findById(user._id).select('+tokenVersion').lean();
      expect(freshUser.tokenVersion).toBe(0);
    });

    test('replaying an already rotated refresh token after grace period expires increments tokenVersion, revokes all sessions, and logs critical security audit', async () => {
      const user = await createUser({ email: 'reuse.attack@integration.test' });
      const deviceA = await loginUser(app, user.email);
      const deviceB = await loginUser(app, user.email);

      // Rotate deviceA token once
      const rotatedA = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: deviceA.refreshToken });
      expect(rotatedA.status).toBe(200);

      // Expire the grace window in MongoDB for the used token
      const decodedA = jwt.decode(deviceA.token);
      await RefreshSession.updateOne(
        { sessionId: decodedA.sid },
        { $set: { 'usedTokens.0.validUntil': new Date(0), previousValidUntil: new Date(0) } }
      );

      // Replay the old refresh token outside the grace window
      const replayRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: deviceA.refreshToken });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.code).toBe('token_reuse');

      // Both deviceA (rotated) and deviceB access tokens must now be rejected
      const meA = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${rotatedA.body.token}`);
      const meB = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${deviceB.token}`);
      expect(meA.status).toBe(401);
      expect(meB.status).toBe(401);

      // Database state verification
      const dbUser = await User.findById(user._id).select('+tokenVersion').lean();
      expect(dbUser.tokenVersion).toBe(1);

      const activeSessions = await RefreshSession.countDocuments({ userId: user._id, revokedAt: null });
      expect(activeSessions).toBe(0);

      await auditService.flush();
      const reuseAudit = await AuditLog.findOne({
        action: 'security.token_reuse_detected',
        'actor.id': String(user._id),
      }).lean();
      expect(reuseAudit).toBeTruthy();
      expect(reuseAudit.severity).toBe('critical');
      expect(reuseAudit.outcome).toBe('denied');
    });
  });

  describe('4. Multi-Device Session Management & Logout', () => {
    test('single-device session revocation or logout invalidates only that device while preserving other active sessions', async () => {
      const user = await createUser({ email: 'multidevice@integration.test' });
      const sessionA = await loginUser(app, user.email, DEFAULT_PASSWORD, { deviceName: 'Phone A' });
      const sessionB = await loginUser(app, user.email, DEFAULT_PASSWORD, { deviceName: 'Tablet B' });

      // List active sessions
      const listRes = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${sessionA.token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(2);
      expect(JSON.stringify(listRes.body)).not.toContain('tokenHash');

      // Revoke Session A explicitly via DELETE /api/auth/sessions/:sessionId
      const sidA = jwt.decode(sessionA.token).sid;
      const revokeRes = await request(app)
        .delete(`/api/auth/sessions/${sidA}`)
        .set('Authorization', `Bearer ${sessionB.token}`);
      expect(revokeRes.status).toBe(200);

      // Session A access token is immediately denied; Session B stays valid
      const checkA = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sessionA.token}`);
      const checkB = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sessionB.token}`);
      expect(checkA.status).toBe(401);
      expect(checkA.body.code).toBe('session_revoked');
      expect(checkB.status).toBe(200);

      // Socket stub recorded room disconnect for sessionA
      expect(io.disconnectedRooms).toContainEqual({ room: `session:${sidA}`, close: true });

      // Logout Session B via POST /api/auth/logout (idempotent)
      const logoutRes1 = await request(app).post('/api/auth/logout').send({ refreshToken: sessionB.refreshToken });
      const logoutRes2 = await request(app).post('/api/auth/logout').send({ refreshToken: sessionB.refreshToken });
      expect(logoutRes1.status).toBe(200);
      expect(logoutRes2.status).toBe(200);

      const checkBAfterLogout = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sessionB.token}`);
      expect(checkBAfterLogout.status).toBe(401);
    });

    test('POST /api/auth/logout-all increments user tokenVersion and revokes all active sessions', async () => {
      const user = await createUser({ email: 'logoutall@integration.test' });
      const sessionA = await loginUser(app, user.email);
      const sessionB = await loginUser(app, user.email);

      const res = await request(app)
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${sessionA.token}`);
      expect(res.status).toBe(200);

      const dbUser = await User.findById(user._id).select('+tokenVersion').lean();
      expect(dbUser.tokenVersion).toBe(1);

      expect(await RefreshSession.countDocuments({ userId: user._id, revokedAt: null })).toBe(0);
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sessionA.token}`)).status).toBe(401);
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sessionB.token}`)).status).toBe(401);
    });
  });

  describe('5. Password Change, OTP Recovery & Account Lifecycle', () => {
    test('PUT /api/auth/password atomically increments tokenVersion, revokes all old devices, and returns a working token pair', async () => {
      const user = await createUser({ email: 'changepass@integration.test' });
      const device1 = await loginUser(app, user.email);
      const device2 = await loginUser(app, user.email);

      // Wrong old password does not mutate tokenVersion or sessions
      const wrongRes = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${device1.token}`)
        .send({ oldPassword: 'WrongOldPassword!', newPassword: 'NewPassword123!' });
      expect(wrongRes.status).toBe(400);
      expect((await User.findById(user._id).select('+tokenVersion')).tokenVersion).toBe(0);

      // Valid password change
      const changeRes = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${device1.token}`)
        .send({ oldPassword: DEFAULT_PASSWORD, newPassword: 'NewPassword123!' });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body.token).toEqual(expect.any(String));
      expect(changeRes.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);

      // Old tokens on both devices are now revoked
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${device1.token}`)).status).toBe(401);
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${device2.token}`)).status).toBe(401);
      expect((await request(app).post('/api/auth/refresh').send({ refreshToken: device1.refreshToken })).status).toBe(401);

      // Replacement token works and has ver === 1
      expect(jwt.decode(changeRes.body.token).ver).toBe(1);
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${changeRes.body.token}`)).status).toBe(200);
    });

    test('forgot-password -> verify-otp (enforcing 5-attempt lockout) -> concurrent reset-password consumes resetToken once and invalidates active sessions', async () => {
      const user = await createUser({ email: 'recovery@integration.test' });
      const activeSession = await loginUser(app, user.email);

      // 1. Request OTP
      const forgotRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: user.email });
      expect(forgotRes.status).toBe(200);
      expect(sentEmails).toHaveLength(1);
      const firstOtp = sentEmails[0].otp;
      expect(firstOtp).toMatch(/^\d{6}$/);

      // 2. Exhaust 5 failed attempts -> 6th attempt returns 429 and clears OTP
      for (let attempt = 1; attempt <= 5; attempt++) {
        const badOtpRes = await request(app)
          .post('/api/auth/verify-otp')
          .send({ email: user.email, otp: '000000' });
        expect(badOtpRes.status).toBe(400);
      }
      const lockedOutRes = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: user.email, otp: firstOtp });
      expect(lockedOutRes.status).toBe(429);

      // 3. Resend OTP and verify with the new code
      const resendRes = await request(app)
        .post('/api/auth/resend-otp')
        .send({ email: user.email });
      expect(resendRes.status).toBe(200);
      expect(sentEmails).toHaveLength(2);
      const validOtp = sentEmails[1].otp;

      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: user.email, otp: validOtp });
      expect(verifyRes.status).toBe(200);
      const { resetToken } = verifyRes.body.data;
      expect(resetToken).toHaveLength(64);

      // 4. Fire 2 concurrent reset-password requests with the same resetToken
      const resetPayload = {
        email: user.email,
        resetToken,
        newPassword: 'ResetPassword123!',
      };
      const [resetA, resetB] = await Promise.all([
        request(app).post('/api/auth/reset-password').send(resetPayload),
        request(app).post('/api/auth/reset-password').send(resetPayload),
      ]);

      expect([resetA.status, resetB.status].sort()).toEqual([200, 400]);

      // Verify DB state: resetPassword cleared, tokenVersion incremented, old session invalidated
      const updatedUser = await User.findById(user._id).select('+resetPassword +tokenVersion').lean();
      expect(updatedUser.tokenVersion).toBe(1);
      expect(updatedUser.resetPassword?.resetToken ?? null).toBeNull();
      expect(updatedUser.resetPassword?.otp ?? null).toBeNull();

      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${activeSession.token}`)).status).toBe(401);

      // Can login with the new password
      const relogin = await loginUser(app, user.email, 'ResetPassword123!');
      expect(relogin.token).toEqual(expect.any(String));
    });

    test('user deactivation and reactivation via user.service increments epoch so old tokens cannot be resurrected', async () => {
      const user = await createUser({ email: 'lifecycle@integration.test' });
      const pair = await loginUser(app, user.email);

      await userService.deleteUser(user._id);
      await User.updateOne({ _id: user._id }, { $set: { isActive: true } });

      const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${pair.token}`);
      const refreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken: pair.refreshToken });
      expect(meRes.status).toBe(401);
      expect(refreshRes.status).toBe(401);
    });
  });
});

