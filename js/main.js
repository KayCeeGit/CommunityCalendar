// main.js: connects the data to the page. It loads events.json, decides which
// events belong on this page, fills the dropdowns, and redraws the cards
// whenever a filter changes.
//
// Each page says what it is with <body data-page="upcoming"> or "archive".

import {
  isValidEvent, splitEvents, sortEvents, todaySydney, filterEvents, groupByMonth,
  monthOptions, yearOptions, monthLabel, yearOf,
} from './logic.js';
import { cardHtml, monthHeaderHtml, messageHtml } from './render.js';

const PAGE = document.body.dataset.page === 'archive' ? 'archive' : 'upcoming';
const ARCHIVE_NEWEST_FIRST = false; // set to true to list the archive newest-first

const byId = (id) => document.getElementById(id);
const container = byId('events');
const selects = {
  month: byId('filter-month'),
  weapon: byId('filter-weapon'),
  format: byId('filter-format'),
  year: byId('filter-year'), // only exists on the archive page
};
const resetButton = byId('reset-filters');

let pageEvents = []; // the events this page is allowed to show

async function loadEvents() {
  const response = await fetch('data/events.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`events.json returned ${response.status}`);
  const all = await response.json();
  return all.filter((e) => {
    const ok = isValidEvent(e);
    if (!ok) console.warn('Skipping invalid event:', e);
    return ok;
  });
}

/** Replaces a dropdown's choices, keeping its first "All ..." option. */
function fillSelect(select, options) {
  if (!select) return;
  const all = select.querySelector('option[value="all"]');
  select.innerHTML = '';
  select.appendChild(all ?? new Option('All', 'all'));
  for (const { value, label } of options) select.appendChild(new Option(label, value));
}

function render() {
  const filters = {
    month: selects.month.value,
    year: selects.year ? selects.year.value : 'all',
    weapon: selects.weapon.value,
    format: selects.format.value,
  };
  const shown = filterEvents(pageEvents, filters);

  if (pageEvents.length === 0) {
    container.innerHTML = messageHtml(PAGE === 'archive' ? 'No past events yet.' : 'No upcoming events listed right now.');
    return;
  }
  if (shown.length === 0) {
    container.innerHTML = messageHtml('No events match these filters.');
    return;
  }

  // Only show the year in month headings when the list spans more than one year.
  const spansYears = new Set(shown.map(yearOf)).size > 1;
  container.innerHTML = groupByMonth(shown)
    .map(({ key, events }) => monthHeaderHtml(monthLabel(key, spansYears)) + events.map(cardHtml).join(''))
    .join('');
}

async function init() {
  if (!container) return;
  try {
    const { upcoming, past } = splitEvents(await loadEvents(), todaySydney());
    pageEvents = sortEvents(PAGE === 'archive' ? past : upcoming, { newestFirst: PAGE === 'archive' && ARCHIVE_NEWEST_FIRST });
  } catch (err) {
    console.error(err);
    container.innerHTML = messageHtml("Sorry, the events couldn't be loaded. Please try again later.");
    return;
  }

  fillSelect(selects.month, monthOptions(pageEvents));
  fillSelect(selects.year, yearOptions(pageEvents));

  Object.values(selects).forEach((s) => s?.addEventListener('change', render));
  resetButton?.addEventListener('click', () => {
    Object.values(selects).forEach((s) => { if (s) s.value = 'all'; });
    render();
  });
  render();
}

init();
