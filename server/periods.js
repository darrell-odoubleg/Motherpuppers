// Lists reset at 23:59 local time: daily every night, weekly on Sunday night,
// monthly on the last night of the month. Pushing the clock forward one minute
// before reading the local date makes 23:59 roll into the next period.

const RESET_SHIFT_MS = 60 * 1000;

function localParts(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, dow };
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Calendar math on a plain date, independent of timezone.
function addDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Period info for the moment `ms` (defaults to now).
function periodsAt(tz, ms = Date.now()) {
  const { y, m, d, dow } = localParts(ms + RESET_SHIFT_MS, tz);
  return fromDate(y, m, d, dow);
}

// Period info for a calendar date string YYYY-MM-DD (used for history).
function periodsForDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return fromDate(y, m, d, dow);
}

function fromDate(y, m, d, dow) {
  const sunday = addDays(y, m, d, (7 - dow) % 7);
  const monday = addDays(...sunday, -6);
  return {
    date: ymd(y, m, d),
    month: m,
    dow,
    daily: { key: `D:${ymd(y, m, d)}`, resets: ymd(y, m, d) },
    weekly: { key: `W:${ymd(...sunday)}`, starts: ymd(...monday), resets: ymd(...sunday) },
    monthly: { key: `M:${y}-${pad(m)}`, resets: ymd(y, m, lastDayOfMonth(y, m)) },
  };
}

module.exports = { periodsAt, periodsForDate };
