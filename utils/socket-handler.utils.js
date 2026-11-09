const { verifyToken } = require('../config/jwt');
const { assertAccessSession } = require('../services/session.service');
const User = require('../models/user.model');
const Message = require('../models/message.model');
const Conversation = require('../models/conversation.model');
const { hasUnsafeKeys } = require('../middleware/sanitize.middleware');
const { validateMessageAttachments } = require('../services/message-attachment.service');
const logger = require('./logger.utils');
const onlineUsers = new Map();
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const fail = message => { throw Object.assign(new Error(message), { public: true }); };

async function resolveSocketUser(token) {
  const decoded = verifyToken(token);
  const user = await User.findById(decoded.sub || decoded.id).select('-password +tokenVersion');
  if (!user?.isActive) throw Object.assign(new Error('Authentication error'), { code: 'session_revoked' });
  await assertAccessSession(decoded, user);
  return { user, decoded, expiresAt: decoded.exp * 1000 };
}
async function validateSocket(socket, user) {
  let code;
  if (!user?.isActive || user.role !== socket.data.role) code = 'session_revoked';
  else {
    try { await assertAccessSession({ ver: socket.data.ver, sid: socket.data.sid }, user); }
    catch (error) { if (!error.statusCode) throw error; code = 'session_revoked'; }
  }
  if (!code && Date.now() >= socket.data.expiresAt) code = 'token_expired';
  if (!code) return true;
  socket.emit('session_revoked', { reason: 'Session is no longer valid', code });
  socket.disconnect(true);
  return false;
}

async function requireParticipant(conversationId, userId) {
  if (!validId(conversationId)) fail('Not authorized');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation?.participants.some(id => String(id) === String(userId))) fail('Not authorized');
  return conversation;
}

function revokeUserSessions(io, userId, reason = 'Account permissions changed') {
  if (!io) return;
  io.to(String(userId)).emit('session_revoked', { reason });
  io.in(String(userId)).disconnectSockets(true);
}

async function revalidateSessions(io) {
  const sockets = await io.fetchSockets();
  if (!sockets.length) return;
  const ids = [...new Set(sockets.map(socket => socket.data.userId))];
  const users = await User.find({ _id: { $in: ids } }).select('isActive role +tokenVersion').lean();
  const current = new Map(users.map(user => [String(user._id), user]));
  for (const socket of sockets) {
    const user = current.get(socket.data.userId);
    await validateSocket(socket, user);
  }
}

