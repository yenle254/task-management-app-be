const mongoose = require('mongoose');
const Task = require('../models/task.model');
const { TASK_STATUS } = require('../utils/constants.utils');
const { percentage } = require('../utils/dashboard.helper');

const eventScope = ({ teamId, employeeId } = {}) => {
  const scope = {};
  if (teamId) scope['statusHistory.teamId'] = new mongoose.Types.ObjectId(teamId);
  if (employeeId) scope['statusHistory.assignedTo'] = new mongoose.Types.ObjectId(employeeId);
  return scope;
};
const historyElementScope = ({ teamId, employeeId } = {}) => {
  const scope = {};
  if (teamId) scope.teamId = new mongoose.Types.ObjectId(teamId);
  if (employeeId) scope.assignedTo = new mongoose.Types.ObjectId(employeeId);
  return scope;
};

// Only recorded events are eligible. Legacy tasks without history cannot be
// placed in a historical team or employee bucket reliably.
const getTaskEventTrend = async (scope, periodType, startDate, endDate) => {
  const format = periodType === 'week' ? '%G-W%V' : '%Y-%m';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const rows = await Task.aggregate([
    {
      $match: { statusHistory: { $elemMatch: {
        ...historyElementScope(scope),
        at: { $gte: startDate, $lte: endDate },
        $or: [{ from: null }, { to: TASK_STATUS.DONE }]
      } } }
    },
    { $unwind: '$statusHistory' },
    {
      $match: {
        ...eventScope(scope),
        'statusHistory.at': { $gte: startDate, $lte: endDate },
        $or: [
          { 'statusHistory.from': null },
          { 'statusHistory.to': TASK_STATUS.DONE }
        ]
      }
    },
    { $sort: { 'statusHistory.at': 1 } },
    {
      $group: {
        _id: {
          period: { $dateToString: { format, date: '$statusHistory.at', timezone } },
          taskId: '$_id'
        },
        created: { $max: { $cond: [{ $eq: ['$statusHistory.from', null] }, 1, 0] } },
        completed: { $max: { $cond: [{ $eq: ['$statusHistory.to', TASK_STATUS.DONE] }, 1, 0] } },
        withDueDate: {
          $last: {
            $cond: [
              { $and: [
                { $eq: ['$statusHistory.to', TASK_STATUS.DONE] },
                { $ne: [{ $ifNull: ['$statusHistory.dueDate', null] }, null] }
              ] }, 1, 0
            ]
          }
        },
        onTime: {
          $last: {
            $cond: [
              { $and: [
                { $eq: ['$statusHistory.to', TASK_STATUS.DONE] },
                { $ne: [{ $ifNull: ['$statusHistory.dueDate', null] }, null] },
                { $lte: ['$statusHistory.at', '$statusHistory.dueDate'] }
              ] }, 1, 0
            ]
          }
        }
      }
    },
    {
      $group: {
        _id: '$_id.period',
        totalTasks: { $sum: 1 },
        createdTasks: { $sum: '$created' },
        completedTasks: { $sum: '$completed' },
        completedWithDueDate: { $sum: '$withDueDate' },
        onTimeTasks: { $sum: '$onTime' }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return rows.map((row) => ({
    period: row._id,
    label: row._id,
    totalTasks: row.totalTasks,
    createdTasks: row.createdTasks,
    completedTasks: row.completedTasks,
    completionRate: percentage(row.completedTasks, row.totalTasks),
    onTimeTasks: row.onTimeTasks,
    onTimeRate: percentage(row.onTimeTasks, row.completedWithDueDate)
  }));
};

const countCompletedTasks = async (scope, startDate, endDate) => {
  const rows = await Task.aggregate([
    {
      $match: { statusHistory: { $elemMatch: {
        ...historyElementScope(scope),
        to: TASK_STATUS.DONE,
        at: { $gte: startDate, $lte: endDate }
      } } }
    },
    { $unwind: '$statusHistory' },
    {
      $match: {
        ...eventScope(scope),
        'statusHistory.to': TASK_STATUS.DONE,
        'statusHistory.at': { $gte: startDate, $lte: endDate }
      }
    },
    { $group: { _id: '$_id' } },
    { $count: 'total' }
  ]);
  return rows[0]?.total || 0;
};

module.exports = { getTaskEventTrend, countCompletedTasks };
