const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true},
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, default: '' },
    attachments: [{
      name: String,
      url: String,
      type: String
    }],
    isRead: { type: Boolean, default: false },
  }, { timestamps: true });


module.exports = mongoose.model('Message', MessageSchema);