// Own mongod/dbpath and HTTP workers only. No .env, seed, or business database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function main() {
    const directory = path.join(root, 'coverage/leave-verification', new Date().toISOString().replace(/[:.]/g, '-'));
    const dbpath = path.join(directory, 'mongo'); fs.mkdirSync(dbpath, { recursive: true });
    const ports = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
    const uri = `mongodb://127.0.0.1:${ports[0]}/leave_verification`;
    const children = [], logs = [], results = [];
    const start = (cmd, args, options = {}) => {
        const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); children.push(child);
        child.on('error', error => logs.push(error.message));
        child.stdout.on('data', data => logs.push(data.toString())); child.stderr.on('data', data => logs.push(data.toString())); return child;
    };
    const check = async (name, run) => { try { await run(); results.push({ name, status: 'PASS' }); console.log('PASS', name); }
        catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.error('FAIL', name, error.message); } };
    try {
        start(process.env.LEAVE_MONGOD || 'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe', ['--dbpath', dbpath, '--port', String(ports[0]), '--bind_ip', '127.0.0.1', '--quiet']);
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
        assert.equal(mongoose.connection.name, 'leave_verification');
        const User = require('../models/user.model'), Team = require('../models/team.model'), Leave = require('../models/leave.model');
        const Notification = require('../models/notification.model');
        const workflow = require('../services/leave-workflow.service');
        const helpers = require('../services/leave.service');
        const { migrate } = require('../migrations/002_leave_workflow');
        const teamA = new mongoose.Types.ObjectId(), teamB = new mongoose.Types.ObjectId();
        const users = {}, tokens = {}, secret = crypto.randomBytes(32).toString('hex');
        const password = crypto.randomBytes(20).toString('hex'), hash = await require('bcryptjs').hash(password, 4);
        for (const [name, role, teamId] of [['employee','employee',teamA],['peer','employee',teamA],['outsider','employee',teamB],['lead','team_lead',teamA],['otherLead','team_lead',teamB],['hr','hr_manager',null],['hr2','hr_manager',null],['admin','system_admin',null]]) {
            users[name] = await User.create({ email: `${name.toLowerCase()}@leave.invalid`, password: hash, role, teamId,
                profile: { fullName: `Leave ${name}`, employeeId: name } });
            tokens[name] = require('jsonwebtoken').sign({ id: String(users[name]._id) }, secret, { expiresIn: '1h' });
        }
        await Team.create([{ _id: teamA, name: 'Leave A', leaderId: users.lead._id }, { _id: teamB, name: 'Leave B', leaderId: users.otherLead._id }]);
        await Leave.init();
        const worker = (port, crash = false) => start(process.execPath, ['tests/leave-fixture-worker.cjs'], { cwd: root,
            env: { ...process.env, MONGO_URL: uri, PORT: String(port), JWT_SECRET: secret, NODE_ENV: 'test', LEAVE_TEST_CRASH: crash ? '1' : '0' } });
        worker(ports[1]); worker(ports[2]); worker(ports[3], true);
        for (const port of ports.slice(1)) {
            let ready = false;
            for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break; } } catch {} await delay(150); }
            assert.ok(ready, 'Fixture worker ready');
        }
        const request = async (name, method, suffix, body, expected = 200, workerIndex = 1) => {
            const res = await fetch(`http://127.0.0.1:${ports[workerIndex]}/api/leaves${suffix}`, { method,
                headers: { Authorization: `Bearer ${tokens[name] || 'invalid'}`, 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
            const json = await res.json(); if (expected !== null) assert.equal(res.status, expected, JSON.stringify(json));
            return { code: res.status, ...json };
        };
        const day = offset => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toISOString(); };
        const data = (days = 1, extra = {}) => ({ type: 'vacation', startDate: day(10), endDate: day(9 + days), reason: 'Fixture leave', ...extra });
        const year = new Date(day(10)).getFullYear();
        const create = async (name = 'employee', days = 1, extra = {}) => (await request(name, 'POST', '', data(days, extra), 201)).data;
        const balance = name => helpers.getLeaveBalance(users[name]._id, year);
        const setBalance = (name, remaining = 12) => User.updateOne({ _id: users[name]._id }, { $set: { [`leaveBalance.${year}`]: { total: 12, used: 12 - remaining, remaining } } });
        await check('MongoDB indexes and six-state model', async () => {
            const indexes = await Leave.collection.indexes(); fs.writeFileSync(path.join(directory, 'indexes.json'), JSON.stringify(indexes, null, 2));
            assert.ok(indexes.some(index => index.key.currentStep === 1)); assert.ok(indexes.some(index => index.key.revision === 1));
            assert.ok(indexes.some(index => index.unique && index.key.idempotencyKey === 1));
        });
        await check('authentication, invalid input and role boundaries', async () => {
            await request('none', 'GET', '/my', null, 401);
            tokens.expired = require('jsonwebtoken').sign({ id: String(users.employee._id) }, secret, { expiresIn: -1 });
            await request('expired', 'GET', '/my', null, 401);
            for (const who of ['employee', 'admin']) { await request(who, 'GET', '/pending', null, 403); await request(who, 'GET', '', null, 403); }
            await request('employee', 'POST', '', data(31), 400);
            await request('employee', 'POST', '', data(1, { draft: 'false' }), 400);
            await request('employee', 'GET', '/my?limit=101', null, 400);
            await request('lead', 'GET', '/pending?step=wrong', null, 400);
            await request('employee', 'PUT', '/invalid/approve', {}, 403);
            await request('hr', 'PUT', '/invalid/approve', {}, 400);
        });
        await check('draft private, no balance check/notification; submit replay and create idempotency', async () => {
            await setBalance('peer', 0);
            const draft = await create('peer', 3, { draft: true, idempotencyKey: 'fixture-draft-retry' });
            assert.equal(draft.status, 'draft'); assert.equal(await Notification.countDocuments({ relatedId: draft._id }), 0);
            assert.equal((await create('peer', 3, { draft: true, idempotencyKey: 'fixture-draft-retry' }))._id, draft._id);
            await request('hr', 'GET', `/${draft._id}`, null, 403);
            await request('hr', 'DELETE', `/${draft._id}`, {}, 403);
            await request('peer', 'POST', `/${draft._id}/submit`, { revision: 0 }, 400);
            await setBalance('peer');
            const submitted = await request('peer', 'POST', `/${draft._id}/submit`, { revision: 0 });
            assert.equal(submitted.data.status, 'pending_team_lead');
            await request('peer', 'POST', `/${draft._id}/submit`, { revision: 0 }, 409);
            assert.equal((await balance('peer')).used, 0);
        });
        await check('TL then HR, revision/edit rules, history, per-step recipients and refund once', async () => {
            await setBalance('employee'); const leave = await create();
            const notices = await Notification.find({ relatedId: leave._id }).lean();
            assert.deepEqual(notices.map(n => String(n.userId)), [String(users.lead._id)]);
            await request('outsider', 'GET', `/${leave._id}`, null, 403);
            await request('otherLead', 'PUT', `/${leave._id}/approve`, { revision: 0 }, 403);
            await request('peer', 'PUT', `/${leave._id}/edit`, { reason: 'Forged' }, 403);
            const edited = (await request('employee', 'PUT', `/${leave._id}/edit`, { reason: 'Changed', revision: 0 })).data;
            assert.equal(edited.revision, 1);
            await request('lead', 'PUT', `/${leave._id}/approve`, { revision: 0 }, 409);
            const step = (await request('lead', 'PUT', `/${leave._id}/approve`, { revision: 1 })).data;
            assert.equal(step.status, 'pending_hr'); assert.equal((await balance('employee')).used, 0);
            assert.ok(!(await request('lead', 'GET', '/pending')).data.some(l => l._id === leave._id));
            const hrNotices = await Notification.find({ relatedId: leave._id, userId: { $in: [users.hr._id, users.hr2._id] } }).lean();
            assert.equal(hrNotices.length, 2);
            await request('lead', 'PUT', `/${leave._id}/approve`, { revision: step.revision }, 403);
            await request('employee', 'PUT', `/${leave._id}/edit`, { reason: 'Too late', revision: step.revision }, 400);
            const approved = (await request('hr', 'PUT', `/${leave._id}/approve`, { revision: step.revision })).data;
            assert.equal(approved.status, 'approved'); assert.equal((await balance('employee')).used, 1);
            await request('hr2', 'PUT', `/${leave._id}/approve`, {}, 400);
            const cancelled = (await request('employee', 'DELETE', `/${leave._id}`, { revision: approved.revision })).data;
            assert.equal(cancelled.status, 'cancelled'); assert.equal((await balance('employee')).used, 0);
            await request('employee', 'DELETE', `/${leave._id}`, {}, 400);
            assert.ok(cancelled.history.some(h => h.action === 'balance_refunded')); assert.equal(await Leave.countDocuments({ _id: leave._id }), 1);
        });
        await check('HR override, self-approval denied, HR/TL own submission and admin blocked', async () => {
            const leadLeave = await create('lead'); assert.equal(leadLeave.status, 'pending_hr');
            await request('lead', 'PUT', `/${leadLeave._id}/approve`, {}, 403);
            const hrLeave = await create('hr'); assert.equal(hrLeave.status, 'pending_hr');
            await request('hr', 'PUT', `/${hrLeave._id}/approve`, {}, 403);
            await request('admin', 'PUT', `/${hrLeave._id}/approve`, {}, 403);
            await request('hr2', 'PUT', `/${hrLeave._id}/approve`, {});
            await request('admin', 'POST', '', data(), 409);
            const leave = await create();
            const rejected = (await request('hr', 'PUT', `/${leave._id}/reject`, {})).data;
            assert.equal(rejected.status, 'rejected'); assert.equal(rejected.rejectionReason, 'No reason provided');
            await request('employee', 'POST', `/${leave._id}/submit`, {}, 400);
            const direct = await create();
            assert.equal((await request('hr', 'PUT', `/${direct._id}/approve`, {})).data.status, 'approved');
        });
        await check('missing/inactive/moved leader routes HR; historical snapshot not reassigned', async () => {
            await User.updateOne({ _id: users.lead._id }, { $set: { isActive: false } });
            assert.equal((await create()).status, 'pending_hr');
            await User.updateOne({ _id: users.lead._id }, { $set: { isActive: true } });
            const leave = await create();
            await User.updateOne({ _id: users.lead._id }, { $set: { teamId: teamB } });
            await request('lead', 'PUT', `/${leave._id}/approve`, {}, 403);
            await request('hr', 'PUT', `/${leave._id}/reject`, {});
            assert.equal(String((await Leave.findById(leave._id)).approverSnapshot[0].userId), String(users.lead._id));
            await User.updateOne({ _id: users.lead._id }, { $set: { teamId: teamA } });
            await User.updateOne({ _id: users.peer._id }, { $set: { teamId: null } });
            assert.equal((await create('peer')).status, 'pending_hr');
            await User.updateOne({ _id: users.peer._id }, { $set: { teamId: teamA } });
        });
        await check('two workers: competing decisions, approve/cancel, duplicate cancel and balance exhaustion', async () => {
            await setBalance('employee');
            let leave = await create();
            let replies = await Promise.all([request('hr','PUT',`/${leave._id}/approve`,{revision:0},null,1),request('hr2','PUT',`/${leave._id}/approve`,{revision:0},null,2)]);
            assert.equal(replies.filter(r => r.code === 200).length, 1); assert.equal((await balance('employee')).used, 1);
            replies = await Promise.all([request('employee','DELETE',`/${leave._id}`,{revision:1},null,1),request('hr','DELETE',`/${leave._id}`,{revision:1},null,2)]);
            assert.equal(replies.filter(r => r.code === 200).length, 1); assert.equal((await balance('employee')).used, 0);
            leave = await create();
            replies = await Promise.all([request('hr','PUT',`/${leave._id}/approve`,{revision:0},null,1),request('employee','DELETE',`/${leave._id}`,{revision:0},null,2)]);
            assert.equal(replies.filter(r => r.code === 200).length, 1);
            const state = await Leave.findById(leave._id); assert.equal((await balance('employee')).used, state.status === 'approved' ? 1 : 0);
            await setBalance('peer', 3); const a = await create('peer', 2), b = await create('peer', 2);
            replies = await Promise.all([request('hr','PUT',`/${a._id}/approve`,{revision:0},null,1),request('hr2','PUT',`/${b._id}/approve`,{revision:0},null,2)]);
            assert.deepEqual(replies.map(r => r.code).sort(), [200,409]); assert.equal((await balance('peer')).remaining, 1);
        });
        await check('cancel started approval denied; HR cancel another requester before start', async () => {
            await setBalance('employee'); const leave = await create();
            await request('hr','PUT',`/${leave._id}/approve`,{});
            await Leave.updateOne({_id:leave._id},{$set:{startDate:new Date(Date.now()-60000)}});
            await request('employee','DELETE',`/${leave._id}`,{},400);
            await request('hr','DELETE',`/${leave._id}`,{},400);
            await Leave.updateOne({_id:leave._id},{$set:{startDate:new Date(day(10))}});
            await request('hr','DELETE',`/${leave._id}`,{}); assert.equal((await balance('employee')).used,0);
        });
        await check('failure injection: final leave write fails, balance conditionally compensated', async () => {
            await setBalance('employee'); const leave = await create();
            const original = Leave.findOneAndUpdate;
            Leave.findOneAndUpdate = function(filter, update, options) {
                if (filter['operation.token'] && update.$set?.status === 'approved') return Promise.reject(new Error('Injected final write failure'));
                return original.call(this, filter, update, options);
            };
            try { await assert.rejects(workflow.transition(users.hr, leave._id, 'approve', { revision:0 }), /Injected/); }
            finally { Leave.findOneAndUpdate = original; }
            assert.equal((await balance('employee')).used,0);
            const saved = await Leave.findById(leave._id); assert.equal(saved.status,'pending_team_lead'); assert.equal(saved.operation,null);
            assert.ok(saved.history.some(h=>h.action==='balance_refunded'));
            await request('hr','PUT',`/${leave._id}/approve`,{}); assert.equal((await balance('employee')).used,1);
        });
        await check('lost response after committed write does not refund or double deduct', async () => {
            await setBalance('employee'); const leave = await create(); const original = Leave.findOneAndUpdate;
            Leave.findOneAndUpdate = function(filter, update, options) {
                if (filter['operation.token'] && update.$set?.status === 'approved') return original.call(this,filter,update,options).then(()=>{throw new Error('Lost response');});
                return original.call(this,filter,update,options);
            };
            try { assert.equal((await workflow.transition(users.hr,leave._id,'approve',{})).status,'approved'); }
            finally { Leave.findOneAndUpdate=original; }
            assert.equal((await balance('employee')).used,1);
        });
        await check('worker crash after debit retains durable claim and receipt for operator recovery', async () => {
            await setBalance('employee'); const leave = await create();
            await assert.rejects(request('hr','PUT',`/${leave._id}/approve`,{},null,3));
            const saved = await Leave.findById(leave._id).lean(); assert.equal(saved.status,'pending_team_lead'); assert.ok(saved.operation?.token);
            assert.equal((await balance('employee')).used,1);
            await request('hr2','PUT',`/${leave._id}/approve`,{},409,2);
            await request('employee','DELETE',`/${leave._id}`,{},409);
        });
        await check('refund final-write failure remains claimed; retry cannot refund twice', async () => {
            await setBalance('peer'); const leave = await create('peer');
            await request('hr','PUT',`/${leave._id}/approve`,{});
            const original = Leave.findOneAndUpdate;
            Leave.findOneAndUpdate = function(filter, update, options) {
                if (filter['operation.token'] && update.$set?.status === 'cancelled') return Promise.reject(new Error('Injected cancel failure'));
                return original.call(this,filter,update,options);
            };
            try { await assert.rejects(workflow.transition(users.peer,leave._id,'cancel',{}),/Injected/); }
            finally { Leave.findOneAndUpdate=original; }
            assert.equal((await balance('peer')).used,0);
            assert.ok((await Leave.findById(leave._id)).operation);
            await request('peer','DELETE',`/${leave._id}`,{},409);
            assert.equal((await balance('peer')).used,0);
        });
        await check('notification failure does not roll back a final decision', async () => {
            await setBalance('peer'); const leave = await create('peer');
            const notifications = require('../services/notification.service'), original = notifications.notifyLeaveApproved;
            notifications.notifyLeaveApproved = async () => { throw new Error('Injected notification failure'); };
            try { assert.equal((await workflow.transition(users.hr,leave._id,'approve',{})).status,'approved'); }
            finally { notifications.notifyLeaveApproved=original; }
            assert.equal((await balance('peer')).used,1);
        });
        await check('legacy migration dry-run/idempotence, truthful history and unchanged balances', async () => {
            const old = { userId:users.peer._id,type:'sick',startDate:new Date(day(10)),endDate:new Date(day(10)),numberOfDays:1,createdAt:new Date(),updatedAt:new Date() };
            await Leave.collection.insertMany([{...old,status:'pending'},{...old,status:'approved',approvedBy:users.hr._id,approvedAt:new Date()},{...old,status:'rejected',rejectionReason:'Historical'}]);
            const before = JSON.stringify(await User.find({}).select('leaveBalance').sort({_id:1}).lean());
            assert.equal((await migrate()).count,3); assert.equal(await Leave.countDocuments({status:'pending'}),1);
            assert.equal((await migrate({apply:true})).count,3); assert.equal((await migrate({apply:true})).count,0);
            assert.equal(JSON.stringify(await User.find({}).select('leaveBalance').sort({_id:1}).lean()),before);
            const legacy = await Leave.find({reason:{$exists:false}}).lean(); assert.ok(legacy.every(l=>l.history.length===0));
        });
        await check('pagination, pending alias/statistics and dashboard count stay consistent', async () => {
            const my = await request('employee','GET','/my?limit=2&page=1'); assert.equal(my.count,2); assert.ok(my.total>2);
            const second = await request('employee','GET','/my?limit=2&page=2'); assert.ok(second.data.every(l=>!my.data.some(first=>first._id===l._id)));
            const stats = await request('hr','GET','/statistics');
            const expected = await Leave.countDocuments({status:{$in:['pending','pending_team_lead','pending_hr']}}); assert.equal(stats.stats.pending,expected);
            const report = await require('../services/statistics.service').getLeaveStats(new Date(year,0,1),new Date(year,11,31),1,year);
            assert.equal(report.pendingLeaves ?? report.summary?.pendingLeaves,expected);
            const pending = await request('hr','GET','?status=pending&limit=100'); assert.equal(pending.total,expected);
            const overview = await fetch(`http://127.0.0.1:${ports[1]}/api/statistics/overview`, { headers:{Authorization:`Bearer ${tokens.hr}`} });
            assert.equal(overview.status,200);assert.equal((await overview.json()).data.pendingLeaves,expected);
        });
        if (process.argv.includes('--browser')) await require('./leave-browser-verification.cjs')({ apiPort:ports[1],directory,users,tokens,check,year });
    } catch (error) {
        results.push({ name: 'Fixture/browser infrastructure', status: 'FAIL', error: error.stack });
        throw error;
    } finally {
        await mongoose.disconnect();
        for (const child of children.reverse()) if (child.exitCode === null) child.kill();
        fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({executedAt:new Date().toISOString(),results},null,2));
        fs.writeFileSync(path.join(directory,'process.log'),logs.join(''));
        console.log('Evidence:',directory);
    }
    if (results.some(result=>result.status==='FAIL')) process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
