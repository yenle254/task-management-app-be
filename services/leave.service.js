const User = require('../models/user.model');
const { differenceInCalendarDays, isBefore, startOfDay } = require('date-fns');

/**
 * Calculate number of leave days between start and end date
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Number} Number of days
 */
const calculateLeaveDays = (startDate, endDate) => {
    const start = startOfDay(new Date(startDate));
    const end = startOfDay(new Date(endDate));
    return differenceInCalendarDays(end, start) + 1;
};

/**
 * Get leave balance for a user in a specific year
 * @param {String} userId - User ID
 * @param {Number} year - Year (e.g., 2025)
 * @returns {Object} Leave balance { total, used, remaining }
 */
const getLeaveBalance = async (userId, year = new Date().getFullYear()) => {
    const user = await User.findById(userId).select('leaveBalance');
    if (!user) {
        throw new Error('User not found');
    }

    const balance = user.leaveBalance?.get(year.toString()) || {
        total: 12,
        used: 0,
        remaining: 12
    };

    return balance;
};

/**
 * Check if user can approve a leave request
 * @param {Object} approver - User who wants to approve
 * @param {Object} leave - Leave request (populated with userId)
 * @returns {Boolean} Can approve or not
 */
const canApproveLeave = (approver, leave) => {
    const id = value => String(value?._id || value || '');
    if (approver.isActive === false || id(approver) === id(leave.userId)) return false;
    if (!['pending_team_lead', 'pending_hr'].includes(leave.status)) return false;
    if (approver.role === 'hr_manager') return true;
    return approver.role === 'team_lead' && leave.status === 'pending_team_lead' &&
        leave.currentStep === 'team_lead' && !!approver.teamId &&
        id(approver.teamId) === id(leave.teamSnapshot) &&
        (leave.approverSnapshot || []).some(a => a.role === 'team_lead' && a.active && id(a.userId) === id(approver));
};

/**
 * Validate leave dates
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Object} { valid: Boolean, message: String }
 */
const validateLeaveDates = (startDate, endDate) => {
    const start = startOfDay(new Date(startDate));
    const end = startOfDay(new Date(endDate));
    const today = startOfDay(new Date());

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { valid: false, message: 'Invalid date format' };
    }

    if (isBefore(end, start)) {
        return { valid: false, message: 'End date must be after or equal to start date' };
    }

    if (isBefore(start, today)) {
        return { valid: false, message: 'Start date must be today or in the future' };
    }

    const days = calculateLeaveDays(start, end);
    if (days > 30) {
        return { valid: false, message: 'Leave request cannot exceed 30 days' };
    }

    return { valid: true, message: 'Valid dates' };
};

/**
 * Update leave balance after leave is approved
 * @param {String} userId - User ID
 * @param {Number} numberOfDays - Number of days to deduct
 * @param {Number} year - Year
 */
const updateLeaveBalance = async (userId, numberOfDays, year = new Date().getFullYear()) => {
    const key = `leaveBalance.${year}`;
    await User.updateOne({ _id: userId, [key]: { $exists: false } },
        { $set: { [key]: { total: 12, used: 0, remaining: 12 } } });
    const user = await User.findOneAndUpdate({ _id: userId, [`${key}.remaining`]: { $gte: numberOfDays } },
        { $inc: { [`${key}.used`]: numberOfDays, [`${key}.remaining`]: -numberOfDays } }, { new: true });
    if (!user) throw Object.assign(new Error('balance no longer sufficient'), { statusCode: 409 });
    return user.leaveBalance.get(String(year));
};

/**
 * Check if user has enough leave balance
 * @param {String} userId - User ID
 * @param {Number} numberOfDays - Days requested
 * @param {Number} year - Year
 * @returns {Boolean}
 */
const hasEnoughLeaveBalance = async (userId, numberOfDays, year = new Date().getFullYear()) => {
    const balance = await getLeaveBalance(userId, year);
    return balance.remaining >= numberOfDays;
};

module.exports = {
    calculateLeaveDays,
    getLeaveBalance,
    canApproveLeave,
    validateLeaveDates,
    updateLeaveBalance,
    hasEnoughLeaveBalance
};
