// In-memory persistence adapter: tests never connect to an application database.
// CAS mutations execute synchronously, before resolving the simulated query.
const User = require('../../models/user.model');
const Session = require('../../models/refresh-session.model');
const clone = value => value == null ? value : structuredClone(value);
const query = value => ({ select() { return this; }, populate() { return this; }, lean: async () => clone(value), then(resolve, reject) { return Promise.resolve(clone(value)).then(resolve, reject); } });
function matches(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(item => matches(row, item));
    if (key === 'usedTokens.hash') return row.usedTokens.some(item => item.hash === expected);
    const value = key.split('.').reduce((o, k) => o?.[k], row);
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$gt' in expected) return value > expected.$gt;
      if ('$lt' in expected) return value < expected.$lt;
      if ('$in' in expected) return expected.$in.includes(String(value));
    }
    return expected === null ? value == null : String(value) === String(expected);
  });
}
function update(row, changes) {
  for (const [key, value] of Object.entries(changes.$set || {})) {
    const keys = key.split('.'); let target = row;
    for (const part of keys.slice(0, -1)) target = target[part] ||= {};
    target[keys.at(-1)] = clone(value);
  }
  for (const [key, value] of Object.entries(changes.$inc || {})) row[key] = (row[key] || 0) + value;
  for (const [key, value] of Object.entries(changes.$push || {})) row[key].push(clone(value));
}
module.exports = () => {
  const user = { _id: 'a'.repeat(24), email: 'test@example.com', role: 'employee', isActive: true, tokenVersion: 0,
    password: 'hashed', profile: { fullName: 'Test User', employeeId: 'TEST' }, resetPassword: {} };
  const users = [user], rows = [];
  const saveable = row => {
    if (!row) return null;
    const value = clone(row);
    value.save = jest.fn(async () => { const { save, ...fields } = value; Object.assign(row, clone(fields)); });
    return value;
  };
  const userQuery = row => ({ select: jest.fn(function () { return this; }), populate() { return this; }, lean: async () => clone(row), then(resolve, reject) { return Promise.resolve(saveable(row)).then(resolve, reject); } });
  jest.spyOn(User, 'findById').mockImplementation(id => userQuery(users.find(item => item._id === String(id))));
  jest.spyOn(User, 'find').mockImplementation(filter => query(users.filter(item => matches(item, filter))));
  jest.spyOn(User, 'findOne').mockImplementation(filter => userQuery(users.find(item => matches(item, filter))));
  jest.spyOn(User, 'findOneAndUpdate').mockImplementation((filter, changes) => {
    const row = users.find(item => matches(item, filter)); if (row) update(row, changes); return userQuery(row);
  });
  jest.spyOn(User, 'findByIdAndUpdate').mockImplementation((id, changes) => {
    const row = users.find(item => item._id === String(id)); if (row) update(row, changes); return userQuery(row);
  });
  jest.spyOn(User, 'create').mockImplementation(async fields => { const row = { ...clone(fields), _id: 'b'.repeat(24), tokenVersion: 0 }; users.push(row); return saveable(row); });
  jest.spyOn(Session, 'create').mockImplementation(async fields => {
    const row = { ...clone(fields), _id: String(rows.length + 1), revokedAt: null, rotations: 0, usedTokens: [], createdAt: new Date(), lastUsedAt: new Date() };
    rows.push(row); return clone(row);
  });
  jest.spyOn(Session, 'findOne').mockImplementation(filter => query(rows.find(row => matches(row, filter))));
  jest.spyOn(Session, 'exists').mockImplementation(async filter => rows.some(row => matches(row, filter)));
  jest.spyOn(Session, 'findOneAndUpdate').mockImplementation((filter, changes) => {
    const row = rows.find(item => matches(item, filter)); if (row) update(row, changes); return query(row);
  });
  jest.spyOn(Session, 'updateOne').mockImplementation(async (filter, changes) => {
    const row = rows.find(item => matches(item, filter)); if (row) update(row, changes); return { matchedCount: row ? 1 : 0 };
  });
  jest.spyOn(Session, 'updateMany').mockImplementation(async (filter, changes) => {
    const found = rows.filter(row => matches(row, filter)); found.forEach(row => update(row, changes)); return { matchedCount: found.length };
  });
  jest.spyOn(Session, 'find').mockImplementation(filter => query(rows.filter(row => matches(row, filter)).map(({ sessionId, deviceName, createdAt, lastUsedAt, expiresAt }) => ({ sessionId, deviceName, createdAt, lastUsedAt, expiresAt }))));
  return { user, users, rows, query };
};
