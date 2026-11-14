const Task = require('../models/task.model');
const Message = require('../models/message.model');
const Conversation = require('../models/conversation.model');
const User = require('../models/user.model');
const { canUserViewTask } = require('./task.service');
const validFilename = filename => typeof filename === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) && !filename.includes('..');

async function resolveFileAccess(filename, user) {
  if (!validFilename(filename)) return null;
  const tasks = await Task.find({ $or: [{ 'attachments.filename': filename }, { 'pendingAttachmentDeletes.filename': filename }] })
    .populate('teamId', 'leaderId').lean();
  if (tasks.length) {
    const task = tasks.find(task => task.status !== 'deleted' &&
      task.attachments?.some(item => item.filename === filename) && canUserViewTask(user, task));
    return task ? { name: task.attachments.find(item => item.filename === filename).name || filename } : null;
  }
  // General uploads are also used by chat: authorize recipients through their conversation.
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const messages = await Message.find({ 'attachments.url': { $regex: `/uploads/${escaped}$` } })
    .select('conversationId attachments').lean();
  if (messages.length) {
    const conversation = await Conversation.findOne({ _id: { $in: messages.map(item => item.conversationId) }, participants: user._id }).lean();
    return conversation ? { name: filename } : null;
  }
  const ownerId = filename.split('-')[0];
  // Profile photos are visible to signed-in colleagues. Only an image owned by
  // the profile owner can become an avatar; task/chat ACLs above retain priority.
  if (/^[a-f0-9]{24}$/i.test(ownerId) && /\.(jpe?g|png|gif|webp)$/i.test(filename)) {
    const profile = await User.findOne({
      _id: ownerId,
      isActive: true,
      'profile.avatar': { $regex: `/(uploads|api/files)/${escaped}$` },
    }).select('_id').lean();
    if (profile) return { name: filename };
  }
  return (ownerId === String(user._id) || user.role === 'hr_manager') ? { name: filename } : null;
}


module.exports = { resolveFileAccess, validFilename };
