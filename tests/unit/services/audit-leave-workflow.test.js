const mongoose = require('mongoose');
jest.mock('../../../services/notification.service', () => ({ notifyPendingLeave: jest.fn(), notifyLeaveApproved: jest.fn(), notifyLeaveRejected: jest.fn() }));
jest.mock('../../../services/expo-push.service', () => ({ send: jest.fn() }));
const Leave = require('../../../models/leave.model');
const User = require('../../../models/user.model');
const AuditLog = require('../../../models/audit-log.model');
const helpers = require('../../../services/leave.service');
const workflow = require('../../../services/leave-workflow.service');
const oid = () => new mongoose.Types.ObjectId().toString();
const owner = { _id: oid(), role: 'employee' }, hr = { _id: oid(), role: 'hr_manager' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const query = value => ({ select() { return this; }, lean: async () => value });
let leave, receipts, rows, mode;
beforeEach(() => {
  rows = []; receipts = {}; mode = 'success';
  leave = { _id: oid(), userId: owner._id, status: 'pending_hr', currentStep: 'hr', revision: 0, operation: null,
    type: 'vacation', startDate: new Date('2099-12-01'), endDate: new Date('2099-12-02'), numberOfDays: 2, history: [] };
  jest.spyOn(AuditLog, 'create').mockImplementation(async doc => { rows.push(doc); return doc; });
  jest.spyOn(Leave, 'findById').mockImplementation(() => ({ lean: async () => structuredClone(leave) }));
  jest.spyOn(Leave, 'findOneAndUpdate').mockImplementation(async (filter, update) => {
    const commit = !!update.$inc;
    if ((!commit && mode === 'claimConflict') || (commit && mode === 'commitConflict')) return null;
    if (commit && mode === 'commitFailure') throw new Error('write failed');
    Object.assign(leave, structuredClone(update.$set));
    if (commit) {
      leave.revision++; leave.history.push(...update.$push.history.$each);
      if (mode === 'lostResponse') throw new Error('response lost AFTER commit');
    }
    return structuredClone(leave);
  });
  jest.spyOn(Leave, 'updateOne').mockImplementation(async (filter, update) => {
    Object.assign(leave, update.$set); if (update.$push?.history) leave.history.push(update.$push.history); return { modifiedCount: 1 };
  });
  jest.spyOn(User, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
  jest.spyOn(User, 'findOneAndUpdate').mockImplementation(async (filter, update) => {
    for (const [path, value] of Object.entries(update.$set)) if (path.startsWith('leaveBalanceOperations.')) receipts[path.split('.')[1]] = value;
    return { _id: owner._id };
  });
  jest.spyOn(User, 'findById').mockImplementation(() => query({ leaveBalanceOperations: receipts }));
  jest.spyOn(User, 'find').mockReturnValue(query([hr]));
  jest.spyOn(helpers, 'hasEnoughLeaveBalance').mockResolvedValue(true);
});
afterEach(async () => { await tick(); await tick(); });
test.each(['claimConflict', 'commitConflict'])('%s emits no workflow success', async failure => {
  mode = failure;
  await expect(workflow.transition(hr, leave._id, 'approve')).rejects.toMatchObject({ statusCode: 409 });
  await tick(); expect(rows.some(row => row.action === 'leave.approved')).toBe(false);
  expect(rows.some(row => row.action === 'leave.balance_deducted')).toBe(false);
});
test.each(['success', 'lostResponse'])('%s emits exactly one approval and one balance deduction', async branch => {
  mode = branch;
  const result = await workflow.transition(hr, leave._id, 'approve', {}, { user: hr, requestId: 'leave-request' });
  await tick();
  expect(result.status).toBe('approved');
  expect(rows.map(row => row.action)).toEqual(['leave.approved', 'leave.balance_deducted']);
  expect(rows[0].context.requestId).toBe('leave-request');
  expect(rows[0].changes).toContainEqual({ field: 'status', from: 'pending_hr', to: 'approved' });
});
test('approved cancellation emits one cancellation and one refund', async () => {
  await workflow.transition(hr, leave._id, 'approve'); await tick(); rows.length = 0;
  await workflow.transition(owner, leave._id, 'cancel'); await tick();
  expect(rows.map(row => row.action)).toEqual(['leave.cancelled', 'leave.balance_refunded']);
});
test('compensation emits refund only, preserves failed workflow status', async () => {
  mode = 'commitFailure';
  await expect(workflow.transition(hr, leave._id, 'approve')).rejects.toThrow('write failed'); await tick();
  expect(rows.map(row => row.action)).toEqual(['leave.balance_refunded']);
  expect(rows[0]).toMatchObject({ metadata: { compensation: true }, reason: 'Approval failed; conditional compensation' });
  expect(leave.status).toBe('pending_hr');
  expect(Object.values(receipts)[0].state).toBe('refunded');
});
test('create replay and unique-key race do not record another submitted event', async () => {
  let existing = null;
  const find = jest.spyOn(Leave, 'findOne').mockImplementation(async () => existing);
  const create = jest.spyOn(Leave, 'create').mockImplementation(async doc => { existing = { _id: oid(), ...doc }; return existing; });
  const input = { type: 'vacation', startDate: '2099-12-01', endDate: '2099-12-02', reason: 'Trip', idempotencyKey: 'same-key' };
  const first = await workflow.create(owner, input), second = await workflow.create(owner, input); await tick();
  expect(second._id).toBe(first._id); expect(create).toHaveBeenCalledTimes(1);
  expect(rows.map(row => row.action)).toEqual(['leave.submitted']);
  find.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
  create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
  await workflow.create(owner, input); await tick(); expect(rows).toHaveLength(1);
});
test('draft create is not a submission; submit/reject transitions retain decisions', async () => {
  jest.spyOn(Leave, 'create').mockImplementation(async doc => ({ _id: oid(), ...doc }));
  await workflow.create(owner, { draft: true, type: 'vacation', startDate: '2099-12-01', endDate: '2099-12-02', reason: 'Trip' }); await tick();
  expect(rows).toHaveLength(0);
  leave.status = 'draft'; leave.currentStep = null;
  await workflow.transition(owner, leave._id, 'submit'); await tick();
  await workflow.transition(hr, leave._id, 'reject', { rejectionReason: 'Staff coverage' }); await tick();
  expect(rows.map(row => row.action)).toEqual(['leave.submitted', 'leave.rejected']);
  expect(rows[1].reason).toBe('Staff coverage');
});
