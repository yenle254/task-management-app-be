/**
 * Mongoose Mock for Unit Tests
 * This provides a simple mock for Mongoose models
 */

class MockQuery {
  constructor(data = []) {
    this.data = Array.isArray(data) ? data : [data];
    this.queryOptions = {};
    this.populateOptions = [];
    this.selectFields = null;
    this.sortOption = null;
    this.limitValue = null;
    this.skipValue = null;
  }

  sort(option) {
    this.sortOption = option;
    return this;
  }

  select(fields) {
    this.selectFields = fields;
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  skip(value) {
    this.skipValue = value;
    return this;
  }

  populate(paths) {
    this.populateOptions = Array.isArray(paths) ? paths : [paths];
    return this;
  }

  lean() {
    return this;
  }

  async then(resolve, reject) {
    try {
      resolve(this.data);
    } catch (error) {
      reject(error);
    }
  }

  async exec() {
    let result = [...this.data];

    if (this.skipValue) {
      result = result.slice(this.skipValue);
    }
    if (this.limitValue) {
      result = result.slice(0, this.limitValue);
    }

    return result;
  }
}

class MockModel {
  constructor(data = null) {
    this.data = data;
    this._id = data?._id || new (require('mongoose').Types.ObjectId)();
    this.mockSave = jest.fn().mockResolvedValue(this.data || this);
    this.mockFindOne = jest.fn();
    this.mockFindById = jest.fn();
    this.mockFind = jest.fn();
    this.mockCreate = jest.fn();
    this.mockFindOneAndUpdate = jest.fn();
    this.mockFindByIdAndUpdate = jest.fn();
    this.mockFindByIdAndDelete = jest.fn();
    this.mockCountDocuments = jest.fn();
    this.mockAggregate = jest.fn();
    this.mockExec = jest.fn();
  }

  static find(conditions = {}) {
    const mockQuery = new MockQuery();
    mockQuery.mockFind.mockResolvedValue([]);
    return mockQuery;
  }

  static findOne(conditions = {}) {
    const mockQuery = new MockQuery();
    mockQuery.mockFindOne.mockResolvedValue(null);
    return mockQuery;
  }

  static findById(id) {
    const mockQuery = new MockQuery();
    mockQuery.mockFindById.mockResolvedValue(null);
    return mockQuery;
  }

  static create(data) {
    return Promise.resolve({ ...data, _id: new (require('mongoose').Types.ObjectId)() });
  }

  static findOneAndUpdate(conditions, update, options) {
    const mockQuery = new MockQuery();
    mockQuery.mockFindOneAndUpdate.mockResolvedValue(null);
    return mockQuery;
  }

  static findByIdAndUpdate(id, update, options) {
    const mockQuery = new MockQuery();
    mockQuery.mockFindByIdAndUpdate.mockResolvedValue(null);
    return mockQuery;
  }

  static findByIdAndDelete(id) {
    const mockQuery = new MockQuery();
    mockQuery.mockFindByIdAndDelete.mockResolvedValue(null);
    return mockQuery;
  }

  static countDocuments(conditions = {}) {
    return Promise.resolve(0);
  }

  static aggregate(pipeline) {
    return Promise.resolve([]);
  }

  save() {
    return Promise.resolve(this.data || this);
  }
}

/**
 * Create a mock for a Mongoose model
 */
const createModelMock = (defaultData = null) => {
  const mock = {
    find: jest.fn().mockReturnValue(new MockQuery(defaultData)),
    findOne: jest.fn().mockReturnValue(new MockQuery(defaultData)),
    findById: jest.fn().mockReturnValue(new MockQuery(defaultData)),
    create: jest.fn().mockResolvedValue(defaultData),
    findOneAndUpdate: jest.fn().mockReturnValue(new MockQuery(defaultData)),
    findByIdAndUpdate: jest.fn().mockReturnValue(new MockQuery(defaultData)),
    findByIdAndDelete: jest.fn().mockReturnValue(new MockQuery(defaultData)),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue([]),
    prototype: {
      save: jest.fn().mockResolvedValue(defaultData)
    }
  };

  return mock;
};

module.exports = {
  MockQuery,
  MockModel,
  createModelMock
};
