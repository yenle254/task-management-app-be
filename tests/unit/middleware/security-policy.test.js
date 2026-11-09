const express = require('express');
const request = require('supertest');
const cors = require('cors');
const { createCorsPolicy } = require('../../../config/cors.config');
const { securityHeaders, permissionsPolicy } = require('../../../config/security.config');
const sanitize = require('../../../middleware/sanitize.middleware');
const { validateRequest } = require('../../../middleware/validate-request.middleware');
const { loginValidation } = require('../../../validators/auth.validators');
const { updateAttendanceValidation } = require('../../../validators/attendance.validators');

function app(env = { NODE_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:8081' }) {
  const api = express();
  api.set('query parser', 'simple');
  api.use(securityHeaders(env), permissionsPolicy, cors(createCorsPolicy(env).httpCorsOptions));
  api.use(express.json(), express.urlencoded({ extended: false }), sanitize);
  api.get('/test', (req, res) => res.json(req.query));
  api.post('/test', (req, res) => res.json(req.body));
  api.post('/login', loginValidation, validateRequest, (_req, res) => res.sendStatus(204));
  api.put('/attendance/:id', updateAttendanceValidation, validateRequest, (req, res) => res.json(req.body));
  require('../../../config/swagger.config').setupSwagger(api);
  api.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  return api;
}

test.each([{}, { ALLOWED_ORIGINS: '*' }, { CLIENT_URL: '*' }])('production rejects missing or wildcard origins %j', config => {
  expect(() => createCorsPolicy({ NODE_ENV: 'production', ...config })).toThrow();
});
test.each(['https://example.test/path', 'null', 'ftp://example.test', 'https://example.test/'])('invalid origin configuration %s is rejected', origin => {
  expect(() => createCorsPolicy({ ALLOWED_ORIGINS: origin })).toThrow();
});
test('explicit production list overrides legacy wildcard; sockets gate WebSocket requests', () => {
  const policy = createCorsPolicy({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://app.test', CLIENT_URL: '*' });
  const callback = jest.fn();
  policy.allowSocketRequest({ headers: { origin: 'https://evil.test' } }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, false);
  policy.allowSocketRequest({ headers: {} }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, true);
});
test('HTTP native, allowed, denied origins and preflight', async () => {
  const api = app();
  expect((await request(api).get('/test')).status).toBe(200);
  const allowed = await request(api).get('/test').set('Origin', 'http://localhost:8081');
  expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
  const denied = await request(api).get('/test').set('Origin', 'https://evil.test');
  expect(denied.status).toBe(403); expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  const preflight = await request(api).options('/test').set('Origin', 'http://localhost:8081')
    .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization');
  expect(preflight.status).toBe(204); expect(preflight.headers['access-control-allow-headers']).toMatch(/Authorization/);
});
test('explicit development wildcard reflects origin without credentials', async () => {
  const result = await request(app({ NODE_ENV: 'development', CLIENT_URL: '*' })).get('/test').set('Origin', 'http://dev.test');
  expect(result.headers['access-control-allow-origin']).toBe('http://dev.test');
  expect(result.headers['access-control-allow-credentials']).toBeUndefined();
});
test('headers cover API, errors and docs; Swagger assets are local and CSP compatible', async () => {
  const api = app();
  for (const url of ['/test', '/missing', '/api-docs/', '/api-docs.json']) {
    const result = await request(api).get(url);
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['x-frame-options']).toBe('DENY');
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    expect(result.headers['permissions-policy']).toContain('geolocation');
    expect(result.headers['x-powered-by']).toBeUndefined();
    expect(result.headers['strict-transport-security']).toBeUndefined();
    expect(result.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  }
  const docs = await request(api).get('/api-docs/');
  expect(docs.status).toBe(200); expect(docs.text).not.toContain('unpkg.com');
  expect((await request(api).get('/api-docs/swagger-ui-init.js')).status).toBe(200);
  expect((await request(api).get('/api-docs.json')).body.openapi).toBe('3.0.0');
  const production = await request(app({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://app.test' })).get('/test');
  expect(production.headers['strict-transport-security']).toContain('max-age=15552000');
});
test.each(['{"email":{"$ne":null}}', '{"nested":[{"$where":"attack"}]}', '{"__proto__":{"polluted":true}}',
  '{"nested":{"constructor":{"prototype":{"polluted":true}}}}', '{"profile.__proto__.x":true}'])('rejects dangerous nested JSON %s', async raw => {
  const result = await request(app()).post('/test').set('Content-Type', 'application/json').send(raw);
  expect(result.status).toBe(400); expect({}.polluted).toBeUndefined();
});
test('flat bracket operators and urlencoded payloads are rejected; duplicates collapse; arrays/dotted profiles preserved', async () => {
  expect((await request(app()).get('/test?status[$ne]=x')).status).toBe(400);
  expect((await request(app()).post('/test').type('form').send('email[$ne]=x')).status).toBe(400);
  expect((await request(app()).get('/test?status=todo&status=done')).body.status).toBe('done');
  const payload = { 'profile.fullName': 'Jane', tags: ['one', 'two'] };
  expect((await request(app()).post('/test').send(payload)).body).toEqual(payload);
});
test.each([{ email: { $ne: null }, password: 'x' }, { email: ['a@example.com'], password: 'x' }, { email: 'a@example.com', password: {} }])('login rejects non-scalar input before controller', async input => {
  expect((await request(app()).post('/login').send(input)).status).toBe(400);
});
test.each([{ userId: 'a'.repeat(24) }, { isDeleted: true }, { location: { lat: 10, lng: 20, extra: true } }, { autoClockOut: {} }])('attendance rejects unsupported update %j', async input => {
  expect((await request(app()).put('/attendance/' + 'a'.repeat(24)).send(input)).status).toBe(400);
});
test('attendance accepts documented fields including reason without mass assignment', async () => {
  const input = { clockIn: '2026-11-07T08:00:00Z', reason: 'Correction', autoClockOut: false };
  const result = await request(app()).put('/attendance/' + 'a'.repeat(24)).send(input);
  expect(result.status).toBe(200); expect(result.body).toEqual(input);
});
