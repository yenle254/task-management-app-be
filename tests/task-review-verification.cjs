// Real Express + Mongoose + lock on a fresh, isolated MongoDB process. No .env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
async function main() {
  const directory = path.resolve(__dirname, '../coverage/task-review-verification', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(path.join(directory, 'mongo'), { recursive: true });
  const port = await freePort(), uri = `mongodb://127.0.0.1:${port}/task_review_verification`;
  const mongo = spawn(process.env.TASK_REVIEW_MONGOD || 'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe',
    ['--dbpath', path.join(directory, 'mongo'), '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { windowsHide: true, stdio: 'ignore' });
  let server; const results = [];
  const check = async (name, action) => { try { await action(); results.push({ name, status: 'PASS' }); console.log('PASS', name); }
    catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.error('FAIL', name, error.message); } };
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    const User = require('../models/user.model'), Team = require('../models/team.model'), Task = require('../models/task.model');
    const Audit = require('../models/audit-log.model'), Notification = require('../models/notification.model');
    const users = [];
    for (const [i, role] of ['employee', 'team_lead', 'hr_manager', 'team_lead', 'system_admin', 'employee'].entries()) users.push(await User.create({
      email: `review${i}@fixture.invalid`, password: 'fixture-password', role, profile: { fullName: `Review User ${i}`, employeeId: `review${i}` }
    }));
    const team = await Team.create({ name: 'Review Team', leaderId: users[1]._id, memberIds: [users[0]._id, users[5]._id] });
    for (const user of users) { user.teamId = team._id; await user.save(); }
    const tokens = users.map(user => require('../config/jwt').generateToken(user._id));
    const express = require('express'), app = express(); app.use(express.json());
    app.get('/api/auth/me', require('../middleware/auth.middleware').protect, (req, res) => res.json({ success: true, data: req.user }));
    app.use('/api/tasks', require('../routes/task.routes'));
    app.use('/api/notifications', require('../routes/notification.routes'));
    app.use('/api/teams', require('../routes/team.routes'));
    app.use('/api/users', require('../routes/user.routes'));
    app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ success: false, error: error.message }));
    server = require('node:http').createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const request = async (actor, method, route, body, expected = 200) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method,
        headers: { Authorization: `Bearer ${tokens[actor]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await response.json(); if (expected !== null) assert.equal(response.status, expected, JSON.stringify(json)); return { status: response.status, ...json };
    };
    const create = (extra = {}) => Task.create({ title: 'Review fixture', status: 'in_progress', assignedBy: users[1]._id, assignedTo: [users[0]._id], teamId: team._id, progress: 100, ...extra });
    let task = await create();
    await check('real submit/reject/resubmit/approve, history, audit, notification recipients', async () => {
      await request(0, 'POST', `/tasks/${task._id}/submit`, { note: 'Ready' });
      await request(0, 'POST', `/tasks/${task._id}/approve`, {}, 403);
      await request(3, 'POST', `/tasks/${task._id}/approve`, {}, 403);
      await request(4, 'POST', `/tasks/${task._id}/approve`, {}, 403);
      await request(1, 'POST', `/tasks/${task._id}/request-changes`, { reason: '  ' }, 400);
      const reason = 'r'.repeat(1000);
      await request(1, 'POST', `/tasks/${task._id}/request-changes`, { reason });
      await request(0, 'POST', `/tasks/${task._id}/submit`, {});
      await request(2, 'POST', `/tasks/${task._id}/approve`, {});
      task = await Task.findById(task._id);
      assert.equal(task.status, 'done'); assert.ok(task.completedAt); assert.equal(task.review.currentRound, 2);
      assert.deepEqual(task.review.rounds.map(e => e.type), ['submitted', 'changes_requested', 'submitted', 'approved']);
      assert.deepEqual(task.statusHistory.map(e => e.to), ['in_progress', 'in_review', 'in_progress', 'in_review', 'done']);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal((await Audit.findOne({ action: 'task.review_rejected', 'target.id': task._id })).reason, reason);
      assert.equal(await Notification.countDocuments({ relatedId: task._id, type: 'task_submitted_for_review' }), 4);
      assert.equal(await Notification.countDocuments({ relatedId: task._id, type: 'task_review_approved' }), 2);
    });
    await check('parallel decisions are serialized by the real database lock', async () => {
      const t = await create(); await request(0, 'POST', `/tasks/${t._id}/submit`, {});
      const decisions = await Promise.all([request(1, 'POST', `/tasks/${t._id}/approve`, {}, null), request(2, 'POST', `/tasks/${t._id}/request-changes`, { reason: 'Redo' }, null)]);
      assert.deepEqual(decisions.map(r => r.status).sort(), [200, 409]);
      const saved = await Task.findById(t._id); assert.equal(saved.review.rounds.length, 2); assert.equal(saved.statusHistory.length, 3);
      assert.equal(await mongoose.connection.collection('task_write_locks').countDocuments({}), 0);
    });
    await check('mutation guards, comment allowed, HR reassignment reset and resubmission', async () => {
      const t = await create(); await request(0, 'POST', `/tasks/${t._id}/submit`, {});
      for (const [method, suffix, body] of [['PUT', '', { title: 'Changed' }], ['PUT', '/progress', { progress: 0 }], ['POST', '/subtasks', { title: 'Changed' }], ['POST', '/checklists', { title: 'Changed' }], ['POST', '/tags', { tags: ['new'] }]]) await request(2, method, `/tasks/${t._id}${suffix}`, body, 409);
      const comment = await request(1, 'POST', `/tasks/${t._id}/comments`, { text: 'Please review' }, 200);
      assert.equal(comment.data.reviewPermissions.canDecide, true);
      assert.equal(comment.data.review.rounds[0].by.profile.fullName, users[0].profile.fullName);
      await request(2, 'PUT', `/tasks/${t._id}`, { teamId: String(team._id), assignedTo: [String(users[0]._id)] });
      assert.equal((await Task.findById(t._id)).status, 'in_review');
      await request(1, 'POST', `/tasks/${t._id}/assign`, { assignedTo: [String(users[5]._id)] }, 403);
      await request(2, 'POST', `/tasks/${t._id}/assign`, { assignedTo: [String(users[5]._id)] });
      const saved = await Task.findById(t._id); assert.equal(saved.status, 'in_progress'); assert.equal(saved.review.rounds.at(-1).type, 'reassigned');
      await request(5, 'POST', `/tasks/${t._id}/submit`, {});
    });
    await check('no completion bypass from progress, subtasks, generic status, or children', async () => {
      const t = await create({ progress: 10, subTasks: [{ title: 'Finish me', isCompleted: false }] });
      await request(0, 'PUT', `/tasks/${t._id}/status`, { status: 'done' }, 400);
      await request(0, 'PUT', `/tasks/${t._id}/progress`, { progress: 100 });
      await request(0, 'PUT', `/tasks/${t._id}/subtasks/${t.subTasks[0]._id}`, {});
      assert.equal((await Task.findById(t._id)).status, 'in_progress');
      const parent = await create(); const child = await create({ parentTaskId: parent._id });
      await request(0, 'POST', `/tasks/${child._id}/submit`, {}); await request(1, 'POST', `/tasks/${child._id}/approve`, {});
      assert.equal((await Task.findById(parent._id)).status, 'in_progress');
    });
    await check('reviewed parent scope locked; dependencies and children gate approval only', async () => {
      const parent = await create(), child = await create({ parentTaskId: parent._id });
      await request(0, 'POST', `/tasks/${parent._id}/submit`, {});
      await request(1, 'POST', `/tasks/${parent._id}/approve`, {}, 400);
      await request(2, 'DELETE', `/tasks/${child._id}`, undefined, 409);
      await request(0, 'POST', `/tasks/${child._id}/submit`, {});
      await request(1, 'PUT', `/tasks/${child._id}/status`, { status: 'done', note: 'Approved through alias' });
      await request(1, 'POST', `/tasks/${parent._id}/approve`, {});
      const dependency = await create(), blocked = await create({ dependencies: [dependency._id] });
      await request(0, 'POST', `/tasks/${blocked._id}/submit`, {});
      await request(1, 'POST', `/tasks/${blocked._id}/approve`, {}, 400);
    });
    await check('HR team change preserves history and resolves the next approver snapshot', async () => {
      const otherTeam = await Team.create({ name: 'Second Review Team', leaderId: users[3]._id, memberIds: [users[5]._id] });
      await User.updateOne({ _id: users[5]._id }, { $set: { teamId: otherTeam._id } });
      const t = await create(); await request(0, 'POST', `/tasks/${t._id}/submit`, {});
      await request(2, 'PUT', `/tasks/${t._id}`, { teamId: String(otherTeam._id), assignedTo: [String(users[5]._id)] });
      const saved = await Task.findById(t._id);
      assert.equal(saved.status, 'in_progress'); assert.equal(saved.review.rounds.at(-1).type, 'reassigned');
      assert.ok(saved.review.approverSnapshot.some(entry => String(entry.userId) === String(users[3]._id)));
      await request(5, 'POST', `/tasks/${t._id}/submit`, {});
      await request(3, 'POST', `/tasks/${t._id}/approve`, {});
      await User.updateOne({ _id: users[5]._id }, { $set: { teamId: team._id } });
    });
    await check('legacy completed tasks remain completed with no invented review rounds', async () => {
      const legacy = await create();
      await Task.collection.updateOne({ _id: legacy._id }, { $set: { status: 'done', completedAt: new Date() }, $unset: { review: '' } });
      const read = await request(0, 'GET', `/tasks/${legacy._id}`);
      assert.equal(read.data.status, 'done'); assert.deepEqual(read.data.review.rounds, []);
      await request(0, 'POST', `/tasks/${legacy._id}/comments`, { text: 'Historical record' });
      assert.equal((await Task.findById(legacy._id)).status, 'done');
    });
    await check('SLA reminders once per round across days, no reminder after approval', async () => {
      const t = await create(); await request(0, 'POST', `/tasks/${t._id}/submit`, {});
      const now = new Date(); await Task.updateOne({ _id: t._id }, { $set: { 'review.submittedAt': new Date(now - 25 * 3600000) } });
      const scheduler = require('../services/reminder-scheduler.service');
      await scheduler.tick(now); await scheduler.tick(new Date(+now + 2 * 86400000));
      assert.equal(await Notification.countDocuments({ relatedId: t._id, type: 'task_review_reminder' }), 2);
      await request(1, 'POST', `/tasks/${t._id}/approve`, {});
      await scheduler.tick(new Date(+now + 3 * 86400000));
      assert.equal(await Notification.countDocuments({ relatedId: t._id, type: 'task_review_reminder' }), 2);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(await Audit.countDocuments({ action: 'task.review_reminder', 'target.id': t._id }), 1);
    });
    await check('approval queue, query validation, self exclusion and snapshot access', async () => {
      await request(0, 'GET', '/tasks/pending-approval', undefined, 403);
      await request(1, 'GET', '/tasks/pending-approval?limit=101', undefined, 400);
      const t = await create(); await request(0, 'POST', `/tasks/${t._id}/submit`, {});
      const own = await create({ assignedTo: [users[1]._id] }); await request(1, 'POST', `/tasks/${own._id}/submit`, {});
      const list = await request(1, 'GET', '/tasks/pending-approval');
      assert.ok(list.data.some(item => item._id === String(t._id))); assert.ok(!list.data.some(item => item._id === String(own._id)));
      const stats = (await request(1, 'GET', '/tasks/pending-approval/stats')).data; assert.equal(stats.pending, list.total);
      assert.equal(stats.byTeam.find(row => row.teamId === String(team._id)).teamName, team.name);
      await Team.updateOne({ _id: team._id }, { $set: { leaderId: users[3]._id } });
      assert.equal((await request(1, 'GET', `/tasks/${t._id}`)).data.reviewPermissions.canDecide, true);
      assert.equal((await request(3, 'GET', `/tasks/${t._id}`)).data.reviewPermissions.canDecide, true);
      await Team.updateOne({ _id: team._id }, { $set: { leaderId: users[1]._id } });
    });
    await check('preferences nested updates and allowlist preserve independent channels', async () => {
      const patch = { categories: { task: { types: { task_submitted_for_review: { inApp: false } } } } };
      const prefs = (await request(1, 'PUT', '/notifications/preferences', patch)).data;
      assert.equal(prefs.categories.task.types.task_submitted_for_review.inApp, false); assert.equal(prefs.categories.task.types.task_submitted_for_review.push, true);
      await request(1, 'PUT', '/notifications/preferences', { categories: { task: { types: { unknown: { push: false } } } } }, 400);
    });
    await check('dashboard review metrics match current database counts', async () => {
      const metrics = await require('../services/employee-dashboard.service').getEmployeeDashboard(users[0]._id);
      assert.equal(metrics.awaitingReviewCount, await Task.countDocuments({ assignedTo: users[0]._id, status: 'in_review' }));
      assert.equal(metrics.submittedByMeCount, await Task.countDocuments({ assignedTo: users[0]._id, status: 'in_review', 'review.submittedBy': users[0]._id }));
      const perf = await require('../services/team-dashboard.service').getTeamPerformance(team);
      assert.equal(perf.taskCounts.inReview, await Task.countDocuments({ teamId: team._id, status: 'in_review' }));
      assert.equal(perf.taskCounts.total, perf.taskCounts.todo + perf.taskCounts.inProgress + perf.taskCounts.inReview + perf.taskCounts.done);
    });
    await check('rollback CLI dry-run preserves all task data', async () => {
      const before = await Task.find().lean();
      const child = spawn(process.execPath, [path.resolve(__dirname, '../scripts/drain-task-review.js')], { windowsHide: true, env: { ...process.env, TASK_REVIEW_MIGRATION_URI: uri }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', data => { output += data; });
      assert.equal(await new Promise(resolve => child.on('exit', resolve)), 0);
      const report = JSON.parse(output); assert.equal(report.mode, 'dry-run'); assert.ok(report.tasks.length > 0);
      assert.deepEqual(await Task.find().lean(), before); fs.writeFileSync(path.join(directory, 'rollback-dry-run.json'), output);
    });
    if (process.argv.includes('--browser')) {
      const browserTask = await create({ title: 'Browser review task', dueDate: new Date(Date.now() + 86400000) });
      await request(0, 'POST', `/tasks/${browserTask._id}/submit`, { note: 'Please verify' });
      const employeeTask = await create({ title: 'Employee browser task' });
      await require('./task-review-browser.cjs')({ apiPort: server.address().port, directory, user: users[1].toObject(), token: tokens[1], taskId: String(browserTask._id),
        employee: { user: users[0].toObject(), token: tokens[0] }, hr: { user: users[2].toObject(), token: tokens[2] }, employeeTaskId: String(employeeTask._id), check });
    }
  } finally {
    fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); mongo.kill();
    console.log('Artifacts:', directory);
  }
  if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

