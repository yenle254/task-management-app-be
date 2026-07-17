const Leave = require('../models/Leave');
const User = require('../models/User');
const leaveService = require('../services/leaveService');
const { 
  notifyLeaveApproved, 
  notifyLeaveRejected,
  notifyPendingLeave 
} = require('../services/notificationService');

/**
 * @desc    Submit leave request
 * @route   POST /api/leaves
 * @access  Private (Employee)
 */
const submitLeave = async (req, res) => {
    try {
        const { type, startDate, endDate, reason } = req.body;
        const userId = req.user._id;

        const validation = leaveService.validateLeaveDates(startDate, endDate);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: validation.message
            });
        }

        const numberOfDays = leaveService.calculateLeaveDays(startDate, endDate);

        const year = new Date(startDate).getFullYear();
        const hasEnough = await leaveService.hasEnoughLeaveBalance(userId, numberOfDays, year);
        if (!hasEnough) {
            const balance = await leaveService.getLeaveBalance(userId, year);
            return res.status(400).json({
                success: false,
                error: `Insufficient leave balance. You have ${balance.remaining} days remaining.`
            });
        }

        const leave = await Leave.create({
            userId,
            type,
            startDate,
            endDate,
            numberOfDays,
            reason,
            status: 'pending'
        });

        await leave.populate('userId', 'email profile');

        // Notify HR and Team Lead about new pending leave
        await notifyPendingLeave(leave);

        res.status(201).json({
            success: true,
            data: leave
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get current user's leave requests
 * @route   GET /api/leaves/my
 * @access  Private
 */
const getMyLeaves = async (req, res) => {
    try {
        const { status, type, year } = req.query;
        const userId = req.user._id;

        const query = { userId };
        
        if (status) {
            query.status = status;
        }
        
        if (type) {
            query.type = type;
        }

        if (year) {
            const startOfYear = new Date(year, 0, 1);
            const endOfYear = new Date(year, 11, 31, 23, 59, 59);
            query.startDate = { $gte: startOfYear, $lte: endOfYear };
        }

        const leaves = await Leave.find(query)
            .populate('approvedBy', 'email profile')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: leaves.length,
            data: leaves
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get all leave requests
 * @route   GET /api/leaves
 * @access  Private (HR Manager)
 */
const getAllLeaves = async (req, res) => {
    try {
        const { status, type, year, page = 1, limit = 10 } = req.query;

        const query = {};
        
        if (status) {
            query.status = status;
        }
        
        if (type) {
            query.type = type;
        }

        if (year) {
            const startOfYear = new Date(year, 0, 1);
            const endOfYear = new Date(year, 11, 31, 23, 59, 59);
            query.startDate = { $gte: startOfYear, $lte: endOfYear };
        }

        const skip = (page - 1) * limit;
        const total = await Leave.countDocuments(query);

        const leaves = await Leave.find(query)
            .populate('userId', 'email profile teamId')
            .populate('approvedBy', 'email profile')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        res.json({
            success: true,
            count: leaves.length,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / limit),
            data: leaves
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get leave by ID
 * @route   GET /api/leaves/:id
 * @access  Private
 */
const getLeaveById = async (req, res) => {
    try {
        const leave = await Leave.findById(req.params.id)
            .populate('userId', 'email profile teamId managerId')
            .populate('approvedBy', 'email profile');

        if (!leave) {
            return res.status(404).json({
                success: false,
                error: 'Leave request not found'
            });
        }

        const canView = 
            leave.userId._id.toString() === req.user._id.toString() ||
            req.user.role === 'hr_manager' ||
            (req.user.role === 'team_lead' && 
             leave.userId.teamId?.toString() === req.user.teamId?.toString());

        if (!canView) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to view this leave request'
            });
        }

        res.json({
            success: true,
            data: leave
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get leave statistics (count by status)
 * @route   GET /api/leaves/statistics
 * @access  Private (Team Lead, HR Manager)
 */
const getLeaveStatistics = async (req, res) => {
    try {
        let query = {};

        // Team lead sees only their team's leaves
        if (req.user.role === 'team_lead') {
            const teamMembers = await User.find({ 
                teamId: req.user.teamId 
            }).select('_id');
            
            const memberIds = teamMembers.map(m => m._id);
            query.userId = { $in: memberIds };
        }

        // Get all leaves and count by status
        const leaves = await Leave.find(query)
            .populate('userId', 'email profile teamId')
            .sort({ createdAt: -1 });

        const stats = {
            pending: leaves.filter(l => l.status === 'pending').length,
            approved: leaves.filter(l => l.status === 'approved').length,
            rejected: leaves.filter(l => l.status === 'rejected').length,
            total: leaves.length
        };

        res.json({
            success: true,
            data: leaves,
            stats: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get pending leave requests for approval
 * @route   GET /api/leaves/pending
 * @access  Private (Team Lead, HR Manager)
 */
const getPendingLeaves = async (req, res) => {
    try {
        let query = { status: 'pending' };

        if (req.user.role === 'team_lead') {
            const teamMembers = await User.find({ 
                teamId: req.user.teamId 
            }).select('_id');
            
            const memberIds = teamMembers.map(m => m._id);
            query.userId = { $in: memberIds };
        }

        const leaves = await Leave.find(query)
            .populate('userId', 'email profile department position')
            .sort({ createdAt: 1 });

        res.json({
            success: true,
            count: leaves.length,
            data: leaves
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Approve leave request
 * @route   PUT /api/leaves/:id/approve
 * @access  Private (Team Lead, HR Manager)
 */
const approveLeave = async (req, res) => {
    try {
        const leave = await Leave.findById(req.params.id)
            .populate('userId', 'email profile teamId managerId');

        if (!leave) {
            return res.status(404).json({
                success: false,
                error: 'Leave request not found'
            });
        }

        if (leave.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Leave request already ${leave.status}`
            });
        }

        const canApprove = leaveService.canApproveLeave(req.user, leave);
        if (!canApprove) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to approve this leave request'
            });
        }

        leave.status = 'approved';
        leave.approvedBy = req.user._id;
        leave.approvedAt = new Date();
        await leave.save();

        const year = new Date(leave.startDate).getFullYear();
        await leaveService.updateLeaveBalance(
            leave.userId._id,
            leave.numberOfDays,
            year
        );

        await leave.populate('approvedBy', 'email profile');

        // Notify employee about approval
        await notifyLeaveApproved(leave, leave.userId._id);

        res.json({
            success: true,
            message: 'Leave request approved successfully',
            data: leave
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Reject leave request
 * @route   PUT /api/leaves/:id/reject
 * @access  Private (Team Lead, HR Manager)
 */
const rejectLeave = async (req, res) => {
    try {
        const { rejectionReason } = req.body;
        const leave = await Leave.findById(req.params.id)
            .populate('userId', 'email profile teamId managerId');

        if (!leave) {
            return res.status(404).json({
                success: false,
                error: 'Leave request not found'
            });
        }

        if (leave.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Leave request already ${leave.status}`
            });
        }

        const canApprove = leaveService.canApproveLeave(req.user, leave);
        if (!canApprove) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to reject this leave request'
            });
        }

        leave.status = 'rejected';
        leave.approvedBy = req.user._id;
        leave.approvedAt = new Date();
        leave.rejectionReason = rejectionReason || 'No reason provided';
        await leave.save();

        await leave.populate('approvedBy', 'email profile');

        // Notify employee about rejection
        await notifyLeaveRejected(leave, leave.userId._id);

        res.json({
            success: true,
            message: 'Leave request rejected',
            data: leave
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Cancel own leave request
 * @route   DELETE /api/leaves/:id
 * @access  Private
 */
const cancelLeave = async (req, res) => {
    try {
        const leave = await Leave.findById(req.params.id);

        if (!leave) {
            return res.status(404).json({
                success: false,
                error: 'Leave request not found'
            });
        }

        if (leave.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to cancel this leave request'
            });
        }

        if (leave.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: 'Only pending leave requests can be cancelled'
            });
        }

        await leave.deleteOne();

        res.json({
            success: true,
            message: 'Leave request cancelled successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get leave balance for current user
 * @route   GET /api/leaves/balance
 * @access  Private
 */
const getLeaveBalance = async (req, res) => {
    try {
        const { year = new Date().getFullYear() } = req.query;
        const userId = req.user._id;

        const balance = await leaveService.getLeaveBalance(userId, parseInt(year));

        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59);

        const leaves = await Leave.find({
            userId,
            startDate: { $gte: startOfYear, $lte: endOfYear },
            status: { $in: ['approved', 'pending'] }
        }).select('type numberOfDays status startDate endDate');

        res.json({
            success: true,
            data: {
                year: parseInt(year),
                balance,
                leaves
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get team leaves
 * @route   GET /api/leaves/team/:teamId
 * @access  Private (Team Lead, HR Manager)
 */
const getTeamLeaves = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { status, month, year = new Date().getFullYear() } = req.query;

        if (req.user.role === 'team_lead' && req.user.teamId?.toString() !== teamId) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to view this team\'s leaves'
            });
        }

        const teamMembers = await User.find({ teamId }).select('_id');
        const memberIds = teamMembers.map(m => m._id);

        const query = {
            userId: { $in: memberIds }
        };

        if (status) {
            query.status = status;
        }

        if (month && year) {
            const startOfMonth = new Date(year, month - 1, 1);
            const endOfMonth = new Date(year, month, 0, 23, 59, 59);
            query.startDate = { $gte: startOfMonth, $lte: endOfMonth };
        } else if (year) {
            const startOfYear = new Date(year, 0, 1);
            const endOfYear = new Date(year, 11, 31, 23, 59, 59);
            query.startDate = { $gte: startOfYear, $lte: endOfYear };
        }

        const leaves = await Leave.find(query)
            .populate('userId', 'email profile')
            .populate('approvedBy', 'email profile')
            .sort({ startDate: 1 });

        res.json({
            success: true,
            count: leaves.length,
            data: leaves
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

module.exports = {
    submitLeave,
    getMyLeaves,
    getAllLeaves,
    getLeaveById,
    getPendingLeaves,
    getLeaveStatistics,
    approveLeave,
    rejectLeave,
    cancelLeave,
    getLeaveBalance,
    getTeamLeaves
};







