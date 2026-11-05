const REVIEW_TYPES = ['task_submitted_for_review', 'task_review_approved', 'task_review_requested', 'task_review_withdrawn', 'task_review_reminder'];
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
  result.categories.task.types = Object.fromEntries(REVIEW_TYPES.map(type => [type, {
    inApp: value?.categories?.task?.types?.[type]?.inApp ?? result.categories.task.inApp,
    push: value?.categories?.task?.types?.[type]?.push ?? result.categories.task.push
  }]));
  return result;
}

function categoryFor(type) {
  if (type.startsWith('leave_')) return 'leave';
  if (type.startsWith('attendance_')) return 'attendance';
  return 'task';
}

function targetFor(type) {
  if (['task_submitted_for_review', 'task_review_reminder', 'task_review_withdrawn'].includes(type)) return 'task_review_inbox';
  return { task: 'task_detail', leave: 'leave', attendance: 'attendance' }[categoryFor(type)];
}

function typeChannels(prefs, type) {
  const category = prefs.categories[categoryFor(type)];
  const override = category.types?.[type];
  return { inApp: category.inApp && (override?.inApp ?? true), push: category.push && (override?.push ?? true) };
}
module.exports = { CATEGORIES, REVIEW_TYPES, preferences, categoryFor, targetFor, typeChannels };
