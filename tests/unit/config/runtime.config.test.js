const express = require('express');
const request = require('supertest');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validateRuntimeConfig: validateConfig, parseTrustProxy } = require('../../../config/runtime.config');
// Configuration cases target production's Node version independently of the test runner.
const validateRuntimeConfig = (env, version = '24.22.1') => validateConfig(env, version);
const { getFileUrl } = require('../../../middleware/upload.middleware');

const development = () => ({ NODE_ENV: 'development', MONGO_URL: 'mongodb://127.0.0.1:27017/runtime_test', JWT_SECRET: 'x'.repeat(48) });
const production = () => ({ ...development(), NODE_ENV: 'production', PORT: '8080',
  ALLOWED_ORIGINS: 'https://app.example.test', ACCEPT_LEGACY_TOKENS: 'false',
  CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: '12345678', CLOUDINARY_API_SECRET: 'fake-test-only-secret' });

test.each(['http://api.example.test', 'https://user:secret@api.example.test', 'https://api.example.test/api', 'https://api.example.test?x=1', 'https://api.example.test#x', 'invalid'])('invalid production public origin is rejected: %s', PUBLIC_BASE_URL => {
  expect(() => validateRuntimeConfig({ ...production(), PUBLIC_BASE_URL })).toThrow('PUBLIC_BASE_URL');
});

test('public upload URLs stay HTTPS behind untrusted/plain HTTP ingress', async () => {
  const previous = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://api.example.test/';
  try {
    expect(() => validateRuntimeConfig({ ...production(), PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL })).not.toThrow();
    const app = express();
    app.set('trust proxy', false);
    app.get('/', (req, res) => res.json({ url: getFileUrl('avatar.png', req) }));
    const response = await request(app).get('/').set('Host', 'untrusted.example').set('X-Forwarded-Proto', 'http');
    expect(response.body.url).toBe('https://api.example.test/uploads/avatar.png');
    expect(getFileUrl('avatar.png')).toBe(response.body.url);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
  }
});

test('Node 24 contract, local defaults, production port and listen address', () => {
  expect(validateRuntimeConfig(development(), '24.22.1')).toMatchObject({ port: 3000, host: '0.0.0.0', trustProxy: false });
  expect(validateRuntimeConfig(production(), '24.22.1')).toMatchObject({ port: 8080, nodeEnv: 'production' });
  expect(validateRuntimeConfig(development(), '22.13.1').port).toBe(3000);
  expect(validateRuntimeConfig({ ...development(), NODE_ENV: 'test' }, '22.13.1').port).toBe(3000);
  expect(() => validateRuntimeConfig(production(), '22.13.1')).toThrow('Production requires Node.js 24');
});

test.each(['20.19.0', '22.12.0', '22.13.0', '23.0.0', '25.0.0'])('unsupported development runtime %s is rejected', version => {
  expect(() => validateRuntimeConfig(development(), version)).toThrow('Development/test requires');
});

test.each(['', '0', '-1', '65536', '3e3', '3000pipe', '3.5', ' 3000', 'Infinity'])('rejects invalid PORT %s', PORT => {
  expect(() => validateRuntimeConfig({ ...development(), PORT })).toThrow('PORT');
});

test('production requires PORT while unset NODE_ENV defaults to development', () => {
  expect(() => validateRuntimeConfig({ ...production(), PORT: undefined })).toThrow('PORT');
  expect(validateRuntimeConfig({ ...development(), NODE_ENV: undefined }).nodeEnv).toBe('development');
  expect(() => validateRuntimeConfig({ ...development(), NODE_ENV: 'prod' })).toThrow('NODE_ENV');
});

test.each(['', 'https://user:secret@db.test', 'mongodb://', 'mongodb+srv://a.test,b.test/db', 'mongodb://db:wrong/db'])('rejects malformed DB URI without leaking it', MONGO_URL => {
  let error;
  try { validateRuntimeConfig({ ...development(), MONGO_URL }); } catch (caught) { error = caught; }
  expect(error.message).toMatch(/MONGO_URL/);
  expect(error.message).not.toContain('secret@');
});

