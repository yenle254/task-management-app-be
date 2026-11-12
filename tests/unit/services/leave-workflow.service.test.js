const mongoose = require('mongoose');
const Leave = require('../../../models/leave.model');
const User = require('../../../models/user.model');
const Team = require('../../../models/team.model');
const { canApproveLeave } = require('../../../services/leave.service');
const { resolveApproverSnapshot, pendingFilter, transition } = require('../../../services/leave-workflow.service');
const oid = () => new mongoose.Types.ObjectId();
const requester = oid(), lead = oid(), hr = oid(), team = oid();
const leave = { userId: requester, status: 'pending_team_lead', currentStep: 'team_lead', teamSnapshot: team,
    approverSnapshot: [{ role: 'team_lead', userId: lead, active: true }] };
afterEach(() => jest.restoreAllMocks());
test.each([
    [{ _id: lead, teamId: team, role: 'team_lead' }, {}, true],
    [{ _id: lead, teamId: team, role: 'team_lead' }, { status: 'pending_hr', currentStep: 'hr' }, false],
    [{ _id: oid(), teamId: team, role: 'team_lead' }, {}, false],
    [{ _id: lead, teamId: oid(), role: 'team_lead' }, {}, false],
    [{ _id: lead, teamId: team, role: 'team_lead', isActive: false }, {}, false],
    [{ _id: hr, role: 'hr_manager' }, {}, true],
    [{ _id: requester, role: 'hr_manager' }, {}, true],
    [{ _id: hr, role: 'system_admin' }, {}, false],
    [{ _id: hr, role: 'hr_manager' }, { status: 'approved' }, false],
    [{ _id: hr, role: 'hr_manager' }, { status: 'rejected' }, false],
    [{ _id: hr, role: 'hr_manager' }, { status: 'cancelled' }, false],
    [{ _id: hr, role: 'hr_manager' }, { status: 'draft' }, false]
])('approval policy %#', (actor, changes, allowed) => expect(canApproveLeave(actor, { ...leave, ...changes })).toBe(allowed));
const query = value => ({ select: () => ({ lean: async () => value }) });

test.each(['employee', 'team_lead', 'hr_manager', 'system_admin'])('draft cancellation is owner-only for %s, before any write', async role => {
    const draft = { _id: oid(), userId: requester, status: 'draft', revision: 0, currentStep: null, operation: null };
    jest.spyOn(Leave, 'findById').mockReturnValue({ lean: async () => draft });
    const claim = jest.spyOn(Leave, 'findOneAndUpdate');
    await expect(transition({ _id: hr, role }, draft._id, 'cancel', { revision: 0 })).rejects.toMatchObject({ statusCode: 403 });
    expect(claim).not.toHaveBeenCalled();
});
test('snapshot uses Team.leaderId; inactive or missing leader skips to HR', async () => {
    jest.spyOn(User, 'find').mockReturnValue(query([{ _id: hr }]));
    jest.spyOn(Team, 'findById').mockReturnValue(query({ leaderId: lead }));
    jest.spyOn(User, 'findOne').mockReturnValue(query(null));
    const result = await resolveApproverSnapshot({ _id: requester, role: 'employee', teamId: team });
    expect(result.status).toBe('pending_hr');
    expect(User.findOne).toHaveBeenCalledWith(expect.objectContaining({ _id: lead, isActive: true }));
});
test('Team Lead requester skips their own step and HR requester can self-approve', async () => {
    jest.spyOn(User, 'find').mockReturnValue(query([{ _id: hr }]));
    const leadResult = await resolveApproverSnapshot({ _id: requester, role: 'team_lead', teamId: team });
    expect(leadResult.currentStep).toBe('hr');
    expect(User.find).toHaveBeenLastCalledWith(expect.objectContaining({ _id: { $ne: requester } }));
    const hrResult = await resolveApproverSnapshot({ _id: requester, role: 'hr_manager', teamId: team });
    expect(hrResult.currentStep).toBe('hr');
    expect(User.find).toHaveBeenLastCalledWith({ role: 'hr_manager', isActive: true });
});
test('no HR and system admin submissions fail with a business conflict', async () => {
    jest.spyOn(User, 'find').mockReturnValue(query([]));
    await expect(resolveApproverSnapshot({ _id: requester, role: 'hr_manager' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(resolveApproverSnapshot({ _id: requester, role: 'system_admin' })).rejects.toMatchObject({ statusCode: 409 });
});
test('legacy pending query spans both steps and schema only accepts the new state machine', () => {
    expect(pendingFilter('pending').$in).toEqual(['pending', 'pending_team_lead', 'pending_hr']);
    expect(Leave.schema.path('status').enumValues).toEqual(['draft', 'pending_team_lead', 'pending_hr', 'approved', 'rejected', 'cancelled']);
});
