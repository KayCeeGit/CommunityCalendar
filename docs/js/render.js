// render.js: turns one event (a plain object from events.json) into the HTML
// for a card. The markup uses the same class names as the old hand-written
// cards, so style.css needs no changes.
//
// SECURITY NOTE: event data will eventually come from a form and AI scrapers,
// so nothing is inserted into the page raw. All text is escaped, and links and
// image paths are checked before use.

import { formatDateRange, typeOf } from './logic.js';

const WEAPONS = [['foil', 'Foil'], ['epee', 'Epee'], ['saber', 'Saber']];
const FORMATS = [['individual', 'Individual'], ['team', 'Teams']];
const GENDERS = [['mens', 'Mens'], ['womens', 'Womens']];
const TYPE_LABELS = { camp: 'Camp', training: 'Training' }; // a competition needs no label
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

/** A <p> for one line of event info, or nothing when there is none (a camp may not have a gender). `text` is already safe. */
const line = (cls, text) => (text ? `<p class="${cls}">${text}</p>` : '');

/** `organiser` is the matching entry from organisers.json (or undefined if there isn't one). */
export function cardHtml(e, organiser) {
  const image = safeImage(organiser?.image) ?? PLACEHOLDER_IMAGE;
  const link = safeLink(e.url);
  const status = Object.hasOwn(STATUS_LABELS, e.status) ? e.status : null; // only known values become a class name
  return `
<div class="item-container${status ? ` is-${status}` : ''}" data-id="${esc(e.id)}">
  <div class="img-container"><img src="${esc(image)}" alt="${esc(organiser?.name ?? e.name)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMAGE}'"></div>
  <div class="body-container">
    <div class="overlay"></div>
    <div class="event-info">
      ${status ? `<p class="status-notice">${esc(STATUS_LABELS[status])}${e.status_note ? `: ${esc(e.status_note)}` : ''}</p>` : ''}
      ${Object.hasOwn(TYPE_LABELS, typeOf(e)) ? `<p class="type-tag">${esc(TYPE_LABELS[typeOf(e)])}</p>` : ''}
      <p class="title">${esc(e.name)}</p>
      <div class="seperator"></div>
      ${line('info-wep', labels(e.weapons, WEAPONS))}
      ${line('info-format', labels(e.format, FORMATS))}
      ${line('info-gender', labels(e.gender, GENDERS))}
      <p class="info-date"><i class="far fa-calendar-alt"></i>${esc(formatDateRange(e))}</p>
       ${e.venue ? `<div class="additional-info">
        <p class="info"><i class="fas fa-map-marker-alt"></i> ${esc(e.venue)}</p>
      </div>` : ''}
    </div>
  </div>
  ${link ? `<a href="${esc(link)}" class="action">Go To Page</a>` : ''}
</div>`;
}

export const monthHeaderHtml = (label) => `<div class="month-header">${esc(label)}</div>`;

export const messageHtml = (text) =>
  `<p style="width:100%;text-align:center;padding:2rem">${esc(text)}</p>`;
