const requestId = require('../../../middleware/request-id.middleware');

describe('requestId middleware', () => {
  test('attaches a UUID to req.requestId', () => {
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    requestId(req, res, next);

    expect(typeof req.requestId).toBe('string');
    expect(req.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(next).toHaveBeenCalled();
  });

  test('sets X-Request-Id response header', () => {
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    requestId(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  test('generates a fresh server-side ID for every request', () => {
    const ids = new Set();
    for (let i = 0; i < 5; i++) {
      const req = { headers: { 'x-request-id': 'spoofed-id' } };
      const res = { setHeader: jest.fn() };
      requestId(req, res, jest.fn());
      ids.add(req.requestId);
    }
    expect(ids.size).toBe(5);
    // None of the generated IDs should equal the spoofed one
    for (const id of ids) {
      expect(id).not.toBe('spoofed-id');
    }
  });

  test('ignores any client-supplied X-Request-Id header', () => {
    const req = { headers: { 'x-request-id': 'client-supplied' } };
    const res = { setHeader: jest.fn() };
    requestId(req, res, jest.fn());
    expect(req.requestId).not.toBe('client-supplied');
  });
});
