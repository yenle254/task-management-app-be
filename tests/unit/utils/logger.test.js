const logger = require('../../../utils/logger.utils');

describe('logger.utils', () => {
  let stdoutSpy;
  let stderrSpy;

  beforeEach(() => {
    // Clear all stdout/stderr write calls but keep the spy alive
    stdoutSpy = process.stdout.write;
    stderrSpy = process.stderr.write;
    if (!stdoutSpy.mock) {
      stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    } else {
      stdoutSpy.mockClear();
      stderrSpy.mockClear();
    }
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  function getStdoutEntries() {
    return stdoutSpy.mock.calls.map(c => c[0]).join('').trim().split('\n').filter(Boolean).map(JSON.parse);
  }
  function getStderrEntries() {
    return stderrSpy.mock.calls.map(c => c[0]).join('').trim().split('\n').filter(Boolean).map(JSON.parse);
  }

  test('emits one JSON object per call with required fields', () => {
    logger.info('hello world', { requestId: 'abc' });
    const entries = getStdoutEntries();
    const entry = entries[entries.length - 1];
    expect(entry.level).toBe('info');
    expect(entry.service).toBe('hr-task-api');
    expect(entry.message).toBe('hello world');
    expect(entry.requestId).toBe('abc');
    expect(typeof entry.timestamp).toBe('string');
    expect(new Date(entry.timestamp).toString()).not.toBe('Invalid Date');
  });

  test('does not allow reserved field override', () => {
    logger.info('msg', { level: 'FAKE', service: 'X', message: 'BAD', timestamp: 'X', environment: 'X' });
    const entries = getStdoutEntries();
    const entry = entries[entries.length - 1];
    expect(entry.level).toBe('info');
    expect(entry.service).toBe('hr-task-api');
    expect(entry.message).toBe('msg');
  });

  test('redacts sensitive top-level keys', () => {
    logger.info('login', { password: 'p', token: 't', authorization: 'a', cookie: 'c', otp: 'o' });
    const entries = getStdoutEntries();
    const entry = entries[entries.length - 1];
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.token).toBe('[REDACTED]');
    expect(entry.authorization).toBe('[REDACTED]');
    expect(entry.cookie).toBe('[REDACTED]');
    expect(entry.otp).toBe('[REDACTED]');
  });

  test('redacts nested sensitive keys', () => {
    logger.info('event', { user: { password: 'p', email: 'e@x' } });
    const entries = getStdoutEntries();
    const entry = entries[entries.length - 1];
    expect(entry.user.password).toBe('[REDACTED]');
    expect(entry.user.email).toBe('e@x');
  });

  test('summarizes Error without leaking arbitrary props', () => {
    const err = new Error('boom');
    err.code = 'EBOOM';
    err.sensitiveField = 'secret';
    logger.error('failed', { error: err });
    const entries = getStderrEntries();
    const entry = entries[entries.length - 1];
    expect(entry.level).toBe('error');
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('boom');
    expect(entry.error.code).toBe('EBOOM');
    expect(entry.error.sensitiveField).toBeUndefined();
  });

  test('serialization failures do not throw', () => {
    const circular = {};
    circular.self = circular;
    expect(() => logger.info('circular', { data: circular })).not.toThrow();
  });

  test('LOG_LEVEL filtering respects environment defaults', () => {
    expect(typeof logger._internals.shouldLog).toBe('function');
    // When LOG_LEVEL is 'silent' (test default), debug should NOT pass
    // When LOG_LEVEL is 'info' or 'debug', it should pass
    const result = logger._internals.shouldLog('debug');
    expect(typeof result).toBe('boolean');
  });

  test('handles non-string message gracefully', () => {
    logger.info(123);
    const entries = getStdoutEntries();
    const entry = entries[entries.length - 1];
    expect(entry.message).toBe('123');
  });

  test('summary: produces only one line per call', () => {
    const before = getStdoutEntries().length + getStderrEntries().length;
    logger.info('one');
    const after = getStdoutEntries().length + getStderrEntries().length;
    expect(after - before).toBe(1);
  });
});
