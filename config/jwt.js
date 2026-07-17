const jwt = require('jsonwebtoken');

const generateToken = (userId, additionalPayload = {}) => {
    const payload = {
        id: userId,
        ...additionalPayload
    };

    const token = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRE || '7d'
        }
    );

    return token;
};

const verifyToken = (token) => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded;
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            throw new Error('Token has expired');
        } else if (error.name === 'JsonWebTokenError') {
            throw new Error('Invalid token');
        } else {
            throw new Error('Token verification failed');
        }
    }
};

const sendTokenResponse = (user, statusCode, res) => {
    const token = generateToken(user._id, {
        email: user.email,
        role: user.role
    });

    const userObj = user.toObject();
    delete userObj.password;

    res.status(statusCode).json({
        success: true,
        token,
        user: userObj
    });
};

const decodeToken = (token) => {
    return jwt.decode(token);
};

module.exports = {
    generateToken,
    verifyToken,
    sendTokenResponse,
    decodeToken
};







