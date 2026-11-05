jest.mock('../../../models/user.model', () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../../utils/socket-handler.utils', () => ({ isUserOnline: jest.fn() }));
jest.mock('axios', () => ({ post: jest.fn() }));
const User = require('../../../models/user.model');
const axios = require('axios');
const { isUserOnline } = require('../../../utils/socket-handler.utils');
const delivery = require('../../../services/notification-delivery.service');
const push = require('../../../services/expo-push.service');
const { preferences, categoryFor, targetFor } = require('../../../utils/notification-preferences.helper');

const notification = { _id: 'n', userId: 'u', type: 'task_assigned', title: 'Title', message: 'Body', relatedId: 't' };
let user, emit;
beforeEach(() => {
  user = { isActive: true, pushToken: 'ExpoPushToken[fixture]', notificationPreferences: preferences() };
  User.findById.mockImplementation(() => ({ select: () => ({ lean: async () => user }) }));
  User.updateOne.mockResolvedValue({ modifiedCount: 1 });
  axios.post.mockResolvedValue({ data: { data: { status: 'ok', id: 'ticket' } } });
  emit = jest.fn(); delivery.initDelivery({ to: jest.fn(() => ({ emit })) });
  process.env.EXPO_ACCESS_TOKEN = 'fixture-token';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { delete process.env.EXPO_ACCESS_TOKEN; });
test('legacy defaults and category/target mapping', () => {
  expect(preferences().categories.attendance.push).toBe(true);
  expect(preferences({ master: false, categories: { task: { inApp: false } } }).categories.leave.inApp).toBe(true);
  expect(categoryFor('leave_starting')).toBe('leave'); expect(targetFor('attendance_reminder')).toBe('attendance');
});
test('online receives one socket event and no push', async () => {
  isUserOnline.mockReturnValue(true); await delivery.deliver(notification);
  expect(emit).toHaveBeenCalledTimes(1); expect(emit).toHaveBeenCalledWith('notification_created', { notification });
  expect(axios.post).not.toHaveBeenCalled();
});
test('offline receives push with account-scoped routing payload', async () => {
  isUserOnline.mockReturnValue(false); await delivery.deliver(notification);
  expect(emit).not.toHaveBeenCalled(); expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1].data).toEqual({ type: 'task_assigned', relatedId: 't', target: 'task_detail', userId: 'u' });
});
test.each(['master', 'push', 'category', 'inactive', 'missingToken'])('disabled %s suppresses offline push', async mode => {
  isUserOnline.mockReturnValue(false);
  if (mode === 'master' || mode === 'push') user.notificationPreferences[mode] = false;
  if (mode === 'category') user.notificationPreferences.categories.task.push = false;
  if (mode === 'inactive') user.isActive = false;
  if (mode === 'missingToken') user.pushToken = null;
  await delivery.deliver(notification); expect(axios.post).not.toHaveBeenCalled();
});
test('in-app disabled while online does not fall back to duplicate push', async () => {
  isUserOnline.mockReturnValue(true); user.notificationPreferences.categories.task.inApp = false;
  await delivery.deliver(notification); expect(emit).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
});
test('no user/uninitialized delivery/storage failure are non-fatal', async () => {
  user = null; await delivery.deliver(notification);
  User.findById.mockImplementation(() => { throw Error('fixture'); }); await expect(delivery.deliver(notification)).resolves.toBeUndefined();
  delivery.initDelivery(null); await delivery.deliver(notification);
});
test('missing access token skips network; token invalidation is conditional', async () => {
  delete process.env.EXPO_ACCESS_TOKEN; await push.send({ to: 'old' }); expect(axios.post).not.toHaveBeenCalled();
  process.env.EXPO_ACCESS_TOKEN = 'fixture';
  axios.post.mockResolvedValue({ data: { data: { status: 'error', details: { error: 'DeviceNotRegistered' } } } });
  await push.send({ userId: 'u', to: 'old' });
  expect(User.updateOne).toHaveBeenCalledWith({ _id: 'u', pushToken: 'old' }, { $unset: { pushToken: '' } });
});
test.each([400, 404, 429, 500])('HTTP %s preserves token and never throws', async status => {
  axios.post.mockRejectedValue({ response: { status } });
  await expect(push.send({ userId: 'u', to: 'old' })).resolves.toBeUndefined(); expect(User.updateOne).not.toHaveBeenCalled();
});
