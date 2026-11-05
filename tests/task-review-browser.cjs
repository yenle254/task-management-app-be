const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
module.exports = async ({ apiPort, directory, user, token, taskId, check }) => {
  const project = path.resolve(__dirname, '../../project');
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const metro = spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--offline', '--port', String(port)],
    { cwd: project, windowsHide: true, env: { ...process.env, CI: '1', EXPO_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; metro.stdout.on('data', data => logs.push(String(data))); metro.stderr.on('data', data => logs.push(String(data)));
  let browser, preview;
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
    assert.ok(ready, 'Metro ready');
    const bundle = `http://127.0.0.1:${port}/tests/task-review-browser.entry.bundle?platform=web&dev=true&minify=false`;
    const bundled = await fetch(bundle, { signal: AbortSignal.timeout(180000) });
    if (!bundled.ok) fs.writeFileSync(path.join(directory, 'bundle-error.txt'), await bundled.text());
    assert.ok(bundled.ok, `Bundle ${bundled.status}`);
    preview = http.createServer((req, res) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) {
        const upstreamPort = req.url.startsWith('/assets/') ? port : apiPort;
        const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
        upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
      }
      res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script src="${bundle}"></script></body></html>`);
    });
    await new Promise(resolve => preview.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await context.addInitScript(({ token, user }) => { localStorage.setItem('authToken', token); localStorage.setItem('user', JSON.stringify(user)); }, { token, user });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${preview.address().port}`);
    await check('browser inbox at 390px and detail show review history, no self-complete controls', async () => {
      await expect(page.getByText('Approvals & Reviews', { exact: true })).toBeVisible({ timeout: 30000 });
      await expect(page.getByText('Browser review task', { exact: true })).toBeVisible();
      await page.evaluate(taskId => window.reviewTest.open('TaskDetail', { taskId }), taskId);
      await expect(page.getByText('Round 1 · Submitted', { exact: true })).toBeVisible();
      assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: path.join(directory, 'review-detail-mobile.png'), fullPage: true });
    });
    await check('browser mandatory reason, length limit, modal cancel and keyboard typing', async () => {
      await page.getByRole('button', { name: 'Request changes', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
      await page.getByLabel('Reason for changes').fill(' ');
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
      await page.getByLabel('Reason for changes').fill('x'.repeat(1001));
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
      await page.getByLabel('Reason for changes').fill('Add acceptance tests');
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
      await page.waitForTimeout(400); // Let the modal fade settle for visual inspection.
      await page.screenshot({ path: path.join(directory, 'review-reason-mobile.png'), fullPage: true });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
    await check('browser approval updates detail and inbox count', async () => {
      const before = await page.evaluate(() => window.reviewTest.state().approvalsStats?.pending);
      await page.getByRole('button', { name: 'Approve', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(page.getByText('Round 1 · Approved', { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.reviewTest.state().approvalsStats?.pending)).toBe(before - 1);
      assert.equal(await page.evaluate(() => window.reviewTest.state().selectedTask.status), 'done');
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.evaluate(() => window.reviewTest.open('Approvals'));
      await expect(page.getByText('Approvals & Reviews', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(directory, 'review-inbox-wide.png'), fullPage: true });
    });
    await check('browser per-type settings roundtrip', async () => {
      await page.evaluate(() => window.reviewTest.open('Settings'));
      await expect(page.getByText('Task review notifications', { exact: true })).toBeVisible();
      const toggle = page.getByRole('switch', { name: 'Approvals in-app', exact: true });
      await toggle.click(); await expect(toggle).not.toBeChecked();
      await page.screenshot({ path: path.join(directory, 'review-settings-wide.png'), fullPage: true });
    });
    await check('browser selected review screens render without exceptions', async () => assert.deepEqual(errors, []));
    await context.close();
  } finally {
    if (browser) await browser.close(); if (preview) await new Promise(resolve => preview.close(resolve));
    if (metro.exitCode === null) {
      if (process.platform === 'win32') await new Promise(resolve => { const stop = spawn('taskkill', ['/PID', String(metro.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); stop.on('exit', resolve); });
      else metro.kill();
    }
    fs.writeFileSync(path.join(directory, 'metro.log'), logs.join(''));
  }
};
