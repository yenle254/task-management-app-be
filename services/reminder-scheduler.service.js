const User = require('../models/user.model');
const Task = require('../models/task.model');
const Leave = require('../models/leave.model');
const Office = require('../models/office.model');
const Attendance = require('../models/attendance.model');
const { isWorkingDay } = require('./attendance.service');
const notifications = require('./notification.service');
const { preferences } = require('../utils/notification-preferences.helper');
const { dayKey, shouldFire, dayRange } = require('../utils/reminder.helper');
const DAY = 86400000;
let timer, running = false, warnedOffice = false;

async function claimAndNotify(userId, key, now, type, title, message, relatedId = null) {
  const claimed = await User.findOneAndUpdate({ _id: userId, isActive: true, [`reminders.${key}`]: { $exists: false } },
    { $set: { [`reminders.${key}`]: { firedAt: now, refKey: relatedId ? String(relatedId) : dayKey(now) } } }, { new: false }).select('_id').lean();
  if (!claimed) return false;
  // Best effort: a failed send/write retains the receipt. Never blindly retry after a crash.
  try { await notifications.createNotification(userId, type, title, message, relatedId); }
  catch (error) { console.warn('Reminder delivery failed:', error.name); }
  return true;
}

async function tick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const { start, end } = dayRange(now);
    const office = await Office.findOne({ isActive: true }).select('workingHours').lean();
    if (!office && !warnedOffice) { console.warn('Reminder scheduler: no active office; using 09:00/18:00'); warnedOffice = true; }
    // Cursor bounds memory. Internal receipts are explicitly selected, never exposed in profile APIs.
    for await (const user of User.find({ isActive: true }).select({ role: 1, notificationPreferences: 1, reminders: 1 }).lean().cursor()) {
      for (const [key, receipt] of Object.entries(user.reminders || {})) {
        if (new Date(receipt.firedAt).getTime() < now.getTime() - 8 * DAY) {
          await User.updateOne({ _id: user._id, [`reminders.${key}.firedAt`]: receipt.firedAt }, { $unset: { [`reminders.${key}`]: '' } });
        }
      }
      if (user.role === 'system_admin' || !isWorkingDay(now)) continue;
      const prefs = preferences(user.notificationPreferences);
      const clockInDue = shouldFire(now, prefs.reminderTimes.clockIn, office?.workingHours?.start, '09:00');
      const clockOutDue = shouldFire(now, prefs.reminderTimes.clockOut, office?.workingHours?.end, '18:00');
      if (!clockInDue && !clockOutDue) continue;
      const attendance = await Attendance.findOne({ userId: user._id, date: { $gte: start, $lt: end } }).select('clockIn clockOut').lean();
      if (clockInDue && !attendance?.clockIn) {
        const leave = await Leave.exists({ userId: user._id, status: 'approved', startDate: { $lt: end }, endDate: { $gte: start } });
        if (!leave) await claimAndNotify(user._id, `attendance_in_${dayKey(now)}`, now, 'attendance_reminder',
          'Attendance reminder', 'Remember to clock in. Open the app to record your attendance.');
      }
      if (clockOutDue && attendance?.clockIn && !attendance.clockOut) await claimAndNotify(user._id, `attendance_out_${dayKey(now)}`, now,
        'attendance_reminder', 'Attendance reminder', 'It is time to clock out.');
    }
    for await (const task of Task.find({ status: { $in: ['todo', 'in_progress'] },
      dueDate: { $gte: new Date(now.getTime() - 7 * DAY), $lte: new Date(now.getTime() + DAY) }
    }).select('title dueDate assignedTo').lean().cursor()) {
      const overdue = new Date(task.dueDate) < now;
      for (const userId of [...new Set(task.assignedTo.map(String))]) await claimAndNotify(userId,
        `task_${overdue ? 'overdue' : 'due'}_${task._id}_${dayKey(now)}`, now,
        overdue ? 'task_overdue' : 'deadline_reminder', overdue ? 'Task overdue' : 'Deadline approaching',
        `Task "${task.title}" ${overdue ? 'is overdue' : 'is due within 24 hours'}.`, task._id);
    }
    for await (const leave of Leave.find({ status: 'approved', startDate: { $gte: now, $lte: new Date(now.getTime() + DAY) } })
      .select('userId startDate').lean().cursor()) {
      await claimAndNotify(leave.userId, `leave_starting_${leave._id}`, now, 'leave_starting', 'Leave starting soon',
        'Your approved leave starts within 24 hours.', leave._id);
    }
  } finally { running = false; }
}

function start(io) {
  if (timer || process.env.NODE_ENV === 'test') return;
  notifications.initDelivery(io);
  const run = () => tick().catch(error => console.warn('Reminder tick failed:', error.name));
  timer = setInterval(run, 60000);
  timer.unref?.();
  run();
}
function stop() { clearInterval(timer); timer = null; }
module.exports = { start, stop, tick, claimAndNotify };
