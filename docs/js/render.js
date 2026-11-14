// render.js: turns one event (a plain object from events.json) into the HTML
// for one row of the calendar (class names are styled in style.css).
//
// SECURITY NOTE: event data will eventually come from a form and AI scrapers,
// so nothing is inserted into the page raw. All text is escaped, and links and
// image paths are checked before use.

import { dateParts, typeOf } from './logic.js';

const WEAPONS = [['foil', 'Foil'], ['epee', 'Epee'], ['saber', 'Saber']]; // the F / E / S glyphs use each name's first letter
const FORMATS = [['individual', 'Individual'], ['team', 'Teams']];
const GENDERS = [['mens', 'Mens'], ['womens', 'Womens']];
const TYPE_LABELS = { other: 'Other' }; // a competition needs no label
const STATUS_LABELS = { postponed: 'Postponed', cancelled: 'Cancelled' };

// Shown when an event's organiser (or its logo file) can't be found.
const PLACEHOLDER_IMAGE = 'img/placeholder.svg';

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

/** Three letters, F E S, lit for the weapons the event uses. Nothing at all when none are listed (an "other" event may not say). */
const weaponGlyphs = (weapons = []) => (weapons.length
  ? `<p class="weapons" aria-label="Weapons: ${labels(weapons, WEAPONS)}">${
    WEAPONS.map(([key, name]) => `<span${weapons.includes(key) ? ' class="on"' : ''} data-w="${key}" title="${name}" aria-hidden="true">${name[0]}</span>`).join('')}</p>`
  : '');

/** The format and gender as two short lines, leaving out whichever is missing. `lines` are already safe. */
const metaLines = (...lines) => (lines.some(Boolean) ? `<p class="meta">${lines.filter(Boolean).map((l) => `<span>${l}</span>`).join('')}</p>` : '');

/** `organiser` is the matching entry from organisers.json (or undefined if there isn't one). */
export function cardHtml(e, organiser) {
  const image = safeImage(organiser?.image) ?? PLACEHOLDER_IMAGE;
  const link = safeLink(e.url);
  const status = Object.hasOwn(STATUS_LABELS, e.status) ? e.status : null; // only known values become a class name
  const date = dateParts(e);
  return `
<article class="item-container${status ? ` is-${status}` : ''}" data-id="${esc(e.id)}">
  <p class="serial">${esc(e.id)}</p>
  <time class="event-date" datetime="${esc(e.start_date)}"><b>${date.day}</b><span class="weekday">${date.weekday}</span>${date.until ? `<small>${date.until}</small>` : ''}</time>
  <div class="event-info">
    ${status ? `<p class="status-notice">${esc(STATUS_LABELS[status])}${e.status_note ? `: ${esc(e.status_note)}` : ''}</p>` : ''}
    ${Object.hasOwn(TYPE_LABELS, typeOf(e)) ? `<p class="type-tag">${esc(TYPE_LABELS[typeOf(e)])}</p>` : ''}
    <h3 class="title">${esc(e.name)}</h3>
    ${e.venue ? `<p class="info">${esc(e.venue)}</p>` : ''}
  </div>
  ${weaponGlyphs(e.weapons)}
  ${metaLines(labels(e.format, FORMATS), labels(e.gender, GENDERS))}
  <div class="img-container"><img src="${esc(image)}" alt="${esc(organiser?.name ?? '')}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMAGE}'"></div>
  ${link ? `<a href="${esc(link)}" class="action" aria-label="${esc(e.name)}: open event page"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : ''}
</article>`;
}

export const monthHeaderHtml = (label, count) => `<h2 class="month-header">${esc(label)}<small>${count} ${count === 1 ? 'event' : 'events'}</small></h2>`;

export const messageHtml = (text) =>
  `<p class="message">${esc(text)}</p>`;
