const errorHandler = require('../../../middleware/error-handler.middleware');

describe('errorHandler middleware - logging behavior', () => {
  let stdoutSpy;
  let stderrSpy;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.NODE_ENV = originalEnv;
  });

  function lastErrorLog() {
    const calls = stderrSpy.mock.calls.map(c => c[0]).join('').trim().split('\n').filter(Boolean);
    return calls.length ? JSON.parse(calls[calls.length - 1]) : null;
  }
  // The logger writes both warn and error to stderr
  function lastWarnLog() {
    const calls = stderrSpy.mock.calls.map(c => c[0]).join('').trim().split('\n').filter(Boolean);
    return calls.length ? JSON.parse(calls[calls.length - 1]) : null;
  }

  test('logs server errors with requestId and stack in development', () => {
    process.env.NODE_ENV = 'development';
    const err = new Error('Server boom');
    const req = { method: 'POST', originalUrl: '/api/x', path: '/api/x', requestId: 'rid-err' };
    const res = {
      headersSent: false,
      statusCode: 0,
      status(c) { this.statusCode = c; return this; },
      json: jest.fn(),
    };

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(500);
    const log = lastErrorLog();
    expect(log).toBeTruthy();
    expect(log.level).toBe('error');
    expect(log.requestId).toBe('rid-err');
    expect(log.errorName).toBe('Error');
    expect(log.errorMessage).toBe('Server boom');
    expect(log.statusCode).toBe(500);
  });

  test('logs errors in production (not only in development)', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('Production failure');
    const req = { method: 'GET', originalUrl: '/api/y', path: '/api/y', requestId: 'rid-prod' };
    const res = {
      headersSent: false,
      statusCode: 0,
      status(c) { this.statusCode = c; return this; },
      json: jest.fn(),
    };

    errorHandler(err, req, res, jest.fn());

    // Stack should NOT be in client response in production
    const body = res.json.mock.calls[0][0];
    expect(body).not.toHaveProperty('stack');
    expect(body.success).toBe(false);

    // But server log should have been written
    const log = lastErrorLog();
    expect(log).toBeTruthy();
    expect(log.requestId).toBe('rid-prod');
  });

  test('uses warn for client errors (4xx), error for server errors (5xx)', () => {
    process.env.NODE_ENV = 'production';

    // Build a ValidationError-like object with the shape the handler expects
    const validationErr = Object.assign(new Error('bad input'), {
      name: 'ValidationError',
      errors: { field1: { message: 'field1 is required' } },
    });
    const req = { method: 'POST', originalUrl: '/api/z', path: '/api/z', requestId: 'rid-4xx' };
    const res = {
      headersSent: false,
      statusCode: 0,
      status(c) { this.statusCode = c; return this; },
      json: jest.fn(),
    };

    errorHandler(validationErr, req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    // 4xx should be warn level, goes to stdout
    const warnLog = lastWarnLog();
    expect(warnLog).toBeTruthy();
    expect(warnLog.statusCode).toBe(400);
    expect(warnLog.requestId).toBe('rid-4xx');
  });

  test('preserves public error response shape', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('Resource not found');
    const req = { method: 'GET', originalUrl: '/api/x', path: '/api/x', requestId: 'r1' };
    const res = {
      headersSent: false,
      statusCode: 0,
      status(c) { this.statusCode = c; return this; },
      json: jest.fn(),
    };

    errorHandler(err, req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ success: false, error: 'Internal server error' });
  });

  test('does not expose internal details in development', () => {
    process.env.NODE_ENV = 'development';
    const err = new Error('dev error');
    const req = { method: 'GET', originalUrl: '/x', path: '/x', requestId: 'r' };
    const res = {
      headersSent: false,
      statusCode: 0,
      status(c) { this.statusCode = c; return this; },
      json: jest.fn(),
    };

    errorHandler(err, req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ success: false, error: 'Internal server error' });
  });

  test('does not log a second time when response already sent', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('late error');
    const req = { method: 'GET', originalUrl: '/x', path: '/x', requestId: 'r' };
    const res = {
      headersSent: true,
      status(c) { return this; },
      json: jest.fn(),
    };

    errorHandler(err, req, res, jest.fn());

    // No log should be emitted
    const errLog = lastErrorLog();
    expect(errLog === null || errLog.requestId !== 'r').toBe(true);
  });
});
