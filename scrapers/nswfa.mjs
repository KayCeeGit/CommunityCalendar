#!/usr/bin/env node
/**
 * The NSWFA scraper.   npm run scrape:nswfa     (then review the new events in  npm run admin)
 *   npm run scrape:nswfa -- --file x.ics    read a saved copy of the calendar instead of the live one
 *
 * NSWFA's website runs on TidyHQ, which publishes every event in a calendar file (.ics).
 * 1. The calendar gives name, dates and link for free. Only UPCOMING events are looked at,
 *    and ones we already hold are skipped before anything else happens.
 * 2. Weapons, format, gender, level and venue are free text on each event's own page, so for
 *    each new event we read that page (nswfa-page.mjs), ask a model what it says
 *    (nswfa-prompt.mjs, nswfa-ai.mjs) and keep only the answers that pass the checks.
 * 3. The event goes into the approval queue (data/pending.json). Anything the AI couldn't
 *    establish is left blank for you to fill in, and the queue won't let a blank event be approved.
 *    Events the AI says aren't worth listing (a recap, something unrelated) are listed in the output, not queued.
 * Needs the ANTHROPIC_API_KEY environment variable (see scrapers/lib/llm.mjs).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKnown, organisersNamedIn } from '../scripts/lib/checks.mjs';
import { loadState, saveState, enqueue, flagsFor, Problem } from '../scripts/lib/store.mjs';
import { todaySydney } from '../docs/js/logic.js';
import { getText, sleep } from './lib/http.mjs';
import { askModel } from './lib/llm.mjs';
import { parseIcal, sydneyDate } from './lib/ical.mjs';
import { checkAnswer, setAside } from './lib/check-answer.mjs';
import { readEventPage } from './nswfa-ai.mjs';

const CALENDAR_URL = 'https://nswfencing.org.au/public/events.ics';
const DEFAULT_ORGANISER = 'nswfa'; // NSWFA lists events run by many others; unless the title says who, it is NSWFA's

/**
 * Who runs this event? Looks for each organiser's name or aliases (organisers.json) in the title.
 * Exactly one organiser found -> that one. None, or several -> NSWFA, so we never guess between them.
 * This matters for duplicates: NSWFA reposts events like "Sydney Intervarsity Fencing League - Round 6",
 * and the duplicate rules only compare events from the SAME organiser.
 */
export function guessOrganiser(title, organisers) {
  const named = organisersNamedIn(title, organisers);
  return named.length === 1 ? named[0] : DEFAULT_ORGANISER;
}

/**
 * One calendar event -> { event } (partial: no weapons/format/gender/level/venue yet),
 * { past: true } if it has finished, or { problem } if we can't read it.
 * `today` is "YYYY-MM-DD" in Sydney.
 */
