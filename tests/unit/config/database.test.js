jest.mock('mongoose', () => ({ connect: jest.fn(), connection: new (require('node:events').EventEmitter)() }));
jest.mock('../../../utils/logger.utils', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const mongoose = require('mongoose');
const logger = require('../../../utils/logger.utils');
const connectDB = require('../../../config/database');

test('connect returns its promise with bounded selection, without owning process signals', async () => {
  const before = process.listenerCount('SIGINT');
  mongoose.connect.mockResolvedValue(mongoose);
  expect(await connectDB()).toBe(mongoose);
  expect(mongoose.connect).toHaveBeenCalledWith(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 });
  expect(process.listenerCount('SIGINT')).toBe(before);
});

test('initial failure is propagated to lifecycle rather than exiting in the database helper', async () => {
  const error = Error('secret credentials');
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
  mongoose.connect.mockRejectedValue(error);
  await expect(connectDB()).rejects.toBe(error);
  expect(exit).not.toHaveBeenCalled();
});

test('connection event logs omit database details', () => {
  mongoose.connection.emit('error', Error('mongodb://secret'));
  mongoose.connection.emit('disconnected');
  expect(logger.error).toHaveBeenCalledWith('MongoDB connection error');
  expect(logger.warn).toHaveBeenCalledWith('MongoDB disconnected');
});
