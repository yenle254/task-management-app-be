const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const project = path.resolve(__dirname, '../../project');
const frontendRequire = createRequire(path.join(project, 'package.json'));
const babel = frontendRequire('@babel/core');
const sourceFile = process.env.TASK_CREATE_TEST_SOURCE || path.join(project, 'src/screens/task/createTaskScreen.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const parsed = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
const component = parsed.program.body.find(node => node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'CreateTaskScreen').declarations[0].init;
const stateNames = component.body.body.flatMap(node => node.type === 'VariableDeclaration'
  ? node.declarations.filter(declaration => declaration.init?.callee?.name === 'useState').map(declaration => declaration.id.elements[0].name) : []);
const compiled = babel.transformSync(source, {
  configFile: false, babelrc: false,
  plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs'), frontendRequire.resolve('@babel/plugin-transform-react-jsx')],
}).code;

// Reject locale-dependent parsing, as native JS engines may do. Numeric dates and ISO remain supported.
class StrictDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(2026, 10, 4, 15, 30);
    else if (args.length === 1 && typeof args[0] === 'string' && !/^\d{4}-\d{2}-\d{2}(T|$)/.test(args[0])) super(NaN);
    else super(...args);
  }
}

function harness(role = 'hr_manager') {
  const state = new Map(), alerts = [], requests = [], errors = [];
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useEffect() {},
    useState(initial) {
      const name = stateNames[cursor++];
      assert.ok(name, 'Hook must correspond to a declared screen state');
      if (!state.has(name)) state.set(name, typeof initial === 'function' ? initial() : initial);
      return [state.get(name), value => state.set(name, typeof value === 'function' ? value(state.get(name)) : value)];
    },
  };
  const native = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map(name => [name, name]));
  Object.assign(native, { StyleSheet: { create: styles => styles }, Platform: { OS: 'android' }, Alert: { alert: (...args) => alerts.push(args) } });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'Date', 'console', compiled)(name => {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name.endsWith('authContext')) return { useAuth: () => ({ user: { role, teamId: 'team-a' }, canManageTasks: () => true }) };
    if (name.includes('store/index')) return { useTaskStore: () => ({ isLoading: false, createTask: async payload => { requests.push(payload); return { data: { _id: 'created-task' } }; } }) };
    if (name.endsWith('advancedTaskFields')) return { __esModule: true, default: 'AdvancedTaskFields', emptyAdvancedFields: () => ({ checklistTitle: '' }), advancedPayload: () => ({}) };
    if (name.endsWith('api.config')) return { API_URL: 'http://fixture.invalid' };
    if (name.endsWith('services/index')) return { teamService: {} };
    if (name === '@expo/vector-icons') return { MaterialCommunityIcons: 'MaterialCommunityIcons' };
    return path.basename(name);
  }, mod, mod.exports, StrictDate, { log() {}, error: (...args) => errors.push(args) });
  const render = () => { cursor = 0; return mod.exports.default({ navigation: { goBack() {} } }); };
  const children = node => (node?.props?.children || []).flat(Infinity);
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'Modal' && !node.props.visible) return null;
    if (predicate(node)) return node;
    for (const child of children(node)) { const match = find(child, predicate); if (match) return match; }
    return null;
  }
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : children(node).map(text).join('');
  const click = label => {
    const button = find(render(), node => node.props.onPress && (node.props.text === label || text(node) === label));
    assert.ok(button, `Visible control: ${label}`);
    return button.props.onPress();
  };
  const openDate = label => {
    const row = find(render(), node => node.type === 'View' && children(node).some(child => child?.type === 'Text' && text(child) === label));
    const button = find(row, node => node.type === 'TouchableOpacity' && node.props.onPress);
    assert.ok(button, `Date selector: ${label}`);
    button.props.onPress();
  };
  const chooseDate = (label, day) => { openDate(label); click(String(day)); click('Confirm'); };
  render();
  state.set('taskTitle', 'Manual task'); state.set('selectedTeam', { _id: 'team-a' });
  state.set('selectedMembers', [{ _id: 'employee-a', profile: {} }]);
  return { state, alerts, requests, errors, render, click, openDate, chooseDate };
}

