jest.mock('../../../models/user.model', () => ({ find: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../../models/task.model', () => ({ find: jest.fn() }));
jest.mock('../../../models/leave.model', () => ({ find: jest.fn(), exists: jest.fn() }));
jest.mock('../../../models/office.model', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/attendance.model', () => ({ findOne: jest.fn() }));
jest.mock('../../../services/notification.service', () => ({ createNotification: jest.fn(), initDelivery: jest.fn() }));
const User = require('../../../models/user.model'), Task = require('../../../models/task.model');
const Leave = require('../../../models/leave.model'), Office = require('../../../models/office.model');
const Attendance = require('../../../models/attendance.model'), notifications = require('../../../services/notification.service');
const scheduler = require('../../../services/reminder-scheduler.service');
const { minutes, shouldFire, dayKey } = require('../../../utils/reminder.helper');
const query = value => ({ select() { return this; }, lean() { return this; }, then(resolve) { return Promise.resolve(value).then(resolve); }, cursor() { return (async function* () { yield* value; })(); } });
let users, tasks, leaves, attendance, claims;
beforeEach(() => {
  users = [{ _id: 'u', role: 'employee' }]; tasks = []; leaves = []; attendance = null; claims = new Set();
  User.find.mockImplementation(() => query(users)); Task.find.mockImplementation(filter => query(filter.status === 'in_review' ? [] : tasks)); Leave.find.mockImplementation(() => query(leaves));
  Office.findOne.mockImplementation(() => query(null)); Attendance.findOne.mockImplementation(() => query(attendance)); Leave.exists.mockResolvedValue(null);
  User.updateOne.mockResolvedValue({});
  User.findOneAndUpdate.mockImplementation(filter => { const key = JSON.stringify(filter); const result = claims.has(key) ? null : { _id: 'u' }; claims.add(key); return query(result); });
  notifications.createNotification.mockResolvedValue({});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
const monday = (hour = 8, minute = 30) => new Date(2026, 9, 26, hour, minute);
test('time helpers reject malformed values and only catch up within five minutes', () => {
  expect(minutes('24:00')).toBeNull(); expect(minutes(null)).toBeNull(); expect(minutes('09:30')).toBe(570);
  expect(shouldFire(monday(), null, null, '09:00')).toBe(true);
  expect(shouldFire(monday(8, 35), null, null, '09:00')).toBe(false);
  expect(dayKey(monday())).toBe('20261026');
});
test('attendance fallback, repeated tick and durable receipts deduplicate', async () => {
  await scheduler.tick(monday()); await scheduler.tick(monday());
  expect(notifications.createNotification).toHaveBeenCalledTimes(1);
  expect(notifications.createNotification.mock.calls[0][1]).toBe('attendance_reminder');
});
test('approved leave, weekend and system admin suppress clock-in reminder', async () => {
  Leave.exists.mockResolvedValue({ _id: 'leave' }); await scheduler.tick(monday());
  Leave.exists.mockResolvedValue(null); await scheduler.tick(new Date(2026, 9, 25, 8, 30));
  users[0].role = 'system_admin'; await scheduler.tick(monday()); expect(notifications.createNotification).not.toHaveBeenCalled();
});
test('clock-out requires clock-in without clock-out, uses preference time', async () => {
  users[0].notificationPreferences = { reminderTimes: { clockOut: '16:00' } };
  attendance = { clockIn: monday() }; await scheduler.tick(monday(16, 0));
  expect(notifications.createNotification).toHaveBeenCalledTimes(1);
  attendance.clockOut = monday(16, 0); await scheduler.tick(monday(16, 1)); expect(notifications.createNotification).toHaveBeenCalledTimes(1);
});
test('task queries enforce 7-day bound, assignees deduplicate and leave reminders fire once', async () => {
  tasks = [{ _id: 't', title: 'Fixture', dueDate: monday(13), assignedTo: ['u', 'u'] }, { _id: 'o', title: 'Overdue', dueDate: monday(11), assignedTo: ['u'] }];
  leaves = [{ _id: 'l', userId: 'u' }]; await scheduler.tick(monday(12)); await scheduler.tick(monday(12));
  expect(notifications.createNotification).toHaveBeenCalledTimes(3);
  expect(notifications.createNotification.mock.calls.map(call => call[1])).toEqual(['deadline_reminder', 'task_overdue', 'leave_starting']);
  expect(Task.find.mock.calls[0][0].dueDate.$gte.getTime()).toBe(monday(12).getTime() - 7 * 86400000);
});
test('prune uses matching receipt timestamp; failed delivery retains claim', async () => {
  users[0].reminders = { old: { firedAt: new Date(2026, 0, 1) }, recent: { firedAt: monday() } };
  notifications.createNotification.mockRejectedValue(Error('fixture failure')); await scheduler.tick(monday()); await scheduler.tick(monday());
  expect(User.updateOne.mock.calls[0][0]['reminders.old.firedAt']).toEqual(new Date(2026, 0, 1));
  expect(notifications.createNotification).toHaveBeenCalledTimes(1);
});
test('start is disabled in tests and stop is safe', () => { scheduler.start({}); scheduler.stop(); expect(notifications.initDelivery).not.toHaveBeenCalled(); });

test('stop waits for the active reminder run before database shutdown', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  Office.findOne.mockReturnValue({ select: () => ({ lean: () => pending }) });
  const run = scheduler.tick(monday());
  let stopped = false;
  const stopping = scheduler.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  release(null); await Promise.all([run, stopping]);
  expect(stopped).toBe(true);
});
