// Tests for the NSWFA scraper (scrapers/nswfa.mjs) and the calendar-file reader (scrapers/lib/ical.mjs).
// No network: tests/fixtures/nswfa-events.ics holds 4 real events from their calendar file
// (3 upcoming as of November 2026, 1 from 2024).
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIcal, sydneyDate } from '../scrapers/lib/ical.mjs';
import { guessOrganiser, mapNswfaEvent } from '../scrapers/nswfa.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const items = parseIcal(fixture('nswfa-events.ics'));
const bySummary = (start) => items.find((i) => i.SUMMARY.startsWith(start));

const organisers = [
  { id: 'nswfa', name: 'NSW Fencing Association', aliases: ['NSWFA', 'NSW Fencing'] },
  { id: 'sifl', name: 'Sydney Intervarsity Fencing League', aliases: ['SIFL'] },
  { id: 'aff', name: 'Australian Fencing Federation', aliases: ['AFF', 'AFC', 'ausfencing.org'] },
  { id: 'usyd', name: 'USYD Fencing', aliases: ['USYD', 'Sydney Uni Fencing'] },
];

test('a calendar file is read into events, with folded lines joined and escapes undone', () => {
  assert.equal(items.length, 4);
  const first = bySummary('2024 State Junior');
  assert.equal(first.SUMMARY, "2024 State Junior Championships + President's Cup – senior and veterans"); // trailing tabs trimmed
  assert.equal(first.LOCATION, 'Grand Parade, Sydney Olympic Park NSW 2127, Australia');                    // "\," became ","
  assert.equal(first.URL, 'https://nswfencing.org.au/public/schedule/events/66903-2024-state-junior-championships-president-s-cup-senior-and-veterans'); // "URL;VALUE=URI" and a folded line
  assert.ok(first.DESCRIPTION.includes("These events will be run as combined poules for Senior, Veteran, and Junior")); // folded across lines
  assert.ok(first.DESCRIPTION.includes('\n\n'));                                                                // "\n" became a real new line
  assert.deepEqual(parseIcal(''), []);
});

test('calendar times are UTC but the date we want is the date in Sydney', () => {
  assert.equal(sydneyDate('20261114T220000Z'), '2026-11-15'); // 10pm UTC = 9am next day (summer, UTC+11)
  assert.equal(sydneyDate('20260630T140000Z'), '2026-07-01'); // 2pm UTC = midnight next day (winter, UTC+10)
  assert.equal(sydneyDate('20260630T130000Z'), '2026-06-30'); // one hour earlier is still the 30th
  assert.equal(sydneyDate('20260231T000000Z'), null);         // not a real date
  assert.equal(sydneyDate('20261114'), null);                 // a format we haven't seen: refuse, don't guess
  assert.equal(sydneyDate(undefined), null);
});

test('the organiser comes from names in the title, and falls back to NSWFA', () => {
  assert.equal(guessOrganiser('Sydney Intervarsity Fencing League - Round 6', organisers), 'sifl');
  assert.equal(guessOrganiser('SIFL #6', organisers), 'sifl');
  assert.equal(guessOrganiser('AFC #3 Open', organisers), 'aff');
  assert.equal(guessOrganiser('PRE AFC3 - Open - All Weapons', organisers), 'nswfa'); // "AFC3" is not the word "AFC"
  assert.equal(guessOrganiser('Beyond Challenge #2 - Foil U11 & U13', organisers), 'nswfa');
  assert.equal(guessOrganiser('USYD vs SIFL friendly', organisers), 'nswfa');         // two organisers named: don't pick
  assert.equal(guessOrganiser('Visit ausfencing.org (not ausfencingXorg)', organisers), 'aff'); // "." in an alias is not a wildcard
  assert.equal(guessOrganiser('ausfencingXorg', organisers), 'nswfa');
});

test('upcoming events become partial events; finished ones are set aside', () => {
  const today = '2026-11-09';
  assert.deepEqual(mapNswfaEvent(bySummary('PRE AFC3'), organisers, today).event, {
    name: 'PRE AFC3 - Open - All Weapons', start_date: '2026-11-15', end_date: '2026-11-15', organiser: 'nswfa',
    url: 'https://nswfencing.org.au/public/schedule/events/90805-pre-afc3-open-all-weapons',
  });
  const round6 = mapNswfaEvent(bySummary('Sydney Intervarsity'), organisers, today).event;
  assert.equal(round6.organiser, 'sifl');
  assert.equal(round6.start_date, '2026-12-13');
  const camp = mapNswfaEvent(bySummary('Join Us'), organisers, today).event;
  assert.deepEqual([camp.start_date, camp.end_date], ['2027-01-03', '2027-01-11']); // a nine-day camp
  assert.deepEqual(mapNswfaEvent(bySummary('2024 State'), organisers, today), { past: true });
  assert.deepEqual(mapNswfaEvent(bySummary('PRE AFC3'), organisers, '2026-11-15').event.name, 'PRE AFC3 - Open - All Weapons'); // still upcoming on its last day
  assert.deepEqual(mapNswfaEvent(bySummary('PRE AFC3'), organisers, '2026-11-16'), { past: true });
});

test('unreadable calendar items are reported, not guessed at', () => {
  const ok = bySummary('PRE AFC3');
  assert.match(mapNswfaEvent({ ...ok, SUMMARY: ' \t ' }, organisers, '2026-11-09').problem, /no title/);
  assert.match(mapNswfaEvent({ ...ok, DTSTART: '20261115' }, organisers, '2026-11-09').problem, /unreadable dates/);
  assert.match(mapNswfaEvent({ ...ok, DTEND: '20261114T000000Z' }, organisers, '2026-11-09').problem, /unreadable dates/); // ends before it starts
  assert.ok(!('url' in mapNswfaEvent({ ...ok, URL: undefined }, organisers, '2026-11-09').event));
});

