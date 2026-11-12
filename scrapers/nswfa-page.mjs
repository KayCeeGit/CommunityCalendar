/**
 * NSWFA event pages, step 1 of the AI stage: cut a page down to the text worth reading.
 *
 * A TidyHQ event page is mostly menus, login boxes and ticket forms. The event itself sits in
 * three places, and these are the parts we keep:
 *   1. from the title (<h1>) up to the ticket box (free events have none):  title, date, time, venue
 *   2. from the "About this event" heading on, up to "Share this event":
 *      the organiser's free-text description, the Schedule (if there is one) and the Location
 * Everything else (the ticket box, menus, footer, scripts) is dropped. If either marker is
 * missing we return null rather than guess, so a changed page layout shows up as a failure.
 */
import { htmlToLines } from './lib/html.mjs';

export function pageText(html) {
  const start = html.indexOf('<h1');
  const about = html.indexOf('>About this event<');
  const end = html.indexOf('>Share this event<');
  if (start < 0 || about < start || end < about) return null;

  const bodyStart = html.lastIndexOf('<h2', about);
  const ticketBox = html.indexOf('<aside', start);
  const top = html.slice(start, ticketBox > 0 && ticketBox < bodyStart ? ticketBox : bodyStart);
  const body = html.slice(bodyStart, html.lastIndexOf('<h2', end));
  return htmlToLines(top + body).join('\n');
}
