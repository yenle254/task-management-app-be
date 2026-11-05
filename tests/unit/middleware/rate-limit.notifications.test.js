const express = require('express');
const request = require('supertest');

// Real HTTP requests and real limiter stores; no database, email or push calls.
describe('backend rate limits', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'production'; // Do not exercise the test-only bypass.
    jest.resetModules();
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.resetModules();
  });

  test.each([
    ['generalLimiter', 1000],
    ['notificationReadLimiter', 3000],
    ['authLimiter', 30],
    ['strictLimiter', 5],
  ])('%s accepts its full budget of %i then rejects the next request', async (name, limit) => {
    const limiter = require('../../../middleware/rate-limit.middleware')[name];
    const app = express();
    app.use(limiter);
    app.get('/test', (req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    try {
      for (let i = 0; i < limit; i++) {
        const result = await request(server).get('/test');
        expect(result.status).toBe(200);
        expect(Number(result.headers['ratelimit-limit'])).toBe(limit);
      }
      const blocked = await request(server).get('/test');
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ success: false, error: expect.any(String), retryAfter: 900 });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(900);
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 60000);

  function authApp() {
    // Keep the actual auth router, rate limiters and async handler in the path.
    jest.doMock('../../../controllers/auth.controller', () => Object.fromEntries([
      'register', 'login', 'forgotPassword', 'verifyOTP', 'resetPassword',
      'resendOTP', 'getMe', 'updateProfile', 'changePassword',
    ].map(name => [name, async (req, res) => res.json({ handler: name })])));
    jest.doMock('../../../middleware/auth.middleware', () => ({ protect: (req, res, next) => next() }));
    jest.doMock('../../../middleware/validate-request.middleware', () => ({ validateRequest: (req, res, next) => next() }));
    jest.doMock('../../../validators', () => Object.fromEntries([
      'registerValidation', 'loginValidation', 'forgotPasswordValidation', 'verifyOTPValidation',
      'resetPasswordValidation', 'changePasswordValidation', 'updateProfileValidation',
    ].map(name => [name, (req, res, next) => next()])));
    const app = express();
    app.use('/api/auth', require('../../../routes/auth.routes'));
    return app;
  }

  test.each(['login', 'forgot-password', 'verify-otp', 'reset-password', 'resend-otp'])(
    '%s uses the increased auth budget without consuming registration attempts', async route => {
      const app = authApp();
      for (let i = 0; i < 30; i++) {
        expect((await request(app).post('/api/auth/' + route)).status).toBe(200);
      }
      expect((await request(app).post('/api/auth/' + route)).status).toBe(429);
      for (let i = 0; i < 5; i++) {
        expect((await request(app).post('/api/auth/register')).status).toBe(200);
      }
      expect((await request(app).post('/api/auth/register')).status).toBe(429);
    }
  );

  test('registration exhaustion does not block login; other auth endpoints share their budget', async () => {
    const app = authApp();
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/register');
    expect((await request(app).post('/api/auth/register')).status).toBe(429);
    for (let i = 0; i < 15; i++) {
      expect((await request(app).post('/api/auth/login')).status).toBe(200);
      expect((await request(app).post('/api/auth/verify-otp')).status).toBe(200);
    }
    expect((await request(app).post('/api/auth/resend-otp')).status).toBe(429);
  });
});