test.each(['mongodb://a.test:27017,b.test:27017/app?replicaSet=rs0', 'mongodb+srv://user:password@cluster.example.test/app'])('validates driver URI syntax without network calls: %s', MONGO_URL => {
  expect(validateRuntimeConfig({ ...development(), MONGO_URL }).port).toBe(3000);
});

test.each([
  [{ JWT_SECRET: 'short' }, 'JWT_SECRET'],
  [{ JWT_SECRET: ' '.repeat(48) }, 'JWT_SECRET'],
  [{ JWT_SECRET: 'replace-with-a-random-secret-of-at-least-32-bytes' }, 'JWT_SECRET'],
  [{ ACCESS_TOKEN_TTL: '1h' }, 'token lifetime'],
  [{ ALLOWED_ORIGINS: undefined, CLIENT_URL: 'https://app.example.test' }, 'ALLOWED_ORIGINS'],
  [{ ALLOWED_ORIGINS: '*' }, 'origins'],
  [{ PRIVATE_FILES_ENABLED: 'false' }, 'PRIVATE_FILES_ENABLED'],
  [{ REFRESH_ENABLED: 'FALSE' }, 'REFRESH_ENABLED'],
  [{ ACCEPT_LEGACY_TOKENS: undefined }, 'ACCEPT_LEGACY_TOKENS'],
  [{ ACCEPT_LEGACY_TOKENS: 'true', LEGACY_TOKEN_ISSUED_BEFORE: 'bad-date' }, 'LEGACY_TOKEN_ISSUED_BEFORE'],
  [{ ACCEPT_LEGACY_TOKENS: 'true', LEGACY_TOKEN_ISSUED_BEFORE: '2026-02-30T00:00:00Z' }, 'LEGACY_TOKEN_ISSUED_BEFORE'],
  [{ ACCEPT_LEGACY_TOKENS: 'true', LEGACY_TOKEN_ISSUED_BEFORE: '2999-01-01T00:00:00Z' }, 'LEGACY_TOKEN_ISSUED_BEFORE'],
  [{ CLOUDINARY_ENABLED: 'false' }, 'Cloudinary'],
  [{ CLOUDINARY_API_KEY: undefined }, 'CLOUDINARY_API_KEY'],
  [{ CLOUDINARY_API_SECRET: 'your_api_secret' }, 'CLOUDINARY_API_SECRET'],
  [{ CLOUDINARY_API_SECRET: '  your_api_secret  ' }, 'CLOUDINARY_API_SECRET'],
  [{ MONGO_URL: 'mongodb://localhost/your_db_name' }, 'MONGO_URL'],
  [{ EMAIL_HOST: 'smtp.example.test' }, 'EMAIL_USER'],
  [{ EMAIL_PORT: 'abc' }, 'EMAIL_PORT'],
  [{ EXPO_ACCESS_TOKEN: 'your_expo_access_token_here' }, 'EXPO_ACCESS_TOKEN'],
  [{ GEMINI_API_KEY: 'your_api_key' }, 'GEMINI_API_KEY'],
  [{ AI_PROVIDER: 'gemini' }, 'GEMINI_API_KEY'],
  [{ AI_PROVIDER: 'ollama' }, 'OLLAMA_BASE_URL'],
  [{ AI_PROVIDER: 'typo' }, 'AI_PROVIDER'],
  [{ OLLAMA_BASE_URL: 'file:///model' }, 'OLLAMA_BASE_URL'],
  [{ OLLAMA_TIMEOUT_MS: '-1' }, 'OLLAMA_TIMEOUT_MS'],
  [{ LOG_LEVEL: 'typo' }, 'LOG_LEVEL'],
  [{ HEALTHCHECK_TIMEOUT_MS: '0' }, 'HEALTHCHECK_TIMEOUT_MS'],
  [{ HEALTHCHECK_TIMEOUT_MS: '5001' }, 'HEALTHCHECK_TIMEOUT_MS'],
  [{ SHUTDOWN_TIMEOUT_MS: 'invalid' }, 'SHUTDOWN_TIMEOUT_MS'],
  [{ SHUTDOWN_TIMEOUT_MS: '120001' }, 'SHUTDOWN_TIMEOUT_MS'],
])('fails early for invalid production config %j', (override, message) => {
  expect(() => validateRuntimeConfig({ ...production(), ...override })).toThrow(message);
});

