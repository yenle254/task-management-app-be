const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const loadClient = require('./frontend-task-client.cjs');

const project = path.resolve(__dirname, '../../project');
const frontendRequire = createRequire(path.join(project, 'package.json'));
const compiled = frontendRequire('@babel/core').transformSync(
  fs.readFileSync(path.join(project, 'src/screens/task/taskDetailScreen.js'), 'utf8'),
  { configFile: false, babelrc: false, plugins: [
    frontendRequire.resolve('@babel/plugin-transform-modules-commonjs'),
    frontendRequire.resolve('@babel/plugin-transform-react-jsx'),
  ] },
).code;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const task = id => ({ _id: id, title: `Task ${id}`, status: 'todo', assignedTo: [], createdAt: '2026-11-09' });
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

// Execute the actual screen and Zustand store; model the stack keeping blurred
// screens mounted. Native child components are shallow placeholders.
function harness(service) {
  const { store } = loadClient('', '', service);
  const alerts = [];
  function screen(taskId) {
    const slots = [];
    let cursor = 0, focused = false, focusEffect, cleanup, effects = [];
    const react = {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState(initial) {
        const index = cursor++;
        if (!slots[index]) slots[index] = { value: initial };
        return [slots[index].value, value => { slots[index].value = value; }];
      },
      useCallback(callback, deps) {
        const index = cursor++;
        if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
        return slots[index].value;
      },
      useEffect(callback, deps) {
        const index = cursor++;
        if (!sameDeps(slots[index]?.deps, deps)) {
          slots[index] = { deps };
          effects.push(callback);
        }
      },
    };
    const navigation = {
      useNavigation: () => ({}), useRoute: () => ({ params: { taskId } }),
      useFocusEffect(callback) {
        if (callback !== focusEffect) {
          if (focused) { cleanup?.(); effects.push(() => { cleanup = callback(); }); }
          focusEffect = callback;
        }
      },
    };
    const native = { StyleSheet: { create: value => value }, Platform: { OS: 'android' },
      Alert: { alert: (...args) => alerts.push(args) } };
    for (const name of ['ActivityIndicator', 'KeyboardAvoidingView', 'RefreshControl', 'ScrollView', 'Text', 'TouchableOpacity', 'View']) native[name] = name;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(name => {
      if (name === 'react') return react;
      if (name === 'react-native') return native;
      if (name === '@react-navigation/native') return navigation;
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (name.endsWith('authContext')) return { useAuth: () => ({ user: { _id: 'user' }, canManageTasks: () => true }) };
      if (name.endsWith('taskStore')) return { __esModule: true, default: Object.assign(() => store.getState(), store) };
      if (name.endsWith('taskStatusMap')) return { getTaskStatus: () => ({ label: 'To Do' }) };
      if (name.endsWith('categoryMapping')) return { CategoryMap: {}, DefaultCategory: 'Category' };
      if (name.endsWith('chat_bot')) return { AITaskBreakdownPanel: 'AITaskBreakdownPanel' };
      return path.basename(name);
    }, module, module.exports);
    const render = () => {
      cursor = 0;
      const tree = module.exports.default();
      const pending = effects; effects = [];
      pending.forEach(effect => effect());
      return tree;
    };
    return { render,
      focus() { const previous = focusEffect; focused = true; render(); if (previous === focusEffect) cleanup = focusEffect?.(); },
      blur() { focused = false; cleanup?.(); cleanup = undefined; },
    };
  }
  return { store, alerts, screen };
}
function contains(node, predicate) {
  if (!node || typeof node !== 'object') return false;
  return predicate(node) || (node.props?.children || []).flat(Infinity).some(child => contains(child, predicate));
}
function assertLoaded(screen, id) {
  const tree = screen.render();
  assert.ok(contains(tree, node => node.type === 'Text' && node.props.children.includes(`Task ${id}`)), `Render task ${id}`);
  assert.equal(contains(tree, node => node.type === 'ActivityIndicator'), false);
}

test('returning from parent restores the original task on every visit without remounting', async () => {
  const calls = [];
  const h = harness({ getTaskById: async id => { calls.push(id); return { data: task(id) }; } });
  const original = h.screen('original');
  original.focus(); await flush(); assertLoaded(original, 'original');
  for (let visit = 0; visit < 2; visit++) {
    original.blur();
    const parent = h.screen('parent'); parent.focus(); await flush(); assertLoaded(parent, 'parent');
    parent.blur(); original.focus(); await flush(); assertLoaded(original, 'original');
  }
  assert.deepEqual(calls, ['original', 'parent', 'original', 'parent', 'original']);
});

for (const outcome of ['success', 'failure']) {
  test(`back during parent loading ignores its late ${outcome}`, async () => {
    const pending = deferred();
    const h = harness({ getTaskById: id => id === 'parent' ? pending.promise : Promise.resolve({ data: task(id) }) });
    const original = h.screen('original'); original.focus(); await flush(); original.blur();
    const parent = h.screen('parent'); parent.focus(); parent.blur();
    original.focus(); await flush(); assertLoaded(original, 'original');
    if (outcome === 'success') pending.resolve({ data: task('parent') });
    else pending.reject({ error: 'Parent request failed' });
    await flush(); assertLoaded(original, 'original');
    assert.equal(h.store.getState().isLoading, false);
    assert.equal(h.store.getState().error, null);
    assert.deepEqual(h.alerts, []);
  });
}

test('failed reload exposes retry and retry restores the original task', async () => {
  let fail = false;
  const h = harness({ getTaskById: async id => {
    if (fail && id === 'original') throw { error: 'Temporary failure' };
    return { data: task(id) };
  } });
  const original = h.screen('original'); original.focus(); await flush(); original.blur();
  const parent = h.screen('parent'); parent.focus(); await flush(); parent.blur();
  fail = true; original.focus(); await flush();
  assert.equal(h.store.getState().isLoading, false);
  assert.equal(h.store.getState().error, 'Temporary failure');
  let retry;
  contains(original.render(), node => { if (node.type === 'TouchableOpacity') retry = node.props.onPress; return false; });
  assert.equal(typeof retry, 'function');
  fail = false; await retry(); assertLoaded(original, 'original');
});
