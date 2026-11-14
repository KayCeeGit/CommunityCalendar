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
const countBox = byId('result-count');
const filtersBox = form.closest('.filters');
const filterBadge = byId('filter-badge');   // how many filters are on, shown on the Filters button
const FILTERS = ['year', 'month', 'weapon', 'format', 'type', 'age']; // the radio groups in the filter form (year only exists on the archive page)

let pageEvents = [];            // the events this page is allowed to show
let organisersById = new Map(); // organiser id -> { name, image, ... }

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function loadEvents() {
  const all = await loadJson('data/events.json');
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
  filtersBox.classList.toggle('is-filtering', filtering);
  filterBadge.textContent = Object.values(values).filter((v) => v !== 'all').length || '';
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

async function init() {
  if (!container) return;

  try {
    const [events, organisers] = await Promise.all([loadEvents(), loadJson('data/organisers.json')]);
    organisersById = new Map(organisers.map((o) => [o.id, o]));
    const { upcoming, past } = splitEvents(events, todaySydney());
    pageEvents = sortEvents(PAGE === 'archive' ? past : upcoming);
  } catch (err) {
    console.error(err);
    container.innerHTML = messageHtml("The events couldn't be loaded. Check your connection and refresh the page.");
    return;
  }

  // The next day with an event going ahead, listing every event that day (built with textContent, so names can't inject markup).
  const next = nextUpBox && nextUp(pageEvents, todaySydney());
  if (next) {
    const part = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text });
    // One dark tile per event, so two events on the same day are easy to tell apart.
    // On phones the box starts collapsed to one line (label, when, a short summary); the toggle button (hidden on wide screens) opens the list.
    const names = Object.assign(part('ul', 'next-events', ''), { id: 'next-list' });
    names.append(...next.events.map((e) => { const li = document.createElement('li'); li.append(part('strong', 'name', e.name)); return li; }));
    const summary = next.events.length === 1 ? next.events[0].name : `${next.events.length} events`;
    const head = part('span', 'next-head', '');
    head.append(part('span', 'label', 'Next up'), part('span', 'when', next.when), part('span', 'next-count', summary));
    const text = part('span', 'text', '');
    text.append(head, names);
    const toggle = Object.assign(part('button', 'next-toggle', ''), { type: 'button' });
    toggle.setAttribute('aria-controls', 'next-list');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Show next events');
    toggle.addEventListener('click', () => {
      const open = nextUpBox.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Hide next events' : 'Show next events');
    });
    nextUpBox.replaceChildren(text, toggle);
    nextUpBox.hidden = false;
  }

  // Month and year options come from the data, so there is never one with nothing behind it.
  const monthsPresent = [...new Set(pageEvents.map((e) => e.start_date.slice(5, 7)))];
  addOptions('month-select', monthsPresent.map((m) => [m, monthLabel(`2000-${m}`, false).slice(0, 3)]));
  addOptions('year-select', yearsIn(pageEvents).map((y) => [y, y]));

  byId('filters-toggle').addEventListener('click', (e) => {   // on small screens the filters start hidden behind this button
    e.currentTarget.setAttribute('aria-expanded', filtersBox.classList.toggle('is-open'));
  });
  form.addEventListener('change', render);
  form.addEventListener('reset', () => setTimeout(render)); // the form is cleared after this event, so draw afterwards
  render();
}

init();
