const jwt = require('jsonwebtoken');
const User = require('../../../models/user.model');
const Message = require('../../../models/message.model');
const Conversation = require('../../../models/conversation.model');
const handler = require('../../../utils/socket-handler.utils');
const { EventEmitter } = require('events');
const a = 'a'.repeat(24), b = 'b'.repeat(24), c = 'c'.repeat(24), convId = 'd'.repeat(24);
let users, conversation, io, connected, authenticate, socket, handlers, stop;
const token = (id = a, options = {}) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h', ...options });

beforeEach(async () => {
  users = new Map([a, b, c].map(id => [id, { _id: id, isActive: true, role: 'employee', profile: { fullName: 'Person' } }]));
  conversation = { _id: convId, participants: [a, b], unreadCount: new Map(), save: jest.fn().mockResolvedValue() };
  jest.spyOn(User, 'findById').mockImplementation(id => ({ select: async () => users.get(String(id)) }));
  jest.spyOn(User, 'find').mockImplementation(() => ({ select: () => ({ lean: async () => [...users.values()] }) }));
  jest.spyOn(Conversation, 'findById').mockImplementation(async () => conversation);
  jest.spyOn(Conversation, 'findOne').mockImplementation(async () => conversation);
  jest.spyOn(Conversation, 'create').mockImplementation(async () => conversation);
  jest.spyOn(Message, 'create').mockImplementation(async data => ({ ...data, _id: 'e'.repeat(24), populate: jest.fn().mockResolvedValue(), createdAt: new Date() }));
  jest.spyOn(Message, 'updateMany').mockResolvedValue({ modifiedCount: 1 });
  handlers = new Map();
  socket = { id: 'socket-a', data: {}, handshake: { auth: { token: token() } },
    on: (event, fn) => handlers.set(event, fn), emit: jest.fn(), join: jest.fn(), leave: jest.fn(), disconnect: jest.fn(), broadcast: { emit: jest.fn() } };
  const room = { emit: jest.fn(), disconnectSockets: jest.fn() };
  io = { use: fn => { authenticate = fn; }, on: (_event, fn) => { connected = fn; },
    httpServer: new EventEmitter(), to: jest.fn(() => room), in: jest.fn(() => room), emit: jest.fn(), fetchSockets: async () => [socket] };
  stop = handler(io);
  const next = jest.fn(); await authenticate(socket, next); expect(next).toHaveBeenCalledWith();
  connected(socket);
});
afterEach(() => { handlers.get('disconnect')?.(); stop(); });

