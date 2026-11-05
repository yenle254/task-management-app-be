const { idOf } = require('./task-advanced.service');
const TYPES = {
  submitForReview: ['task_submitted_for_review', 'Task awaiting review'],
  approveReview: ['task_review_approved', 'Task approved'],
  requestChanges: ['task_review_requested', 'Changes requested'],
  withdrawSubmission: ['task_review_withdrawn', 'Submission withdrawn']
};
async function notify({ operation, task, actorId, reason }) {
  try {
    const [type, title] = TYPES[operation];
    const reviewerEvent = ['submitForReview', 'withdrawSubmission'].includes(operation);
    const recipients = reviewerEvent ? (task.review?.approverSnapshot || []).filter(entry => entry.active !== false).map(entry => entry.userId)
      : [...task.assignedTo, task.assignedBy];
    const ids = [...new Set(recipients.map(idOf))].filter(id => id && id !== idOf(actorId));
    if (ids.length) await require('./notification.service').createBulkNotifications(ids, type, title,
      `${task.title}${reason ? ': ' + reason : ''}`.slice(0, 500), task._id);
  } catch (error) { console.warn('Task review notification failed:', error.name); }
}
module.exports = { notify };
