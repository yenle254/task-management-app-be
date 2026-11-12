const Task = require('../models/task.model');
const Message = require('../models/message.model');
const Conversation = require('../models/conversation.model');
const { canUserAccessTask } = require('./task.service');
const validFilename = filename => typeof filename === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) && !filename.includes('..');

async function resolveFileAccess(filename, user) {
  if (!validFilename(filename)) return null;
  const tasks = await Task.find({ $or: [{ 'attachments.filename': filename }, { 'pendingAttachmentDeletes.filename': filename }] })
    .populate('teamId', 'leaderId').lean();
  if (tasks.length) {
    const task = tasks.find(task => task.status !== 'deleted' &&
      task.attachments?.some(item => item.filename === filename) && canUserAccessTask(user, task));
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
  return (ownerId === String(user._id) || user.role === 'hr_manager') ? { name: filename } : null;
}


module.exports = { resolveFileAccess, validFilename };
