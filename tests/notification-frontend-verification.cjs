const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../project');
const frontendRequire = createRequire(path.join(root, 'package.json'));
const babel = frontendRequire('@babel/core');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}) {
  const cache = new Map(), storage = new Map(), calls = [], listeners = {};
  const prefs = { master: true, push: true, sound: true, categories: Object.fromEntries(['task','leave','attendance'].map(c => [c, { inApp: true, push: true }])), reminderTimes: { clockIn: null, clockOut: null } };
  const api = {
    get: async url => ({ data: url.includes('preferences') ? prefs : url.includes('/unread/') ? { unreadCount: 0 } : [] }),
    put: async (url, data) => { calls.push(['put', url, data]); return { data: { ...prefs, ...data } }; },
    post: async (url, data) => { calls.push(['post', url, data]); return { data: {} }; },
    delete: async url => { calls.push(['delete', url]); return { data: {} }; }, ...overrides.api
  };
  const notifications = {
    getPermissionsAsync: async () => ({ granted: true }), requestPermissionsAsync: async () => ({ granted: true }),
    setNotificationChannelAsync: async () => {}, AndroidImportance: { DEFAULT: 3 },
    getExpoPushTokenAsync: async options => { calls.push(['token', options]); return { data: 'ExpoPushToken[fixture]' }; },
    addNotificationResponseReceivedListener: cb => { listeners.response = cb; return { remove: () => { delete listeners.response; } }; },
    addPushTokenListener: cb => { listeners.token = cb; return { remove: () => { delete listeners.token; } }; },
    getLastNotificationResponseAsync: async () => null,
    setNotificationHandler: handler => { listeners.handler = handler; },
    scheduleNotificationAsync: async data => { calls.push(['local', data]); },
    dismissAllNotificationsAsync: async () => calls.push(['dismiss']), cancelAllScheduledNotificationsAsync: async () => calls.push(['cancel']),
    clearLastNotificationResponseAsync: async () => calls.push(['clearResponse']), setBadgeCountAsync: async n => calls.push(['badge', n]),
    ...overrides.notifications
  };
  const native = { AppState: { currentState: 'active' }, Platform: { OS: 'android' } };
  const constants = { appOwnership: 'standalone', easConfig: { projectId: 'fixture-project' }, ...overrides.constants };
  const socket = { onNotificationCreated: callback => { listeners.socket = callback; return () => { delete listeners.socket; }; } };
  function load(relative) {
    const absolute = path.resolve(root, relative);
    if (absolute === path.join(root, 'src/services/api.js')) return { default: api, __esModule: true };
    if (absolute === path.join(root, 'src/services/socketService.js')) return { default: socket, __esModule: true };
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} }; cache.set(absolute, mod);
    const code = babel.transformSync(fs.readFileSync(absolute, 'utf8'), { filename: absolute, configFile: false, babelrc: false,
      plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
    const requireLocal = name => {
      if (name === 'react-native') return native;
      if (name === 'expo-constants') return { default: constants, __esModule: true };
      if (name === 'expo-notifications') return notifications;
      if (name === '@react-native-async-storage/async-storage') return { default: {
        getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value), removeItem: async key => storage.delete(key)
      }, __esModule: true };
      return name.startsWith('.') ? load(path.resolve(path.dirname(absolute), name + '.js')) : frontendRequire(name);
    };
    new Function('require', 'module', 'exports', code)(requireLocal, mod, mod.exports);
    return mod.exports;
  }
  return { load, calls, listeners, storage, api, notifications, prefs, native };
}

