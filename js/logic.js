// logic.js: the "thinking" part of the site. Pure functions only: no page
// (DOM) access, so they can be tested in Node without a browser.
//
// Dates are always ISO strings ("2026-12-12"). ISO strings sort correctly as
// plain text, so we can compare them with <, >, and localeCompare.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Sydney as "YYYY-MM-DD" (not the visitor's own timezone). */
export function todaySydney(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

/** True only for a date that really exists ("2026-02-31" is rejected). */
function isRealDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Minimum an event needs to be safely shown. Anything failing this is skipped
 * (and logged) rather than breaking the whole page. This matters once the
 * interface and AI scrapers start adding events.
 */
export function isValidEvent(e) {
  return Boolean(
    e && typeof e === 'object' &&
    typeof e.name === 'string' && e.name.trim() &&
    isRealDate(e.start_date) && isRealDate(e.end_date) && e.end_date >= e.start_date &&
    Array.isArray(e.weapons) && Array.isArray(e.format)
  );
}

/**
 * Splits events into upcoming and past. An event counts as upcoming until the
 * END of its last day, so a 3-day circuit stays on the calendar until it finishes.
 */
export function splitEvents(events, today) {
  return {
    upcoming: events.filter((e) => e.end_date >= today),
    past: events.filter((e) => e.end_date < today),
  };
}

/** Sort by start date, then end date, then name. Returns a new array. */
export function sortEvents(events, { newestFirst = false } = {}) {
  const sorted = [...events].sort((a, b) =>
    a.start_date.localeCompare(b.start_date) ||
    a.end_date.localeCompare(b.end_date) ||
    a.name.localeCompare(b.name));
  return newestFirst ? sorted.reverse() : sorted;
}

export const monthKey = (e) => e.start_date.slice(0, 7); // "2026-12"
export const yearOf = (e) => e.start_date.slice(0, 4);   // "2026"

/** "2026-12" -> "December 2026" (or just "December"). */
export function monthLabel(key, withYear = true) {
  const [y, m] = key.split('-');
  const name = MONTH_NAMES[Number(m) - 1];
  return withYear ? `${name} ${y}` : name;
}

/**
 * Filters by month ("2026-12"), year ("2026"), weapon, and format.
 * Each filter is "all" (or missing) to mean "don't filter on this".
 */
export function filterEvents(events, { month = 'all', year = 'all', weapon = 'all', format = 'all' } = {}) {
  return events.filter((e) =>
    (month === 'all' || monthKey(e) === month) &&
    (year === 'all' || yearOf(e) === year) &&
    (weapon === 'all' || e.weapons.includes(weapon)) &&
    (format === 'all' || e.format.includes(format)));
}

/** Groups an already-sorted list into [{ key: "2026-12", events: [...] }, ...]. */
export function groupByMonth(events) {
  const groups = [];
  for (const e of events) {
    const key = monthKey(e);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, events: [e] });
  }
  return groups;
}

/** Unique, sorted values for the month dropdown: [{ value, label }]. */
export function monthOptions(events) {
  return [...new Set(events.map(monthKey))].sort().map((key) => ({ value: key, label: monthLabel(key) }));
}

/** Unique, sorted values for the year dropdown: [{ value, label }]. */
export function yearOptions(events) {
  return [...new Set(events.map(yearOf))].sort().map((y) => ({ value: y, label: y }));
}

/**
 * Display text for the card, in the same d/m style the site already uses:
 *   one day         -> "12/12"
 *   same month      -> "11-13/9"
 *   across months   -> "30/9 - 2/10"
 */
export function formatDateRange(e) {
  const [, sm, sd] = e.start_date.split('-').map(Number);
  const [, em, ed] = e.end_date.split('-').map(Number);
  if (e.start_date === e.end_date) return `${sd}/${sm}`;
  if (sm === em) return `${sd}-${ed}/${sm}`;
  return `${sd}/${sm} - ${ed}/${em}`;
}