test.each(['missing', 'invalid', 'expired', 'inactive', 'unknown'])('handshake rejects %s credentials', async kind => {
  const candidate = { handshake: { auth: {} }, data: {} };
  if (kind === 'invalid') candidate.handshake.auth.token = 'bad';
  if (kind === 'expired') candidate.handshake.auth.token = token(a, { expiresIn: -1 });
  if (kind === 'inactive') { users.get(a).isActive = false; candidate.handshake.auth.token = token(); }
  if (kind === 'unknown') candidate.handshake.auth.token = token('f'.repeat(24));
  const next = jest.fn(); await authenticate(candidate, next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));
});
test('presence only includes user IDs', () => {
  expect(socket.broadcast.emit).toHaveBeenCalledWith('user_online', { userId: a });
  expect(socket.emit).toHaveBeenCalledWith('online_users', [a]);
  expect(JSON.stringify(socket.emit.mock.calls)).not.toContain('email');
});
test.each(['join_conversation', 'leave_conversation', 'send_message', 'mark_as_read', 'typing_start', 'typing_stop'])('%s rejects a non-participant without database mutation or room access', async event => {
  conversation.participants = [b, c];
  socket.join.mockClear();
  const data = ['join_conversation', 'leave_conversation'].includes(event) ? convId : { conversationId: convId, receiverId: b, message: 'hello' };
  await handlers.get(event)(data);
  expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  expect(socket.join).not.toHaveBeenCalled(); expect(socket.leave).not.toHaveBeenCalled();
  expect(Message.create).not.toHaveBeenCalled(); expect(Message.updateMany).not.toHaveBeenCalled();
  expect(conversation.save).not.toHaveBeenCalled();
});
test('join, leave, typing and read operate for participants', async () => {
  await handlers.get('join_conversation')(convId); await handlers.get('leave_conversation')(convId);
  expect(socket.join).toHaveBeenCalledWith(`conversation_${convId}`); expect(socket.leave).toHaveBeenCalledWith(`conversation_${convId}`);
  await handlers.get('typing_start')({ conversationId: convId, receiverId: b });
  await handlers.get('typing_stop')({ conversationId: convId, receiverId: b });
  await handlers.get('mark_as_read')({ conversationId: convId });
  expect(conversation.unreadCount.get(a)).toBe(0);
  expect(io.to(b).emit).toHaveBeenCalledWith('messages_read', { conversationId: convId, readBy: a });
});
test.each([null, {}, { receiverId: b, message: 'x'.repeat(6000) }, { receiverId: b, message: {} },
  { receiverId: 'invalid', message: 'hello' }, { receiverId: a, message: 'hello' }, { receiverId: b, message: ' ' },
  { receiverId: b, message: 'hello', $where: 'attack' }])('malformed/oversized message %j never writes', async data => {
  await handlers.get('send_message')(data);
  expect(Message.create).not.toHaveBeenCalled(); expect(socket.emit).toHaveBeenCalledWith('error', expect.any(Object));
});
test('receiver must be active and belong to the specified conversation', async () => {
  await handlers.get('send_message')({ receiverId: c, conversationId: convId, message: 'hello' });
  expect(Message.create).not.toHaveBeenCalled();
  users.get(b).isActive = false;
  await handlers.get('send_message')({ receiverId: b, message: 'hello' });
  expect(Message.create).not.toHaveBeenCalled();
});
test('valid message preserves acknowledgement and unread contract', async () => {
  await handlers.get('send_message')({ receiverId: b, conversationId: convId, tempId: 'temp-1', message: 'hello' });
  expect(Message.create).toHaveBeenCalledWith(expect.objectContaining({ senderId: a, message: 'hello' }));
  expect(conversation.unreadCount.get(b)).toBe(1);
  expect(socket.emit).toHaveBeenCalledWith('message_sent', expect.objectContaining({ tempId: 'temp-1', conversationId: convId }));
  expect(io.to(b).emit).toHaveBeenCalledWith('message_notification', expect.objectContaining({ senderId: a }));
});
test('new direct conversation only includes sender and receiver', async () => {
  Conversation.findOne.mockResolvedValue(null);
  await handlers.get('send_message')({ receiverId: b, message: 'hello' });
  expect(Conversation.create).toHaveBeenCalledWith(expect.objectContaining({ participants: [a, b] }));
});
test('per-user rate limit stops the 61st message', async () => {
  for (let i = 0; i < 61; i++) await handlers.get('send_message')({ receiverId: b, message: 'hello' });
  expect(Message.create).toHaveBeenCalledTimes(60);
  expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Too many socket events' });
});
test.each(['inactive', 'role', 'deleted', 'expired'])('idle sessions are revoked when %s changes', async reason => {
  if (reason === 'inactive') users.get(a).isActive = false;
  if (reason === 'role') users.get(a).role = 'team_lead';
  if (reason === 'deleted') users.delete(a);
  if (reason === 'expired') socket.data.expiresAt = Date.now() - 1;
  await handler.revalidateSessions(io);
  expect(socket.emit).toHaveBeenCalledWith('session_revoked', expect.any(Object)); expect(socket.disconnect).toHaveBeenCalledWith(true);
});
test('valid idle session remains connected and event-time role changes immediately revoke', async () => {
  await handler.revalidateSessions(io); expect(socket.disconnect).not.toHaveBeenCalled();
  users.get(a).role = 'team_lead';
  await handlers.get('join_conversation')(convId);
  expect(io.in(a).disconnectSockets).toHaveBeenCalledWith(true);
});
test('periodic idle check runs within 60s and shutdown stops it', async () => {
  stop(); jest.useFakeTimers();
  try {
    stop = handler(io); users.get(a).isActive = false;
    await jest.advanceTimersByTimeAsync(30000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    io.httpServer.emit('close');
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
test('database errors emit generic error without leaking details', async () => {
  Conversation.findById.mockRejectedValue(new Error('secret database connection string'));
  await handlers.get('join_conversation')(convId);
  expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unable to process socket event' });
});

test.each(['updateUser', 'deleteUser'])('%s controller immediately disconnects all sessions', async method => {
  jest.spyOn(require('../../../services/session.service'), 'revokeAllSessions').mockResolvedValue();
  const service = require('../../../services/user.service');
  const audit = require('../../../services/audit.service');
  const controller = require('../../../controllers/user.controller');
  const before = { _id: a, role: 'employee', isActive: true };
  const after = method === 'updateUser' ? { ...before, role: 'team_lead' } : { ...before, isActive: false };
  User.findById.mockReturnValue({ select: () => ({ lean: async () => before }) });
  jest.spyOn(service, method).mockResolvedValue(after);
  jest.spyOn(audit, 'changed').mockImplementation(() => {});
  const req = { params: { id: a }, body: method === 'updateUser' ? { role: 'team_lead' } : {}, app: { get: () => io } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller[method](req, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(io.to(a).emit).toHaveBeenCalledWith('session_revoked', expect.any(Object));
  expect(io.in(a).disconnectSockets).toHaveBeenCalledWith(true);
});

test('real Socket.IO transport: two authenticated users exchange a message and revoke an idle session', async () => {
  const http = require('http');
  const { Server } = require('socket.io');
  const { io: client } = require('../../../../project/node_modules/socket.io-client');
  const server = http.createServer();
  const real = new Server(server);
  const stopReal = handler(real);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const event = (socket, name) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 3000);
    socket.once(name, data => { clearTimeout(timeout); resolve(data); });
  });
  try {
    for (const id of [a, b]) {
      const socket = client(url, { auth: { token: token(id) }, transports: ['websocket'], forceNew: true });
      clients.push(socket); await event(socket, 'connect');
    }
    clients[1].emit('join_conversation', convId);
    // Wait for the actual server room membership before emitting to that room.
    for (let i = 0; i < 30 && !real.sockets.adapter.rooms.get(`conversation_${convId}`)?.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const received = event(clients[1], 'new_message');
    clients[0].emit('send_message', { receiverId: b, conversationId: convId, message: 'real transport' });
    expect((await received).message.message).toBe('real transport');
    const revoked = event(clients[1], 'session_revoked');
    users.get(b).isActive = false;
    await handler.revalidateSessions(real);
    expect((await revoked).reason).toBe('Session is no longer valid');
  } finally {
    clients.forEach(socket => socket.disconnect()); stopReal();
    await new Promise(resolve => real.close(resolve));
  }
});
