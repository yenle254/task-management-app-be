// Dedicated temporary MongoDB process, real HTTP/Socket.IO/browser. Never loads .env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const output = path.resolve(__dirname, '../report/auth-live');
const temporary = path.join(output, `mongo-${process.pid}-${Date.now()}`);
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const event = (socket, name) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
  socket.once(name, value => { clearTimeout(timeout); resolve(value); });
});
async function main() {
  fs.mkdirSync(temporary, { recursive: true });
  const port = await freePort();
  const mongo = spawn('C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe',
    ['--dbpath', temporary, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { windowsHide: true, stdio: 'ignore' });
  const exited = new Promise(resolve => mongo.once('exit', resolve));
  let io, stop, browser; const clients = [], results = [];
  const check = async (name, action) => { await action(); results.push({ name, status: 'PASS' }); console.log('PASS', name); };
  try {
    await mongoose.connect(`mongodb://127.0.0.1:${port}/auth_isolated_verification`, { serverSelectionTimeoutMS: 15000 });
    const User = require('../models/user.model');
    const Session = require('../models/refresh-session.model');
    const Audit = require('../models/audit-log.model');
    const tokens = require('../services/token.service');
    const sessions = require('../services/session.service');
    const jwt = require('jsonwebtoken');
    const { hashPassword } = require('../services/auth.service');
    require('../services/email.service').sendResetPasswordEmail = async () => {}; // no outbound email
    await Promise.all([User.init(), Session.init(), Audit.init()]);
    const user = await User.create({ email: 'auth@fixture.invalid', password: await hashPassword('FixturePassword123!'),
      profile: { fullName: 'Fixture User', employeeId: 'AUTH01' }, resetPassword: { otp: '123456', resetToken: 'never-expose' } });
    const express = require('express'), app = express(); app.use(express.json());
    let refreshCount = 0;
    app.use('/api/auth/refresh', (_req, _res, next) => { refreshCount++; next(); });
    app.use('/api/auth', require('../routes/auth.routes'));
    const { protect } = require('../middleware/auth.middleware');
    app.get('/api/protected', protect, (_req, res) => res.json({ success: true }));
    app.get('/uploads/fixture.png', protect, (_req, res) => res.type('png').send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=', 'base64')));
    const server = require('node:http').createServer(app);
    io = new (require('socket.io').Server)(server);
    app.set('io', io); stop = require('../utils/socket-handler.utils')(io);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const call = async (route, body, token, method = body === undefined ? 'GET' : 'POST') => {
      const res = await fetch(`${origin}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    const login = async (password = 'FixturePassword123!') => { const res = await call('/auth/login', { email: user.email, password }); assert.equal(res.status, 200); return res.body; };
    let first, other;
    await check('real Mongo indexes, hidden reset data, hashed-only session and 15m JWT', async () => {
      first = await login(); other = await login();
      assert.ok(first.token && first.refreshToken && first.user);
      assert.equal(first.user.resetPassword, undefined); assert.equal(first.user.password, undefined); assert.equal(first.user.tokenVersion, undefined);
      const row = await Session.collection.findOne({ sessionId: jwt.decode(first.token).sid });
      assert.equal(row.tokenHash, tokens.hashRefreshToken(first.refreshToken)); assert.ok(!JSON.stringify(row).includes(first.refreshToken));
      assert.equal(jwt.decode(first.token).exp - jwt.decode(first.token).iat, 900);
      assert.ok((await Session.collection.indexes()).some(index => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
      assert.equal((await User.findById(user._id)).resetPassword, undefined);
    });
    await check('me/profile retain data contract and never expose recovery credentials', async () => {
      const me = await call('/auth/me', undefined, first.token);
      assert.equal(me.status, 200); assert.equal(me.body.data.email, user.email);
      assert.equal(me.body.data.resetPassword, undefined); assert.equal(me.body.data.tokenVersion, undefined);
      const profile = await call('/auth/profile', { fullName: 'Updated Fixture User' }, first.token, 'PUT');
      assert.equal(profile.status, 200); assert.equal(profile.body.data.profile.fullName, 'Updated Fixture User');
      assert.equal(profile.body.data.resetPassword, undefined);
    });
    await check('real atomic Mongo rotation: 12 requests, one200 and eleven409, next rotation succeeds', async () => {
      const replies = await Promise.all(Array.from({ length: 12 }, () => call('/auth/refresh', { refreshToken: first.refreshToken })));
      assert.equal(replies.filter(result => result.status === 200).length, 1);
      assert.equal(replies.filter(result => result.status === 409).length, 11);
      const winner = replies.find(result => result.status === 200).body;
      assert.equal((await call('/auth/refresh', { refreshToken: winner.refreshToken })).status, 200);
      assert.equal((await User.findById(user._id).select('+tokenVersion')).tokenVersion, 0);
    });
    await check('oldest refresh replay outside grace revokes all devices and records critical audit', async () => {
      await Session.updateOne({ sessionId: jwt.decode(first.token).sid }, { $set: { 'usedTokens.0.validUntil': new Date(0) } });
      assert.equal((await call('/auth/refresh', { refreshToken: first.refreshToken })).body.code, 'token_reuse');
      assert.equal((await call('/protected', undefined, other.token)).status, 401);
      assert.equal(await Session.countDocuments({ userId: user._id, revokedAt: null }), 0);
      for (let i = 0; i < 30 && !await Audit.exists({ action: 'security.token_reuse_detected' }); i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal((await Audit.findOne({ action: 'security.token_reuse_detected' })).severity, 'critical');
    });
    const socketClient = require('../../project/node_modules/socket.io-client').io;
    const connect = async pair => { const socket = socketClient(origin, { autoConnect: false, auth: { token: pair.token }, transports: ['websocket'], forceNew: true, reconnection: false }); clients.push(socket); const ready = event(socket, 'connect'); socket.connect(); await ready; return socket; };
    await check('real sockets: single-device logout disconnects only matching sid, other HTTP/socket stays usable', async () => {
      first = await login(); other = await login(); const a = await connect(first), b = await connect(other);
      const revoked = event(a, 'session_revoked');
      assert.equal((await call('/auth/logout', { refreshToken: first.refreshToken })).status, 200);
      assert.equal((await revoked).reason, 'logout'); assert.equal(b.connected, true);
      assert.equal((await call('/protected', undefined, first.token)).status, 401);
      assert.equal((await call('/protected', undefined, other.token)).status, 200);
    });
    await check('real password change revokes old access/refresh/socket and replacement pair works', async () => {
      const b = clients.at(-1), revoked = event(b, 'session_revoked');
      const changed = await call('/auth/password', { oldPassword: 'FixturePassword123!', newPassword: 'ChangedPassword123!' }, other.token, 'PUT');
      assert.equal(changed.status, 200); assert.equal((await revoked).reason, 'password_changed');
      assert.equal((await call('/protected', undefined, other.token)).status, 401);
      assert.equal((await call('/auth/refresh', { refreshToken: other.refreshToken })).status, 401);
      assert.equal((await call('/protected', undefined, changed.body.token)).status, 200);
    });
    await check('real forgot/verify/reset consumes reset token once and invalidates active sessions', async () => {
      const pair = await login('ChangedPassword123!');
      assert.equal((await call('/auth/forgot-password', { email: user.email })).status, 200);
      const record = await User.findById(user._id).select('+resetPassword');
      const verified = await call('/auth/verify-otp', { email: user.email, otp: record.resetPassword.otp }); assert.equal(verified.status, 200);
      const body = { email: user.email, resetToken: verified.body.data.resetToken, newPassword: 'FixturePassword123!' };
      const replies = await Promise.all([call('/auth/reset-password', body), call('/auth/reset-password', body)]);
      assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 400]);
      assert.equal((await call('/protected', undefined, pair.token)).status, 401);
    });
    await check('deactivate then reactivate cannot resurrect either credential', async () => {
      const pair = await login();
      await require('../services/user.service').deleteUser(user._id);
      await User.updateOne({ _id: user._id }, { $set: { isActive: true } });
      assert.equal((await call('/protected', undefined, pair.token)).status, 401);
      assert.equal((await call('/auth/refresh', { refreshToken: pair.refreshToken })).status, 401);
    });
    // Browser bundle uses actual frontend modules with browser storage adapters; no mock HTTP/socket.
    const frontend = path.resolve(__dirname, '../../project');
    const babel = require(path.join(frontend, 'node_modules/@babel/core'));
    const files = ['services/api', 'services/authService', 'services/tokenManager', 'services/socketService', 'services/fileService', 'utils/authStorage', 'utils/fileUrlHelper'];
    const factories = files.map(file => {
      const code = babel.transformSync(fs.readFileSync(path.join(frontend, `src/${file}.js`), 'utf8'), { babelrc: false, configFile: false, plugins: [path.join(frontend, 'node_modules/@babel/plugin-transform-modules-commonjs')] }).code;
      return `${JSON.stringify('/src/' + file + '.js')}: function(require,module,exports){${code}\n}`;
    }).join(',');
    app.get('/fixture', (_req, res) => res.type('html').send('<html><body><h1>Auth lifecycle verification</h1><img id="preview"><script src="/axios.js"></script><script src="/socket.io/socket.io.js"></script><script src="/fixture.js"></script></body></html>'));
    app.get('/axios.js', (_req, res) => res.sendFile(path.join(frontend, 'node_modules/axios/dist/axios.min.js')));
    app.get('/fixture.js', (_req, res) => res.type('js').send(`
      const factories={${factories}}, cache={};
      function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
        const require=name=>{
          if(name==='axios')return window.axios;
          if(name==='socket.io-client')return {io:window.io};
          if(name==='react-native')return {Platform:{OS:'web'}};
          if(name==='expo-secure-store'||name==='expo-file-system/legacy')return {};
          if(name==='@react-native-async-storage/async-storage')return {getItem:async k=>localStorage.getItem(k),setItem:async(k,v)=>localStorage.setItem(k,v),removeItem:async k=>localStorage.removeItem(k),multiRemove:async keys=>keys.forEach(k=>localStorage.removeItem(k))};
          if(name.endsWith('api.config'))return {BASE_URL:location.origin+'/api',API_URL:location.origin+'/api',TIMEOUT:5000};
          const parts=id.split('/').slice(0,-1); for(const p of name.split('/')){if(p==='..')parts.pop();else if(p!=='.')parts.push(p);}return load(parts.join('/')+'.js');
        };factories[id](require,module,module.exports);return module.exports;
      }
      window.process={env:{}}; window.auth=load('/src/services/authService.js').default;
      window.manager=load('/src/services/tokenManager.js'); window.api=load('/src/services/api.js').default;
      window.socketService=load('/src/services/socketService.js').default; window.files=load('/src/services/fileService.js');
    `));
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    const requestUrls = []; page.on('request', req => requestUrls.push(req.url()));
    await page.goto(origin + '/fixture');
    await check('real browser frontend: login, concurrent expired access recovery, private blob preview', async () => {
      await page.evaluate(() => auth.login('auth@fixture.invalid', 'FixturePassword123!'));
      const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('taskflow.credentials')));
      const decoded = jwt.decode(saved.token); const expired = jwt.sign({ ...decoded, iat: 1, exp: 2 }, process.env.JWT_SECRET);
      await page.evaluate(({ expired, refreshToken }) => manager.setSession({ token: expired, refreshToken }), { expired, refreshToken: saved.refreshToken });
      const before = refreshCount;
      assert.equal(await page.evaluate(async () => (await Promise.all(Array.from({ length: 10 }, () => api.get('/protected')))).every(result => result.success)), true);
      assert.equal(refreshCount - before, 1);
      await page.evaluate(async () => { document.querySelector('#preview').src = await files.getPreviewUrl('/uploads/fixture.png'); });
      await page.waitForFunction(() => document.querySelector('#preview').naturalWidth === 1);
      assert.ok(requestUrls.every(url => !url.includes('access_token') && !url.includes('refreshToken')));
      await page.screenshot({ path: path.join(output, 'browser.png') });
    });
    await check('real browser socket expiry refresh/reconnect, password change stays signed in, logout clears storage', async () => {
      await page.evaluate(() => socketService.connect());
      const browserId = await page.evaluate(() => socketService.socket.id);
      io.sockets.sockets.get(browserId).data.expiresAt = Date.now() - 1;
      await require('../utils/socket-handler.utils').revalidateSessions(io);
      await page.waitForFunction(old => socketService.connected && socketService.socket.id !== old, browserId);
      await page.evaluate(() => auth.changePassword('FixturePassword123!', 'BrowserPassword123!'));
      await page.waitForFunction(() => socketService.connected);
      assert.equal(await page.evaluate(async () => (await api.get('/protected')).success), true);
      await page.evaluate(async () => { socketService.disconnect(); await auth.logout(); });
      assert.equal(await page.evaluate(() => localStorage.getItem('taskflow.credentials')), null);
    });
  } finally {
    if (browser) await browser.close(); clients.forEach(socket => socket.disconnect()); stop?.();
    if (io) await new Promise(resolve => io.close(resolve));
    await mongoose.disconnect(); mongo.kill(); await exited;
    // Delete only the unique directory created by this run, after the isolated process exits.
    if (path.dirname(path.resolve(temporary)) !== output || !path.basename(temporary).startsWith('mongo-')) throw new Error('Unsafe fixture cleanup path');
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
