const express = require('express');
const request = require('supertest');
test('audit routes share their own 60/15min budget without consuming notification budget', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const { auditLimiter, notificationReadLimiter } = require('../../../middleware/rate-limit.middleware');
  const app = express();
  app.use('/audit', auditLimiter); app.get('/audit/:mode', (req, res) => res.json({ success: true }));
  app.get('/notifications', notificationReadLimiter, (req, res) => res.json({ success: true }));
  try {
    for (let i = 0; i < 60; i++) expect((await request(app).get(`/audit/${['list', 'detail', 'target'][i % 3]}`)).status).toBe(200);
    const blocked = await request(app).get('/audit/list'); expect(blocked.status).toBe(429); expect(blocked.body.success).toBe(false);
    const notifications = await request(app).get('/notifications'); expect(notifications.status).toBe(200); expect(notifications.headers['ratelimit-limit']).toBe('3000');
  } finally { process.env.NODE_ENV = previous; }
});
