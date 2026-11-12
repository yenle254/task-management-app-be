// Real browser + real HTTP middleware, in-memory model stubs; never connects to MongoDB.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'security-browser-fixture-secret';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const { securityHeaders, permissionsPolicy } = require('../config/security.config');
const sanitize = require('../middleware/sanitize.middleware');
const { setupSwagger, swaggerSpec } = require('../config/swagger.config');
const User = require('../models/user.model');
const Task = require('../models/task.model');
const audit = require('../services/audit.service');
const output = path.resolve(__dirname, '../report/security-browser');
const userId = 'a'.repeat(24);
const filename = `${userId}-browser-${process.pid}.png`;
const fullPath = path.resolve(__dirname, '../uploads', filename);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=', 'base64');

async function main() {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(fullPath, png);
  User.findById = () => ({ select: async () => ({ _id: userId, isActive: true, role: 'employee' }) });
  Task.find = () => ({ populate: () => ({ lean: async () => [{ assignedBy: userId, assignedTo: [],
    status: 'todo', attachments: [{ filename, name: 'original-image.png' }] }] }) });
  audit.record = () => {};
  const app = express();
  app.use(securityHeaders(), permissionsPolicy, express.json(), sanitize);
  app.use('/uploads', require('../routes/file.routes'));
  app.use('/api/files', require('../routes/file.routes'));
  app.get('/security-health', (_req, res) => res.json({ success: true }));
  swaggerSpec.paths = { '/security-health': { get: { summary: 'Security browser fixture', responses: { 200: { description: 'OK' } } } } };
  swaggerSpec.servers = [{ url: '/' }];
  setupSwagger(app);
  let origin;
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '5m' });
  app.get('/preview', (_req, res) => res.type('html').send('<!doctype html><html><body><h1>Private attachment verification</h1><img id="preview" alt="Private image"><a id="download">Download original</a><script src="/preview.js"></script></body></html>'));
  app.get('/preview.js', async (_req, res) => {
    const helper = (await fs.readFile(path.resolve(__dirname, '../../project/src/utils/fileUrlHelper.js'), 'utf8'))
      .replace(/^import .*;\r?\n/m, '').replaceAll('export const ', 'const ');
    res.type('js').send(`const API_CONFIG = ${JSON.stringify({ BASE_URL: origin + '/api' })};\n${helper}\n` +
      `document.querySelector('#preview').src = getAuthenticatedFileUrl(${JSON.stringify('/uploads/' + filename)}, ${JSON.stringify(token)});` +
      `document.querySelector('#download').href = getAuthenticatedFileUrl(${JSON.stringify('/api/files/' + filename)}, ${JSON.stringify(token)});`);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    page.on('console', message => { if (message.type() === 'error') console.error('Browser:', message.text().split('?')[0]); });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const violations = [];
    await page.addInitScript(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.effectiveDirective)); });
    await page.goto(origin + '/api-docs/');
    await page.screenshot({ path: path.join(output, 'swagger-initial.png'), fullPage: true });
    console.log('Swagger page:', (await page.locator('body').innerText()).slice(0, 300));
    await page.getByText('Security browser fixture', { exact: true }).click();
    await page.getByRole('button', { name: 'Try it out' }).click();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.responses-inner')?.textContent.includes('"success": true'));
    violations.push(...await page.evaluate(() => window.cspViolations));
    await page.screenshot({ path: path.join(output, 'swagger.png'), fullPage: true });
    assert.equal((await page.request.get(origin + '/uploads/' + filename)).status(), 401);
    await page.goto(origin + '/preview');
    await page.waitForFunction(() => document.querySelector('#preview').naturalWidth > 0);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'original-image.png');
    await download.saveAs(path.join(output, 'download.png'));
    assert.deepEqual(await fs.readFile(path.join(output, 'download.png')), png);
    violations.push(...await page.evaluate(() => window.cspViolations));
    await page.screenshot({ path: path.join(output, 'private-preview.png') });
    assert.deepEqual(errors, []); assert.deepEqual(violations, []);
    console.log('PASS Swagger renders and executes a request under CSP; anonymous file blocked; frontend URL helper displays authenticated image; downloaded bytes match; no CSP violations or page errors.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(fullPath);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
