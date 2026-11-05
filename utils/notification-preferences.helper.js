const CATEGORIES = ['task', 'leave', 'attendance'];

function preferences(value = {}) {
  const result = {
    master: value?.master ?? true, push: value?.push ?? true, sound: value?.sound ?? true,
    categories: {}, reminderTimes: { clockIn: value?.reminderTimes?.clockIn ?? null, clockOut: value?.reminderTimes?.clockOut ?? null }
  };
  for (const category of CATEGORIES) result.categories[category] = {
    inApp: value?.categories?.[category]?.inApp ?? true,
    push: value?.categories?.[category]?.push ?? true
  };
  return result;
}

function categoryFor(type) {
  if (type.startsWith('leave_')) return 'leave';
  if (type.startsWith('attendance_')) return 'attendance';
  return 'task';
}

function targetFor(type) {
  return { task: 'task_detail', leave: 'leave', attendance: 'attendance' }[categoryFor(type)];
}

module.exports = { CATEGORIES, preferences, categoryFor, targetFor };
