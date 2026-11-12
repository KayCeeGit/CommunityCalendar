// main.js: connects the data to the page. It loads events.json, decides which
// events belong on this page, builds the month and year options from the data,
// and redraws the events whenever a filter changes. The filters are also kept in
// the address bar (?weapon=epee&month=12), so a filtered view can be shared or bookmarked.
//
// Each page says what it is with <body data-page="upcoming"> or "archive".

import {
  isValidEvent, splitEvents, sortEvents, todaySydney, filterEvents, groupByMonth,
  yearsIn, yearOf, monthLabel, nextUp,
} from './logic.js';
import { cardHtml, monthHeaderHtml, messageHtml } from './render.js';

const PAGE = document.body.dataset.page === 'archive' ? 'archive' : 'upcoming';

const byId = (id) => document.getElementById(id);
const container = byId('events');
const form = byId('filters');
const nextUpBox = byId('next-up');   // only on the calendar page
const countBox = byId('result-count');
const FILTERS = ['q', 'year', 'month', 'weapon', 'format', 'type']; // the controls in the filter form (year only exists on the archive page)
const unset = (name) => (name === 'q' ? '' : 'all');                // what a control says when it isn't filtering

let pageEvents = [];            // the events this page is allowed to show
let organisersById = new Map(); // organiser id -> { name, image, ... }

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function loadEvents() {
  const all = await loadJson('../../data/events.json');
  return all.filter((e) => {
    const ok = isValidEvent(e);
    if (!ok) console.warn('Skipping invalid event:', e);
    return ok;
  });
}

/** The filter values as { q: "", month: "all", weapon: "epee", ... }. A control missing from the page counts as unset. */
const filterValues = () => Object.fromEntries(FILTERS.map((name) => [name, form.elements[name]?.value ?? unset(name)]));
const isFiltering = (values) => Object.entries(values).some(([name, value]) => value !== unset(name));

/** Writes the active filters into the address bar, without adding a history entry. */
function saveToUrl(values) {
  const params = new URLSearchParams(Object.entries(values).filter(([name, value]) => value !== unset(name)));
  history.replaceState(null, '', params.size ? `?${params}` : location.pathname);
}

/** Applies a link like ?weapon=epee&month=12 to the controls. Unknown names and values are ignored, so a bad link just shows everything. */
function loadFromUrl() {
  for (const [name, value] of new URLSearchParams(location.search)) {
    if (!FILTERS.includes(name)) continue;
    const control = form.elements[name];
    if (!control) continue;
    if (name === 'q') control.value = value.slice(0, 80);
    else if ([...(control.options ?? control)].some((option) => option.value === value)) control.value = value;
  }
}

function render() {
  const values = filterValues();
  const shown = filterEvents(pageEvents, values);
  const filtering = isFiltering(values);
  form.closest('.filters').classList.toggle('is-filtering', filtering);
  saveToUrl(values);

  const total = pageEvents.length;
  countBox.textContent = total === 0 ? '' : filtering ? `Showing ${shown.length} of ${total} events` : `${total} ${total === 1 ? 'event' : 'events'}`;

  if (total === 0) {
    container.innerHTML = messageHtml(PAGE === 'archive' ? 'No past events yet.' : 'No upcoming events are listed right now. Check back soon, or add one from the About page.');
    return;
  }
  if (shown.length === 0) {
    container.innerHTML = messageHtml('No events match these filters. Use "Clear filters" to see everything.');
    return;
  }

  // Only show the year in month headings when the list spans more than one year.
  const spansYears = new Set(shown.map(yearOf)).size > 1;
  container.innerHTML = groupByMonth(shown)
    .map(({ key, events }) => `<section class="month-block">${monthHeaderHtml(monthLabel(key, spansYears), events.length)}${
      events.map((e) => cardHtml(e, organisersById.get(e.organiser))).join('')}</section>`)
    .join('');
}

/** Adds one option per value to a dropdown (the "All" option is already in the page). */
function addOptions(selectId, items) {
  const select = byId(selectId);
  if (!select) return;
  for (const [value, text] of items) select.append(Object.assign(document.createElement('option'), { value, textContent: text }));
}

async function init() {
  if (!container) return;

  try {
    const [events, organisers] = await Promise.all([loadEvents(), loadJson('../../data/organisers.json')]);
    organisersById = new Map(organisers.map((o) => [o.id, o]));
    const { upcoming, past } = splitEvents(events, todaySydney());
    // The archive lists the most recent events first; the calendar lists the soonest first.
    pageEvents = PAGE === 'archive' ? sortEvents(past).reverse() : sortEvents(upcoming);
  } catch (err) {
    console.error(err);
    container.innerHTML = messageHtml("The events couldn't be loaded. Check your connection and refresh the page.");
    return;
  }

  // The next event that is going ahead, as a link that jumps to it (built with DOM calls, so names can't inject markup).
  const next = nextUpBox && nextUp(pageEvents, todaySydney());
  if (next) {
    const part = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text });
    const name = Object.assign(part('a', 'name', next.event.name), { href: `#${encodeURIComponent(next.event.id)}` });
    nextUpBox.replaceChildren(part('span', 'label', 'Next up:'), ' ', name, ' ', part('span', 'when', `(${next.when})`));
    nextUpBox.hidden = false;
  }

  // Month and year options come from the data, so there is never one with nothing behind it.
  const monthsPresent = [...new Set(pageEvents.map((e) => e.start_date.slice(5, 7)))];
  addOptions('month-select', monthsPresent.map((m) => [m, monthLabel(`2000-${m}`, false)]));
  addOptions('year-select', yearsIn(pageEvents).map((y) => [y, y]));
  loadFromUrl();

  form.addEventListener('input', render);                    // fires for typing, radio buttons and dropdowns alike
  form.addEventListener('submit', (ev) => ev.preventDefault()); // pressing Enter in the search box must not reload the page
  form.addEventListener('reset', () => setTimeout(render));  // the form is cleared after this event, so draw afterwards
  render();
}

init();
