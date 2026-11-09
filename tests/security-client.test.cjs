const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../../project');
const fromProject = createRequire(path.join(root, 'package.json'));
const babel = fromProject('@babel/core');

function harness() {
  const storage = new Map([['authToken', 'current-token'], ['user', '{}'], ['refreshToken', 'refresh']]);
  const sockets = [], cache = new Map();
  const interceptors = { request: { use() {} }, response: { use() {} } };
  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} }; cache.set(absolute, mod);
    const code = babel.transformSync(fs.readFileSync(absolute, 'utf8'), { configFile: false, babelrc: false,
      plugins: [fromProject.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
    new Function('require', 'module', 'exports', 'console', code)(name => {
      if (name === 'react-native') return { Platform: { OS: 'web' } };
      if (name === 'expo-secure-store') return {};
      if (name === 'expo-file-system/legacy') return {};
      if (name === 'axios') return { create: () => ({ interceptors }) };
      if (name === '@react-native-async-storage/async-storage') return {
        getItem: async key => storage.get(key), setItem: async (key, value) => storage.set(key, value),
        removeItem: async key => storage.delete(key), multiRemove: async keys => keys.forEach(key => storage.delete(key)),
      };
      if (name.endsWith('api.config')) return { BASE_URL: 'http://localhost:3000/api', API_URL: 'http://localhost:3000/api' };
      if (name === 'socket.io-client') return { io: () => {
        const callbacks = new Map();
        const socket = { connected: true, id: 'test-socket', disconnected: false,
          on(event, callback) { if (!callbacks.has(event)) callbacks.set(event, []); callbacks.get(event).push(callback); },
          disconnect() { this.disconnected = true; },
          connect() { this.disconnected = false; setImmediate(() => this.trigger('connect')); },
          emit() {},
          async trigger(event, data) { for (const fn of callbacks.get(event) || []) await fn(data); },
        };
        sockets.push(socket); setImmediate(() => socket.trigger('connect'));
        return socket;
      } };
      return load(path.resolve(path.dirname(absolute), name + '.js'));
    }, mod, mod.exports, { log() {}, error() {} });
    return mod.exports;
  }
  return { load, storage, sockets };
}
test('preview URL adds token only to exact configured origin and private file path', () => {
  const { load } = harness(); const helpers = load('src/utils/fileUrlHelper.js');
  assert.equal(new URL(helpers.getAuthenticatedFileUrl('/uploads/a.png', 'secret')).searchParams.get('access_token'), 'secret');
  assert.equal(helpers.getAuthenticatedFileUrl('/uploads/a.png', null), '');
  for (const url of ['https://evil.test/uploads/a.png', 'http://localhost:3000.evil.test/uploads/a.png',
    'http://user@localhost:3000/uploads/a.png', 'http://localhost:3000/api/auth/login', 'file:///cache/a.png']) {
    assert.equal(helpers.getAuthenticatedFileUrl(url, 'secret'), url);
  }
});
test('file service strips preview token for download, retains other params and requires login', async () => {
  const h = harness(); const service = h.load('src/services/fileService.js');
  assert.deepEqual(await service.getFileRequest('/uploads/a.png?access_token=old&v=2'), {
    url: 'http://localhost:3000/uploads/a.png?v=2', options: { headers: { Authorization: 'Bearer current-token' } },
  });
  assert.deepEqual(await service.getFileRequest('https://external.test/a.png'), { url: 'https://external.test/a.png', options: {} });
  await h.load('src/services/tokenManager.js').clearSession(); await assert.rejects(service.getFileRequest('/uploads/a.png'), /sign in/);
});
test('session expiration clears token, user and refresh token and notifies auth listeners', async () => {
  const h = harness(); const api = h.load('src/services/api.js'); let expired = 0;
  const unsubscribe = api.subscribeSessionExpired(() => expired++);
  await api.expireSession('current-token');
  assert.equal(h.storage.size, 0); assert.equal(expired, 1);
  unsubscribe();
});
test('delayed revocation from an earlier token never clears a new login', async () => {
  const h = harness(); const api = h.load('src/services/api.js'); let expired = 0;
  api.subscribeSessionExpired(() => expired++);
  await api.expireSession('old-token');
  assert.equal(await h.load('src/utils/authStorage.js').getToken(), 'current-token'); assert.equal(expired, 0);
});
test('Socket.IO session_revoked disconnects and drives the existing auth expiration flow', async () => {
  const h = harness(); const api = h.load('src/services/api.js'); let expired = 0;
  api.subscribeSessionExpired(() => expired++);
  const service = h.load('src/services/socketService.js').default;
  await service.connect(); await h.sockets[0].trigger('session_revoked', { reason: 'Role changed' });
  assert.equal(h.sockets[0].disconnected, true); assert.equal(service.connected, false);
  assert.equal(h.storage.size, 0); assert.equal(expired, 1);
});
test('an obsolete socket cannot revoke a newer connection', async () => {
  const h = harness(); const service = h.load('src/services/socketService.js').default;
  await service.connect(); const old = h.sockets[0]; service.connected = false;
  await service.connect(); await old.trigger('session_revoked');
  assert.equal(await h.load('src/utils/authStorage.js').getToken(), 'current-token');
  assert.equal(h.sockets[1].disconnected, false);
});
