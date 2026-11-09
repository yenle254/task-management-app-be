const audit = require('../services/audit.service');
const rejectAuthentication = req => audit.record({ ...req, ip: req.ip, user: null }, { action: 'security.auth_rejected', outcome: 'denied' });
const { verifyToken } = require('../config/jwt');
const { assertAccessSession } = require('../services/session.service');
const User = require('../models/user.model');

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        rejectAuthentication(req);
        return res.status(401).json({
            success: false,
            error: 'Not authorized to access this route. No token provided.'
        });
    }

    let verified = false;
    try {
        const decoded = verifyToken(token);
        verified = true;

        req.user = await User.findById(decoded.sub || decoded.id).select('-password +tokenVersion');

        if (!req.user) {
            rejectAuthentication(req);
            return res.status(401).json({
                success: false,
                error: 'User not found'
            });
        }

        if (!req.user.isActive) {
            rejectAuthentication(req);
            return res.status(401).json({
                success: false,
                error: 'User account is deactivated'
            });
        }

        await assertAccessSession(decoded, req.user);
        req.auth = decoded;
        next();
    } catch (error) {
        if (verified && !error.statusCode) return res.status(500).json({ success: false, error: 'Unable to validate session', code: 'session_error' });
        rejectAuthentication(req);
        return res.status(401).json({
            success: false,
            error: error.message || 'Not authorized to access this route',
            code: error.code || 'invalid_token'
        });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            rejectAuthentication(req);
            return res.status(401).json({
                success: false,
                error: 'Not authenticated'
            });
        }

        if (!roles.includes(req.user.role)) {
            audit.record(req, { action: 'security.access_denied', outcome: 'denied', metadata: { route: audit.context(req).route, method: req.method, requiredRoles: roles } });
            return res.status(403).json({
                success: false,
                error: `User role '${req.user.role}' is not authorized to access this route`
            });
        }

        next();
    };
};

module.exports = { protect, authorize };







