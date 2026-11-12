// render.js: turns one event (a plain object from events.json) into the HTML
// for one row of the calendar (class names are styled in style.css).
//
// SECURITY NOTE: event data will eventually come from a form and AI scrapers,
// so nothing is inserted into the page raw. All text is escaped, and links and
// image paths are checked before use.

import { dateParts, typeOf } from './logic.js';

const WEAPONS = [['foil', 'Foil'], ['epee', 'Epee'], ['saber', 'Saber']];
const FORMATS = [['individual', 'Individual'], ['team', 'Teams']];
const GENDERS = [['mens', 'Mens'], ['womens', 'Womens']];
const TYPE_LABELS = { camp: 'Camp', other: 'Other' }; // a competition needs no label
const STATUS_LABELS = { postponed: 'Postponed', cancelled: 'Cancelled' };

// Shown when an event's organiser (or its logo file) can't be found.
const PLACEHOLDER_IMAGE = 'img/placeholder.svg';
const ASSETS = '../../'; // the data and images live two folders up, shared by every design

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Only plain web links are allowed (blocks things like javascript: URLs). */
function safeLink(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** Logos must be a file inside img/ (no ".." tricks). */
function safeImage(path) {
  return typeof path === 'string' && /^img\/[\w\-. ]+$/.test(path) && !path.includes('..') ? path : null;
}

/** Picks the allowed values out of a list, in a fixed order, as display labels. */
const labels = (values = [], table) =>
  table.filter(([key]) => values.includes(key)).map(([, label]) => label).join(' / ');

/** One short line of plain text, or nothing when there is none (a camp may not list a gender). `text` is already safe. */
const line = (cls, text) => (text ? `<p class="${cls}">${text}</p>` : '');

/** `organiser` is the matching entry from organisers.json (or undefined if there isn't one). */
export function cardHtml(e, organiser) {
  const image = safeImage(organiser?.image) ?? PLACEHOLDER_IMAGE;
  const link = safeLink(e.url);
  const status = Object.hasOwn(STATUS_LABELS, e.status) ? e.status : null; // only known values become a class name
  const date = dateParts(e);
  const name = esc(e.name);
  return `
<article class="item-container${status ? ` is-${status}` : ''}" id="${esc(e.id)}">
  <time class="event-date" datetime="${esc(e.start_date)}"><span class="weekday">${date.weekday}</span> <b>${date.day}</b> <span class="mon">${date.month}</span>${date.until ? ` <small>${date.until}</small>` : ''}</time>
  <div class="event-info">
    ${status ? `<p class="status-notice">${esc(STATUS_LABELS[status])}${e.status_note ? `: ${esc(e.status_note)}` : ''}</p>` : ''}
    ${Object.hasOwn(TYPE_LABELS, typeOf(e)) ? `<p class="type-tag">${esc(TYPE_LABELS[typeOf(e)])}</p>` : ''}
    <h3 class="title">${link ? `<a href="${esc(link)}" class="action">${name}</a>` : name}</h3>
    ${line('info', esc(e.venue))}
    ${line('by', esc(organiser?.name))}
  </div>
  <div class="details">${line('weapons', labels(e.weapons, WEAPONS))}${line('format', labels(e.format, FORMATS))}${line('gender', labels(e.gender, GENDERS))}</div>
  <img class="logo" src="${ASSETS}${esc(image)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${ASSETS}${PLACEHOLDER_IMAGE}'">
</article>`;
}

export const monthHeaderHtml = (label, count) =>
  `<h2 class="month-header">${esc(label)}<small>${count} ${count === 1 ? 'event' : 'events'}</small></h2>`;

export const messageHtml = (text) =>
  `<p class="message">${esc(text)}</p>`;
