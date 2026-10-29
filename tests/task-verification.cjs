// Real HTTP + MongoDB verification. Own mongod/dbpath only; never uses .env URI.
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
  const directory = path.join(root, 'coverage/task-verification', new Date().toISOString().replace(/[:.]/g, '-'));
  const dbpath = path.join(directory, 'mongo'); fs.mkdirSync(dbpath, { recursive: true });
  const mongoPort = await freePort(), apiPort = await freePort(), secondPort = await freePort();
  const uri = `mongodb://127.0.0.1:${mongoPort}/task_verification`;
  const baseURL = `http://127.0.0.1:${apiPort}/api`;
  const children = [], logs = [], results = [];
  const start = (command, args, options = {}) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    children.push(child); child.on('error', e => logs.push(e.message));
    child.stdout.on('data', c => logs.push(c.toString())); child.stderr.on('data', c => logs.push(c.toString())); return child;
  };
  const check = async (name, fn) => { try { await fn(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); } catch (e) { results.push({ name, status: 'FAIL', error: e.message }); console.log(`FAIL ${name}: ${e.message}`); } };
  const tokens = {};
  const request = async (role, method, route, body, expected = 200) => {
    const origin = role === 'employee2' ? `http://127.0.0.1:${secondPort}/api` : baseURL;
    const response = await fetch(origin + route, { method, headers: { ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const data = await response.json(); if (expected != null) assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return { status: response.status, ...data };
  };
  try {
    start(process.env.TASK_MONGOD || 'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe', ['--dbpath', dbpath, '--port', String(mongoPort), '--bind_ip', '127.0.0.1', '--quiet']);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    assert.equal(mongoose.connection.name, 'task_verification');
    const Task = require('../models/task.model'), User = require('../models/user.model'), Team = require('../models/team.model');
    const id = () => new mongoose.Types.ObjectId();
    const teamA = id(), teamB = id();
    const password = crypto.randomBytes(20).toString('hex');
    const hash = await require('bcryptjs').hash(password, 10);
    const users = {};
    for (const [name, role, team] of [['hr','hr_manager',null],['lead','team_lead',teamA],['otherLead','team_lead',teamB],['employee','employee',teamA],['peer','employee',teamA],['outsider','employee',teamB],['admin','system_admin',null]]) {
      users[name] = await User.create({ email: `${name.toLowerCase()}@task.invalid`, password: hash, role, teamId: team, profile: { fullName: `Verification ${name}`, employeeId: name } });
    }
    await Team.create([{ _id: teamA, name: 'Verification A', leaderId: users.lead._id, memberIds: [users.employee._id, users.peer._id] }, { _id: teamB, name: 'Verification B', leaderId: users.otherLead._id, memberIds: [users.outsider._id] }]);
    await Task.init();
    const secret = crypto.randomBytes(32).toString('hex');
    start(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, MONGO_URL: uri, PORT: String(apiPort), NODE_ENV: 'test', JWT_SECRET: secret, EMAIL_HOST: '', EMAIL_USER: '', EMAIL_PASS: '' } });
    start(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, MONGO_URL: uri, PORT: String(secondPort), NODE_ENV: 'test', JWT_SECRET: secret, EMAIL_HOST: '', EMAIL_USER: '', EMAIL_PASS: '' } });
    for (let i = 0; i < 75; i++) { try { if ((await fetch(baseURL.replace('/api',''))).ok) break; } catch {} await delay(200); }
    await check('real password login for seven fixture identities', async () => {
      for (const name of Object.keys(users)) { const r = await request(name, 'POST', '/auth/login', { email: users[name].email, password }); tokens[name] = r.token || r.data?.token; assert.ok(tokens[name]); }
      await request('none', 'GET', '/tasks/my', null, 401);
      tokens.expired = require('jsonwebtoken').sign({ id: String(users.employee._id) }, secret, { expiresIn: -1 });
      await request('expired', 'GET', '/tasks/my', null, 401);
      tokens.employee2 = tokens.employee;
    });
    const make = async (title, extra = {}) => Task.create({ title, teamId: teamA, assignedBy: users.hr._id, assignedTo: [users.employee._id], dueDate: new Date(2026, 9, 28), ...extra });
    let task = await make('Authorized task');
    await check('actual MongoDB task indexes exist', async () => {
      const indexes = await Task.collection.indexes();
      for (const key of ['parentTaskId', 'dependencies', 'watchers', 'statusHistory.at']) assert.ok(indexes.some(i => i.key[key] === 1), key);
      fs.writeFileSync(path.join(directory, 'indexes.json'), JSON.stringify(indexes, null, 2));
    });
    await check('direct cross-user/team and system admin requests denied for every advanced API', async () => {
      const child = String(id());
      const cases = [['POST','parent',{parentTaskId:child}],['DELETE','parent'],['GET','children'],['POST','checklists',{title:'Checklist'}],['PATCH',`checklists/${child}`,{title:'Changed'}],['DELETE',`checklists/${child}`],['POST',`checklists/${child}/items`,{text:'Item'}],['PATCH',`checklists/${child}/items/${child}`,{isCompleted:true}],['DELETE',`checklists/${child}/items/${child}`],['POST','dependencies',{dependencyIds:[child]}],['DELETE',`dependencies/${child}`],['GET','dependencies'],['POST','watchers',{userId:String(users.peer._id)}],['DELETE',`watchers/${users.employee._id}`],['GET','watchers'],['POST','tags',{tags:['tag']}],['PUT','estimate',{estimatedMinutes:10}],['POST','time-entries',{minutes:5}],['DELETE',`time-entries/${child}`],['GET','time-entries'],['DELETE',`attachments/${child}`],['GET','history']];
      for (const user of ['peer','outsider','otherLead','admin']) for (const [method,suffix,body] of cases) await request(user,method,`/tasks/${task._id}/${suffix}`,body,403);
      for (const user of ['employee','admin']) { await request(user,'GET','/tasks',null,403); await request(user,'GET',`/tasks/board?teamId=${teamA}`,null,403); }
      await request('lead','GET',`/tasks/board?teamId=${teamB}`,null,403);
    });
    await check('checklist CRUD independent of progress/status; tags/estimate/time ownership', async () => {
      await request('employee','PUT',`/tasks/${task._id}/progress`,{progress:42});
      let r = await request('employee','POST',`/tasks/${task._id}/checklists`,{title:'Independent'},201);
      const c = r.data.checklist._id;
      r = await request('employee','POST',`/tasks/${task._id}/checklists/${c}/items`,{text:'Item'});
      const item = r.data.checklist.items[0]._id;
      await request('employee','PATCH',`/tasks/${task._id}/checklists/${c}/items/${item}`,{isCompleted:true});
      r = await request('employee','POST',`/tasks/${task._id}/tags`,{tags:[' x ','x','y']}); assert.deepEqual(r.data.tags,['x','y']); assert.equal(r.data.progress,42); assert.equal(r.data.status,'in_progress');
      await request('employee','PUT',`/tasks/${task._id}/estimate`,{estimatedMinutes:60,storyPoints:3});
      r = await request('employee','POST',`/tasks/${task._id}/time-entries`,{minutes:15,userId:String(users.hr._id),actualMinutes:999},201);
      assert.equal(r.data.task.actualMinutes,15); assert.equal(r.data.timeEntry.userId._id,String(users.employee._id));
      await request('lead','DELETE',`/tasks/${task._id}/time-entries/${r.data.timeEntry._id}`,null,403);
      await request('hr','DELETE',`/tasks/${task._id}/time-entries/${r.data.timeEntry._id}`);
      await request('employee','DELETE',`/tasks/${task._id}/checklists/${c}/items/${item}`);
      await request('employee','DELETE',`/tasks/${task._id}/checklists/${c}`);
    });
    await check('watcher validation and narrower removal/status permissions', async () => {
      await request('employee','POST',`/tasks/${task._id}/watchers`,{userId:String(users.peer._id)},400);
      await request('employee','POST',`/tasks/${task._id}/watchers`,{userId:String(users.employee._id)});
      await request('employee','DELETE',`/tasks/${task._id}/watchers/${users.employee._id}`,null,403);
      await request('lead','PUT',`/tasks/${task._id}/status`,{status:'in_progress'},403);
      await request('hr','DELETE',`/tasks/${task._id}/watchers/${users.employee._id}`);
    });
    await check('hierarchy/dependency completion guards and one-level/cross-team/deleted rejection', async () => {
      const parent = await make('Parent'), child = await make('Child'), dep = await make('Dependency'), foreign = await make('Other team',{teamId:teamB}), deleted = await make('Deleted',{status:'deleted'});
      await request('employee','POST',`/tasks/${child._id}/parent`,{parentTaskId:String(parent._id)});
      await request('employee','POST',`/tasks/${parent._id}/parent`,{parentTaskId:String(child._id)},400);
      await request('hr','POST',`/tasks/${child._id}/parent`,{parentTaskId:String(foreign._id)},400);
      await request('employee','PUT',`/tasks/${parent._id}/status`,{status:'done'},400);
      await request('employee','POST',`/tasks/${child._id}/dependencies`,{dependencyIds:[String(dep._id)]});
      await request('employee','POST',`/tasks/${dep._id}/dependencies`,{dependencyIds:[String(child._id)]},400);
      await request('hr','POST',`/tasks/${child._id}/dependencies`,{dependencyIds:[String(foreign._id)]},400);
      await request('hr','POST',`/tasks/${child._id}/dependencies`,{dependencyIds:[String(deleted._id)]},400);
      await request('employee','PUT',`/tasks/${child._id}/status`,{status:'done'},400);
      await request('employee','PUT',`/tasks/${dep._id}/status`,{status:'done'});
      await request('employee','PUT',`/tasks/${child._id}/status`,{status:'done'});
      assert.equal((await Task.findById(parent._id)).status,'done');
      const fresh = await make('Incomplete');
      await request('employee','POST',`/tasks/${fresh._id}/parent`,{parentTaskId:String(parent._id)},400);
      await request('employee','POST',`/tasks/${child._id}/dependencies`,{dependencyIds:[String(fresh._id)]},400);
    });
    // Observational check only: the prompt does not specify whether reopening
    // a prerequisite should be blocked or cascade to its completed dependents.
    {
      const prerequisite=await make('Policy prerequisite'),dependent=await make('Policy dependent');
      await request('employee','PUT',`/tasks/${prerequisite._id}/status`,{status:'done'});
      await request('employee','POST',`/tasks/${dependent._id}/dependencies`,{dependencyIds:[String(prerequisite._id)]});
      await request('employee','PUT',`/tasks/${dependent._id}/status`,{status:'done'});
      const reopened=await request('employee','PUT',`/tasks/${prerequisite._id}/status`,{status:'in_progress'},null);
      results.push({name:'Prerequisite reopen policy requires a business decision',status:'NEEDS_DECISION',observedHttpStatus:reopened.status,dependentStatus:(await Task.findById(dependent._id)).status});
    }
    await check('concurrent inverse dependencies cannot commit a cycle', async () => {
      for(let i=0;i<8;i++) { const a=await make('Race dep A'),b=await make('Race dep B');
        await Promise.all([request('employee','POST',`/tasks/${a._id}/dependencies`,{dependencyIds:[String(b._id)]},null),request('employee2','POST',`/tasks/${b._id}/dependencies`,{dependencyIds:[String(a._id)]},null)]);
        const [aa,bb]=await Promise.all([Task.findById(a._id),Task.findById(b._id)]); assert.ok(!(aa.dependencies.length && bb.dependencies.length),'Both inverse links persisted'); }
    });
    await check('concurrent inverse parents cannot commit a cycle', async () => {
      for(let i=0;i<8;i++) { const a=await make('Race parent A'),b=await make('Race parent B');
        await Promise.all([request('employee','POST',`/tasks/${a._id}/parent`,{parentTaskId:String(b._id)},null),request('employee2','POST',`/tasks/${b._id}/parent`,{parentTaskId:String(a._id)},null)]);
        const [aa,bb]=await Promise.all([Task.findById(a._id),Task.findById(b._id)]); assert.ok(!(aa.parentTaskId && bb.parentTaskId),'Both inverse parents persisted'); }
    });
    await check('concurrent dependency add and completion remain consistent', async () => {
      for(let i=0;i<8;i++) { const a=await make('Race finish'),b=await make('Race blocker');
        await Promise.all([request('employee','POST',`/tasks/${a._id}/dependencies`,{dependencyIds:[String(b._id)]},null),request('employee2','PUT',`/tasks/${a._id}/status`,{status:'done'},null)]);
        const aa=await Task.findById(a._id); assert.ok(!(aa.status==='done'&&aa.dependencies.length),'Done task persisted with incomplete blocker'); }
    });
    await check('concurrent manual logs preserve all entries and server total across workers', async () => {
      const t=await make('Concurrent logs');
      await Promise.all(Array.from({length:8},(_,i)=>request(i%2?'employee2':'employee','POST',`/tasks/${t._id}/time-entries`,{minutes:10},201)));
      const result=await Task.findById(t._id);assert.equal(result.timeEntries.length,8);assert.equal(result.actualMinutes,80);
    });
    await check('failed parent save restores child status/history and leaves no lock', async () => {
      const parent=await make('Failure parent'),child=await make('Failure child');
      await request('employee','POST',`/tasks/${child._id}/parent`,{parentTaskId:String(parent._id)});
      // Corrupt only this isolated fixture to force parent validation to fail
      // AFTER the child save. This exercises real compensation, not a mock.
      await Task.collection.updateOne({_id:parent._id},{$unset:{title:1}});
      const before=await Task.collection.findOne({_id:child._id});
      await request('employee','PUT',`/tasks/${child._id}/status`,{status:'done'},500);
      assert.deepEqual(await Task.collection.findOne({_id:child._id}),before);
      assert.equal(await mongoose.connection.collection('task_write_locks').countDocuments(),0);
      await Task.collection.updateOne({_id:parent._id},{$set:{title:'Failure parent'}});
    });
    await check('list filter/sort before pagination, complete board/calendar/timeline above 100 rows', async () => {
      const now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1),monthEnd=new Date(now.getFullYear(),now.getMonth()+1,0);
      const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const rows = Array.from({length:125},(_,i)=>({title:`Paged ${String(i).padStart(3,'0')}`,teamId:teamA,assignedBy:users.hr._id,assignedTo:[users.employee._id],status:'todo',priority:i%2?'high':'low',tags:['paged'],startDate:monthStart,dueDate:monthEnd,createdAt:monthStart}));
      await Task.collection.insertMany(rows);
      const ids=[]; for(let p=1;p<=7;p++){const r=await request('employee','GET',`/tasks/my?tags=paged&sort=title_asc&limit=20&page=${p}&userId=${users.outsider._id}`); assert.equal(r.total,125); assert.equal(r.pages,7); ids.push(...r.data.map(t=>t._id));}
      assert.equal(new Set(ids).size,125);
      const r=await request('employee','GET','/tasks/my?tags=paged&priority=high&sort=priority_desc&limit=20'); assert.equal(r.total,62); assert.ok(r.data.every(t=>t.priority==='high'));
      for(const view of ['calendar','timeline']) { const v=await request('employee','GET',`/tasks/${view}?from=${key(monthStart)}&to=${key(monthEnd)}`); assert.equal(v.data.filter(t=>t.title.startsWith('Paged')).length,125); }
      const board=await request('lead','GET',`/tasks/board?teamId=${teamA}`); assert.equal(board.data.todo.filter(t=>t.title.startsWith('Paged')).length,125);
    });
    await check('legacy missing fields/history remain usable without fabricated history', async () => {
      const legacyId=id(); await Task.collection.insertOne({_id:legacyId,title:'Legacy',teamId:teamA,assignedBy:users.hr._id,assignedTo:[users.employee._id],status:'todo',subTasks:[{_id:id(),title:'Embedded',isCompleted:false}],progress:0});
      const history=await request('employee','GET',`/tasks/${legacyId}/history`); assert.deepEqual(history.data,[]);
      const r=await request('employee','POST',`/tasks/${legacyId}/tags`,{tags:['legacy']}); assert.deepEqual(r.data.statusHistory,[]);
    });
    await check('date boundaries and overlap across month/year use local calendar days', async () => {
      const before=await make('Boundary before',{dueDate:new Date(2026,9,31,23,59,59,999)});
      const after=await make('Boundary after',{dueDate:new Date(2026,10,1,0,0,0,0)});
      const span=await make('Boundary year span',{startDate:new Date(2026,11,30),dueDate:new Date(2027,0,3)});
      const october=await request('employee','GET','/tasks/calendar?from=2026-10-31&to=2026-10-31');
      assert.ok(october.data.some(t=>t._id===String(before._id)));assert.ok(!october.data.some(t=>t._id===String(after._id)));
      const january=await request('employee','GET','/tasks/timeline?from=2027-01-01&to=2027-01-07');assert.ok(january.data.some(t=>t._id===String(span._id)));
    });
    await check('personal task stats exclude missing/null deadlines from overdue', async () => {
      await make('Undated legacy equivalent',{dueDate:null});await make('Real overdue',{dueDate:new Date(2026,8,1)});
      const stats=(await request('employee','GET','/tasks/stats')).data;
      const expected=await Task.countDocuments({assignedTo:users.employee._id,status:{$in:['todo','in_progress']},dueDate:{$ne:null,$lt:new Date()}});
      assert.equal(stats.overdue,expected);
    });
    await check('Dashboard counts, completion/on-time rates and workload match lifecycle fixtures',async()=>{
      const rows=await Task.find({teamId:teamA,status:{$ne:'deleted'}}).lean();
      const performance=(await request('lead','GET',`/teams/${teamA}/performance`)).data;
      const done=rows.filter(t=>t.status==='done');const overdue=rows.filter(t=>['todo','in_progress'].includes(t.status)&&t.dueDate&&new Date(t.dueDate)<new Date());
      assert.equal(performance.taskCounts.total,rows.length);assert.equal(performance.taskCounts.done,done.length);assert.equal(performance.overdueCount,overdue.length);
      const pct=(a,b)=>b?Math.round(a/b*10000)/100:0;
      assert.equal(performance.completionRate,pct(done.length,rows.length));
      const eligible=done.map(t=>[...(t.statusHistory||[])].reverse().find(e=>e.to==='done')).filter(e=>e?.dueDate);
      assert.equal(performance.onTimeEligibleTasks,eligible.length);assert.equal(performance.onTimeTasks,eligible.filter(e=>new Date(e.at)<=new Date(e.dueDate)).length);
      for(const member of performance.workloadByMember){const assigned=rows.filter(t=>(t.assignedTo||[]).some(id=>String(id)===member.userId));assert.equal(member.totalTasks,assigned.length);assert.equal(member.openTasks,assigned.filter(t=>['todo','in_progress'].includes(t.status)).length);}
      const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),1),end=new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59,999);
      const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const trend=(await request('lead','GET',`/teams/${teamA}/performance-trends?period=month&startDate=${key(start)}&endDate=${key(end)}`)).data.trend;
      const all=await Task.find({}).lean();const completed=new Set(),created=new Set();
      for(const t of all)for(const e of t.statusHistory||[]){if(String(e.teamId)!==String(teamA)||new Date(e.at)<start||new Date(e.at)>end)continue;if(e.to==='done')completed.add(String(t._id));if(e.from===null)created.add(String(t._id));}
      assert.equal(trend.reduce((sum,b)=>sum+b.completedTasks,0),completed.size);assert.equal(trend.reduce((sum,b)=>sum+b.createdTasks,0),created.size);
    });
    await check('actual frontend apiClient/service/store: full list pagination and advanced mutation contracts', async () => {
      const {service,store}=require('./frontend-task-client.cjs')(tokens.employee,baseURL);
      store.getState().setFilters({tags:['paged'],sort:'title_asc'});
      for(let page=1;page<=7;page++)await store.getState().fetchTaskPage('my',{page});
      assert.equal(store.getState().myTasks.length,125);assert.equal(store.getState().total,125);assert.equal(store.getState().hasMore,false);
      await store.getState().fetchTaskById(String(task._id));
      await store.getState().updateEstimate(String(task._id),{estimatedMinutes:90});
      assert.equal(store.getState().selectedTask.estimatedMinutes,90);
      const clientTask=await make('Client mutation');
      await service.setTags(String(clientTask._id),['client']);
      const history=await service.getTaskHistory(String(clientTask._id));assert.ok(history.data.length);
      const hrClient=require('./frontend-task-client.cjs')(tokens.hr,baseURL);
      const created=await hrClient.service.createTask({title:'Created through frontend',teamId:String(teamA),assignedTo:[String(users.employee._id)],tags:['client'],estimatedMinutes:30});
      assert.equal(created.data.estimatedMinutes,30);
      await hrClient.service.updateTask(created.data._id,{title:'Edited through frontend'});
      assert.equal((await Task.findById(created.data._id)).title,'Edited through frontend');
    });
    await check('upload actual 10MB boundary, invalid type, unauthorized, repeated deletion', async () => {
      const upload=async(role,name,size,type='text/plain',expected=200)=>{const form=new FormData();form.append('attachment',new Blob([Buffer.alloc(size)],{type}),name);return request(role,'POST',`/tasks/${task._id}/attachments`,form,expected);};
      await upload('employee','verification.txt',6*1024*1024);
      await upload('employee','verification-boundary.txt',10*1024*1024);
      await upload('employee','verification.txt',10*1024*1024+1,'text/plain',400);
      await upload('employee','verification.exe',10,'application/octet-stream',400);
      await upload('outsider','verification.txt',10,'text/plain',403);
      const doc=await Task.findById(task._id); const attachment=doc.attachments[0]; assert.ok(fs.existsSync(path.join(root,'uploads',attachment.filename)));
      await request('employee','DELETE',`/tasks/${task._id}/attachments/${attachment._id}`); assert.ok(!fs.existsSync(path.join(root,'uploads',attachment.filename)));
      await request('employee','DELETE',`/tasks/${task._id}/attachments/${attachment._id}`,null,404);
      const boundary=(await Task.findById(task._id)).attachments[0];
      await request('employee','DELETE',`/tasks/${task._id}/attachments/${boundary._id}`);
    });
    await check('busy write lock rejects upload without leaving an orphan file', async () => {
      const locks=mongoose.connection.collection('task_write_locks');
      const before=new Set(fs.readdirSync(path.join(root,'uploads')));
      await locks.insertOne({_id:'tasks',owner:'verification-busy-lock',undo:[]});
      try {
        const form=new FormData();form.append('attachment',new Blob(['Owned verification fixture'],{type:'text/plain'}),'verification-busy.txt');
        await request('employee','POST',`/tasks/${task._id}/attachments`,form,409);
        const added=fs.readdirSync(path.join(root,'uploads')).filter(name=>!before.has(name));
        assert.deepEqual(added,[],'Lock timeout must clean the file Multer already wrote');
      } finally {
        await locks.deleteOne({_id:'tasks',owner:'verification-busy-lock'});
        // Only files produced by this isolated request, identified by fixture user prefix.
        for(const name of fs.readdirSync(path.join(root,'uploads'))) {
          if(!before.has(name)&&name.startsWith(String(users.employee._id)+'-')) fs.unlinkSync(path.join(root,'uploads',name));
        }
      }
    });
    await check('storage deletion failure retains durable intent and repeated request retries', async () => {
      const filename=`verification-directory-${crypto.randomUUID()}.txt`;
      const fixturePath=path.join(root,'uploads',filename);fs.mkdirSync(fixturePath);
      const t=await make('Storage failure',{attachments:[{name:'Fixture',filename,url:`/uploads/${filename}`,type:'text/plain'}]});
      const attachment=t.attachments[0];
      try {
        await request('employee','DELETE',`/tasks/${t._id}/attachments/${attachment._id}`);
        const pending=await Task.findById(t._id);assert.equal(pending.attachments.length,0);assert.equal(pending.pendingAttachmentDeletes.length,1);
        fs.rmdirSync(fixturePath);fs.writeFileSync(fixturePath,'Only this verification fixture');
        await request('employee','DELETE',`/tasks/${t._id}/attachments/${attachment._id}`);
        assert.equal((await Task.findById(t._id)).pendingAttachmentDeletes.length,0);assert.ok(!fs.existsSync(fixturePath));
      } finally { if(fs.existsSync(fixturePath)){if(fs.statSync(fixturePath).isDirectory())fs.rmdirSync(fixturePath);else fs.unlinkSync(fixturePath);} }
    });
    if (process.argv.includes('--browser')) await require('./task-browser-verification.cjs')({apiPort,directory,users,password,secret,check});
    if (process.argv.includes('--native')) await require('./task-native-verification.cjs')({apiPort,directory,users,password,check});
  } finally {
    await mongoose.disconnect();
    for (const child of children.reverse()) if (child.exitCode === null) child.kill();
    fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({executedAt:new Date().toISOString(),node:process.version,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,fixtureRoles:['hr_manager','team_lead','employee','system_admin'],fixtureUsers:7,backendWorkers:2,mongoVersion:'6.0.29',results,existingDatabaseWrites:0},null,2));
    fs.writeFileSync(path.join(directory,'process.log'),logs.join(''));
    console.log(`Artifacts: ${directory}`);
  }
  if(results.some(r=>r.status==='FAIL')) process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
