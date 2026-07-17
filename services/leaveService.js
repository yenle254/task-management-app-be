const Leave = require('../models/Leave');
const User = require('../models/User');
const { differenceInCalendarDays, isBefore, isAfter, startOfDay, isFuture, isPast } = require('date-fns');

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
    if (approver.role === 'hr_manager') {
        return true;
    }

    if (approver.role === 'team_lead') {
        if (leave.userId.teamId && leave.userId.teamId.toString() === approver.teamId?.toString()) {
            return true;
        }

        if (leave.userId.managerId && leave.userId.managerId.toString() === approver._id.toString()) {
            return true;
        }
    }

    return false;
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
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const yearKey = year.toString();
    let balance = user.leaveBalance?.get(yearKey) || { total: 12, used: 0, remaining: 12 };

    balance.used += numberOfDays;
    balance.remaining = balance.total - balance.used;

    if (balance.remaining < 0) {
        balance.remaining = 0;
    }
    
    if (!user.leaveBalance) {
        user.leaveBalance = new Map();
    }
    user.leaveBalance.set(yearKey, balance);

    await user.save();
    return balance;
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
