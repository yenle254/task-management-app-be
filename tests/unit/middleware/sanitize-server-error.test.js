const express = require('express');
const request = require('supertest');
const sanitizeServerError = require('../../../middleware/sanitize-server-error.middleware');

describe('sanitized server responses', () => {
  const app = express();
  app.use(sanitizeServerError);
  app.get('/caught', (req, res) => res.status(500).json({
    success: false, error: 'database password leaked', stack: 'internal trace'
  }));
  app.get('/client', (req, res) => res.status(400).json({
    success: false, error: 'Invalid date'
  }));

  test('masks internal details from controller-generated 500 responses', async () => {
    const response = await request(app).get('/caught');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'Internal server error' });
  });

  test('preserves validation errors', async () => {
    const response = await request(app).get('/client');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: 'Invalid date' });
  });
});
