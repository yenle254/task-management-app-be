const User = require('../models/User');
const Attendance = require('../models/Attendance');


/**
 * Calculate work hours between clock-in and clock-out
 * @param {Date} clockIn
 * @param {Date} clockOut
 * @returns {Number}
**/
const calculateWorkHours = (clockIn, clockOut) => {
    const inTime = new Date(clockIn);
    const outTime = new Date(clockOut);
    const diffMs = outTime - inTime;
    const diffHrs = diffMs / (1000 * 60 * 60);
    return parseFloat(diffHrs.toFixed(2));
}


/**
 * Determine attendance status based on clock-in time (late or not)
 * @param {Date} clockInTime
 * @returns {String}
**/ 
const determineStatus = (clockInTime) => {
    const inTime = new Date(clockInTime);
    const standardStart = new Date(inTime);
    standardStart.setHours(9, 0, 0, 0); // 9:00 AM
    return inTime <= standardStart ? 'present' : 'late';    
}


/** 
 * Get today's attendance record for a user
 * @param {String} userId
 * @returns {Object|null}
**/
const getTodayAttendance = async (userId) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    return await Attendance.findOne({
        userId,
        date: { $gte: startOfDay, $lte: endOfDay }
    });
}


/**
 * Check if a date is a working day (Monday-Friday, excluding holidays)
 * @param {Date} date
 * @returns {Boolean}
 */
const isWorkingDay = (date) => {
    const day = date.getDay();
    // 0 = Sunday, 6 = Saturday
    return day !== 0 && day !== 6;
}

/**
 * Get all working days between two dates
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array} Array of Date objects
 */
const getWorkingDays = (startDate, endDate) => {
    const workingDays = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    
    while (current <= end) {
        if (isWorkingDay(current)) {
            workingDays.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
    }
    
    return workingDays;
}

/**
 * Get attendance statistics for a user over a date range
 * @param {String} userId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Object}
 */
const getAttendanceStats = async (userId, startDate, endDate) => {
    const query = { userId };
    let workingDaysCount = 0;
    
    // Only add date filter if dates are provided and valid
    if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            query.date = { $gte: start, $lte: end };
            // Calculate working days in range
            const workingDays = getWorkingDays(start, end);
            workingDaysCount = workingDays.length;
        }
    }
    
    const records = await Attendance.find(query);

    const totalRecords = records.length;
    const presentDays = records.filter(r => r.status === 'present').length;
    const lateDays = records.filter(r => r.status === 'late').length;
    
    // Calculate absent days: working days - total records
    const absentDays = workingDaysCount > 0 ? Math.max(0, workingDaysCount - totalRecords) : 0;
    
    const totalWorkHours = records.reduce((sum, r) => sum + (r.workHours || 0), 0);
    const averageWorkHours = totalRecords > 0 ? totalWorkHours / totalRecords : 0;

    return {
        totalDays: workingDaysCount || totalRecords,
        presentDays,
        lateDays,
        absentDays,
        totalWorkHours: parseFloat(totalWorkHours.toFixed(2)),
        averageWorkHours: parseFloat(averageWorkHours.toFixed(2))
    };
}


/**
 * Auto clock-out for incomplete past attendance records
 * @param {Object} record - Attendance record
 * @returns {Object} Updated record
 */
const autoClockOutIfNeeded = (record) => {
    // Only process if no clock-out
    if (record.clockOut) {
        return record;
    }
    
    const recordDate = new Date(record.date);
    recordDate.setHours(23, 59, 59, 999);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // If record is from past (not today), auto clock-out at 6 PM
    if (recordDate < today) {
        const autoClockOutTime = new Date(record.date);
        autoClockOutTime.setHours(18, 0, 0, 0); // 6:00 PM
        
        record.clockOut = autoClockOutTime;
        record.workHours = calculateWorkHours(record.clockIn, autoClockOutTime);
        record.autoClockOut = true; // Flag to indicate auto clock-out
    }
    
    return record;
}

/**
 * Validate if location is within allowed area
 * @param {Number} lat
 * @param {Number} lng
 * @returns {Boolean}
 **/
const validateLocation = (lat, lng) => {
    // 10.871556, 106.803221 // cb
    // 10.869093, 106.803103 // cn
    // 10.869935, 106.805138 // cd
    // 10.869913, 106.802012 // ct
    const allowedArea = {
        latMin: 10.869093,
        latMax: 10.871556,
        lngMin: 106.802012,
        lngMax: 106.805138
    };

    return lat >= allowedArea.latMin && lat <= allowedArea.latMax &&
           lng >= allowedArea.lngMin && lng <= allowedArea.lngMax;
}

module.exports = {
    calculateWorkHours,
    determineStatus,
    getTodayAttendance,
    getAttendanceStats,
    validateLocation,
    isWorkingDay,
    getWorkingDays,
    autoClockOutIfNeeded
};