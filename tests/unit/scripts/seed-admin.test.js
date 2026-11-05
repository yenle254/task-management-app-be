jest.mock('mongoose', () => ({ connect: jest.fn(), disconnect: jest.fn() }));
jest.mock('../../../models/user.model', () => ({ findOne: jest.fn(), create: jest.fn() }));
const mongoose = require('mongoose');
const User = require('../../../models/user.model');
const bcrypt = require('bcryptjs');
const { seedAdmin, ADMIN_ACCOUNT, MONGO_URI } = require('../../../demo_project/seed-admin');

describe('standalone demo admin seed', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mongoose.connect.mockResolvedValue({});
    mongoose.disconnect.mockResolvedValue();
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({});
  });
  test('creates the HR demo account with a verifiable password and explicit local database', async () => {
    await seedAdmin();
    expect(mongoose.connect).toHaveBeenCalledWith(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    const data = User.create.mock.calls[0][0];
    expect(data.email).toBe(ADMIN_ACCOUNT.email);
    expect(data.role).toBe('hr_manager');
    expect(data.isActive).toBe(true);
    expect(data.password).not.toBe(ADMIN_ACCOUNT.password);
    expect(await bcrypt.compare(ADMIN_ACCOUNT.password, data.password)).toBe(true);
    expect(data.leaveBalance.has(String(new Date().getFullYear()))).toBe(true);
    expect(console.log.mock.calls.flat()).not.toContain(ADMIN_ACCOUNT.password);
    expect(mongoose.disconnect).toHaveBeenCalled();
  });
  test('rerunning restores this account login without replacing teams or balances', async () => {
    const balance = new Map([['2026', {total:12,used:3,remaining:9}]]);
    const existing = { email:ADMIN_ACCOUNT.email, role:'hr_manager', profile:{employeeId:ADMIN_ACCOUNT.employeeId},
      isActive:false, teamId:'existing-team', leaveBalance:balance, save:jest.fn() };
    User.findOne.mockResolvedValue(existing);
    await seedAdmin();
    expect(await bcrypt.compare(ADMIN_ACCOUNT.password, existing.password)).toBe(true);
    expect(existing.isActive).toBe(true);
    expect(existing.teamId).toBe('existing-team');
    expect(existing.leaveBalance).toBe(balance);
    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(User.create).not.toHaveBeenCalled();
  });
  test.each([
    {email:'another@example.test', role:'hr_manager', profile:{employeeId:ADMIN_ACCOUNT.employeeId}},
    {email:ADMIN_ACCOUNT.email, role:'hr_manager', profile:{employeeId:'OTHER'}},
    {email:ADMIN_ACCOUNT.email, role:'system_admin', profile:{employeeId:ADMIN_ACCOUNT.employeeId}},
  ])('refuses to overwrite a conflicting identity: %j', async existing => {
    existing.save = jest.fn(); User.findOne.mockResolvedValue(existing);
    await expect(seedAdmin()).rejects.toThrow('belongs to another account');
    expect(existing.save).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
    expect(mongoose.disconnect).toHaveBeenCalled();
  });
});
