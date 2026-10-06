/**
 * Jest Configuration for HR Task Management Backend
 */
module.exports = {
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/'
  ],

  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ],
  // Coverage thresholds - relaxed for initial test setup
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Test environment
  testEnvironment: 'node',

  // Timeout
  testTimeout: 15000,

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Module path ignore patterns
  modulePathIgnorePatterns: ['<rootDir>/node_modules/'],

  // Force exit after tests complete (for CI)
  forceExit: false,

  // Detect open handles (for debugging)
  detectOpenHandles: false
};