export function mapNswfaEvent(item, organisers, today) {
  const name = (item.SUMMARY ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { problem: 'no title' };

  const start_date = sydneyDate(item.DTSTART);
  const end_date = item.DTEND ? sydneyDate(item.DTEND) : start_date;
  if (!start_date || !end_date || end_date < start_date) {
    return { problem: `unreadable dates "${item.DTSTART}" to "${item.DTEND}"` };
  }
  if (end_date < today) return { past: true };

  return { event: { name, start_date, end_date, organiser: guessOrganiser(name, organisers), ...(item.URL ? { url: item.URL } : {}) } };
}

// ---------- from calendar to queue ----------

/**
 * Takes the calendar's items through the whole pipeline and queues what it can.
 * Returns one result per item, saying what happened:
 *   queued           added to the queue (notes = warnings and anything the checks threw away)
 *   known            we already hold it: not touched, its page not even fetched
 *   set-aside        the AI says it isn't an event to list (a recap, something unrelated): not queued
 *   needs-person     the page or the AI's answer couldn't be used
 *   skipped          the calendar item itself was unusable
 *   past             already finished
 * `state` is changed in memory only; the caller saves it. `getPage`, `ask` and `pause` can be
 * replaced in tests.
 */
export async function processNswfa(items, state, { getPage = getText, ask = askModel, pause = sleep, today = todaySydney() } = {}) {
  const results = [];
  for (const item of items) {
    const { event: partial, past, problem } = mapNswfaEvent(item, state.organisers, today);
    if (past) { results.push({ outcome: 'past' }); continue; }
    if (problem) { results.push({ outcome: 'skipped', name: item.SUMMARY ?? '(no title)', notes: [problem] }); continue; }
    if (isKnown(partial, state)) { results.push({ outcome: 'known', name: partial.name }); continue; }
    if (!partial.url) { results.push({ outcome: 'needs-person', name: partial.name, notes: ['the calendar gives no page to read'] }); continue; }

    const fail = (message) => results.push({ outcome: 'needs-person', name: partial.name, url: partial.url, notes: [message] });
    await pause(1000); // one page request a second
    let read;
    try {
      read = await readEventPage(await getPage(partial.url), state.validators.choices, ask);
    } catch (err) {
      fail(err.message);
      continue;
    }
    if (read.problem) { fail(read.problem); continue; }

    const reason = String(read.answer.reason ?? '').trim().slice(0, 300);
    if (setAside(read.answer)) { results.push({ outcome: 'set-aside', name: partial.name, notes: [reason] }); continue; }

    const { fields, notes } = checkAnswer(read.answer, read.text, state.validators.choices);
    const event = { ...partial, ...fields };
    try {
      const queued = enqueue(state, event, {
        source: 'scraper',
        source_url: partial.url,
        source_note: `NSWFA events calendar. AI note: ${reason || '(none)'}`,
      });
      if (queued.skipped) results.push({ outcome: 'known', name: partial.name });
      else results.push({ outcome: 'queued', name: partial.name, event, pid: queued.entry.pid, notes: [...notes, ...flagsFor(state, queued.entry)] });
    } catch (err) {
      if (!(err instanceof Problem)) throw err;
      fail(err.errors.join('; '));
    }
  }
  return results;
}

// ---------- running it ----------

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('no API key: set the ANTHROPIC_API_KEY environment variable first');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const state = loadState(root);

  const fileAt = process.argv.indexOf('--file');
  const text = fileAt > 0 ? readFileSync(process.argv[fileAt + 1], 'utf8') : await getText(CALENDAR_URL, 'text/calendar');
  const items = parseIcal(text);

  const results = await processNswfa(items, state);
  saveState(state); // writes data/pending.json only if something was queued

  const label = { queued: 'QUEUED', known: 'KNOWN', 'set-aside': 'SET ASIDE', 'needs-person': 'NEEDS YOU', skipped: 'SKIPPED' };
  for (const r of results.filter((x) => x.outcome !== 'past')) {
    console.log(`${label[r.outcome].padEnd(10)} ${r.name}${r.pid ? `  (${r.pid})` : ''}`);
    if (r.event) {
      const e = r.event;
      const show = (v) => (v?.length ? [].concat(v).join(', ') : '(blank)');
      console.log(`           ${e.start_date}${e.end_date !== e.start_date ? ` to ${e.end_date}` : ''}   ${e.venue ?? '(no venue)'}`);
      console.log(`           weapons ${show(e.weapons)} | format ${show(e.format)} | gender ${show(e.gender)} | level ${show(e.level)}`);
    }
    for (const note of r.notes ?? []) console.log(`           ${r.outcome === 'queued' ? 'note: ' : ''}${note}`);
    if (r.outcome === 'needs-person') console.log(`           add it by hand if you want it: ${r.url ?? ''}`);
    console.log();
  }

  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  console.log(`${items.length} events in the calendar, ${count('past')} already finished (ignored).`);
  console.log(`${count('queued')} queued, ${count('known')} already known, ${count('set-aside')} set aside, ${count('needs-person')} need you, ${count('skipped')} skipped.`);
  if (count('queued')) console.log('Review them with:  npm run admin');
}

// Run main() only when this file is started directly, not when tests import it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Scrape failed: ${err.message}`);
    process.exitCode = 1;
  });
}
