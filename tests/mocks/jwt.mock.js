/**
 * JWT Mock for Unit Tests
 */
const jwt = require('jsonwebtoken');

const mockJwt = {
  /**
   * Mock sign function
   */
  sign: jest.fn().mockReturnValue('mocked_jwt_token'),

  /**
   * Mock verify function
   */
  verify: jest.fn().mockReturnValue({
    id: 'user_id_123',
    email: 'test@example.com',
    role: 'employee'
  }),

  /**
   * Mock decode function
   */
  decode: jest.fn().mockReturnValue({
    id: 'user_id_123',
    email: 'test@example.com',
    role: 'employee',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400
  })
};

/**
 * Generate a test token
 */
const generateTestToken = (userData = {}) => {
  const payload = {
    id: 'user_id_123',
    email: 'test@example.com',
    role: 'employee',
    ...userData
  };
  return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
};

/**
 * Generate expired token
 */
const generateExpiredToken = (userData = {}) => {
  const payload = {
    id: 'user_id_123',
    email: 'test@example.com',
    role: 'employee',
    ...userData
  };
  return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', { expiresIn: '-1h' });
};

module.exports = {
  mockJwt,
  generateTestToken,
  generateExpiredToken
};
