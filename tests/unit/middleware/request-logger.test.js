const requestLogger = require('../../../middleware/request-logger.middleware');

describe('requestLogger middleware', () => {
  let stdoutSpy;
  let stderrSpy;
  const EventEmitter = require('events');

  beforeEach(() => {
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

  function allEntries() {
    const all = [
      ...stdoutSpy.mock.calls.map(c => c[0]),
      ...stderrSpy.mock.calls.map(c => c[0]),
    ].join('').trim().split('\n').filter(Boolean);
    return all.map(l => JSON.parse(l));
  }

  function tick() {
    return new Promise(resolve => setImmediate(resolve));
  }

  test('emits one completion log with required fields', async () => {
    const req = { method: 'GET', path: '/api/x', requestId: 'rid-1', url: '/api/x' };
    const res = new EventEmitter();
    res.statusCode = 200;
    const next = jest.fn();

    requestLogger(req, res, next);
    await tick();
    res.emit('finish');
    await tick();

    const entries = allEntries();
    expect(entries.length).toBe(1);
    const e = entries[0];
    expect(e.message).toBe('HTTP request completed');
    expect(e.requestId).toBe('rid-1');
    expect(e.method).toBe('GET');
    expect(e.route).toBe('/api/x');
    expect(e.statusCode).toBe(200);
    expect(typeof e.durationMs).toBe('number');
    expect(e.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('does not log twice when both finish and close fire', async () => {
    const req = { method: 'GET', path: '/api/y', requestId: 'rid-2', url: '/api/y' };
    const res = new EventEmitter();
    res.statusCode = 200;

    requestLogger(req, res, jest.fn());
    await tick();
    res.emit('finish');
    res.emit('close');
    res.emit('finish');
    await tick();

    const entries = allEntries();
    expect(entries.length).toBe(1);
  });

  test('uses warn severity for 4xx and error for 5xx', async () => {
    const req1 = { method: 'GET', path: '/a', requestId: 'r1', url: '/a' };
    const res1 = new EventEmitter();
    res1.statusCode = 404;
    requestLogger(req1, res1, jest.fn());

    const req2 = { method: 'GET', path: '/b', requestId: 'r2', url: '/b' };
    const res2 = new EventEmitter();
    res2.statusCode = 500;
    requestLogger(req2, res2, jest.fn());

    await tick();
    res1.emit('finish');
    res2.emit('finish');
    await tick();

    const entries = allEntries();
    const e1 = entries.find(e => e.requestId === 'r1');
    const e2 = entries.find(e => e.requestId === 'r2');
    expect(e1.level).toBe('warn');
    expect(e2.level).toBe('error');
  });

  test('uses info severity for 2xx', async () => {
    const req = { method: 'GET', path: '/ok', requestId: 'r-ok', url: '/ok' };
    const res = new EventEmitter();
    res.statusCode = 204;
    requestLogger(req, res, jest.fn());
    await tick();
    res.emit('finish');
    await tick();

    const entries = allEntries();
    expect(entries[0].level).toBe('info');
    expect(entries[0].statusCode).toBe(204);
  });

  test('does not log query string or sensitive input', async () => {
    const req = {
      method: 'GET',
      path: '/search',
      requestId: 'r-q',
      url: '/search?password=secret&token=abc',
    };
    const res = new EventEmitter();
    res.statusCode = 200;
    requestLogger(req, res, jest.fn());
    await tick();
    res.emit('finish');
    await tick();

    const entries = allEntries();
    const entry = entries[0];
    expect(entry.route).not.toContain('password');
    expect(entry.route).not.toContain('secret');
    expect(entry.route).not.toContain('token');
  });

  test('normalizeRoute uses req.route.path + baseUrl when available', () => {
    const result = requestLogger.normalizeRoute({
      baseUrl: '/api/tasks',
      route: { path: '/:id' },
    });
    expect(result).toBe('/api/tasks/:id');
  });

  test('normalizeRoute strips query when only url is available', () => {
    const result = requestLogger.normalizeRoute({ url: '/foo?bar=1' });
    expect(result).toBe('/foo');
  });
});
