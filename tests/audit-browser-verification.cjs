// Real Expo screens, navigation, AuthProvider, Axios interceptor and Zustand;
// isolated in-memory HTTP fixture. Never loads server.js or connects to Mongo/email/push.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const project = path.resolve(__dirname, '../../project');
const directory = path.resolve(__dirname, '../coverage/audit-browser', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(directory, { recursive: true });
const fixtureRole = process.env.AUDIT_FIXTURE_ROLE || 'system_admin';
assert.ok(['system_admin', 'hr_manager'].includes(fixtureRole));
const user = { _id: '111111111111111111111111', email: 'fixture@example.test', role: fixtureRole, isActive: true, profile: { fullName: 'Audit Fixture', employeeId: 'FIXTURE' } };
const records = Array.from({ length: 13 }, (_, index) => ({ _id: (index + 1).toString(16).padStart(24, '0'),
  at: new Date(Date.UTC(2026, 10, 3, 12, 0, 0) - index * 60000).toISOString(), action: 'user.updated', category: 'user', severity: 'warning', outcome: 'success',
  actor: { id: user._id, name: user.profile.fullName, email: user.email, role: 'hr_manager' },
  target: { type: 'user', id: '222222222222222222222222', label: `Fixture employee ${index}` },
  reason: index === 0 ? 'Department transfer for the new position' : index === 1 ? 'No reason provided' : null,
  changes: [{ field: 'profile.department', from: 'Sales', to: 'Marketing' }], metadata: {},
  context: { requestId: `fixture-${index}`, ip: '127.0.0.1', method: 'PUT', route: '/api/users/:id' } }));
const results = [], requests = [];
let metro, preview, browser;
const logs = [];
async function check(name, run) { await run(); results.push({ name, passed: true }); console.log('PASS', name); }
(async () => {
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  metro = spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--offline', '--port', String(port)],
    { cwd: project, windowsHide: true, env: { ...process.env, CI: '1', EXPO_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  metro.stdout.on('data', data => logs.push(String(data))); metro.stderr.on('data', data => logs.push(String(data)));
  let ready = false;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) { ready = true; break; } } catch {} await delay(250); }
  assert.ok(ready, 'Own Expo Metro ready');
  const bundle = `http://127.0.0.1:${port}/tests/audit-browser.entry.bundle?platform=web&dev=true&minify=false`;
  const bundled = await fetch(bundle, { signal: AbortSignal.timeout(180000) });
  if (!bundled.ok) fs.writeFileSync(path.join(directory, 'bundle-error.txt'), await bundled.text());
  assert.ok(bundled.ok, `Bundle status ${bundled.status}`); await bundled.arrayBuffer();
  preview = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/assets/')) {
      const upstream = http.request({ hostname: '127.0.0.1', port, path: req.url }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); upstream.end(); return;
    }
    if (url.pathname.startsWith('/api/')) {
      requests.push(req.url); res.setHeader('Content-Type', 'application/json');
      let data = { success: true, data: [] };
      if (url.pathname === '/api/auth/me') data.data = user;
      else if (url.pathname === '/api/auth/login') data = { success: true, token: 'fixture-token-2', user };
      else if (url.pathname === '/api/notifications/preferences') data.data = { master: false, categories: {} };
      else if (url.pathname.includes('unread')) data.data = { unreadCount: 0 };
      else if (url.pathname.startsWith('/api/admin/audit-logs')) {
        const suffix = url.pathname.slice('/api/admin/audit-logs'.length);
        if (suffix && !suffix.startsWith('/target/')) data.data = records.find(record => record._id === suffix.slice(1));
        else {
          const filters = Object.fromEntries(url.searchParams); let selected = records;
          for (const key of ['action', 'category', 'severity', 'outcome']) if (filters[key]) selected = selected.filter(record => record[key] === filters[key]);
          if (filters.actorId) selected = selected.filter(record => record.actor.id === filters.actorId);
          const page = Number(filters.page || 1), limit = Number(filters.limit || 10);
          data = { success: true, data: selected.slice((page - 1) * limit, page * limit), total: selected.length, count: selected.slice((page - 1) * limit, page * limit).length, page, pages: Math.ceil(selected.length / limit) };
        }
      }
      res.end(JSON.stringify(data)); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script src="${bundle}"></script></body></html>`);
  });
  await new Promise(resolve => preview.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  await context.addInitScript(({ user }) => {
    if (!sessionStorage.getItem('fixture-initialized')) {
      localStorage.setItem('authToken', 'fixture-token'); localStorage.setItem('user', JSON.stringify(user)); sessionStorage.setItem('fixture-initialized', 'true');
    }
  }, { user });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  const filterButton = key => page.getByRole('button', { name: new RegExp(`^${key.charAt(0).toUpperCase() + key.slice(1)}: `) });
  const selectFilter = async (key, value) => {
    const labels = { 'user.updated': 'Cập nhật nhân viên', 'auth.register': 'Đăng ký tài khoản' };
    await filterButton(key).click();
    await page.getByRole('radio', { name: labels[value] || value || 'All', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  };
  const openList = async () => { await expect(page.getByText('Audit Log', { exact: true })).toBeVisible({ timeout: 30000 }); await page.getByText('Audit Log', { exact: true }).click(); await expect(page.getByRole('button', { name: 'Apply filters', exact: true })).toBeVisible(); };
  await page.goto(`http://127.0.0.1:${preview.address().port}`);
  await check(`${fixtureRole} menu, loading, real list and Load next pagination at mobile width`, async () => {
    let release; const held = new Promise(resolve => { release = resolve; });
    await page.route('**/api/admin/audit-logs?**', async route => { await held; await route.continue().catch(error => errors.push(error.message)); });
    await openList(); await expect(page.getByLabel('Loading audit logs')).toBeVisible(); release();
    await expect.poll(() => page.evaluate(() => window.auditVerificationState().records.length)).toBe(10);
    await page.unroute('**/api/admin/audit-logs?**');
    await page.getByRole('button', { name: 'Load next', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.auditVerificationState().records.length)).toBe(13);
    await page.getByText('Filters', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(directory, 'audit-list-mobile.png'), fullPage: true });
  });
  await check('audit selects match Profile sheet; Close, backdrop and back discard draft; Confirm waits for Apply', async () => {
    const count = requests.filter(url => url.includes('/admin/audit-logs')).length;
    await filterButton('category').click();
    await expect(page.getByRole('heading', { name: 'Select Category', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'user', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'user', exact: true })).toBeChecked();
    await page.screenshot({ path: path.join(directory, 'audit-select-modal-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(filterButton('category')).toHaveAccessibleName('Category: All');
    await filterButton('category').click();
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'user', exact: true }).click();
    await page.getByRole('button', { name: 'Close Category selection', exact: true }).click({ position: { x: 10, y: 10 } });
    await expect(filterButton('category')).toHaveAccessibleName('Category: All');
    await filterButton('category').click();
    await page.getByRole('radio', { name: 'user', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(filterButton('category')).toHaveAccessibleName('Category: All');
    await selectFilter('category', 'user');
    await expect(filterButton('category')).toHaveAccessibleName('Category: user');
    assert.equal(requests.filter(url => url.includes('/admin/audit-logs')).length, count);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(filterButton('category')).toHaveAccessibleName('Category: All');
  });
  await check('all filters send live parameters; empty state; detail reason/diff/context and target timeline', async () => {
    await page.getByLabel('From (ISO date/time)', { exact: true }).fill('2026-11-03T00:00:00Z');
    await page.getByLabel('To (exclusive, ISO date/time)', { exact: true }).fill('2026-11-04T00:00:00Z');
    await page.getByLabel('Actor ID', { exact: true }).fill(user._id);
    for (const [key, value] of [['category', 'user'], ['severity', 'warning'], ['outcome', 'success'], ['action', 'user.updated']]) await selectFilter(key, value);
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect.poll(() => requests.filter(url => url.includes('actorId=') && url.includes('severity=warning')).length).toBeGreaterThan(0);
    await selectFilter('action', 'auth.register'); await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByText('No audit records match', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByText('Fixture employee 0', { exact: true }).click();
    await expect(page.getByText('Lý do thay đổi', { exact: true })).toBeVisible();
    await expect(page.getByText('Department transfer for the new position', { exact: true })).toBeVisible();
    await expect(page.getByText('Sales', { exact: true })).toBeVisible(); await expect(page.getByText('Marketing', { exact: true })).toBeVisible();
    await expect(page.getByText('Request ID: fixture-0', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(directory, 'audit-detail-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'View target history', exact: true }).click();
    await expect(page.getByText('History of Fixture employee 0', { exact: true })).toBeVisible();
    await expect(page.getByText('Lý do: No reason provided', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Lý do: No reason recorded', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Load next', exact: true }).click(); await expect(page.getByText('Page 2 / 2', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.getByText('History of Fixture employee 0', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(directory, 'audit-target-wide.png'), fullPage: true });
  });
  await check('network error/retry, 403 state, logout/account change clears store', async () => {
    await page.reload(); await openList();
    await page.route('**/api/admin/audit-logs?**', route => route.abort('failed'));
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await page.unroute('**/api/admin/audit-logs?**'); await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.auditVerificationState().error)).toBeNull();
    await page.route('**/api/admin/audit-logs?**', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'User role is not authorized to access this route' }) }));
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click(); await expect(page.getByText('You do not have permission', { exact: true })).toBeVisible();
    await page.unroute('**/api/admin/audit-logs?**'); await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await selectFilter('category', 'user'); await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out verification', exact: true }).click(); await expect(page.getByText('Session ended verification', { exact: true })).toBeVisible();
    const state = await page.evaluate(() => window.auditVerificationState()); assert.deepEqual(state.records, []); assert.deepEqual(state.filters, {});
    await page.getByRole('button', { name: 'Sign in fixture', exact: true }).click(); await openList();
    await expect(filterButton('category')).toHaveAccessibleName('Category: All');
  });
  await check('401 uses shared interceptor/session-expired reset; no render exceptions', async () => {
    await page.route('**/api/admin/audit-logs?**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Session expired fixture' }) }));
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByText('Session ended verification', { exact: true })).toBeVisible();
    assert.deepEqual((await page.evaluate(() => window.auditVerificationState())).records, []); assert.deepEqual(errors, []);
  });
})().catch(error => { process.exitCode = 1; results.push({ passed: false, error: error.stack }); console.error(error); }).finally(async () => {
  if (browser) await browser.close(); if (preview) await new Promise(resolve => preview.close(resolve));
  if (metro && metro.exitCode === null) {
    if (process.platform === 'win32') await new Promise(resolve => { const stop = spawn('taskkill', ['/PID', String(metro.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); stop.on('exit', resolve); });
    else metro.kill();
  }
  fs.writeFileSync(path.join(directory, 'metro.log'), logs.join(''));
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ results, requests }, null, 2));
  console.log('Evidence:', directory);
});
