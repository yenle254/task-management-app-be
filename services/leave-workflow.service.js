const { randomUUID } = require('node:crypto');
const Leave = require('../models/leave.model');
const User = require('../models/user.model');
const Team = require('../models/team.model');
const helpers = require('./leave.service');
const notifications = require('./notification.service');
const { LEAVE_PENDING_STATUSES } = require('../utils/constants.utils');

const id = value => String(value?._id || value || '');
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const pendingFilter = status => status === 'pending' ? { $in: LEAVE_PENDING_STATUSES } : status;
const event = (leave, actor, action, to, reason, revision = leave.revision + 1) => ({
    from: leave.status, to, action, by: actor._id, at: new Date(), reason, revision,
    snapshot: { startDay: leave.startDate, endDay: leave.endDate, days: leave.numberOfDays, step: leave.currentStep }
});

// Team.leaderId is authoritative. managerId never silently changes the approver.
async function resolveApproverSnapshot(requester, { legacy = false } = {}) {
    if (requester.role === 'system_admin' && !legacy) fail(409, 'No eligible leave approver for system_admin');
    const hr = await User.find({ role: 'hr_manager', isActive: true, _id: { $ne: requester._id } }).select('_id').lean();
    if (!hr.length && !legacy) fail(409, 'No eligible HR approver');
    const resolvedAt = new Date();
    const approverSnapshot = hr.map(user => ({ role: 'hr_manager', userId: user._id, active: true, resolvedAt }));
    let leader;
    if (requester.role === 'employee' && requester.teamId) {
        const team = await Team.findById(requester.teamId).select('leaderId').lean();
        if (team) leader = await User.findOne({ _id: team.leaderId, role: 'team_lead', isActive: true,
            teamId: requester.teamId }).select('_id').lean();
    }
    if (leader && id(leader) !== id(requester)) approverSnapshot.unshift({ role: 'team_lead', userId: leader._id, active: true, resolvedAt });
    return { approverSnapshot, teamSnapshot: requester.teamId || null,
        status: leader ? 'pending_team_lead' : 'pending_hr', currentStep: leader ? 'team_lead' : 'hr' };
}

function fields(input, previous = {}) {
    const data = Object.fromEntries(['type', 'startDate', 'endDate', 'reason'].map(key => [key, input[key] ?? previous[key]]));
    if (!['sick', 'vacation', 'personal'].includes(data.type)) fail(400, 'Invalid leave type');
    const validation = helpers.validateLeaveDates(data.startDate, data.endDate);
    if (!validation.valid) fail(400, validation.message);
    data.startDate = new Date(data.startDate); data.endDate = new Date(data.endDate);
    data.numberOfDays = helpers.calculateLeaveDays(data.startDate, data.endDate);
    return data;
}
async function checkBalance(userId, data) {
    if (!await helpers.hasEnoughLeaveBalance(userId, data.numberOfDays, data.startDate.getFullYear())) fail(400, 'Insufficient leave balance');
}

async function notify(leave) {
    try {
        if (LEAVE_PENDING_STATUSES.includes(leave.status)) await notifications.notifyPendingLeave(leave);
        else if (leave.status === 'approved') await notifications.notifyLeaveApproved(leave, leave.userId);
        else if (leave.status === 'rejected') await notifications.notifyLeaveRejected(leave, leave.userId);
    } catch (error) { console.error('Leave notification failed:', error.message); }
}

async function create(actor, input) {
    const key = input.idempotencyKey;
    if (key) {
        const existing = await Leave.findOne({ userId: actor._id, idempotencyKey: key });
        if (existing) return existing;
    }
    const data = fields(input);
    let routing = { status: 'draft' };
    if (!input.draft) { await checkBalance(actor._id, data); routing = await resolveApproverSnapshot(actor); }
    const doc = { ...data, ...routing, userId: actor._id, revision: 0, ...(key ? { idempotencyKey: key } : {}) };
    if (!input.draft) doc.history = [event({ ...doc, status: 'draft' }, actor, 'submit', routing.status, data.reason, 0)];
    let leave;
    try { leave = await Leave.create(doc); }
    catch (error) {
        if (error.code === 11000 && key) return Leave.findOne({ userId: actor._id, idempotencyKey: key });
        throw error;
    }
    if (!input.draft) await notify(leave);
    return leave;
}