for (const role of ['hr_manager', 'team_lead']) {
  test(`${role} can choose dates, reopen the calendar and create a task without parsing display labels`, async () => {
    const h = harness(role);
    h.chooseDate('Start Date', 4); h.chooseDate('Due Date', 6);
    assert.ok(h.state.get('startDate') instanceof Date);
    assert.equal(h.state.get('startDate').getHours(), 0);
    h.openDate('Start Date'); assert.equal(h.state.get('tempDate').getDate(), 4); h.click('Cancel');
    h.click('Create Task'); await h.click('Yes, Proceed Now');
    assert.deepEqual(h.requests, [{ title: 'Manual task', description: '', assignedTo: ['employee-a'], teamId: 'team-a',
      priority: 'medium', difficulty: 'medium', attachments: [],
      startDate: new Date(2026, 10, 4).toISOString(), dueDate: new Date(2026, 10, 6).toISOString() }]);
    assert.equal(h.state.get('showSuccessDialog'), true);
    assert.deepEqual(h.alerts, []); assert.deepEqual(h.errors, []);
  });
}

test('confirming today without clicking a day normalizes both dates to local midnight', async () => {
  const h = harness();
  h.openDate('Start Date'); h.click('Confirm'); h.openDate('Due Date'); h.click('Confirm');
  h.click('Create Task'); await h.click('Yes, Proceed Now');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].startDate, new Date(2026, 10, 4).toISOString());
  assert.equal(h.requests[0].dueDate, h.requests[0].startDate);
});

test('invalid/missing dates and inverted ranges are rejected before opening the create dialog', () => {
  for (const [start, due, message] of [
    [null, null, 'Start date is required'],
    [new StrictDate(2026, 10, 4), null, 'Due date is required'],
    [new StrictDate(NaN), new StrictDate(2026, 10, 6), 'Please select a valid start date'],
    [new StrictDate(2026, 10, 4), '6 November 2026', 'Please select a valid due date'],
    [new StrictDate(2026, 10, 6), new StrictDate(2026, 10, 4), 'Due date cannot be earlier than start date'],
  ]) {
    const h = harness(); h.state.set('startDate', start); h.state.set('dueDate', due); h.click('Create Task');
    assert.equal(h.alerts.at(-1)[1], message);
    assert.equal(h.state.get('showConfirmDialog'), false);
    assert.deepEqual(h.requests, []);
  }
});

test('final confirmation revalidates dates and cannot send an invalid date to the API', async () => {
  const h = harness(); h.chooseDate('Start Date', 4); h.chooseDate('Due Date', 6); h.click('Create Task');
  h.state.set('dueDate', new StrictDate(NaN)); await h.click('Yes, Proceed Now');
  assert.equal(h.alerts.at(-1)[1], 'Please select a valid due date');
  assert.equal(h.state.get('isUploading'), false);
  assert.deepEqual(h.requests, []); assert.deepEqual(h.errors, []);
});

test('calendar handles leap days and year rollover without reparsing labels', async () => {
  for (const [start, due] of [[new StrictDate(2028, 1, 29), new StrictDate(2028, 2, 1)], [new StrictDate(2026, 11, 31), new StrictDate(2027, 0, 1)]]) {
    const h = harness();
    for (const [label, value] of [['Start Date', start], ['Due Date', due]]) {
      h.openDate(label); h.state.set('tempDate', value); h.click('Confirm');
    }
    h.click('Create Task'); await h.click('Yes, Proceed Now');
    assert.equal(h.requests[0].startDate, start.toISOString());
    assert.equal(h.requests[0].dueDate, due.toISOString());
    assert.deepEqual(h.errors, []);
  }
});
