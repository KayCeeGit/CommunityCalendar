// logic.js: the "thinking" part of the site. Pure functions only: no page
// (DOM) access, so they can be tested in Node without a browser.
//
// Dates are always ISO strings ("2026-12-12"). ISO strings sort correctly as
// plain text, so we can compare them with <, >, and localeCompare.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Sydney as "YYYY-MM-DD" (not the visitor's own timezone). */
export function todaySydney(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

/** True only for a date that really exists ("2026-02-31" is rejected). */
export function isRealDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * The minimum an event needs for the page to draw it safely. Anything failing
 * this is skipped (and logged) instead of breaking the whole page. It covers
 * exactly the fields render.js relies on.
 */
export function isValidEvent(e) {
  return Boolean(
    e && typeof e === 'object' &&
    typeof e.name === 'string' && e.name.trim() &&
    isRealDate(e.start_date) && isRealDate(e.end_date) && e.end_date >= e.start_date &&
    ['weapons', 'format', 'gender'].every((k) => e[k] === undefined || Array.isArray(e[k])) // an "other" event may leave these out
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

/** Oldest first: by start date, then end date, then name. Returns a new array. */
export function sortEvents(events) {
  return [...events].sort((a, b) =>
    a.start_date.localeCompare(b.start_date) ||
    a.end_date.localeCompare(b.end_date) ||
    a.name.localeCompare(b.name));
}

const monthKey = (e) => e.start_date.slice(0, 7); // "2026-12", used to group cards
const monthOf = (e) => e.start_date.slice(5, 7);  // "12", used by the month filter
export const yearOf = (e) => e.start_date.slice(0, 4); // "2026"

/** "2026-12" -> "December 2026" (or just "December"). */
export function monthLabel(key, withYear = true) {
  const [y, m] = key.split('-');
  const name = MONTH_NAMES[Number(m) - 1];
  return withYear ? `${name} ${y}` : name;
}

/**
 * Filters by month ("01" to "12"), year ("2026"), weapon, format and type (competition, other).
 * Each filter is "all" (or missing) to mean "don't filter on this".
 * Month and year are separate, so month "01" + year "2027" means January 2027.
 */
export const typeOf = (e) => e.type ?? 'competition'; // an event with no type is a competition

export function filterEvents(events, { month = 'all', year = 'all', weapon = 'all', format = 'all', type = 'all' } = {}) {
  return events.filter((e) =>
    (month === 'all' || monthOf(e) === month) &&
    (year === 'all' || yearOf(e) === year) &&
    (weapon === 'all' || e.weapons?.includes(weapon)) &&
    (format === 'all' || e.format?.includes(format)) &&
    (type === 'all' || typeOf(e) === type));
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

/** The years that have events, newest first, for the year dropdown: ["2027", "2026"]. */
export function yearsIn(events) {
  return [...new Set(events.map(yearOf))].sort().reverse();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The pieces of an event's date for the card's date block:
 *   one day      -> { weekday: "Sat", day: "12", month: "Dec", until: "" }
 *   same month   -> { weekday: "Fri", day: "11", month: "Sep", until: "to 13" }
 *   across months-> { weekday: "Wed", day: "30", month: "Sep", until: "to 2 Oct" }
 */
export function dateParts(e) {
  const [, sm, sd] = e.start_date.split('-').map(Number);
  const [, em, ed] = e.end_date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(`${e.start_date}T00:00:00Z`).getUTCDay()];
  const until = e.start_date === e.end_date ? '' : sm === em ? `to ${ed}` : `to ${ed} ${MONTHS[em - 1]}`;
  return { weekday, day: String(sd), month: MONTHS[sm - 1], until };
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The events for the "Next up" box: the first one (events must be sorted) that is still going ahead,
 * plus any other going-ahead events that start on the same day, with a plain-words "when".
 * Postponed and cancelled events are skipped. Null if there isn't one.
 */
export function nextUp(events, today) {
  const first = events.find((e) => !e.status);
  if (!first) return null;
  const days = daysBetween(today, first.start_date);
  const when = days < 0 ? 'on now' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return { events: events.filter((e) => !e.status && e.start_date === first.start_date), when };
}
