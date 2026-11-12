#!/usr/bin/env node
/**
 * The AFF scraper.   npm run scrape:aff     (then review the new events in  npm run admin)
 *   npm run scrape:aff -- --file x.json     read a saved copy of the feed instead of the live one
 *
 * 1. AFF's website runs the WordPress plugin "The Events Calendar", which publishes every
 *    event as JSON. That gives us name, dates, venue and link with no guessing and no AI.
 * 2. The feed has no weapons, format, gender or level. For each event we don't already
 *    have, we read its own page (aff-page.mjs) to fill those in.
 * 3. A complete event goes into the approval queue (data/pending.json) as a scraper entry.
 *    Nothing is published until you approve it in the admin tool.
 * An event we can't read completely is listed in the output, not queued.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKnown } from '../scripts/lib/checks.mjs';
import { isRealDate } from '../docs/js/logic.js';
import { loadState, saveState, enqueue, flagsFor, Problem } from '../scripts/lib/store.mjs';
import { getJson, getText, sleep } from './lib/http.mjs';
import { decodeEntities } from './lib/html.mjs';
import { completeEvent } from './aff-page.mjs';

const FEED = 'https://www.ausfencing.org/wp-json/tribe/events/v1/events';
const MAX_PAGES = 5; // a safety stop, so a misbehaving site can't keep us fetching forever

// ---------- reading the feed ----------

/**
 * One item from the feed -> { event } (partial: no weapons/format/gender/level yet)
 * or { problem } if the item can't be used.
 */
export function mapAffEvent(item) {
  if (!item || item.status !== 'publish') return { problem: 'not published' };

  const name = decodeEntities(item.title).trim();
  if (!name) return { problem: 'no title' };

  // The feed labels every time "Sydney time", even for a Perth event, and uses 00:00:00 to
  // 23:59:59 for all-day events. We only want the calendar dates, so take the date part as written.
  const start_date = String(item.start_date ?? '').slice(0, 10);
  const end_date = String(item.end_date ?? '').slice(0, 10) || start_date;
  if (!isRealDate(start_date) || !isRealDate(end_date) || end_date < start_date) {
    return { problem: `unusable dates "${item.start_date}" to "${item.end_date}"` };
  }

  const event = { name, start_date, end_date };
  const v = item.venue; // an event with no venue has [] here
  if (v && !Array.isArray(v) && v.venue) {
    event.venue = [decodeEntities(v.venue), decodeEntities(v.city)].filter(Boolean).join(', ');
  }
  event.organiser = 'aff';
  if (item.url) event.url = item.url;
  return { event };
}

/** Every event in the feed. The feed comes in pages, so keep asking until the last one. */
export async function fetchAffFeed({ get = getJson, pause = sleep } = {}) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await get(`${FEED}?per_page=50&page=${page}`);
    items.push(...(data.events ?? []));
    if (page >= (data.total_pages ?? 1)) break;
    await pause(1000); // be gentle: one request a second
  }
  return items;
}

// ---------- from feed to queue ----------

/**
 * Takes the feed's items through the whole pipeline and queues what it can.
 * Returns one result per item, saying what happened:
 *   queued        added to the queue (with any warnings, like a possible duplicate)
 *   known         we already hold it: not touched, its page not even fetched
 *   needs-person  the page couldn't be fully read, or the event failed validation
 *   skipped       the feed item itself was unusable
 * `state` is changed in memory only; the caller saves it. `getPage` and `pause` can be
 * replaced in tests.
 */
export async function processFeed(items, state, { getPage = getText, pause = sleep } = {}) {
  const results = [];
  for (const item of items) {
    const { event: partial, problem } = mapAffEvent(item);
    if (problem) {
      results.push({ outcome: 'skipped', name: decodeEntities(item?.title), notes: [problem] });
      continue;
    }
    if (isKnown(partial, state)) {
      results.push({ outcome: 'known', name: partial.name });
      continue;
    }

    await pause(1000); // one page request a second
    const done = await completeEvent(partial, getPage);
    if (!done.event) {
      results.push({ outcome: 'needs-person', name: partial.name, url: partial.url, notes: done.uncertain });
      continue;
    }

    try {
      const queued = enqueue(state, done.event, { source: 'scraper', source_url: partial.url, source_note: 'AFF events feed' });
      if (queued.skipped) results.push({ outcome: 'known', name: partial.name });
      else results.push({ outcome: 'queued', name: partial.name, event: done.event, pid: queued.entry.pid, notes: flagsFor(state, queued.entry) });
    } catch (err) {
      if (!(err instanceof Problem)) throw err;
      results.push({ outcome: 'needs-person', name: partial.name, url: partial.url, notes: err.errors });
    }
  }
  return results;
}

// ---------- running it ----------

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const state = loadState(root);

  const fileAt = process.argv.indexOf('--file');
  const items = fileAt > 0
    ? JSON.parse(readFileSync(process.argv[fileAt + 1], 'utf8')).events ?? []
    : await fetchAffFeed();
  console.log(`AFF feed: ${items.length} event(s)\n`);

  const results = await processFeed(items, state);
  saveState(state); // writes data/pending.json only if something was queued

  const label = { queued: 'QUEUED', known: 'KNOWN', 'needs-person': 'NEEDS YOU', skipped: 'SKIPPED' };
  for (const r of results) {
    console.log(`${label[r.outcome].padEnd(9)} ${r.name}${r.pid ? `  (${r.pid})` : ''}`);
    if (r.event) {
      const e = r.event;
      console.log(`          ${e.start_date}${e.end_date !== e.start_date ? ` to ${e.end_date}` : ''}   ${e.venue ?? '(no venue)'}`);
      console.log(`          weapons ${e.weapons.join(', ')} | format ${e.format.join(', ')} | gender ${e.gender.join(', ')} | level ${e.level.join(', ')}`);
    }
    for (const note of r.notes ?? []) console.log(`          ${r.outcome === 'queued' ? 'warning: ' : ''}${note}`);
    if (r.outcome === 'needs-person') console.log(`          add it by hand if you want it: ${r.url}`);
    console.log();
  }

  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  console.log(`${count('queued')} queued, ${count('known')} already known, ${count('needs-person')} need you, ${count('skipped')} skipped.`);
  if (count('queued')) console.log('Review them with:  npm run admin');
}

// Run main() only when this file is started directly, not when tests import it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Scrape failed: ${err.message}`);
    process.exitCode = 1;
  });
}
