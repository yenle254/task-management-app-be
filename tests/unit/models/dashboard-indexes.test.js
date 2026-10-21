const Task = require('../../../models/task.model');
const Attendance = require('../../../models/attendance.model');
const Leave = require('../../../models/leave.model');
const User = require('../../../models/user.model');

const hasIndex = (model, fields) => model.schema.indexes().some(([spec]) =>
  JSON.stringify(spec) === JSON.stringify(fields)
);

describe('dashboard query indexes', () => {
  test('declares effective compound indexes without duplicate definitions', () => {
    const expected = [
      [Task, [{ assignedTo: 1, status: 1 }, { teamId: 1, status: 1 },
        { status: 1, dueDate: 1 }, { assignedTo: 1, status: 1, dueDate: 1 }]],
      [Attendance, [{ userId: 1, date: 1 }, { userId: 1, date: -1 }]],
      [Leave, [{ userId: 1, status: 1 }, { userId: 1, startDate: 1 },
        { status: 1, createdAt: -1 }, { status: 1, startDate: 1, endDate: 1 }]],
      [User, [{ role: 1, isActive: 1 }, { role: 1, teamId: 1 }, { teamId: 1, isActive: 1 }]]
    ];
    for (const [model, specs] of expected) {
      const declared = model.schema.indexes().map(([spec]) => JSON.stringify(spec));
      expect(new Set(declared).size).toBe(declared.length);
      for (const spec of specs) expect(hasIndex(model, spec)).toBe(true);
    }
  });
});
