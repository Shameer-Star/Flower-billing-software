// Calendar helpers. Every business date is a local 'YYYY-MM-DD' string in APP_TZ,
// so a 5 AM collection in India is never filed under the previous (UTC) day.
const APP_TZ = process.env.APP_TZ || 'Asia/Kolkata';
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

// Offset of APP_TZ from UTC (minutes) at an instant
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});
function offsetMinutes(ms) {
  const p = {};
  for (const part of partsFormat.formatToParts(new Date(ms))) p[part.type] = part.value;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((wall - Math.floor(ms / 60000) * 60000) / 60000);
}

// The offset is cached per UTC day, so bucketing thousands of timestamps costs a few
// Intl calls instead of one each. Days where the zone changes offset (DST) use Intl directly.
const dayOffsets = new Map();
function localDate(d = new Date()) {
  const ms = d.getTime();
  const day = Math.floor(ms / 86400000);
  let offset = dayOffsets.get(day);
  if (offset === undefined) {
    const start = offsetMinutes(day * 86400000);
    offset = start === offsetMinutes(day * 86400000 + 86399999) ? start : null;
    if (dayOffsets.size > 5000) dayOffsets.clear();
    dayOffsets.set(day, offset);
  }
  if (offset === null) return dateFormat.format(d);
  return new Date(ms + offset * 60000).toISOString().slice(0, 10);
}

function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function addDays(s, n) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// Fortnights follow the usual settlement halves: 1st-15th and 16th-month end.
// Key format: 'YYYY-MM-1' or 'YYYY-MM-2' (sorts correctly as a string).
function fortnightKey(s) {
  const [y, m, d] = s.split('-');
  return `${y}-${m}-${Number(d) <= 15 ? 1 : 2}`;
}

function isFortnightKey(k) {
  return typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])-[12]$/.test(k);
}

function fortnightRange(k) {
  const [y, m, half] = k.split('-');
  if (half === '1') return { start: `${y}-${m}-01`, end: `${y}-${m}-15` };
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return { start: `${y}-${m}-16`, end: `${y}-${m}-${lastDay}` };
}

function previousFortnightKey(k) {
  return fortnightKey(addDays(fortnightRange(k).start, -1));
}

// The `count` most recent fortnights, oldest first, ending with the one containing `today`.
function lastFortnights(today, count) {
  const keys = [fortnightKey(today)];
  while (keys.length < count) keys.unshift(previousFortnightKey(keys[0]));
  return keys;
}

module.exports = {
  APP_TZ,
  localDate,
  isDateStr,
  addDays,
  daysBetween,
  fortnightKey,
  isFortnightKey,
  fortnightRange,
  previousFortnightKey,
  lastFortnights
};