const socketHandler = io => {
  const budgets = new Map();
  io.use(async (socket, next) => {
    try {
      const identity = await resolveSocketUser(socket.handshake.auth?.token);
      socket.user = identity.user;
      socket.data = { ...socket.data, userId: String(identity.user._id), role: identity.user.role,
        expiresAt: identity.expiresAt, ver: identity.decoded.ver ?? 0, sid: identity.decoded.sid };
      next();
    } catch (error) {
      const denied = new Error('Authentication error');
      denied.data = { code: ['invalid_token', 'token_expired', 'session_revoked'].includes(error.code) ? error.code : 'session_error' };
      next(denied);
    }
  });
  // Batch checks include idle sockets; 30s leaves headroom for scheduling/DB latency.
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try { await revalidateSessions(io); }
    catch { logger.error('Socket session revalidation failed'); }
    finally { checking = false; }
  }, 30000);
  timer.unref();
  const stop = () => clearInterval(timer);
  io.httpServer?.once('close', stop);

  io.on('connection', socket => {
    const userId = socket.data.userId;
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socket.join(userId);
    if (socket.data.sid) socket.join(`session:${socket.data.sid}`);
    socket.broadcast.emit('user_online', { userId });
    socket.emit('online_users', [...onlineUsers.keys()]);

    const handle = (event, callback) => socket.on(event, async data => {
      try {
        const now = Date.now();
        let budget = budgets.get(userId);
        if (!budget || now - budget.start >= 60000) {
          budget = { start: now, events: 0, messages: 0 };
          budgets.set(userId, budget);
        }
        if (++budget.events > 240 || (event === 'send_message' && ++budget.messages > 60)) fail('Too many socket events');
        if (hasUnsafeKeys(data)) fail('Invalid input');
        const current = await User.findById(userId).select('isActive role teamId profile email +tokenVersion');
        if (!current?.isActive || current.role !== socket.data.role) { revokeUserSessions(io, userId); return; }
        if (!await validateSocket(socket, current)) return;
        socket.user = current;
        await callback(data);
      } catch (error) {
        const message = error.public ? error.message : 'Unable to process socket event';
        socket.emit('error', { message });
        if (event === 'send_message') socket.emit('message_error', { tempId: data?.tempId, error: message });
        if (!error.public) logger.error('Socket event failed', { event, userId });
      }
    });
    handle('join_conversation', async id => {
      await requireParticipant(id, userId);
      await socket.join(`conversation_${id}`);
    });
    handle('leave_conversation', async id => {
      await requireParticipant(id, userId);
      await socket.leave(`conversation_${id}`);
    });
    handle('send_message', async data => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Invalid message');
      const { receiverId, conversationId, tempId } = data;
      const message = data.message ?? '';
      if (typeof message !== 'string') fail('Invalid message');
      if (message.length > 5000) fail('Message is too long');
      if (!validId(receiverId) || receiverId === userId) fail('Invalid receiver');
      let conversation;
      if (conversationId) {
        conversation = await requireParticipant(conversationId, userId);
        if (!conversation.participants.some(id => String(id) === receiverId)) fail('Not authorized');
      }
      const receiver = await User.findById(receiverId).select('isActive');
      if (!receiver?.isActive) fail('Receiver not found');
      const attachments = await validateMessageAttachments(data.attachments, socket.user);
      if (!message.trim() && !attachments.length) fail('Message or attachments are required');
      if (!conversation) {
        conversation = await Conversation.findOne({ participants: { $all: [userId, receiverId], $size: 2 } });
        if (!conversation) conversation = await Conversation.create({ participants: [userId, receiverId], unreadCount: new Map([[receiverId, 0]]) });
      }
      const newMessage = await Message.create({ conversationId: conversation._id, senderId: userId, message, attachments, isRead: false });
      conversation.lastMessage = message;
      conversation.lastMessageAt = new Date();
      conversation.unreadCount.set(receiverId, (conversation.unreadCount.get(receiverId) || 0) + 1);
      await conversation.save();
      await newMessage.populate('senderId', 'email profile');
      io.to(`conversation_${conversation._id}`).emit('new_message', { message: newMessage, conversationId: conversation._id, tempId });
      io.to(receiverId).emit('message_notification', { conversationId: conversation._id, senderId: userId,
        senderName: socket.user.profile?.fullName || socket.user.email, message, timestamp: newMessage.createdAt });
      socket.emit('message_sent', { tempId, message: newMessage, conversationId: conversation._id });
    });
    for (const [event, outgoing] of [['typing_start', 'user_typing'], ['typing_stop', 'user_stop_typing']]) {
      handle(event, async data => {
        const conversation = await requireParticipant(data?.conversationId, userId);
        if (!validId(data.receiverId) || !conversation.participants.some(id => String(id) === data.receiverId) || data.receiverId === userId) fail('Not authorized');
        io.to(data.receiverId).emit(outgoing, { conversationId: data.conversationId, userId,
          ...(event === 'typing_start' ? { userName: socket.user.profile?.fullName || '' } : {}) });
      });
    }
    handle('mark_as_read', async data => {
      const conversation = await requireParticipant(data?.conversationId, userId);
      await Message.updateMany({ conversationId: conversation._id, senderId: { $ne: userId }, isRead: false }, { isRead: true });
      conversation.unreadCount.set(userId, 0);
      await conversation.save();
      conversation.participants.filter(id => String(id) !== userId).forEach(id => {
        io.to(String(id)).emit('messages_read', { conversationId: conversation._id, readBy: userId });
      });
    });
    socket.on('disconnect', () => {
      const connections = onlineUsers.get(userId);
      connections?.delete(socket.id);
      if (connections?.size) return;
      onlineUsers.delete(userId);
      // Keep budget until its window ends; reconnecting must not reset it.
      io.emit('user_offline', { userId });
    });
  });
  const budgetCleanup = setInterval(() => {
    for (const [id, budget] of budgets) if (Date.now() - budget.start >= 60000) budgets.delete(id);
  }, 60000);
  budgetCleanup.unref();
  io.httpServer?.once('close', () => clearInterval(budgetCleanup));
  return () => { stop(); clearInterval(budgetCleanup); };
};
module.exports = socketHandler;
module.exports.isUserOnline = userId => Boolean(onlineUsers.get(String(userId))?.size);
module.exports.resolveSocketUser = resolveSocketUser;
module.exports.requireParticipant = requireParticipant;
module.exports.revokeUserSessions = revokeUserSessions;
module.exports.revalidateSessions = revalidateSessions;
