const Attendance = require('../models/Attendance');
const attendanceService = require('../services/attendanceServices');
const User = require('../models/User');


/**
 * @desc    Employee clock-in
 * @route   POST /api/attendance/clock-in
 * @access  Private
 */
const clockIn = async (req, res) => {
    try {
        const userId = req.user._id;
        const { lat, lng } = req.body;

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Latitude and longitude are required'
            });
        }

        const todayAttendance = await attendanceService.getTodayAttendance(userId);
        if (todayAttendance && todayAttendance.clockIn) {
            return res.status(400).json({
                success: false,
                message: 'Already clocked in today'
            });
        }

        const validLocation = attendanceService.validateLocation(lat, lng);
        if (!validLocation) {
            return res.status(400).json({
                success: false,
                message: 'Clock-in location is outside the allowed area'
            });
        }

        const clockInTime = new Date();
        const currentHour = clockInTime.getHours();
        
        // Check if before 6 AM (06:00) or after 6 PM (18:00)
        if (currentHour < 6) {
            return res.status(400).json({
                success: false,
                message: 'Clock-in is not allowed before 6:00 AM. Office hours are from 6:00 AM to 6:00 PM.'
            });
        }
        
        if (currentHour >= 18) {
            return res.status(400).json({
                success: false,
                message: 'Clock-in is not allowed after 6:00 PM. Please contact HR if you need to record attendance for today.'
            });
        }

        const status = attendanceService.determineStatus(clockInTime);
        const attendanceRecord = new Attendance({
            userId,
            date: clockInTime,
            clockIn: clockInTime,
            status,
            location: {
                lat,
                lng
            }
        });
        await attendanceRecord.save();
        res.status(200).json({
            success: true,
            data: attendanceRecord
        });

    } catch (error) {
        console.error('Clock-in error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}



/**
 * @desc    Employee clock-out
 * @route   PUT /api/attendance/clock-out
 * @access  Private
 */
const clockOut = async (req, res) => {
    try {
        const userId = req.user._id;
        const todayAttendance = await attendanceService.getTodayAttendance(userId);
        if (!todayAttendance || !todayAttendance.clockIn) {
            return res.status(400).json({
                success: false,
                message: 'No clock-in record found for today'
            });
        }

        if (todayAttendance.clockOut) {
            return res.status(400).json({
                success: false,
                message: 'Already clocked out today'
            });
        }

        const clockOutTime = new Date();
        const workHours = attendanceService.calculateWorkHours(todayAttendance.clockIn, clockOutTime);
        todayAttendance.clockOut = clockOutTime;
        todayAttendance.workHours = workHours;
        await todayAttendance.save();

        res.status(200).json({
            success: true,
            data: todayAttendance
        });

    } catch (error) {
        console.error('Clock-out error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        })
    }
}



/**
 * @desc    Get current user's attendance records (with calculated absent days)
 * @route   GET /api/attendance/my
 * @access  Private
 */
const getMyAttendance = async (req, res) => {
    try {
        const userId = req.user._id;
        const { startDate, endDate } = req.query;
        const query = { userId };
        let finalRecords = [];
        
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                query.date = {
                    $gte: start,  
                    $lte: end     
                };
                
                // Get actual attendance records
                let records = await Attendance.find(query).sort({ date: -1 });
                
                // Auto clock-out for incomplete past records
                const recordsToUpdate = [];
                records = records.map(record => {
                    const originalClockOut = record.clockOut;
                    const updatedRecord = attendanceService.autoClockOutIfNeeded(record);
                    
                    // If auto clock-out was applied, save to DB
                    if (!originalClockOut && updatedRecord.clockOut && updatedRecord.autoClockOut) {
                        recordsToUpdate.push(record);
                    }
                    
                    return updatedRecord;
                });
                
                // Save updated records to DB
                if (recordsToUpdate.length > 0) {
                    await Promise.all(recordsToUpdate.map(r => r.save()));
                }
                
                // Get all working days in range
                const workingDays = attendanceService.getWorkingDays(start, end);
                
                // Create a map of existing records by date
                const recordMap = new Map();
                records.forEach(record => {
                    const dateKey = new Date(record.date).toDateString();
                    recordMap.set(dateKey, record);
                });
                
                // Get today's date for comparison
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                // Fill in absent records for missing working days (excluding today)
                workingDays.forEach(day => {
                    const dateKey = day.toDateString();
                    const dayDate = new Date(day);
                    dayDate.setHours(0, 0, 0, 0);
                    
                    if (recordMap.has(dateKey)) {
                        finalRecords.push(recordMap.get(dateKey));
                    } else if (dayDate < today) {
                        // Only create absent record for past days, not today
                        finalRecords.push({
                            _id: `absent_${day.getTime()}`,
                            userId,
                            date: day,
                            status: 'absent',
                            workHours: 0,
                            isCalculated: true // Flag to indicate this is a calculated record
                        });
                    }
                });
                
                // Sort by date descending
                finalRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
            } else {
                // If no date range, just return actual records
                finalRecords = await Attendance.find(query).sort({ date: -1 });
            }
        } else {
            // If no date range, just return actual records
            finalRecords = await Attendance.find(query).sort({ date: -1 });
        }

        res.status(200).json({
            success: true,
            data: finalRecords
        });

    } catch (error) {
        console.error('Get my attendance error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}



/**
 * @desc    Get attendance records for a specific date
 * @route   GET /api/attendance/date/:date
 * @access  Private (Current user or HR Manager)
 */
const getAttendanceByDate = async (req, res) => {
    try {
        const { date } = req.params;
        const targetDate = new Date(date);
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const records = await Attendance.find({
            date: { $gte: startOfDay, $lte: endOfDay }
        }).populate('userId', 'name email');    

        res.status(200).json({
            success: true,
            data: records
        });

    } catch (error) {
        console.error('Get attendance by date error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}


/**
 * @desc    Get all attendance records
 * @route   GET /api/attendance
 * @access  Private (HR Manager only)
 */
const getAllAttendance = async (req, res) => {
    try {
        const { startDate, endDate, page = 1, limit = 20 } = req.query;
        const query = {};
        
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                query.date = {
                    $gte: start,
                    $lte: end
                };
            }
        }
        
        const records = await Attendance.find(query)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort({ date: -1 })
            .populate('userId', 'name email');
        
        res.status(200).json({
            success: true,
            data: records
        });

    } catch (error) {
        console.error('Get all attendance error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}



/**
 * @desc    Get attendance records for a team
 * @route   GET /api/attendance/team/:teamId
 * @access  Private (Team Lead only)
 */
const getTeamAttendance = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { startDate, endDate } = req.query;

        const teamMembers = await User.find({ teamId }).select('_id');
        const memberIds = teamMembers.map(m => m._id);
        const query = {
            userId: { $in: memberIds }
        };

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                query.date = {
                    $gte: start,
                    $lte: end
                };
            }
        }

        const records = await Attendance.find(query).sort({ date: -1 }).populate('userId', 'name email');
        res.status(200).json({
            success: true,
            data: records
        });

    } catch (error) {
        console.error('Get team attendance error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}



/**
 * @desc    Get attendance statistics for current user
 * @route   GET /api/attendance/stats
 * @access  Private
 */
const getAttendanceStats = async (req, res) => {
    try {
        const userId = req.user._id;
        const { startDate, endDate } = req.query;
        const stats = await attendanceService.getAttendanceStats(userId, startDate, endDate);
        
        res.status(200).json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('Get attendance stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}



/**
 * @desc    Update an attendance record
 * @route   PUT /api/attendance/:id
 * @access  Private (HR Manager only)
 */
const updateAttendance = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const attendanceRecord = await Attendance.findById(id);
        if (!attendanceRecord) {
            return res.status(404).json({
                success: false,
                message: 'Attendance record not found'
            });
        }

        Object.keys(updates).forEach(key => {
            attendanceRecord[key] = updates[key];
        });
        await attendanceRecord.save();

        res.status(200).json({
            success: true,
            data: attendanceRecord
        });

    } catch (error) {
        console.error('Update attendance error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}



/** 
 * @desc    Get today's attendance for current user
 * @route   GET /api/attendance/today
 * @access  Private
 */
const getTodayAttendance = async (req, res) => {
    try {
        const userId = req.user._id;
        const todayAttendance = await attendanceService.getTodayAttendance(userId);
        res.status(200).json({
            success: true,
            data: todayAttendance
        });

    } catch (error) {
        console.error('Get today attendance error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}


module.exports = {
    clockIn,
    clockOut,
    getMyAttendance,
    getAttendanceByDate,
    getAllAttendance,
    getTeamAttendance,
    getAttendanceStats,
    updateAttendance,
    getTodayAttendance
}