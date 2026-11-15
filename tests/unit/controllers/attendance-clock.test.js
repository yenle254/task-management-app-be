const Attendance = require('../../../models/attendance.model');
const officeService = require('../../../services/office.service');
const controller = require('../../../controllers/attendance.controller');
jest.mock('../../../services/office.service', () => ({ getActiveOffice: jest.fn(), validateLocation: jest.fn() }));

const office = { workingHours: { start: '10:30', end: '17:15' }, location: { lat: 21, lng: 105 }, radius: 200 };
const req = { user: { _id: 'a'.repeat(24) }, body: { lat: 21, lng: 105 } };
const response = () => { const res = { code: 200 }; res.status = jest.fn(code => { res.code = code; return res; }); res.json = jest.fn(body => { res.body = body; return res; }); return res; };
beforeEach(() => {
  jest.useFakeTimers();
  officeService.getActiveOffice.mockResolvedValue(office);
  officeService.validateLocation.mockResolvedValue(true);
  jest.spyOn(Attendance, 'findOne').mockResolvedValue(null);
  jest.spyOn(Attendance.prototype, 'save').mockResolvedValue();
});
afterEach(() => jest.useRealTimers());

test.each([[5, 30, 'present'], [10, 30, 'present'], [12, 27, 'late'], [17, 14, 'late']])('clock-in at %s:%s uses HR start time and allows late arrival', async (hour, minute, status) => {
  jest.setSystemTime(new Date(2026, 10, 14, hour, minute));
  const res = response(); await controller.clockIn(req, res);
  expect(res.code).toBe(200);
  expect(res.body.data.status).toBe(status);
  expect(res.body.data.workingHours.toObject()).toEqual(office.workingHours);
  expect(officeService.validateLocation).toHaveBeenCalledWith(21, 105, office);
});

test.each([[17, 15], [18, 0], [23, 0]])('clock-in at/after HR end time %s:%s is blocked with the actual schedule', async (hour, minute) => {
  jest.setSystemTime(new Date(2026, 10, 14, hour, minute));
  const res = response(); await controller.clockIn(req, res);
  expect(res.code).toBe(400);
  expect(res.body.message).toContain('10:30 - 17:15');
  expect(Attendance.prototype.save).not.toHaveBeenCalled();
});

test('new HR start time changes late classification', async () => {
  jest.setSystemTime(new Date(2026, 10, 14, 11));
  officeService.getActiveOffice.mockResolvedValue({ ...office, workingHours: { start: '11:30', end: '19:00' } });
  const res = response(); await controller.clockIn(req, res);
  expect(res.body.data.status).toBe('present');
});

test('missing office and out-of-radius location cannot create attendance', async () => {
  officeService.getActiveOffice.mockResolvedValueOnce(null);
  const missing = response(); await controller.clockIn(req, missing);
  expect(missing.code).toBe(400);
  officeService.validateLocation.mockResolvedValue(false);
  const outside = response(); await controller.clockIn(req, outside);
  expect(outside.code).toBe(400);
  expect(Attendance.prototype.save).not.toHaveBeenCalled();
});

test('clock-out remains allowed after end of shift and calculates actual elapsed time', async () => {
  jest.setSystemTime(new Date(2026, 10, 14, 20));
  const record = { clockIn: new Date(2026, 10, 14, 12), save: jest.fn().mockResolvedValue() };
  Attendance.findOne.mockResolvedValue(record);
  const res = response(); await controller.clockOut(req, res);
  expect(res.code).toBe(200);
  expect(record.workHours).toBe(8);
});
