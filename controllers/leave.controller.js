const Leave = require('../models/leave.model');
const User = require('../models/user.model');
const leaveService = require('../services/leave.service');
const workflow = require('../services/leave-workflow.service');
const { LEAVE_PENDING_STATUSES } = require('../utils/constants.utils');

const respondError = (res, error) => res.status(error.statusCode || 500).json({ success: false, error: error.message });
const populate = query => query.populate('userId', 'email profile teamId').populate('approvedBy', 'email profile').populate('history.by', 'email profile.fullName');
const present = async leave => {
    try { return await Leave.populate(leave, [
        { path: 'userId', select: 'email profile teamId' }, { path: 'approvedBy', select: 'email profile' },
        { path: 'history.by', select: 'email profile.fullName' }
    ]); }
    catch (error) { console.error('Leave response enrichment failed:', error.message); return leave; }
};
const filters = ({ status, type, year }) => ({
    ...(status ? { status: workflow.pendingFilter(status) } : {}), ...(type ? { type } : {}),
    ...(year ? { startDate: { $gte: new Date(Number(year), 0, 1), $lt: new Date(Number(year) + 1, 0, 1) } } : {})
});
async function teamScope(user) {
    if (user.role !== 'team_lead') return {};
    if (!user.teamId) return { userId: { $in: [] } };
    const members = await User.find({ teamId: user.teamId }).select('_id').lean();
    return { userId: { $in: members.map(member => member._id) } };
}
const submitLeave = async (req, res) => {
    try { res.status(201).json({ success: true, data: await present(await workflow.create(req.user, req.body, req)) }); }
    catch (error) { respondError(res, error); }
};
const actionHandler = action => async (req, res) => {
    try { res.json({ success: true, data: await present(await workflow.transition(req.user, req.params.id, action, req.body || {}, req)) }); }
    catch (error) { respondError(res, error); }
};
const submitDraft = actionHandler('submit'), editLeave = actionHandler('edit_resubmit');
const approveLeave = actionHandler('approve'), rejectLeave = actionHandler('reject'), cancelLeave = actionHandler('cancel');

const list = own => async (req, res) => {
    try {
        const query = { ...filters(req.query), ...(own ? { userId: req.user._id } : {}) };
        if (!own) query.$or = [{ status: { $ne: 'draft' } }, { userId: req.user._id }];
        const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
        const [data, total] = await Promise.all([
            populate(Leave.find(query)).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Leave.countDocuments(query)
        ]);
        res.json({ success: true, count: data.length, total, page, pages: Math.ceil(total / limit), data });
    } catch (error) { respondError(res, error); }
};
const getMyLeaves = list(true), getAllLeaves = list(false);
const getLeaveById = async (req, res) => {
    try {
        const leave = await populate(Leave.findById(req.params.id)).lean();
        if (!leave) return res.status(404).json({ success: false, error: 'Leave request not found' });
        const owner = workflow.id(leave.userId) === workflow.id(req.user);
        const canView = owner || (leave.status !== 'draft' && (req.user.role === 'hr_manager' ||
            (req.user.role === 'team_lead' && !!req.user.teamId && workflow.id(leave.userId?.teamId) === workflow.id(req.user.teamId))));
        if (!canView) return res.status(403).json({ success: false, error: 'Not authorized to view this leave request' });
        res.json({ success: true, data: leave });
    } catch (error) { respondError(res, error); }
};
const getPendingLeaves = async (req, res) => {
    try {
        const query = {
            status: { $in: LEAVE_PENDING_STATUSES },
            ...(req.user.role === 'hr_manager' ? {} : { userId: { $ne: req.user._id } })
        };
        if (req.query.step) query.currentStep = req.query.step;
        if (req.user.role === 'team_lead') {
            Object.assign(query, await teamScope(req.user), { status: 'pending_team_lead', currentStep: 'team_lead',
                teamSnapshot: req.user.teamId || null, approverSnapshot: { $elemMatch: { role: 'team_lead', userId: req.user._id, active: true } } });
            const Team = require('../models/team.model');
            const team = req.user.teamId && await Team.findById(req.user.teamId).select('leaderId').lean();
            if (!team || workflow.id(team.leaderId) !== workflow.id(req.user) || req.query.step === 'hr') query.userId = { $in: [] };
        }
        const data = await populate(Leave.find(query)).sort({ createdAt: 1 }).lean();
        res.json({ success: true, count: data.length, data });
    } catch (error) { respondError(res, error); }
};
const getLeaveStatistics = async (req, res) => {
    try {
        const data = await populate(Leave.find({ ...await teamScope(req.user), status: { $ne: 'draft' } })).sort({ createdAt: -1 }).lean();
        const stats = { pending: 0, approved: 0, rejected: 0, cancelled: 0, total: data.length };
        for (const leave of data) { const key = LEAVE_PENDING_STATUSES.includes(leave.status) ? 'pending' : leave.status; if (key in stats) stats[key]++; }
        res.json({ success: true, stats, data });
    } catch (error) { respondError(res, error); }
};
const getLeaveBalance = async (req, res) => {
    try {
        const year = Number(req.query.year || new Date().getFullYear());
        const [balance, leaves] = await Promise.all([
            leaveService.getLeaveBalance(req.user._id, year),
            Leave.find({ userId: req.user._id, ...filters({ year }), status: { $in: ['approved', ...LEAVE_PENDING_STATUSES] } })
                .select('type numberOfDays status currentStep startDate endDate').lean()
        ]);
        res.json({ success: true, data: { year, balance, leaves } });
    } catch (error) { respondError(res, error); }
};
const getTeamLeaves = async (req, res) => {
    try {
        if (req.user.role === 'team_lead' && workflow.id(req.user.teamId) !== req.params.teamId)
            return res.status(403).json({ success: false, error: 'Not authorized to view this team' });
        const members = await User.find({ teamId: req.params.teamId }).select('_id').lean();
        const year = Number(req.query.year || new Date().getFullYear());
        const query = { userId: { $in: members.map(member => member._id) }, ...filters({ ...req.query, year }) };
        query.$or = [{ status: { $ne: 'draft' } }, { userId: req.user._id }];
        if (req.query.month) query.startDate = { $gte: new Date(year, Number(req.query.month) - 1, 1), $lt: new Date(year, Number(req.query.month), 1) };
        const data = await populate(Leave.find(query)).sort({ startDate: 1 }).lean();
        res.json({ success: true, count: data.length, data });
    } catch (error) { respondError(res, error); }
};
module.exports = { submitLeave, submitDraft, editLeave, getMyLeaves, getAllLeaves, getLeaveById, getPendingLeaves,
    getLeaveStatistics, approveLeave, rejectLeave, cancelLeave, getLeaveBalance, getTeamLeaves };
