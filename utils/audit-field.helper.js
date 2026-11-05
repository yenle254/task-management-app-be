const { isSensitiveKey } = require('./redact.utils');

const FIELDS = Object.freeze({
  user: ['role', 'teamId', 'managerId', 'isActive', 'profile.department', 'profile.position', 'profile.employeeId', 'profile.phone'],
  team: ['name', 'description', 'leaderId', 'memberIds'],
  attendance: ['clockIn', 'clockOut', 'status', 'workHours', 'location.lat', 'location.lng'],
  office: ['name', 'address', 'location.lat', 'location.lng', 'radius', 'workingHours.start', 'workingHours.end', 'isActive'],
  task: ['assignedTo', 'status', 'dueDate', 'priority', 'teamId'],
  leave: ['status', 'currentStep', 'type', 'startDate', 'endDate', 'numberOfDays', 'revision']
});
const readPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
function normalize(value) {
  if (value === undefined || value === null) return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value._bsontype === 'ObjectId') return String(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    if (value._id) return normalize(value._id); // populated references compare by ID
    return Object.fromEntries(Object.keys(value).sort().filter(key => !isSensitiveKey(key)).map(key => [key, normalize(value[key])]));
  }
  return value;
}
// Snapshot only known fields; populated documents and private fields never escape.
function snapshot(type, document) {
  if (!document) return null;
  const result = {};
  for (const field of FIELDS[type] || []) {
    const parts = field.split('.');
    let target = result;
    for (const part of parts.slice(0, -1)) target = target[part] ||= {};
    target[parts.at(-1)] = normalize(readPath(document, field));
  }
  return result;
}
function diff(before, after, fields) {
  return fields.filter(field => !isSensitiveKey(field)).flatMap(field => {
    const from = normalize(readPath(before, field)), to = normalize(readPath(after, field));
    return JSON.stringify(from) === JSON.stringify(to) ? [] : [{ field, from: from ?? null, to: to ?? null }];
  });
}
module.exports = { FIELDS, readPath, normalize, snapshot, diff };
