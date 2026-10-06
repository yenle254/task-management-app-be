/**
 * Global Test Setup
 * Run before all test files
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing';
process.env.JWT_EXPIRE = '1h';

// Import jest-extended matchers
require('jest-extended');

// Suppress console output during tests (optional - uncomment if needed)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

// Set default timeout for async operations
jest.setTimeout(15000);

// Global afterAll hook to cleanup
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100));
});

// Global beforeEach to reset mocks
beforeEach(() => {
  jest.clearAllMocks();
});
