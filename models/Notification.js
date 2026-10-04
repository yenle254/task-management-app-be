const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: [
      'task_assigned',
      'task_updated',
      'task_completed',
      'comment_added',
      'deadline_reminder',
      'leave_approved',
      'leave_rejected',
      'leave_pending'
    ],
    required: true,
    index: true
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  relatedId: { type: mongoose.Schema.Types.ObjectId, default: null },
  isRead: { type: Boolean, default: false, index: true },
}, {
  timestamps: true,
  collection: 'notifications',
  indexes: [
      { userId: 1, isRead: 1 },         // Unread count, filter unread
      { userId: 1, createdAt: -1 },     // Paginate notifications
      { userId: 1, type: 1 }            // Filter by type
  ]
});


module.exports = mongoose.model('Notification', NotificationSchema);