test('frontend modified files and new screens parse with installed Babel', () => {
  const files = ['src/screens/notificationScreen.js', 'src/screens/profile/notificationSettingsScreen.js', 'src/screens/profile/myProfile.js',
    'src/contexts/authContext.js', 'src/navigations/rootNavigator.js', 'src/navigations/stackNavigator.js', 'src/navigations/profileStackNavigatior.js',
    'src/services/pushNotificationService.js', 'src/services/socketService.js', 'store/notificationStore.js', 'store/notificationPreferencesStore.js'];
  for (const file of files) babel.parseSync(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] } });
});
test('notification realtime dedup and late list/unread responses cannot restore a logged-out session', async () => {
  const list = deferred(), unread = deferred();
  const h = harness({ api: { get: url => url.includes('/unread/') ? unread.promise : list.promise } });
  const store = h.load('store/notificationStore.js').default;
  const a = store.getState().fetchNotifications(), b = store.getState().fetchUnreadCount();
  const n = { _id: 'fixture', isRead: false };
  assert.equal(store.getState().handleRealtimeNotification(n), true); assert.equal(store.getState().handleRealtimeNotification(n), false);
  assert.equal(store.getState().unreadCount, 1); store.getState().reset();
  list.resolve({ data: [n] }); unread.resolve({ data: { unreadCount: 99 } }); await Promise.all([a,b]);
  assert.deepEqual(store.getState().notifications, []); assert.equal(store.getState().unreadCount, 0);
});
test('stale unread poll does not erase realtime increment; poll lifecycle remains available', async () => {
  const held = deferred(); const h = harness({ api: { get: () => held.promise } }); const store = h.load('store/notificationStore.js').default;
  const pending = store.getState().fetchUnreadCount(); store.getState().handleRealtimeNotification({ _id: 'new', isRead: false });
  held.resolve({ data: { unreadCount: 0 } }); await pending; assert.equal(store.getState().unreadCount, 1);
  store.getState().startAutoRefresh(); assert.ok(store.getState().refreshInterval); store.getState().reset(); assert.equal(store.getState().refreshInterval, null);
});
test('preferences GET/PUT roundtrip, dedup save and reset invalidates response', async () => {
  const held = deferred(), h = harness({ api: { put: () => held.promise } }); const store = h.load('store/notificationPreferencesStore.js').default;
  await store.getState().fetchPreferences(); assert.equal(store.getState().preferences.master, true);
  const a = store.getState().updatePreferences({ master: false }), b = store.getState().updatePreferences({ master: false }); assert.equal(a, b);
  held.resolve({ data: { ...h.prefs, master: false } }); await a; assert.equal(store.getState().preferences.master, false);
  const pending = deferred(); h.api.get = () => pending.promise; const read = store.getState().fetchPreferences(); store.getState().reset();
  pending.resolve({ data: h.prefs }); await read; assert.equal(store.getState().preferences, null);
});
test('task/comment/deadline, leave inbox, attendance and default route match actual stacks', () => {
  const { notificationTarget } = harness().load('src/utils/notificationTarget.js');
  for (const type of ['task_overdue','comment_added','deadline_reminder']) assert.deepEqual(notificationTarget({ type, relatedId: 't' }, 'employee'), { screen: 'TaskDetail', params: { taskId: 't' } });
  assert.equal(notificationTarget({ type: 'leave_pending' }, 'team_lead').screen, 'LeaveInbox');
  assert.equal(notificationTarget({ type: 'leave_starting' }, 'hr_manager').screen, 'MyLeaves');
  assert.equal(notificationTarget({ type: 'attendance_reminder' }, 'hr_manager').screen, 'Attendance');
  assert.equal(notificationTarget({ type: 'attendance_reminder' }, 'employee').params.screen, 'clockin');
  assert.equal(notificationTarget({}, 'employee').screen, 'Notification'); assert.equal(notificationTarget({}, 'system_admin'), null);
});
test('late preferences read cannot undo a newer preference save', async () => {
  const held = deferred(), h = harness({ api: { get: () => held.promise } });
  const store = h.load('store/notificationPreferencesStore.js').default;
  const pending = store.getState().fetchPreferences(); await store.getState().updatePreferences({ master: false });
  held.resolve({ data: h.prefs }); await pending; assert.equal(store.getState().preferences.master, false);
});
test('manager registers Expo token with projectId, handles rotation and unregisters before cleanup', async () => {
  const h = harness(), manager = h.load('src/services/pushNotificationService.js');
  manager.initNotificationManager('u', () => {}, () => h.prefs); await flush();
  assert.equal(h.calls.filter(c => c[0] === 'post').length, 1); assert.equal(h.calls.find(c => c[0] === 'token')[1].projectId, 'fixture-project');
  h.listeners.token({ type: 'android', data: 'native-rotated' }); await flush();
  assert.equal(h.calls.filter(c => c[0] === 'post').length, 2);
  assert.equal(h.calls.filter(c => c[0] === 'token')[1][1].devicePushToken.data, 'native-rotated');
  await manager.cleanupNotifications(); assert.ok(h.calls.some(c => c[0] === 'delete' && c[1] === '/notifications/push-token'));
  assert.ok(h.calls.some(c => c[0] === 'badge' && c[1] === 0)); assert.equal(h.listeners.socket, undefined);
});
test('Expo Go degrades to local; preferences and foreground state gate local display', async () => {
  const h = harness({ constants: { appOwnership: 'expo' } }), manager = h.load('src/services/pushNotificationService.js');
  manager.initNotificationManager('u', () => {}, () => h.prefs); await flush(); assert.equal(h.calls.filter(c => c[0] === 'post').length, 0);
  await manager.showForegroundNotification({ type: 'task_assigned', title: 'Fixture', message: 'Fixture' }, h.prefs);
  assert.equal(h.calls.filter(c => c[0] === 'local').length, 1);
  h.prefs.categories.task.inApp = false; await manager.showForegroundNotification({ type: 'task_assigned' }, h.prefs);
  h.native.AppState.currentState = 'background'; await manager.showForegroundNotification({ type: 'leave_starting' }, h.prefs);
  assert.equal(h.calls.filter(c => c[0] === 'local').length, 1); await manager.cleanupNotifications(false);
});
test('explicit permission opt-in is not swallowed by silent startup registration', async () => {
  let granted = false, prompts = 0;
  const h = harness({ constants: { appOwnership: 'expo' }, notifications: {
    getPermissionsAsync: async () => ({ granted }),
    requestPermissionsAsync: async () => { prompts++; granted = true; return { granted }; }
  } });
  const manager = h.load('src/services/pushNotificationService.js');
  manager.initNotificationManager('u', () => {}, () => h.prefs);
  await manager.registerPushToken(true);
  assert.equal(prompts, 1); assert.equal(await manager.permissionGranted(), true);
  await manager.cleanupNotifications(false);
});
test('cold-start tap survives auth readiness, deduplicates, and rejects other-account payload', async () => {
  const response = { notification: { request: { identifier: 'tap', content: { data: { type: 'leave_starting', userId: 'u' } } } } };
  const h = harness({ notifications: { getLastNotificationResponseAsync: async () => response } }), manager = h.load('src/services/pushNotificationService.js');
  manager.initNotificationManager('u', () => {}, () => h.prefs); await flush();
  const targets = await Promise.all([manager.consumePendingTarget('u'), manager.consumePendingTarget('u')]);
  assert.equal(targets.filter(Boolean).length, 1); assert.equal(targets.find(Boolean).type, 'leave_starting');
  h.listeners.response(response); await flush(); assert.equal(await manager.consumePendingTarget('u'), null);
  h.listeners.response({ notification: { request: { identifier: 'other', content: { data: { type: 'task_assigned', userId: 'other' } } } } });
  await flush(); assert.equal(await manager.consumePendingTarget('u'), null); await manager.cleanupNotifications(false);
});
