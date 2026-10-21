const logger = require('../utils/logger.utils');

/**
 * Global Express error handler.
 * Preserves the existing public response shape and status-code logic.
 * Adds structured server-side logging in all environments.
 */
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    if (err.name === 'CastError') {
        const message = 'Resource not found';
        error = { message, statusCode: 404 };
    }

    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        const message = `${field} already exists`;
        error = { message, statusCode: 400 };
    }

    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors).map(val => val.message).join(', ');
        error = { message, statusCode: 400 };
    }

    if (err.name === 'JsonWebTokenError') {
        const message = 'Invalid token';
        error = { message, statusCode: 401 };
    }

    if (err.name === 'TokenExpiredError') {
        const message = 'Token expired';
        error = { message, statusCode: 401 };
    }

    const statusCode = error.statusCode || 500;
    const isServerError = statusCode >= 500;
    const logMethod = isServerError ? 'error' : 'warn';

    // Avoid double-logging if response already sent (e.g. aborted)
    if (!res.headersSent) {
        logger[logMethod]('HTTP request failed', {
            requestId: req.requestId,
            method: req.method,
            route: req.originalUrl ? req.originalUrl.split('?')[0] : req.path,
            statusCode,
            errorName: err.name,
            errorMessage: err.message,
            ...(isServerError && process.env.NODE_ENV !== 'test' ? { stack: err.stack } : {}),
        });
    }

    // Log the internal error above, but never expose its message or stack on 5xx.
    res.status(statusCode).json({
        success: false,
        error: isServerError ? 'Internal server error' : (error.message || 'Request failed')
    });
};

module.exports = errorHandler;
