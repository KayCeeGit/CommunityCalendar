// render.js: turns one event (a plain object from events.json) into the HTML
// for a row of the calendar (class names are styled in style.css).
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

/** An <li> for one tag (weapons, format, gender), or nothing when there is none (a camp may not have a gender). `text` is already safe. */
const tag = (cls, text) => (text ? `<li class="${cls}">${text}</li>` : '');

/** `organiser` is the matching entry from organisers.json (or undefined if there isn't one). */
export function cardHtml(e, organiser) {
  const image = safeImage(organiser?.image) ?? PLACEHOLDER_IMAGE;
  const link = safeLink(e.url);
  const status = Object.hasOwn(STATUS_LABELS, e.status) ? e.status : null; // only known values become a class name
  const date = dateParts(e);
  const tags = tag('info-wep', labels(e.weapons, WEAPONS)) + tag('info-format', labels(e.format, FORMATS)) + tag('info-gender', labels(e.gender, GENDERS));
  return `
<article class="item-container${status ? ` is-${status}` : ''}" data-id="${esc(e.id)}">
  <time class="event-date" datetime="${esc(e.start_date)}"><span class="weekday">${date.weekday}</span><b>${date.day}</b><span class="month">${date.month}</span>${date.until ? `<small>${date.until}</small>` : ''}</time>
  <div class="event-info">
    ${status ? `<p class="status-notice">${esc(STATUS_LABELS[status])}${e.status_note ? `: ${esc(e.status_note)}` : ''}</p>` : ''}
    ${Object.hasOwn(TYPE_LABELS, typeOf(e)) ? `<p class="type-tag">${esc(TYPE_LABELS[typeOf(e)])}</p>` : ''}
    <h3 class="title">${esc(e.name)}</h3>
  </div>
  ${tags ? `<ul class="tags">${tags}</ul>` : ''}
  ${e.venue ? `<p class="info"><i class="fas fa-map-marker-alt" aria-hidden="true"></i>${esc(e.venue)}</p>` : ''}
  <div class="img-container"><img src="${ASSETS}${esc(image)}" alt="${esc(organiser?.name ?? '')}" loading="lazy" onerror="this.onerror=null;this.src='${ASSETS}${PLACEHOLDER_IMAGE}'"></div>
  ${link ? `<a href="${esc(link)}" class="action" aria-label="${esc(e.name)}: open event page">Event page <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : ''}
</article>`;
}

export const monthHeaderHtml = (label, count) => `<h2 class="month-header">${esc(label)}<small>${count} ${count === 1 ? 'event' : 'events'}</small></h2>`;

export const messageHtml = (text) =>
  `<p class="message">${esc(text)}</p>`;
