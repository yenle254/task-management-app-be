const asyncHandler = require('../../../middleware/async-handler.middleware');

describe('asyncHandler middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  test('passes successful response through', async () => {
    const handler = asyncHandler(async (req, res) => {
      res.json({ success: true });
    });

    await handler(mockReq, mockRes, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('forwards rejected Promise to next(error)', () => {
    const testError = new Error('Async error');
    const handler = asyncHandler(async () => {
      throw testError;
    });

    handler(mockReq, mockRes, mockNext);

    return new Promise(resolve => setImmediate(() => {
      expect(mockNext).toHaveBeenCalledWith(testError);
      expect(mockRes.json).not.toHaveBeenCalled();
      resolve();
    }));
  });

  test('forwards synchronous throw to next(error)', () => {
    const testError = new Error('Sync error');
    const handler = asyncHandler(() => {
      throw testError;
    });

    handler(mockReq, mockRes, mockNext);

    return new Promise(resolve => setImmediate(() => {
      expect(mockNext).toHaveBeenCalledWith(testError);
      expect(mockRes.json).not.toHaveBeenCalled();
      resolve();
    }));
  });

  test('forwards rejected Promise to next(error) only once', () => {
    const testError = new Error('Single call');
    const handler = asyncHandler(async () => {
      throw testError;
    });

    handler(mockReq, mockRes, mockNext);

    return new Promise(resolve => setImmediate(() => {
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(testError);
      resolve();
    }));
  });

  test('passes through returned values from handler', async () => {
    const handler = asyncHandler(async (req, res) => {
      return { data: 'value' };
    });

    await handler(mockReq, mockRes, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
  });

  test('handles promise rejection with Error object', () => {
    const error = new Error('Promise rejected');
    const handler = asyncHandler(async () => {
      return Promise.reject(error);
    });

    handler(mockReq, mockRes, mockNext);

    return new Promise(resolve => setImmediate(() => {
      expect(mockNext).toHaveBeenCalledWith(error);
      resolve();
    }));
  });

  test('handles non-Error thrown values', () => {
    const handler = asyncHandler(async () => {
      throw 'string error';
    });

    handler(mockReq, mockRes, mockNext);

    return new Promise(resolve => setImmediate(() => {
      expect(mockNext).toHaveBeenCalledWith('string error');
      resolve();
    }));
  });
});
