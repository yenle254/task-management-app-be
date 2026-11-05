const AuditLog = require('../../../models/audit-log.model');
const mongoose = require('mongoose');
const id = new mongoose.Types.ObjectId();
test.each(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'])('Mongoose %s is rejected before reaching the driver', async method => {
  await expect(AuditLog[method]({ _id: id }, { action: 'user.updated' })).rejects.toThrow('append-only');
});
test.each(['deleteOne', 'deleteMany', 'findOneAndDelete'])('Mongoose %s is rejected before reaching the driver', async method => {
  await expect(AuditLog[method]({ _id: id })).rejects.toThrow('append-only');
});
test('document save/deleteOne and bulkWrite mutations cannot bypass append-only', async () => {
  const doc = new AuditLog({ action: 'user.updated', category: 'user', outcome: 'success' });
  doc.isNew = false;
  await expect(doc.save()).rejects.toThrow('append-only');
  await expect(doc.deleteOne()).rejects.toThrow('append-only');
  await expect(AuditLog.bulkWrite([{ updateOne: { filter: { _id: id }, update: { $set: { reason: 'changed' } } } }])).rejects.toThrow('append-only');
});
test('raw collection access explicitly BYPASSES schema hooks (driver stub, no real DB)', async () => {
  const driver = jest.spyOn(AuditLog.collection, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
  await expect(AuditLog.collection.updateOne({ _id: id }, { $set: { reason: 'raw bypass' } })).resolves.toEqual({ modifiedCount: 1 });
  expect(driver).toHaveBeenCalledTimes(1);
});
test('five indexes include stable chronological sort and no TTL', () => {
  expect(AuditLog.schema.indexes().map(([keys]) => keys)).toEqual([
    { at: -1, _id: -1 }, { 'actor.id': 1, at: -1 }, { 'target.type': 1, 'target.id': 1, at: -1 },
    { category: 1, action: 1, at: -1 }, { outcome: 1, at: -1 }
  ]);
  expect(AuditLog.schema.indexes().some(([, options]) => 'expireAfterSeconds' in options)).toBe(false);
});
