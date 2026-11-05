const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../project');
const frontendRequire = createRequire(path.join(root, 'package.json'));
const babel = frontendRequire('@babel/core');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness() {
  const api = { get: async () => ({ success: true, data: [], page: 1, pages: 0, total: 0 }) }, cache = new Map();
  function load(file) {
    const absolute = path.resolve(root, file);
    if (absolute === path.join(root, 'src/services/api.js')) return { default: api, __esModule: true };
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} }; cache.set(absolute, mod);
    const code = babel.transformSync(fs.readFileSync(absolute, 'utf8'), { filename: absolute, configFile: false, babelrc: false, plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
    new Function('require', 'module', 'exports', code)(name => name.startsWith('.') ? load(path.resolve(path.dirname(absolute), name + '.js')) : frontendRequire(name), mod, mod.exports);
    return mod.exports;
  }
  return { api, store: load('store/auditStore.js').default, service: load('src/services/auditService.js').default };
}
test('all changed frontend screens/navigation/context parse with installed Babel', () => {
  for (const file of ['src/components/audit/auditFilterSelect.js', 'src/components/profile/selectInputField.js']) {
    babel.parseSync(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file, configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  }
  for (const file of ['src/screens/admin/auditLogScreen.js', 'src/screens/admin/auditLogDetailScreen.js', 'src/components/audit/auditUI.js', 'src/services/auditService.js', 'store/auditStore.js', 'src/navigations/adminStackNavigator.js', 'src/screens/admin/adminDashboardScreen.js', 'src/navigations/profileStackNavigatior.js', 'src/screens/profile/myProfile.js', 'src/contexts/authContext.js', 'tests/audit-browser.entry.js']) {
    babel.parseSync(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file, configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  }
});

for (const role of ['hr_manager', 'employee', 'team_lead']) {
  test(`${role} profile menu and registered audit routes respect permissions`, () => {
    const React = frontendRequire('react');
    const { renderToStaticMarkup } = frontendRequire('react-dom/server');
    const actions = [], navigations = [];
    const host = ({ children }) => React.createElement('div', null, children);
    const native = {
      View: host, Text: host, Pressable: host, ScrollView: host, Alert: { alert() {} },
      StyleSheet: { create: styles => styles },
    };
    function load(file) {
      const filename = path.resolve(root, file);
      const mod = { exports: {} };
      const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, configFile: false, babelrc: false,
        plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs'), frontendRequire.resolve('@babel/plugin-transform-react-jsx')],
      }).code;
      new Function('require', 'module', 'exports', code)(name => {
        if (name === 'react-native') return native;
        if (name === '@react-navigation/native') return { useNavigation: () => ({ navigate: route => navigations.push(route) }) };
        if (name === '@react-navigation/native-stack') return { createNativeStackNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }) };
        if (name === 'react-native-safe-area-context') return { SafeAreaView: host, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
        if (name.endsWith('authContext')) return { useAuth: () => ({ user: { role }, signOut() {} }) };
        if (name.endsWith('clickChange')) return props => { actions.push(props); return React.createElement('button', null, props.title); };
        if (name.endsWith('.svg') || name.endsWith('avatar') || name.endsWith('viewInf') || name.includes('/screens/')) return () => null;
        return name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.js')) : frontendRequire(name);
      }, mod, mod.exports);
      return mod.exports;
    }
    const Profile = load('src/screens/profile/myProfile.js').default;
    renderToStaticMarkup(React.createElement(Profile));
    const entry = actions.find(action => action.title === 'Audit Log');
    assert.equal(Boolean(entry), role === 'hr_manager');
    if (entry) { entry.onPress(); assert.deepEqual(navigations, ['AuditLog']); }
    const navigation = load('src/navigations/profileStackNavigatior.js').default();
    const routes = [];
    const visit = node => {
      if (!React.isValidElement(node)) return;
      if (node.type === 'Screen') routes.push(node.props.name);
      React.Children.forEach(node.props.children, visit);
    };
    visit(navigation);
    assert.equal(routes.includes('AuditLog'), role === 'hr_manager');
    assert.equal(routes.includes('AuditLogDetail'), role === 'hr_manager');
    assert.equal(routes.includes('CreateHrAccount'), false);
  });
}
test('service uses existing unwrapped apiClient contract and target path', async () => {
  const h = harness(), calls = [];
  h.api.get = async (...args) => { calls.push(args); return { data: { id: 'event' } }; };
  assert.deepEqual(await h.service.getAuditLogById('event'), { data: { id: 'event' } });
  await h.service.getTargetAuditLogs('user', 'person', { page: 2 });
  assert.deepEqual(calls[1], ['/admin/audit-logs/target/user/person', { params: { page: 2 } }]);
});
test('logout/reset clears list/filters/loading; delayed success/error cannot restore prior session', async () => {
  for (const fail of [false, true]) {
    const h = harness(), pending = deferred(); h.api.get = () => pending.promise;
    h.store.getState().setFilters({ category: 'user' }); const request = h.store.getState().fetchAuditLogs();
    h.store.getState().reset();
    if (fail) pending.reject({ error: 'old account failure' }); else pending.resolve({ data: [{ _id: 'private' }], page: 1, pages: 1, total: 1 });
    await request; const state = h.store.getState();
    assert.deepEqual(state.records, []); assert.deepEqual(state.filters, {}); assert.equal(state.error, null); assert.equal(state.isLoading, false);
  }
});
test('filter changes invalidate old requests; Load next retains previous page and retries same failed page', async () => {
  const h = harness(), old = deferred(); h.api.get = () => old.promise;
  const initial = h.store.getState().fetchAuditLogs(); h.store.getState().setFilters({ category: 'user', action: '' });
  h.api.get = async () => ({ data: [{ _id: 'new' }], page: 1, pages: 2, total: 2 }); await h.store.getState().fetchAuditLogs();
  old.resolve({ data: [{ _id: 'old' }], page: 1, pages: 1, total: 1 }); await initial;
  assert.deepEqual(h.store.getState().records, [{ _id: 'new' }]);
  h.api.get = async () => { throw { error: 'Offline' }; }; await h.store.getState().fetchAuditLogs(2);
  assert.equal(h.store.getState().requestedPage, 2); assert.equal(h.store.getState().error, 'Offline');
  h.api.get = async () => ({ data: [{ _id: 'new' }, { _id: 'next' }], page: 2, pages: 2, total: 2 });
  await h.store.getState().fetchAuditLogs(h.store.getState().requestedPage);
  assert.deepEqual(h.store.getState().records, [{ _id: 'new' }, { _id: 'next' }]); assert.equal(h.store.getState().error, null);
});
test('authorization rejection uses required permission state', async () => {
  const h = harness(); h.api.get = async () => { throw { error: "User role 'employee' is not authorized to access this route" }; };
  await h.store.getState().fetchAuditLogs(); assert.equal(h.store.getState().error, 'You do not have permission');
});
