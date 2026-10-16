const mongoose = require('mongoose');
const { populateRelatedDocs } = require('../../../controllers/notification.controller');
const { NOTIFICATION_TYPES } = require('../../../utils/constants.utils');

const Task = require('../../../models/task.model');
const Leave = require('../../../models/leave.model');

describe('populateRelatedDocs (notification enrichment)', () => {
  const taskObjectId1 = new mongoose.Types.ObjectId();
  const taskObjectId2 = new mongoose.Types.ObjectId();
  const leaveObjectId = new mongoose.Types.ObjectId();
  const missingTaskId = new mongoose.Types.ObjectId();

  let taskFindSpy;
  let leaveFindSpy;

  beforeEach(() => {
    taskFindSpy = jest.spyOn(Task, 'find').mockReturnValue({
      select: () => ({
        lean: () => Promise.resolve([
          { _id: taskObjectId1, title: 'Task One' },
          { _id: taskObjectId2, title: 'Task Two' },
        ]),
      }),
    });
    leaveFindSpy = jest.spyOn(Leave, 'find').mockReturnValue({
      select: () => ({
        lean: () => Promise.resolve([{ _id: leaveObjectId }]),
      }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const makeTaskNotification = (id) => ({
    _id: new mongoose.Types.ObjectId(),
    type: NOTIFICATION_TYPES.TASK_ASSIGNED,
    relatedId: id,
  });
  const makeLeaveNotification = (id) => ({
    _id: new mongoose.Types.ObjectId(),
    type: NOTIFICATION_TYPES.LEAVE_APPROVED,
    relatedId: id,
  });
  const makeUnrelatedTypeNotification = () => ({
    _id: new mongoose.Types.ObjectId(),
    type: 'SOME_OTHER_TYPE',
    relatedId: new mongoose.Types.ObjectId(),
  });
  const makeNoRelatedNotification = () => ({
    _id: new mongoose.Types.ObjectId(),
    type: NOTIFICATION_TYPES.TASK_ASSIGNED,
    relatedId: null,
  });

  test('populates relatedId for task notifications with a valid task', async () => {
    const notifications = [makeTaskNotification(taskObjectId1)];
    const result = await populateRelatedDocs(notifications);

    expect(result).toHaveLength(1);
    expect(result[0].relatedId).toEqual(
      expect.objectContaining({ _id: taskObjectId1, title: 'Task One' })
    );
  });

  test('populates relatedId for leave notifications with a valid leave', async () => {
    const notifications = [makeLeaveNotification(leaveObjectId)];
    const result = await populateRelatedDocs(notifications);

    expect(result[0].relatedId).toEqual(
      expect.objectContaining({ _id: leaveObjectId })
    );
  });

  test('sets relatedId to null when the related task has been deleted', async () => {
    const notifications = [makeTaskNotification(missingTaskId)];
    const result = await populateRelatedDocs(notifications);

    expect(result[0].relatedId).toBeNull();
  });

  test('leaves notifications with no relatedId untouched', async () => {
    const notifications = [makeNoRelatedNotification()];
    const result = await populateRelatedDocs(notifications);

    expect(result[0].relatedId).toBeNull();
  });

  test('leaves notifications of unrelated types untouched', async () => {
    const notifications = [makeUnrelatedTypeNotification()];
    const result = await populateRelatedDocs(notifications);

    // relatedId stays as the original ObjectId (not replaced, not enriched)
    expect(result[0].relatedId).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test('handles empty input array without errors', async () => {
    const result = await populateRelatedDocs([]);
    expect(result).toEqual([]);
    expect(taskFindSpy).not.toHaveBeenCalled();
    expect(leaveFindSpy).not.toHaveBeenCalled();
  });

  test('handles a mix of valid, missing, null and unrelated notifications', async () => {
    const notifications = [
      makeTaskNotification(taskObjectId1),    // valid -> populated
      makeTaskNotification(missingTaskId),    // deleted task -> null
      makeLeaveNotification(leaveObjectId),   // valid -> populated
      makeNoRelatedNotification(),            // null -> stays null
      makeUnrelatedTypeNotification(),        // unrelated type -> untouched
    ];
    const result = await populateRelatedDocs(notifications);

    expect(result[0].relatedId.title).toBe('Task One');
    expect(result[1].relatedId).toBeNull();
    expect(result[2].relatedId._id).toEqual(leaveObjectId);
    expect(result[3].relatedId).toBeNull();
    expect(result[4].relatedId).toBeInstanceOf(mongoose.Types.ObjectId);
  });
});
