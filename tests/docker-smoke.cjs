// Run after docker build: node tests/docker-smoke.cjs [image]
// Only creates/disposes uniquely named test containers and an isolated network.
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');

const image = process.argv[2] || 'hr-task-api:step3';
const suffix = `${Date.now()}-${process.pid}`;
const network = `hr-smoke-net-${suffix}`;
const database = `hr-smoke-db-${suffix}`;
const api = `hr-smoke-api-${suffix}`;
const created = [];
let networkCreated = false;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (_) { /* Service may still be starting. */ }
    await delay(500);
  }
  throw new Error(`Timed out: ${label}`);
}
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) });

async function main() {
  console.log('Checking image isolation and non-root upload permissions');
  const isolation = docker('run', '--rm', '--network', 'none', '--entrypoint', 'node', image, '-e', `
    const fs=require('fs'), assert=require('assert/strict');
    assert.equal(process.getuid(),1000);
    assert.equal(process.versions.node.split('.')[0],'24');
    for(const name of ['.env','.env.example','.git','.claude','report','coverage','tests','demo_project','public','docs','app.json','eas.json'])
      assert.equal(fs.existsSync('/app/'+name),false,name+' must not be in image');
    for(const name of ['jest','nodemon','@playwright/test'])
      assert.equal(fs.existsSync('/app/node_modules/'+name),false,'dev dependency '+name);
    function inspect(dir){ for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      assert(!entry.name.startsWith('.'),'hidden file in runtime tree');
      if(entry.isDirectory()) inspect(dir+'/'+entry.name);
      else assert(entry.name.endsWith('.js'),'unexpected runtime file '+entry.name);
    }}
    for(const dir of ['config','controllers','middleware','models','routes','services','utils','validators','chat_bot','scripts']) inspect('/app/'+dir);
    assert.throws(()=>fs.writeFileSync('/app/forbidden','x'),{code:'EACCES'});
    fs.writeFileSync('/app/uploads/probe','writable');
    assert.equal(fs.readFileSync('/app/uploads/probe','utf8'),'writable');
    fs.unlinkSync('/app/uploads/probe');
    console.log(JSON.stringify({uid:process.getuid(),node:process.version,uploadsWritable:true,sourceReadOnly:true}));
  `);
  console.log(isolation);
  // Separate bridge; MongoDB has no host port. API is published on loopback only.
  docker('network', 'create', network); networkCreated = true;
  docker('run', '-d', '--name', database, '--network', network, 'mongo:8', '--bind_ip_all'); created.push(database);
  await until(() => docker('exec', database, 'mongosh', '--quiet', '--eval', 'db.adminCommand({ping:1}).ok') === '1', 'MongoDB startup');
  const config = {
    NODE_ENV: 'production', PORT: '3107', MONGO_URL: `mongodb://${database}:27017/docker_smoke`,
    JWT_SECRET: randomBytes(48).toString('hex'), ALLOWED_ORIGINS: 'https://smoke.example.test',
    ACCEPT_LEGACY_TOKENS: 'false', PRIVATE_FILES_ENABLED: 'true', AI_PROVIDER: 'local_only',
    CLOUDINARY_CLOUD_NAME: 'smoke-cloud', CLOUDINARY_API_KEY: '123456789', CLOUDINARY_API_SECRET: 'smoke-only-value',
    NODE_OPTIONS: '--require=/tmp/docker-cloudinary.fixture.cjs',
  };
  const envArgs = Object.entries(config).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  docker('run', '-d', '--name', api, '--network', network, '-p', '127.0.0.1::3107',
    '--health-interval=1s', '--health-start-period=1s',
    '--mount', `type=bind,source=${path.resolve(__dirname, 'fixtures/docker-cloudinary.fixture.cjs')},target=/tmp/docker-cloudinary.fixture.cjs,readonly`,
    ...envArgs, image); created.push(api);
  const port = docker('port', api, '3107/tcp').split(':').at(-1);
  const base = `http://127.0.0.1:${port}`;
  await until(async () => (await request(`${base}/health/ready`)).status === 200, 'API readiness');
  await until(() => docker('inspect', '--format', '{{.State.Health.Status}}', api) === 'healthy', 'Docker liveness healthcheck');
  console.log('Production startup, readiness and Docker healthcheck passed on PORT=3107');

  docker('exec', api, 'node', '-e', `
    const mongoose=require('mongoose');
    (async()=>{await mongoose.connect(process.env.MONGO_URL);
      await require('./models/user.model').create({email:'docker-smoke@example.test',
        password:await require('bcryptjs').hash('SmokePassword123!',4),role:'hr_manager',
        profile:{fullName:'Docker Smoke',employeeId:'DOCKER-SMOKE'}});
      await mongoose.disconnect();
    })().catch(()=>process.exit(1));
  `);
  const login = await request(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'docker-smoke@example.test', password: 'SmokePassword123!' }) });
  assert.equal(login.status, 200);
  const { token } = await login.json(); assert(token);
  assert.equal((await request(`${base}/api/upload`, { method: 'POST' })).status, 401);
  const upload = (content, name = 'smoke.txt') => {
    const body = new FormData(); body.append('file', new Blob([content], { type: 'text/plain' }), name);
    return request(`${base}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  };
  const uploaded = await upload('Docker upload smoke test'); assert.equal(uploaded.status, 200);
  const file = await uploaded.json(); assert.equal(file.success, true); assert.equal(file.size, 24);
  const download = await request(`${base}/api/files/${file.filename}`, { redirect: 'manual', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(download.status, 302); assert(download.headers.get('location').startsWith('https://res.cloudinary.com/'));
  assert.equal((await upload('simulate-cloud-failure')).status, 400);
  assert.equal(docker('exec', api, 'node', '-e', "console.log(require('fs').readdirSync('/app/uploads').length)"), '0');
  console.log('Authenticated upload, cloud handoff (stubbed), private download redirect and temp-file cleanup passed');

  docker('stop', '--time', '10', database);
  await until(async () => (await request(`${base}/health/ready`)).status === 503, 'readiness after MongoDB stop');
  assert.equal((await request(`${base}/health/live`)).status, 200);
  docker('start', database);
  await until(async () => (await request(`${base}/health/ready`)).status === 200, 'readiness recovery');
  console.log('MongoDB outage/recovery: readiness 503 -> 200, liveness stays 200');
  docker('stop', '--time', '20', api);
  assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', api), '0');
  console.log('SIGTERM shutdown exited 0; all Docker smoke checks passed');
}

// Fetch/AbortSignal timers may be unref'ed; retain the runner until cleanup ends.
const keepAlive = setInterval(() => {}, 1000);
main().catch(error => {
  console.error(error.message);
  if (created.includes(api)) {
    try { console.error(docker('logs', '--tail', '50', api)); } catch (_) { /* Original failure takes precedence. */ }
  }
  process.exitCode = 1;
}).finally(() => {
  for (const name of created.reverse()) {
    try { docker('rm', '-f', '-v', name); } catch (_) { console.error(`Cleanup required: ${name}`); process.exitCode = 1; }
  }
  if (networkCreated) {
    try { docker('network', 'rm', network); } catch (_) { console.error(`Cleanup required: ${network}`); process.exitCode = 1; }
  }
  clearInterval(keepAlive);
});
