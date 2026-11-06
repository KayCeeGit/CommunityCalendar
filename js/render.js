// render.js: turns one event (a plain object from events.json) into the HTML
// for a card. The markup uses the same class names as the old hand-written
// cards, so style.css needs no changes.
//
// SECURITY NOTE: event data will eventually come from a form and AI scrapers,
// so nothing is inserted into the page raw. All text is escaped, and links and
// image paths are checked before use.

import { formatDateRange } from './logic.js';

const WEAPONS = [['foil', 'Foil'], ['epee', 'Epee'], ['saber', 'Saber']];
const FORMATS = [['individual', 'Individual'], ['team', 'Teams']];
const GENDERS = [['mens', 'Mens'], ['womens', 'Womens']];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Only plain web links are allowed (blocks things like javascript: URLs). */
export function safeLink(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** Images must be a file inside img/ (no ".." tricks), or a full https link. */
export function safeImage(path) {
  if (typeof path !== 'string') return null;
  if (/^img\/[\w\-. ]+$/.test(path) && !path.includes('..')) return path;
  return safeLink(path)?.startsWith('https:') ? path : null;
}

/** Picks the allowed values out of a list, in a fixed order, as display labels. */
const labels = (values, table) =>
  table.filter(([key]) => values.includes(key)).map(([, label]) => label).join(' / ');

export function cardHtml(e) {
  const image = safeImage(e.image);
  const link = safeLink(e.url);
  return `
<div class="item-container" data-id="${esc(e.id)}">
  <div class="img-container">${image ? `<img src="${esc(image)}" alt="${esc(e.name)}">` : ''}</div>
  <div class="body-container">
    <div class="overlay"></div>
    <div class="event-info">
      <p class="title">${esc(e.name)}</p>
      <div class="seperator"></div>
      <p class="info-wep">${labels(e.weapons, WEAPONS)}</p>
      <p class="info-format">${labels(e.format, FORMATS)}</p>
      <p class="info-gender">${labels(e.gender ?? [], GENDERS)}</p>
      <p class="info-date"><i class="far fa-calendar-alt"></i>${esc(formatDateRange(e))}</p>
      <div class="additional-info">
        <p class="info"><i class="fas fa-map-marker-alt"></i> ${esc(e.venue ?? 'Venue TBC')}</p>
      </div>
    </div>
  </div>
  ${link ? `<a href="${esc(link)}" class="action">Go To Page</a>` : ''}
</div>`;
}

export const monthHeaderHtml = (label) => `<div class="month-header">${esc(label)}</div>`;

export const messageHtml = (text) =>
  `<p style="width:100%;text-align:center;padding:2rem">${esc(text)}</p>`;
