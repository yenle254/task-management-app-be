const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastMessage: { type: String },
    lastMessageAt: { type: Date },
    unreadCount: { 
      type: Map, 
      of: Number,
      default: {}
    }
  }, { timestamps: true, collection: 'conversations' });


module.exports = mongoose.model('Conversation', ConversationSchema);