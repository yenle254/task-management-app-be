const express = require('express');
const request = require('supertest');
const { notificationReadLimiter, generalLimiter } = require('../../../middleware/rate-limit.middleware');

describe('notification rate limiters', () => {
  let app;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Force rate limiters to actually run by overriding test skip
    process.env.NODE_ENV = 'development';
    jest.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.resetModules();
  });

  const buildApp = (limiter) => {
    const app = express();
    app.use(limiter);
    app.get('/test', (req, res) => res.json({ ok: true }));
    return app;
  };

  test('notificationReadLimiter allows up to 300 requests per window', async () => {
    const { notificationReadLimiter: lim } = require('../../../middleware/rate-limit.middleware');
    const app = buildApp(lim);

    // Send 300 requests - all should pass
    const responses = [];
    for (let i = 0; i < 300; i++) {
      const r = await request(app).get('/test');
      responses.push(r.status);
    }
    expect(responses.every(s => s === 200)).toBe(true);
  });

  test('notificationReadLimiter rejects the 301st request with the expected error shape', async () => {
    const { notificationReadLimiter: lim } = require('../../../middleware/rate-limit.middleware');
    const app = buildApp(lim);

    for (let i = 0; i < 300; i++) {
      await request(app).get('/test');
    }
    const blocked = await request(app).get('/test');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(expect.objectContaining({
      success: false,
      error: expect.any(String),
      retryAfter: expect.any(Number),
    }));
  });

  test('generalLimiter still throttles at 100 requests per window (auth protection preserved)', async () => {
    const { generalLimiter: lim } = require('../../../middleware/rate-limit.middleware');
    const app = buildApp(lim);

    for (let i = 0; i < 100; i++) {
      await request(app).get('/test');
    }
    const blocked = await request(app).get('/test');
    expect(blocked.status).toBe(429);
  });
});