test('optional integrations may be absent; complete settings and bounded legacy rollout are accepted', () => {
  expect(validateRuntimeConfig({ ...production(), EMAIL_HOST: 'smtp.example.test', EMAIL_USER: 'sender', EMAIL_PASS: 'test-password',
    EMAIL_PORT: '587', AI_PROVIDER: 'local_only', ACCEPT_LEGACY_TOKENS: 'true', LEGACY_TOKEN_ISSUED_BEFORE: '2026-01-01T00:00:00Z' }).port).toBe(8080);
});

test.each(['true', '*', '', '0.0.0.0/0', '::/0', '10.0.0.1/33', '::1/129', '10.0.0.0/x', 'localhost', '-1', '256', '1.5', '127.0.0.1,', '127.0.0.1/8/1'])('rejects unsafe or malformed proxy setting %s', value => {
  expect(() => parseTrustProxy(value)).toThrow('TRUST_PROXY');
});

function proxyApp(value) {
  const app = express();
  app.set('trust proxy', parseTrustProxy(value));
  app.get('/', (req, res) => res.json({ ip: req.ip, protocol: req.protocol, url: getFileUrl('test.pdf', req) }));
  return app;
}

test('direct requests cannot spoof client IP or HTTPS using forwarded headers', async () => {
  const result = await request(proxyApp('false')).get('/').set('X-Forwarded-For', '198.51.100.7').set('X-Forwarded-Proto', 'https');
  expect(result.body.ip).not.toBe('198.51.100.7');
  expect(result.body.protocol).toBe('http');
});

test('verified proxy subnet yields client IP and HTTPS file URL', async () => {
  const result = await request(proxyApp('127.0.0.1/32,::1/128')).get('/').set('Host', 'api.example.test')
    .set('X-Forwarded-For', '198.51.100.7').set('X-Forwarded-Proto', 'https');
  expect(result.body).toEqual({ ip: '198.51.100.7', protocol: 'https', url: 'https://api.example.test/uploads/test.pdf' });
});

test('untrusted peer ignores forwarded headers; one-hop mode ignores spoofed leftmost IP', async () => {
  const untrusted = await request(proxyApp('192.0.2.0/24')).get('/').set('X-Forwarded-Proto', 'https');
  expect(untrusted.body.protocol).toBe('http');
  const oneHop = await request(proxyApp('1')).get('/').set('X-Forwarded-For', '203.0.113.9, 198.51.100.7');
  expect(oneHop.body.ip).toBe('198.51.100.7');
});

test.each(['server.js', 'scripts/check-config.js'])('%s exits nonzero before connecting/listening on invalid configuration', entry => {
  const result = spawnSync(process.execPath, [entry], {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, NODE_ENV: 'development', PORT: 'invalid-port', MONGO_URL: 'mongodb://secret-user:secret-pass@127.0.0.1:1/test' },
    encoding: 'utf8', timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('PORT');
  expect(result.stdout).toBe('');
  expect(result.stderr).not.toMatch(/secret-user|secret-pass|MongoDB Connected/);
});

test('check-config succeeds with unreachable services without making connections or exposing secrets', () => {
  const nodeEnv = process.versions.node.startsWith('24.') ? 'production' : 'development';
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../../scripts/check-config.js')], {
    // No .env here: this subprocess uses only the synthetic configuration below.
    cwd: __dirname,
    env: { ...process.env, ...production(), NODE_ENV: nodeEnv, MONGO_URL: 'mongodb://user:secret-pass@127.0.0.1:1/runtime_test' },
    encoding: 'utf8', timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ success: true, environment: nodeEnv, port: 8080, host: '0.0.0.0', trustProxy: false });
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toMatch(/secret-pass|fake-test-only-secret|MONGO_URL|JWT_SECRET/);
});
