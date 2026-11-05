function dayKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
function minutes(time) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}
function shouldFire(now, override, officeTime, fallback) {
  const scheduled = minutes(override) ?? (((minutes(officeTime) ?? minutes(fallback)) + 1440 - 30) % 1440);
  const elapsed = now.getHours() * 60 + now.getMinutes() - scheduled;
  return elapsed >= 0 && elapsed < 5;
}
function dayRange(now) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start, end };
}
module.exports = { dayKey, minutes, shouldFire, dayRange };
