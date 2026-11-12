jest.mock('../../../services/audit.service', () => ({ record: jest.fn(), context: () => ({ route: '/test' }) }));
const express = require('express');
const request = require('supertest');
const fs = require('fs/promises');
const path = require('path');
const jwt = require('jsonwebtoken');
const User = require('../../../models/user.model');
const Task = require('../../../models/task.model');
const Message = require('../../../models/message.model');
const Conversation = require('../../../models/conversation.model');
const { securityHeaders } = require('../../../config/security.config');
const sanitize = require('../../../middleware/sanitize.middleware');
const fileRoutes = require('../../../routes/file.routes');
const uploadRoutes = require('../../../routes/upload.routes');
const { resolveFileAccess } = require('../../../middleware/file-access.middleware');
const { validateMessageAttachments, validateTaskAttachments } = require('../../../services/message-attachment.service');
const { matchesSignature } = require('../../../utils/file-signature.helper');
const { inventory } = require('../../../scripts/audit-uploads');
const owner = 'a'.repeat(24), outsider = 'b'.repeat(24), team = 'c'.repeat(24);
const filename = `${owner}-security-${process.pid}.png`;
const htmlName = `${owner}-security-${process.pid}.html`;
const directory = path.resolve(__dirname, '../../../uploads');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
let actor, tasks, messages, conversation;
const token = (id = owner, options = {}) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h', ...options });
const api = () => {
  const app = express();
  app.use(securityHeaders(), express.json(), sanitize);
  app.use('/uploads', fileRoutes); app.use('/api/files', fileRoutes); app.use('/api/upload', uploadRoutes);
  app.use((_req, res) => res.status(404).json({ success: false }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  return app;
};
beforeAll(async () => {
  await fs.writeFile(path.join(directory, filename), png);
  await fs.writeFile(path.join(directory, htmlName), '<script>alert(1)</script>');
});
afterAll(async () => {
  await fs.unlink(path.join(directory, filename));
  await fs.unlink(path.join(directory, htmlName));
});
beforeEach(() => {
  // These fixtures use legacy tokens issued within the bounded rollout window.
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-07T12:00:00Z'));
  actor = { _id: owner, role: 'employee', isActive: true };
  tasks = [{ assignedBy: owner, assignedTo: [], status: 'todo', attachments: [{ filename, name: 'Original image.png' }], teamId: team }];
  messages = []; conversation = null;
  jest.spyOn(User, 'findById').mockImplementation(() => ({ select: async () => actor }));
  jest.spyOn(Task, 'find').mockImplementation(() => ({ populate: () => ({ lean: async () => tasks }) }));
  jest.spyOn(Message, 'find').mockImplementation(() => ({ select: () => ({ lean: async () => messages }) }));
  jest.spyOn(Conversation, 'findOne').mockImplementation(() => ({ lean: async () => conversation }));
});
test.each(['/uploads/', `/uploads/${filename}`, `/api/files/${filename}`])('anonymous private route %s returns 401', async url => {
  expect((await request(api()).get(url)).status).toBe(401);
});
test('real task/admin routes retain authentication and role restrictions', async () => {
  const secured = express();
  secured.use('/api/tasks', require('../../../routes/task.routes'));
  secured.use('/api/admin', require('../../../routes/admin.routes'));
  expect((await request(secured).get('/api/tasks')).status).toBe(401);
  expect((await request(secured).get('/api/tasks').set('Authorization', 'Bearer invalid')).status).toBe(401);
  expect((await request(secured).get('/api/tasks').set('Authorization', `Bearer ${token(owner, { expiresIn: -1 })}`)).status).toBe(401);
  expect((await request(secured).get('/api/tasks').set('Authorization', `Bearer ${token()}`)).status).toBe(403);
  expect((await request(secured).get('/api/admin/audit-logs').set('Authorization', `Bearer ${token()}`)).status).toBe(403);
  actor.isActive = false;
  expect((await request(secured).get('/api/tasks').set('Authorization', `Bearer ${token()}`)).status).toBe(401);
});
test('production cannot disable private files with the rollback flag', async () => {
  const environment = process.env.NODE_ENV, flag = process.env.PRIVATE_FILES_ENABLED;
  try {
    process.env.NODE_ENV = 'production'; process.env.PRIVATE_FILES_ENABLED = 'false';
    expect((await request(api()).get(`/uploads/${filename}`)).status).toBe(401);
    expect((await request(api()).get('/uploads/')).status).toBe(401);
  } finally {
    process.env.NODE_ENV = environment;
    if (flag === undefined) delete process.env.PRIVATE_FILES_ENABLED; else process.env.PRIVATE_FILES_ENABLED = flag;
  }
});
test.each(['invalid', 'expired', 'inactive', 'missing'])('file authentication rejects %s', async kind => {
  let credential = token();
  if (kind === 'invalid') credential += 'bad';
  if (kind === 'expired') credential = token(owner, { expiresIn: -1 });
  if (kind === 'inactive') actor.isActive = false;
  if (kind === 'missing') actor = null;
  expect((await request(api()).get(`/uploads/${filename}`).set('Authorization', `Bearer ${credential}`)).status).toBe(401);
});
test.each(['creator', 'assignee', 'hr', 'lead'])('authorized %s downloads original bytes safely', async role => {
  if (role !== 'creator') {
    actor._id = outsider;
    if (role === 'assignee') tasks[0].assignedTo = [outsider];
    if (role === 'hr') actor.role = 'hr_manager';
    if (role === 'lead') { actor.role = 'team_lead'; actor.teamId = team; }
  }
  const result = await request(api()).get(`/api/files/${filename}`).set('Authorization', `Bearer ${token(actor._id)}`);
  expect(result.status).toBe(200); expect(result.body).toEqual(png);
  expect(result.headers['content-disposition']).toContain('attachment;');
  expect(result.headers['content-disposition']).toContain('Original image.png');
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(result.headers['cache-control']).toContain('no-store');
});
test('unrelated employee and unrelated team lead get the same 404', async () => {
  actor._id = outsider;
  expect((await request(api()).get(`/uploads/${filename}`).set('Authorization', `Bearer ${token()}`)).status).toBe(404);
  actor.role = 'team_lead'; actor.teamId = 'd'.repeat(24);
  expect((await request(api()).get(`/uploads/${filename}`).set('Authorization', `Bearer ${token()}`)).status).toBe(404);
});
test('deleted task and pending attachment deletion cannot fall back to uploader access', async () => {
  tasks[0].status = 'deleted';
  expect(await resolveFileAccess(filename, actor)).toBeNull();
  tasks[0].status = 'todo'; tasks[0].attachments = [];
  expect(await resolveFileAccess(filename, actor)).toBeNull();
});
test('query credentials work only on file routes; header takes precedence', async () => {
  expect((await request(api()).get(`/uploads/${filename}?access_token=${token()}`)).status).toBe(200);
  expect((await request(api()).get(`/uploads/${filename}?access_token=${token()}`).set('Authorization', 'Bearer invalid')).status).toBe(401);
  expect((await request(api()).post(`/api/upload?access_token=${token()}`)).status).toBe(401);
});
test.each(['/uploads/%2e%2e%5c.env', '/uploads/file%00.png', '/uploads/.env', '/uploads/..%2f.env', '/api/files/missing.png'])('traversal/missing path %s never exposes data', async url => {
  expect((await request(api()).get(url).set('Authorization', `Bearer ${token()}`)).status).toBe(404);
});
test('orphan file stays private to uploader/HR, and legacy HTML is forced to download', async () => {
  tasks = [];
  expect(await resolveFileAccess(filename, actor)).not.toBeNull();
  actor._id = outsider; expect(await resolveFileAccess(filename, actor)).toBeNull();
  actor.role = 'hr_manager'; expect(await resolveFileAccess(filename, actor)).not.toBeNull();
  const result = await request(api()).get(`/uploads/${htmlName}`).set('Authorization', `Bearer ${token()}`);
  expect(result.status).toBe(200); expect(result.headers['content-type']).toBe('application/octet-stream');
  expect(result.headers['content-security-policy']).toContain('sandbox');
});
test('chat attachment recipients require conversation membership', async () => {
  tasks = []; messages = [{ conversationId: 'd'.repeat(24) }]; actor._id = outsider;
  expect(await resolveFileAccess(filename, actor)).toBeNull();
  conversation = { _id: 'd'.repeat(24) };
  expect(await resolveFileAccess(filename, actor)).not.toBeNull();
  expect(Conversation.findOne).toHaveBeenCalledWith(expect.objectContaining({ participants: outsider }));
});
test('message attachments cannot smuggle another user file or persist a query token', async () => {
  const item = { name: 'image.png', type: 'image', url: `https://old-host.test/uploads/${filename}` };
  expect(await validateMessageAttachments([item], actor)).toEqual([{ ...item, url: `/uploads/${filename}` }]);
  for (const bad of [null, {}, { ...item, url: item.url + '?access_token=secret' }, { ...item, url: 'javascript:alert(1)' }]) {
    await expect(validateMessageAttachments([bad], actor)).rejects.toThrow();
  }
  actor._id = outsider;
  await expect(validateMessageAttachments([item], actor)).rejects.toThrow();
  await expect(validateMessageAttachments(Array(6).fill(item), actor)).rejects.toThrow();
});
test('task creation cannot launder unauthorized filenames into accessible attachment metadata', async () => {
  const item = { filename, name: 'photo.png', type: 'image/png', url: 'https://evil.test/steal' };
  expect(await validateTaskAttachments([item], actor)).toEqual([{ ...item, url: `/uploads/${filename}` }]);
  actor._id = outsider;
  await expect(validateTaskAttachments([item], actor)).rejects.toThrow();
  await expect(validateTaskAttachments([{ ...item, filename: '../.env' }], actor)).rejects.toThrow();
});
test.each(['evil.html', 'shell.php', 'vector.svg', 'app.exe', 'fake.pdf', 'fake.png', 'fake.docx'])('upload rejects unsafe or mislabelled %s', async name => {
  const result = await request(api()).post('/api/upload').set('Authorization', `Bearer ${token()}`)
    .attach('file', Buffer.from('<html>bad</html>'), { filename: name, contentType: 'application/octet-stream' });
  expect(result.status).toBe(400);
});
test('real PNG upload is sniffed and returned with private URL', async () => {
  const result = await request(api()).post('/api/upload').set('Authorization', `Bearer ${token()}`)
    .attach('file', png, { filename: 'image.png', contentType: 'application/octet-stream' });
  try { expect(result.status).toBe(200); expect(result.body.mimetype).toBe('image/png'); }
  finally { if (result.body.filename) await fs.unlink(path.join(directory, result.body.filename)); }
});
test('inclusive 10 MiB boundary, oversized files, bulk count and cleanup', async () => {
  const upload = require('../../../middleware/upload.middleware');
  const bulk = express();
  bulk.use((req, _res, next) => { req.user = actor; next(); });
  bulk.post('/', upload.uploadMultiple, upload.uploadErrorHandler, (req, res) => res.json(req.files));
  const oversized = await request(api()).post('/api/upload').set('Authorization', `Bearer ${token()}`)
    .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 65), 'large.txt');
  expect(oversized.status).toBe(400); expect(oversized.body.error).toMatch(/File too large/);
  const exact = await request(api()).post('/api/upload').set('Authorization', `Bearer ${token()}`)
    .attach('file', Buffer.alloc(10 * 1024 * 1024, 65), 'exact.txt');
  try { expect(exact.status).toBe(200); } finally { if (exact.body.filename) await fs.unlink(path.join(directory, exact.body.filename)); }
  let req = request(bulk).post('/');
  for (let i = 0; i < 6; i++) req = req.attach('attachments', png, `image${i}.png`);
  const result = await req;
  expect(result.status).toBe(400); expect(result.body.error).toMatch(/Maximum 5 files/);
});
test.each([['jpg', 'ffd8ff'], ['gif', '474946383961'], ['pdf', '255044462d'], ['webp', '524946460000000057454250'],
  ['zip', '504b0304'], ['docx', '504b0506'], ['xlsx', '504b0708'], ['doc', 'd0cf11e0a1b11ae1'], ['rar', '526172211a0700'], ['txt', '6869']])('signature %s accepted, fake bytes rejected', (ext, hex) => {
  expect(matchesSignature(Buffer.from(hex, 'hex'), ext)).toBe(true);
  expect(matchesSignature(Buffer.from([0]), ext)).toBe(false);
});
test('inventory is read-only and reports missing references', async () => {
  const result = await inventory([{ attachments: [{ filename: 'missing-test.png' }] }], directory);
  expect(result.missing).toEqual(['missing-test.png']);
  expect(result.invalidSignatures).toContain(htmlName);
});
