const Attendance = require('../../../models/attendance.model');
const officeService = require('../../../services/office.service');
const attendanceService = require('../../../services/attendance.service');

jest.mock('../../../services/office.service', () => ({ validateLocation: jest.fn() }));

describe('attendance service date and status rules', () => {
  afterEach(() => jest.restoreAllMocks());

  test('classifies 09:00 as present and later clock-ins as late', () => {
    expect(attendanceService.determineStatus(new Date(2025, 0, 6, 9, 0))).toBe('present');
    expect(attendanceService.determineStatus(new Date(2025, 0, 6, 9, 1))).toBe('late');
  });

  test('counts recorded hours and excludes weekends from working days', () => {
    expect(attendanceService.calculateWorkHours(
      new Date(2025, 0, 6, 9), new Date(2025, 0, 6, 17, 30)
    )).toBe(8.5);
    expect(attendanceService.isWorkingDay(new Date(2025, 0, 4))).toBe(false);
    expect(attendanceService.getWorkingDays(
      new Date(2025, 0, 3), new Date(2025, 0, 6)
    )).toHaveLength(2);
  });

  test('includes the final day in personal attendance statistics', async () => {
    const spy = jest.spyOn(Attendance, 'find').mockResolvedValue([
      { status: 'present', workHours: 8 }
    ]);
    const stats = await attendanceService.getAttendanceStats(
      'employee-1', '2025-01-06', '2025-01-07'
    );
    expect(spy.mock.calls[0][0].date.$lte.getHours()).toBe(23);
    expect(spy.mock.calls[0][0].date.$lte.getMilliseconds()).toBe(999);
    expect(stats).toMatchObject({
      totalDays: 2, presentDays: 1, absentDays: 1,
      totalWorkHours: 8, averageWorkHours: 8
    });
  });

  test('queries the current local day for clock-in lookup', async () => {
    const spy = jest.spyOn(Attendance, 'findOne').mockResolvedValue(null);
    expect(await attendanceService.getTodayAttendance('employee-1')).toBeNull();
    expect(spy.mock.calls[0][0].date.$gte.getHours()).toBe(0);
    expect(spy.mock.calls[0][0].date.$lte.getHours()).toBe(23);
  });

  test('only auto-clocks-out an unfinished past record', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(9, 0, 0, 0);
    const oldRecord = { date: yesterday, clockIn: yesterday, clockOut: null };
    attendanceService.autoClockOutIfNeeded(oldRecord);
    expect(oldRecord.autoClockOut).toBe(true);
    expect(oldRecord.workHours).toBe(9);

    const todayRecord = { date: new Date(), clockIn: new Date(), clockOut: null };
    attendanceService.autoClockOutIfNeeded(todayRecord);
    expect(todayRecord.clockOut).toBeNull();
  });

  test('delegates location checks to the office rule', async () => {
    officeService.validateLocation.mockResolvedValue(true);
    expect(await attendanceService.validateLocation(10, 106)).toBe(true);
    expect(officeService.validateLocation).toHaveBeenCalledWith(10, 106);
  });
});
