const mongoose = require('mongoose');
const logger = require('../utils/logger.utils');

mongoose.connection.on('error', () => logger.error('MongoDB connection error'));
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

/**
 * @returns {Promise}
 */
const connectDB = async () => {
    const conn = await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 });
    logger.info('MongoDB connected');
    return conn;
};

module.exports = connectDB;



