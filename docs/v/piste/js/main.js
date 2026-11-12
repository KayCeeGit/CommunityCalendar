// main.js: connects the data to the page. It loads events.json, decides which
// events belong on this page, builds the month and year options from the data,
// and redraws the events whenever a filter changes.
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
const density = byId('density');     // only on the calendar page: the "Compact view" switch
const countBox = byId('result-count');
const FILTERS = ['year', 'month', 'weapon', 'format', 'type']; // the controls in the filter form (year only exists on the archive page)

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

/** The filter values as { month: "all", weapon: "epee", ... }. A group missing from the page counts as "all". */
const filterValues = () => Object.fromEntries(FILTERS.map((name) => [name, form.elements[name]?.value ?? 'all']));

function render() {
  const values = filterValues();
  const shown = filterEvents(pageEvents, values);
  const filtering = Object.values(values).some((v) => v !== 'all');
  form.closest('.filters').classList.toggle('is-filtering', filtering);
  countBox.textContent = pageEvents.length === 0 ? '' : `${shown.length} ${shown.length === 1 ? 'event' : 'events'}`;

  if (pageEvents.length === 0) {
    container.innerHTML = messageHtml(PAGE === 'archive' ? 'No past events yet.' : 'No upcoming events are listed right now. Check back soon, or add one from the About page.');
    return;
  }
  if (shown.length === 0) {
    container.innerHTML = messageHtml('No events match these filters. Clear the filters to see everything.');
    return;
  }

  // Only show the year in month headings when the list spans more than one year.
  const spansYears = new Set(shown.map(yearOf)).size > 1;
  container.innerHTML = groupByMonth(shown)
    .map(({ key, events }) => `<section class="month-block">${monthHeaderHtml(monthLabel(key, spansYears), events.length)}<div class="month-events">${
      events.map((e) => cardHtml(e, organisersById.get(e.organiser))).join('')}</div></section>`)
    .join('');
}

/** Adds one option per value to a dropdown (the "All" option is already in the page). */
function addOptions(selectId, items) {
  const select = byId(selectId);
  if (!select) return;
  for (const [value, text] of items) select.append(Object.assign(document.createElement('option'), { value, textContent: text }));
}

/** The calendar page remembers whether you prefer cards or compact rows. */
function setupDensity() {
  if (!density) return;
  try { density.checked = localStorage.getItem('calendar-density') === 'compact'; } catch { /* storage can be blocked; the default is fine */ }
  const apply = () => container.classList.toggle('is-compact', density.checked);
  apply();
  density.addEventListener('change', () => {
    apply();
    try { localStorage.setItem('calendar-density', density.checked ? 'compact' : 'cards'); } catch { /* not saved, still works */ }
  });
}

const lamp = (colour) => Object.assign(document.createElement('span'), { className: `lamp ${colour}` });

async function init() {
  if (!container) return;

  try {
    const [events, organisers] = await Promise.all([loadEvents(), loadJson('../../data/organisers.json')]);
    organisersById = new Map(organisers.map((o) => [o.id, o]));
    const { upcoming, past } = splitEvents(events, todaySydney());
    pageEvents = sortEvents(PAGE === 'archive' ? past : upcoming);
  } catch (err) {
    console.error(err);
    container.innerHTML = messageHtml("The events couldn't be loaded. Check your connection and refresh the page.");
    return;
  }

  // The scoring box: the next day with an event going ahead, listing every event that day
  // (built with textContent, so names can't inject markup).
  const next = nextUpBox && nextUp(pageEvents, todaySydney());
  if (next) {
    const part = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text });
    const names = part('ul', 'next-events', '');
    names.append(...next.events.map((e) => { const li = document.createElement('li'); li.append(part('strong', '', e.name)); return li; }));
    const text = part('span', 'text', '');
    text.append(part('span', 'next-label', 'Next up '), part('span', 'when', next.when), names);
    nextUpBox.replaceChildren(lamp('red'), text, lamp('green'));
    nextUpBox.hidden = false;
  }

  // Month and year options come from the data, so there is never an option with nothing behind it.
  const monthsPresent = [...new Set(pageEvents.map((e) => e.start_date.slice(5, 7)))];
  addOptions('month-select', monthsPresent.map((m) => [m, monthLabel(`2000-${m}`, false)]));
  addOptions('year-select', yearsIn(pageEvents).map((y) => [y, y]));

  form.addEventListener('change', render);
  form.addEventListener('reset', () => setTimeout(render)); // the form is cleared after this event, so draw afterwards
  setupDensity();
  render();
}

init();
