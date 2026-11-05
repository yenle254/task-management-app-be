const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
    name: String,
    url: String,
    type: String
}, { _id: false });

const MessageSchema = new mongoose.Schema({
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true},
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, default: '' },
    // Explicit subdocument schema: the inline object-array shorthand
    // ({name,url,type: String}) is mis-parsed as a string array because of
    // the nested `type` key, breaking object attachment casting.
    attachments: [AttachmentSchema],
    isRead: { type: Boolean, default: false },
  }, { timestamps: true });


module.exports = mongoose.model('Message', MessageSchema);