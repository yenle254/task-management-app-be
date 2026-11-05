// Isolated mongod only. Expo transport is replaced before delivery is initialized.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const mongoose = require('mongoose');
process.env.NODE_ENV = 'test';
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });

async function main() {
  if (process.argv[2] === '--claim') {
    const [uri, userId] = process.argv.slice(3);
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/notification_verification$/);
    await mongoose.connect(uri);
    await require('../services/reminder-scheduler.service').claimAndNotify(userId, 'two_workers', new Date(), 'task_overdue', 'Fixture', 'Fixture');
    await mongoose.disconnect(); return;
  }
  const directory = path.resolve(__dirname, '../coverage/notification-verification', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(path.join(directory, 'mongo'), { recursive: true });
  const port = await freePort(), uri = `mongodb://127.0.0.1:${port}/notification_verification`;
  const mongod = spawn(process.env.NOTIFICATION_MONGOD || 'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe',
    ['--dbpath', path.join(directory, 'mongo'), '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { windowsHide: true, stdio: 'ignore' });
  let io, server; const sockets = [], results = [];
  const check = async (name, run) => { try { await run(); results.push({ name, status: 'PASS' }); console.log('PASS', name); }
    catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.error('FAIL', name, error.message); } };
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    assert.equal(mongoose.connection.name, 'notification_verification');
    const User = require('../models/user.model'), Notification = require('../models/notification.model');
    const Task = require('../models/task.model'), Leave = require('../models/leave.model'), Attendance = require('../models/attendance.model');
    const users = [], tokens = [];
    process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
    process.env.EXPO_ACCESS_TOKEN = 'fixture-never-sent';
    const pushes = [];
    require('axios').post = async (...args) => { pushes.push(args); return { data: { data: { status: 'ok', id: 'fixture' } } }; };
    for (const role of ['employee', 'team_lead', 'hr_manager', 'system_admin']) {
      const user = await User.create({ email: `${role}@notification.invalid`, password: 'fixture-password', role, profile: { fullName: `Fixture ${role}`, employeeId: role } });
      users.push(user); tokens.push(require('jsonwebtoken').sign({ id: String(user._id) }, process.env.JWT_SECRET));
    }
    const express = require('express'), app = express(); app.use(express.json());
    app.get('/api/auth/me', require('../middleware/auth.middleware').protect, (req, res) => res.json({ success: true, data: req.user }));
    app.use('/api/notifications', require('../routes/notification.routes'));
    server = require('node:http').createServer(app); io = new (require('socket.io').Server)(server);
    require('../utils/socket-handler.utils')(io);
    const notifications = require('../services/notification.service'); notifications.initDelivery(io);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (index, method, suffix, body, status = 200) => {
      const response = await fetch(base + '/api/notifications' + suffix, { method, headers: { Authorization: `Bearer ${tokens[index] || 'invalid'}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const json = await response.json(); assert.equal(response.status, status, JSON.stringify(json)); return json;
    };
    await check('authenticated self-only preferences/token API across all four roles', async () => {
      await request(-1, 'GET', '/preferences', null, 401);
      for (let i = 0; i < 4; i++) {
        const prefs = (await request(i, 'GET', '/preferences')).data; assert.equal(prefs.master, true);
        await request(i, 'POST', '/push-token', { token: `ExpoPushToken[fixture_${i}]`, platform: 'android' });
        await request(i, 'POST', '/push-token', { token: `ExpoPushToken[fixture_${i}]`, platform: 'android' });
        await request(i, 'PUT', '/preferences', { categories: { task: { inApp: false } } });
        const changed = (await request(i, 'GET', '/preferences')).data;
        assert.equal(changed.categories.task.inApp, false); assert.equal(changed.categories.leave.push, true);
        await request(i, 'PUT', '/preferences', { categories: { task: { inApp: true } } });
      }
      await request(0, 'POST', '/push-token', { token: 'invalid', platform: 'android' }, 400);
      await request(0, 'POST', '/push-token', { token: 'ExpoPushToken[fixture]', platform: ['android'] }, 400);
      await request(0, 'POST', '/push-token', { token: 'ExpoPushToken[fixture]', platform: 'android', userId: String(users[1]._id) }, 400);
      for (const body of [{ reminders: {} }, { pushToken: 'x' }, { master: 'false' }, { categories: { other: {} } }, { reminderTimes: { clockIn: '25:00' } }]) await request(0, 'PUT', '/preferences', body, 400);
      await request(0, 'PUT', '/preferences', { reminderTimes: { clockIn: '07:45', clockOut: null } });
      await request(0, 'DELETE', '/push-token'); await request(0, 'DELETE', '/push-token');
      assert.equal((await User.findById(users[1]._id).select('+pushToken')).pushToken, 'ExpoPushToken[fixture_1]');
    });
    await check('legacy user defaults and hidden internal/token fields', async () => {
      const id = new mongoose.Types.ObjectId();
      await User.collection.insertOne({ _id: id, email: 'legacy@notification.invalid', role: 'employee', isActive: true });
      const hydrated = await User.findById(id); assert.equal(hydrated.notificationPreferences.master, true); assert.equal(hydrated.pushToken, undefined);
      assert.equal((await User.findById(users[1]._id).lean()).reminders, undefined);
      await User.deleteOne({ _id: id });
    });
    await check('real socket delivery, multiple connections, offline push and preference gates', async () => {
      const socketClient = require('../../project/node_modules/socket.io-client').io;
      const connect = async () => { const socket = socketClient(base, { auth: { token: tokens[1] }, transports: ['websocket'], reconnection: false }); sockets.push(socket); await once(socket, 'connect'); return socket; };
      const first = await connect(), second = await connect(); let received = 0;
      second.on('notification_created', () => received++);
      const event = once(second, 'notification_created');
      await notifications.createNotification(users[1]._id, 'task_assigned', 'Fixture', 'Fixture'); await event;
      assert.equal(received, 1); assert.equal(pushes.length, 0);
      first.disconnect(); await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(require('../utils/socket-handler.utils').isUserOnline(users[1]._id), true);
      second.disconnect(); await new Promise(resolve => setTimeout(resolve, 50));
      await notifications.createNotification(users[1]._id, 'task_overdue', 'Fixture', 'Fixture'); assert.equal(pushes.length, 1);
      await request(1, 'PUT', '/preferences', { master: false });
      const before = await Notification.countDocuments(); await notifications.createNotification(users[1]._id, 'task_overdue', 'Fixture', 'Fixture');
      assert.equal(pushes.length, 1); assert.equal(await Notification.countDocuments(), before + 1);
    });
    await check('existing seven endpoints, unread boolean and new type population', async () => {
      const task = new mongoose.Types.ObjectId(); await Task.collection.insertOne({ _id: task, title: 'Fixture related task' });
      const leave = new mongoose.Types.ObjectId(); await Leave.collection.insertOne({ _id: leave });
      const n = await notifications.createNotification(users[0]._id, 'task_overdue', 'Fixture', 'Fixture', task);
      await notifications.createNotification(users[0]._id, 'leave_starting', 'Fixture', 'Fixture', leave);
      await notifications.createNotification(users[0]._id, 'attendance_reminder', 'Fixture', 'Fixture');
      assert.equal((await request(0, 'GET', '/type/task_overdue')).data[0].relatedId.title, 'Fixture related task');
      assert.equal((await request(0, 'GET', '/type/leave_starting')).data[0].relatedId._id, String(leave));
      assert.equal((await request(0, 'GET', '/type/attendance_reminder')).data[0].relatedId, null);
      await request(1, 'PUT', `/${n._id}/read`, {}, 403); await request(1, 'DELETE', `/${n._id}`, null, 403);
      await request(0, 'PUT', `/${n._id}/read`, {});
      assert.equal((await request(0, 'GET', '/?unreadOnly=true')).total, 2);
      assert.equal((await request(0, 'GET', '/unread/count')).data.unreadCount, 2);
      await request(0, 'PUT', '/read-all', {}); assert.equal((await request(0, 'GET', '/unread/count')).data.unreadCount, 0);
      await request(0, 'DELETE', `/${n._id}`); await request(0, 'DELETE', ''); assert.equal((await request(0, 'GET', '')).total, 0);
      await Task.deleteOne({ _id: task }); await Leave.deleteOne({ _id: leave });
    });
    await check('two independent workers claim exactly one reminder in MongoDB', async () => {
      const run = () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename, '--claim', uri, String(users[0]._id)], { windowsHide: true, stdio: 'pipe', env: { ...process.env, EXPO_ACCESS_TOKEN: '' } });
        let output = ''; child.stderr.on('data', data => { output += data; }); child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(Error(output)));
      });
      await Promise.all([run(), run()]); assert.equal(await Notification.countDocuments({ userId: users[0]._id }), 1);
    });
    await check('scheduler real queries: attendance leave exclusion, due/overdue bounds, dedup and prune', async () => {
      const now = new Date(2026, 9, 26, 8, 30), DAY = 86400000;
      await User.updateMany({}, { $set: { 'notificationPreferences.reminderTimes.clockIn': null, 'notificationPreferences.master': false } });
      await User.updateOne({ _id: users[0]._id }, { $set: { 'reminders.expired': { firedAt: new Date(now.getTime() - 9 * DAY), refKey: 'fixture' } } });
      await Leave.collection.insertMany([{ userId: users[0]._id, status: 'approved', startDate: new Date(2026, 9, 26), endDate: new Date(2026, 9, 27) },
        { userId: users[2]._id, status: 'approved', startDate: new Date(now.getTime() + DAY), endDate: new Date(now.getTime() + DAY * 2) }]);
      await Attendance.collection.insertOne({ userId: users[1]._id, date: new Date(2026, 9, 26), clockIn: now });
      const tasks = [1, -1, -8].map(days => ({ title: 'Fixture', status: 'todo', dueDate: new Date(now.getTime() + days * DAY), assignedTo: [users[0]._id] }));
      tasks.push({ ...tasks[0], status: 'done' }); await Task.collection.insertMany(tasks);
      const scheduler = require('../services/reminder-scheduler.service'); await scheduler.tick(now); await scheduler.tick(now);
      assert.equal(await Notification.countDocuments({ userId: users[0]._id, type: 'attendance_reminder' }), 0);
      assert.equal(await Notification.countDocuments({ userId: users[2]._id, type: 'attendance_reminder' }), 1);
      assert.equal(await Notification.countDocuments({ userId: users[3]._id, type: 'attendance_reminder' }), 0);
      assert.equal(await Notification.countDocuments({ type: 'deadline_reminder' }), 1);
      // Three old task_overdue docs belong to earlier delivery/worker checks; only one scheduler overdue is new.
      assert.equal(await Notification.countDocuments({ type: 'task_overdue', relatedId: { $ne: null } }), 1);
      assert.equal(await Notification.countDocuments({ type: 'leave_starting' }), 1);
      assert.equal((await User.findById(users[0]._id).select('+reminders')).reminders.has('expired'), false);
      await scheduler.tick(new Date(2026, 9, 26, 17, 30));
      assert.equal(await Notification.countDocuments({ userId: users[1]._id, type: 'attendance_reminder' }), 1);
    });
    await check('notification compound indexes exist in the fixture database', async () => {
      await Notification.init(); const indexes = await Notification.collection.indexes();
      fs.writeFileSync(path.join(directory, 'indexes.json'), JSON.stringify(indexes, null, 2));
      for (const key of [{ userId: 1, isRead: 1 }, { userId: 1, createdAt: -1 }, { userId: 1, type: 1 }]) assert.ok(indexes.some(index => JSON.stringify(index.key) === JSON.stringify(key)));
    });
    if (process.argv.includes('--browser')) {
      await User.updateOne({ _id: users[0]._id }, { $set: { 'notificationPreferences.master': true } });
      await require('./notification-browser-verification.cjs')({ apiPort: server.address().port, directory,
        user: { _id: String(users[0]._id), role: 'employee', email: users[0].email, profile: users[0].profile }, token: tokens[0], check });
    }
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (io) await new Promise(resolve => io.close(resolve));
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    mongod.kill(); await once(mongod, 'exit').catch(() => {});
    fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
    console.log('Evidence:', directory);
  }
  if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