// Safe, idempotent compatibility normalization. No historical decisions or balance writes.
async function legacyPatch(leave) {
    if (leave.revision !== undefined && leave.status !== 'pending') return null;
    let routing = { currentStep: null, approverSnapshot: [] };
    if (leave.status === 'pending') {
        const requester = await User.findById(leave.userId).select('role teamId isActive').lean();
        routing = requester ? await resolveApproverSnapshot(requester, { legacy: true }) :
            { status: 'pending_hr', currentStep: 'hr', approverSnapshot: [] };
    }
    return { ...routing, revision: 0, history: [], operation: null };
}

async function readForAction(leaveId) {
    let leave = await Leave.findById(leaveId).lean();
    if (!leave) fail(404, 'Leave request not found');
    const patch = await legacyPatch(leave);
    if (patch) {
        await Leave.updateOne({ _id: leave._id, status: leave.status, revision: { $exists: false } }, { $set: patch });
        // Legacy records that acquired a schema default but still have old status.
        if (leave.status === 'pending') await Leave.updateOne({ _id: leave._id, status: 'pending' }, { $set: patch });
        leave = await Leave.findById(leaveId).lean();
    }
    return leave;
}

async function canDecide(actor, leave) {
    if (!helpers.canApproveLeave(actor, leave)) return false;
    if (actor.role === 'team_lead') {
        const requester = await User.findById(leave.userId).select('teamId').lean();
        const team = await Team.findById(leave.teamSnapshot).select('leaderId').lean();
        return id(requester?.teamId) === id(leave.teamSnapshot) && id(team?.leaderId) === id(actor);
    }
    return true; // HR override deliberately permits current active HR outside original snapshot.
}

// Receipt and arithmetic share ONE User update; an unknown write result is never retried blindly.
async function deduct(leave, token) {
    const year = new Date(leave.startDate).getFullYear(), days = leave.numberOfDays;
    const balance = `leaveBalance.${year}`, receipt = `leaveBalanceOperations.${token}`;
    await User.updateOne({ _id: leave.userId, [balance]: { $exists: false } },
        { $set: { [balance]: { total: 12, used: 0, remaining: 12 } } });
    const updated = await User.findOneAndUpdate({ _id: leave.userId, [receipt]: { $exists: false }, [`${balance}.remaining`]: { $gte: days } },
        { $inc: { [`${balance}.used`]: days, [`${balance}.remaining`]: -days },
            $set: { [receipt]: { leaveId: leave._id, year, days, state: 'deducted' } } }, { new: true });
    if (!updated) fail(409, 'balance no longer sufficient');
}
async function receiptFor(leave, token) {
    const user = await User.findById(leave.userId).select('+leaveBalanceOperations').lean();
    return user?.leaveBalanceOperations?.[token];
}
async function refund(leave, token, legacy = false) {
    const year = new Date(leave.startDate).getFullYear(), days = leave.numberOfDays;
    const balance = `leaveBalance.${year}`, receipt = `leaveBalanceOperations.${token}`;
    const filter = { _id: leave.userId, [`${balance}.used`]: { $gte: days },
        ...(legacy ? { [receipt]: { $exists: false } } : { [`${receipt}.state`]: 'deducted' }) };
    const updated = await User.findOneAndUpdate(filter, { $inc: { [`${balance}.used`]: -days, [`${balance}.remaining`]: days },
        $set: { [receipt]: { leaveId: leave._id, year, days, state: 'refunded' } } }, { new: true });
    if (!updated && (await receiptFor(leave, token))?.state !== 'refunded') fail(409, 'Balance refund requires operator reconciliation');
}

