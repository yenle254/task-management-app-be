const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
    required: true 
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  relatedId: { type: mongoose.Schema.Types.ObjectId, default: null },
  isRead: { type: Boolean, default: false },
}, { timestamps: true, collection: 'notifications' });


module.exports = mongoose.model('Notification', NotificationSchema);