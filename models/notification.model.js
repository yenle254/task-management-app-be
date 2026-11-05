const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: [
      'task_submitted_for_review',
      'task_review_approved',
      'task_review_requested',
      'task_review_withdrawn',
      'task_review_reminder',
      'task_assigned',
      'task_updated',
      'task_completed',
      'comment_added',
      'deadline_reminder',
      'task_overdue',
      'attendance_reminder',
      'leave_starting',
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


NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, type: 1 });
module.exports = mongoose.model('Notification', NotificationSchema);