async function transition(actor, leaveId, action, input = {}) {
    const leave = await readForAction(leaveId);
    const owner = id(leave.userId) === id(actor);
    if (input.revision !== undefined && input.revision !== leave.revision) fail(409, 'Leave changed; refresh before deciding');
    if (leave.operation) fail(409, 'Leave operation in progress or awaiting recovery');
    let updates = {}, reason = input.reason;
    if (action === 'submit' || action === 'edit_resubmit') {
        if (!owner) fail(403, 'Only the requester can edit or submit');
        if (action === 'submit' && leave.status !== 'draft') fail(400, `Leave already ${leave.status}`);
        if (action === 'edit_resubmit' && leave.status !== 'pending_team_lead') fail(400, 'Only the Team Lead step can be edited');
        updates = fields(input, leave); await checkBalance(leave.userId, updates);
        if (action === 'submit') Object.assign(updates, await resolveApproverSnapshot(actor));
        else Object.assign(updates, { status: 'pending_team_lead', currentStep: 'team_lead' });
    } else if (action === 'approve' || action === 'reject') {
        if (owner) fail(403, 'Self approval/rejection is not permitted');
        if (!LEAVE_PENDING_STATUSES.includes(leave.status)) fail(400, `Leave already ${leave.status}`);
        if (!await canDecide(actor, leave)) fail(403, 'Not an eligible approver for this step');
        updates.status = action === 'reject' ? 'rejected' : actor.role === 'hr_manager' ? 'approved' : 'pending_hr';
        updates.currentStep = updates.status === 'pending_hr' ? 'hr' : null;
        if (updates.status !== 'pending_hr') { updates.approvedBy = actor._id; updates.approvedAt = new Date(); }
        if (action === 'reject') { reason = input.rejectionReason?.trim() || 'No reason provided'; updates.rejectionReason = reason; }
    } else if (action === 'cancel') {
        if (!owner && actor.role !== 'hr_manager') fail(403, 'Only requester or HR can cancel');
        if (leave.status === 'draft' && !owner) fail(403, 'Drafts are private to the requester');
        if (!['draft', 'pending_team_lead', 'pending_hr', 'approved'].includes(leave.status)) fail(400, `Leave already ${leave.status}`);
        if (leave.status === 'approved' && new Date(leave.startDate) <= new Date()) fail(400, 'Leave has already started');
        updates = { status: 'cancelled', currentStep: null };
    } else fail(400, 'Unknown leave action');

    const token = randomUUID();
    const claimed = await Leave.findOneAndUpdate({ _id: leave._id, status: leave.status, revision: leave.revision,
        currentStep: leave.currentStep, operation: null }, { $set: { operation: { token, action, at: new Date(), by: actor._id } } }, { new: true });
    if (!claimed) fail(409, 'Leave already changed; refresh before deciding');
    const finalApproval = updates.status === 'approved';
    const approvedCancel = action === 'cancel' && leave.status === 'approved';
    const balanceToken = leave.balanceOperationId || `legacy_${leave._id}`;
    try {
        const history = [event({ ...leave, ...('startDate' in updates ? { startDate: updates.startDate, endDate: updates.endDate, numberOfDays: updates.numberOfDays } : {}) }, actor, action, updates.status, reason)];
        if (finalApproval) {
            await deduct(leave, token); updates.balanceOperationId = token;
            history.push(event(leave, actor, 'balance_deducted', updates.status));
        }
        if (approvedCancel) {
            await refund(leave, balanceToken, !leave.balanceOperationId);
            history.push(event(leave, actor, 'balance_refunded', updates.status));
        }
        const result = await Leave.findOneAndUpdate({ _id: leave._id, 'operation.token': token, revision: leave.revision },
            { $set: { ...updates, operation: null }, $inc: { revision: 1 }, $push: { history: { $each: history } } }, { new: true, runValidators: true });
        if (!result) fail(409, 'Leave claim changed; operator reconciliation required');
        if (action !== 'cancel') await notify(result);
        return result;
    } catch (error) {
        // Read-back distinguishes a failed write from a committed write with a lost response.
        // If read-back itself fails, leave the durable claim for operator recovery.
        const current = await Leave.findById(leave._id).lean();
        if (current && !current.operation && current.revision === leave.revision + 1 && current.status === updates.status) return current;
        if (current?.operation?.token !== token) throw error;
        if (finalApproval) {
            const receipt = await receiptFor(leave, token);
            if (receipt?.state === 'deducted') await refund(leave, token);
            if (receipt) {
                await Leave.updateOne({ _id: leave._id, 'operation.token': token }, { $set: { operation: null },
                    $push: { history: event(leave, actor, 'balance_refunded', leave.status, 'Approval failed; conditional compensation', leave.revision) } });
                throw error;
            }
        }
        // A cancellation with an applied refund remains claimed until an operator finalizes it.
        if (approvedCancel && await receiptFor(leave, balanceToken)) throw error;
        await Leave.updateOne({ _id: leave._id, 'operation.token': token }, { $set: { operation: null } });
        throw error;
    }
}

module.exports = { create, transition, resolveApproverSnapshot, legacyPatch, pendingFilter, canDecide, id };
