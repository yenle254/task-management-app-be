const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../../project');
const projectRequire = createRequire(path.join(root, 'package.json'));
const babel = projectRequire('@babel/core');
const axios = projectRequire('axios');
const valid = id => `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, jti: id })).toString('base64url')}.signature`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await tick(); assert.ok(predicate(), 'Expected asynchronous state to settle'); };
function harness({ platform = 'android', secureFailure = false, legacy = true } = {}) {
  const initial = valid('first');
  const storage = new Map(legacy ? [['authToken', initial], ['refreshToken', 'refresh-first'], ['user', '{}']] : []);
  const secure = new Map(), calls = [], cache = new Map(), sockets = [], downloads = [];
  const h = { initial, storage, secure, calls, sockets, downloads,
    handler: async config => ({ status: 200, data: config.url === '/auth/refresh' ? { token: valid('next'), refreshToken: 'refresh-next', expiresIn: 900 } : { success: true } }) };
  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} }; cache.set(absolute, mod);
    const code = babel.transformSync(fs.readFileSync(absolute, 'utf8'), { configFile: false, babelrc: false,
      plugins: [projectRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
    new Function('require', 'module', 'exports', 'console', code)(name => {
      if (name === 'axios') return { create: options => axios.create({ ...options, adapter: async config => {
        calls.push(config);
        const response = { config, headers: {}, statusText: '', ...await h.handler(config) };
        if (response.status >= 400) throw new axios.AxiosError('Request failed', 'HTTP_ERROR', config, {}, response);
        return response;
      } }) };
      if (name === '@react-native-async-storage/async-storage') return { getItem: async key => storage.get(key) || null,
        setItem: async (key, value) => storage.set(key, value), removeItem: async key => storage.delete(key), multiRemove: async keys => keys.forEach(key => storage.delete(key)) };
      if (name === 'expo-secure-store') return { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', getItemAsync: async key => secure.get(key) || null,
        setItemAsync: async (key, value) => { if (secureFailure) throw new Error('Secure storage unavailable'); secure.set(key, value); }, deleteItemAsync: async key => secure.delete(key) };
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === 'expo-file-system/legacy') return { cacheDirectory: 'file:///cache/', deleteAsync: async () => {}, downloadAsync: async (url, uri, options) => {
        downloads.push({ url, uri, options }); return { status: downloads.length === 1 ? 401 : 200, uri };
      } };
      if (name.endsWith('api.config')) return { BASE_URL: 'http://localhost:3000/api', API_URL: 'http://localhost:3000/api', TIMEOUT: 2000 };
      if (name === 'socket.io-client') return { io: (_url, options) => {
        const callbacks = new Map();
        const socket = { connected: false, id: 'fake', options, attempts: [], emitted: [],
          on(event, callback) { if (!callbacks.has(event)) callbacks.set(event, []); callbacks.get(event).push(callback); },
          emit(...args) { this.emitted.push(args); },
          connect() { options.auth(auth => { this.attempts.push(auth); this.connected = true; setImmediate(() => this.trigger('connect')); }); },
          disconnect() { this.connected = false; this.trigger('disconnect'); },
          async trigger(event, data) { for (const callback of callbacks.get(event) || []) await callback(data); },
        }; sockets.push(socket); return socket;
      } };
      return load(path.resolve(path.dirname(absolute), name + '.js'));
    }, mod, mod.exports, { log() {}, error() {} });
    return mod.exports;
  }
  h.load = load; h.manager = load('src/services/tokenManager.js'); h.authStorage = load('src/utils/authStorage.js');
  return h;
}
test('native migration writes atomic pair into SecureStore before deleting plaintext', async () => {
  const h = harness(); assert.equal(await h.authStorage.getToken(), h.initial);
  assert.equal(h.storage.has('authToken'), false); assert.equal(h.storage.has('refreshToken'), false);
  assert.equal(JSON.parse(h.secure.get('taskflow.credentials')).refreshToken, 'refresh-first');
});
test('SecureStore failure never silently writes plaintext or deletes migration source', async () => {
  const h = harness({ secureFailure: true });
  await assert.rejects(h.authStorage.getToken(), /Secure storage/);
  assert.equal(h.storage.get('authToken'), h.initial); assert.equal(h.secure.size, 0);
});
test('web fallback supports credentials and cleanup', async () => {
  const h = harness({ platform: 'web' }); await h.authStorage.getToken();
  assert.equal(h.secure.size, 0); assert.ok(h.storage.has('taskflow.credentials'));
  await h.manager.clearSession(); assert.equal(h.storage.size, 0);
});
test('valid access needs no refresh; near-expired access refreshes proactively', async () => {
  const h = harness(); assert.equal(await h.manager.getValidAccessToken(), h.initial); assert.equal(h.calls.length, 0);
  const old = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.sig`;
  await h.manager.setSession({ token: old, refreshToken: 'refresh-first' });
  assert.equal(await h.manager.getValidAccessToken(), valid('next')); assert.equal(h.calls.length, 1);
});
test('many concurrent 401s share one refresh and every request retries once', async () => {
  const h = harness(); const api = h.load('src/services/api.js').default;
  h.handler = async config => config.url === '/auth/refresh' ? { status: 200, data: { token: valid('next'), refreshToken: 'refresh-next' } }
    : { status: config.headers.Authorization === `Bearer ${h.initial}` ? 401 : 200, data: { success: true } };
  const results = await Promise.all(Array.from({ length: 12 }, () => api.get('/tasks')));
  assert.ok(results.every(result => result.success)); assert.equal(h.calls.filter(call => call.url === '/auth/refresh').length, 1);
  assert.equal(await h.authStorage.getToken(), valid('next'));
});
test('second401 stops after one retry and expires only that session', async () => {
  const h = harness(); const api = h.load('src/services/api.js').default; let expired = 0;
  h.manager.subscribeSessionExpired(() => expired++);
  h.handler = async config => config.url === '/auth/refresh' ? { status: 200, data: { token: valid('next'), refreshToken: 'refresh-next' } } : { status: 401, data: { error: 'denied' } };
  await assert.rejects(api.get('/tasks')); assert.equal(h.calls.length, 3); assert.equal(expired, 1); assert.equal(await h.authStorage.getToken(), null);
});
test('login401 neither refreshes nor destroys an existing session', async () => {
  const h = harness(); h.handler = async () => ({ status: 401, data: { error: 'Invalid credentials' } });
  await assert.rejects(h.load('src/services/api.js').default.post('/auth/login', {}));
  assert.equal(await h.authStorage.getToken(), h.initial); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].headers.Authorization, undefined);
});
test('invalid refresh clears credentials and broadcasts once', async () => {
  const h = harness(); let expired = 0; h.manager.subscribeSessionExpired(() => expired++);
  h.handler = async () => ({ status: 401, data: { code: 'refresh_invalid' } });
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => h.manager.refreshAccessToken(h.initial)));
  assert.ok(results.every(result => result.status === 'rejected')); assert.equal(expired, 1); assert.equal(h.calls.length, 1);
});
for (const status of [409, 429, 500, 503]) test(`refresh${status} preserves credentials`, async () => {
  const h = harness(); h.handler = async () => ({ status, data: { code: status === 409 ? 'refresh_retry' : 'unavailable' } });
  await assert.rejects(h.manager.refreshAccessToken(h.initial)); assert.equal(await h.authStorage.getToken(), h.initial);
});
test('network refresh failure preserves session', async () => {
  const h = harness(); h.handler = async () => { throw new Error('offline'); };
  await assert.rejects(h.manager.refreshAccessToken(h.initial)); assert.equal(await h.authStorage.getToken(), h.initial);
});
test('409 accepts the pair written by another web tab without a second refresh', async () => {
  const h = harness({ platform: 'web' });
  h.handler = async () => { setTimeout(() => h.storage.set('taskflow.credentials', JSON.stringify({ token: valid('other-tab'), refreshToken: 'other' })), 30); return { status: 409, data: { code: 'refresh_retry' } }; };
  assert.equal(await h.manager.refreshAccessToken(h.initial), valid('other-tab')); assert.equal(h.calls.length, 1);
});
test('logout during pending refresh cannot resurrect credentials', async () => {
  const h = harness(); const gate = deferred();
  h.handler = async config => config.url === '/auth/refresh' ? gate.promise : { status: 200, data: {} };
  const pending = h.manager.refreshAccessToken(h.initial); await tick();
  await h.manager.logoutSession(); gate.resolve({ status: 200, data: { token: valid('late'), refreshToken: 'late' } });
  await assert.rejects(pending); assert.equal(await h.authStorage.getToken(), null);
  assert.ok(h.calls.some(call => call.url === '/auth/logout'));
});
test('late refresh cannot overwrite new login or clear it on401', async () => {
  for (const status of [200, 401]) {
    const h = harness(); const gate = deferred(); h.handler = async () => gate.promise;
    const pending = h.manager.refreshAccessToken(h.initial); await tick();
    await h.manager.setSession({ token: valid('new-login'), refreshToken: 'new-login' });
    gate.resolve({ status, data: { token: valid('late'), refreshToken: 'late' } });
    await assert.rejects(pending); assert.equal(await h.authStorage.getToken(), valid('new-login'));
  }
});
test('logout clears local state even when network request fails', async () => {
  const h = harness(); h.handler = async () => { throw new Error('offline'); };
  await assert.rejects(h.manager.logoutSession()); assert.equal(await h.authStorage.getToken(), null);
});
test('socket re-reads token on reconnect and rejoins conversations after refresh', async () => {
  const h = harness(); const service = h.load('src/services/socketService.js').default;
  await service.connect(); service.joinConversation('conversation');
  await h.manager.refreshAccessToken(h.initial); await tick(); await tick();
  assert.equal(h.sockets[0].attempts.at(-1).token, valid('next'));
  assert.deepEqual(h.sockets[0].emitted.at(-1), ['join_conversation', 'conversation']); service.disconnect();
});
test('socket expiry refreshes and reconnects without a logout', async () => {
  const h = harness(); const service = h.load('src/services/socketService.js').default;
  await service.connect(); await h.sockets[0].trigger('session_revoked', { code: 'token_expired' }); await until(() => service.connected);
  assert.equal(await h.authStorage.getToken(), valid('next')); assert.equal(service.connected, true); service.disconnect();
});
test('socket auth refresh network failure never becomes a destructive invalid-token logout', async () => {
  const h = harness(); const service = h.load('src/services/socketService.js').default;
  await service.connect();
  const expired = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.sig`;
  await h.authStorage.saveCredentials({ token: expired, refreshToken: 'still-valid' });
  h.handler = async () => { throw new Error('offline'); };
  await new Promise(resolve => h.sockets[0].options.auth(resolve));
  await h.sockets[0].trigger('connect_error', { data: { code: 'invalid_token' } });
  assert.equal(await h.authStorage.getToken(), expired); service.disconnect();
});
test('logout calls server before clearing storage and never clears a newer login', async () => {
  const h = harness(); const gate = deferred();
  h.handler = async () => gate.promise;
  const logout = h.manager.logoutSession(); await tick();
  assert.equal(await h.authStorage.getToken(), h.initial);
  await h.manager.setSession({ token: valid('new-login'), refreshToken: 'new-login' });
  gate.resolve({ status: 200, data: {} }); await logout;
  assert.equal(await h.authStorage.getToken(), valid('new-login'));
});
test('password-change revocation waits for new pair instead of deleting it', async () => {
  const h = harness(); const service = h.load('src/services/socketService.js').default;
  await service.connect(); const gate = deferred();
  const change = h.manager.trackPasswordChange(async () => { await gate.promise; await h.manager.setSession({ token: valid('changed'), refreshToken: 'changed' }); });
  const revoke = h.sockets[0].trigger('session_revoked', { reason: 'password_changed' });
  gate.resolve(); await change; await revoke; await until(() => service.connected);
  assert.equal(await h.authStorage.getToken(), valid('changed')); assert.equal(service.connected, true); service.disconnect();
});
test('file download refreshes401 once and never sends a token in URL', async () => {
  const h = harness(); const service = h.load('src/services/fileService.js');
  assert.equal((await service.downloadAuthenticated('/uploads/test.png?access_token=obsolete', 'file:///cache/test.png')).status, 200);
  assert.equal(h.downloads.length, 2); assert.ok(h.downloads.every(item => !item.url.includes('access_token')));
  assert.equal(h.downloads[1].options.headers.Authorization, `Bearer ${valid('next')}`);
});
test('raw upload fetch shares refresh and preserves request body on retry', async () => {
  const h = harness(); const oldFetch = global.fetch; const requests = []; const body = {};
  global.fetch = async (url, options) => { requests.push({ url, options }); return { status: requests.length === 1 ? 401 : 200 }; };
  try {
    assert.equal((await h.manager.authorizedFetch('http://localhost:3000/api/upload', { method: 'POST', body })).status, 200);
    assert.equal(requests.length, 2); assert.equal(requests[1].options.body, body);
    assert.equal(requests[1].options.headers.Authorization, `Bearer ${valid('next')}`);
  } finally { global.fetch = oldFetch; }
});
