// Tests for the AFF scraper (scrapers/aff.mjs) and its robots.txt reader (scrapers/lib/http.mjs).
// No network: tests/fixtures/aff-feed.json is a saved copy of the real feed.
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapAffEvent, fetchAffFeed, processFeed } from '../scrapers/aff.mjs';
import { compileValidators, eventProblems } from '../scripts/lib/checks.mjs';
import { decodeEntities, htmlToLines } from '../scrapers/lib/html.mjs';
import { scheduleLines, readSchedule, completeEvent } from '../scrapers/aff-page.mjs';
import { robotsAllows } from '../scrapers/lib/http.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const feed = JSON.parse(fixture('aff-feed.json'));
const schemaValidators = compileValidators(JSON.parse(readFileSync(new URL('../schema/event.schema.json', import.meta.url), 'utf8')));
const afc3 = fixture('afc3-schedule.html'); // the "Tournament Schedule" block of two real event pages
const ayc2 = fixture('ayc2-schedule.html');

test('html entities in feed text become real characters', () => {
  assert.equal(decodeEntities('Lights &#8211; Adelaide'), 'Lights – Adelaide');
  assert.equal(decodeEntities('A &amp; B &#x26; C'), 'A & B & C');
  assert.equal(decodeEntities('&unknown; &#0; stays'), '&unknown; &#0; stays');
  assert.equal(decodeEntities(undefined), '');
});

test('feed items become partial events, dates taken as written', () => {
  const first = mapAffEvent(feed.events[0]).event;
  assert.deepEqual(first, {
    name: '2026/27 Australian Fencing Circuit #3',
    start_date: '2026-11-20', end_date: '2026-11-22',   // not shifted by the UTC fields
    venue: 'The Gold Netball Centre WA, Jolimont',
    organiser: 'aff',
    url: 'https://www.ausfencing.org/tribe-events/2026-27-australian-fencing-circuit-3/',
  });
  const second = mapAffEvent(feed.events[1]).event;
  assert.equal(second.venue, 'The Lights Sports and Community Centre – Adelaide, Lightsview');
  assert.equal(second.end_date, '2026-12-13');
});

test('unusable feed items are reported, not guessed at', () => {
  const base = feed.events[0];
  assert.match(mapAffEvent({ ...base, status: 'draft' }).problem, /not published/);
  assert.match(mapAffEvent({ ...base, title: '  ' }).problem, /no title/);
  assert.match(mapAffEvent({ ...base, start_date: '2026-02-31 00:00:00' }).problem, /unusable dates/);
  assert.match(mapAffEvent({ ...base, end_date: '2026-11-19 23:59:59' }).problem, /unusable dates/); // ends before it starts
  assert.match(mapAffEvent(null).problem, /not published/);
  assert.ok(!('venue' in mapAffEvent({ ...base, venue: [] }).event)); // no venue is fine
});

test('the feed is read page by page until the last page', async () => {
  const asked = [];
  const pages = { 1: { events: [{ id: 1 }], total_pages: 2 }, 2: { events: [{ id: 2 }], total_pages: 2 } };
  const items = await fetchAffFeed({
    get: async (url) => { asked.push(url); return pages[new URL(url).searchParams.get('page')]; },
    pause: async () => {},
  });
  assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
  assert.equal(asked.length, 2);
});

test('robots.txt: AFF\'s real file', () => {
  const aff = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: https://www.ausfencing.org/sitemap.xml\n';
  assert.equal(robotsAllows(aff, '/wp-json/tribe/events/v1/events'), true);
  assert.equal(robotsAllows(aff, '/wp-admin/options.php'), false);
  assert.equal(robotsAllows(aff, '/wp-admin/admin-ajax.php'), true); // the longer Allow wins
});

test('robots.txt: other shapes', () => {
  assert.equal(robotsAllows('', '/anything'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', '/anything'), true);          // empty Disallow = allow all
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n', '/events'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$\n', '/files/a.pdf'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$\n', '/files/a.pdf.html'), true);
  assert.equal(robotsAllows('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\n', '/events'), true); // BadBot's group is not ours
  assert.equal(robotsAllows('User-agent: BadBot\nUser-agent: *\nDisallow: /x\n', '/x/1'), false); // stacked agents share a group
  assert.equal(robotsAllows('# comment\nUser-agent: * # everyone\nDisallow: /x # no\n', '/x'), false);
});

test('html becomes plain lines; entities are decoded after tags are removed', () => {
  assert.deepEqual(htmlToLines('<p>A&nbsp;&nbsp;B<br>C &amp; D</p><script>x()</script><p>&lt;b&gt;</p>'), ['A B', 'C & D', '<b>']);
});

test('the schedule block is found, and only that block', () => {
  const lines = scheduleLines(afc3);
  assert.ok(lines.includes('08:30 Senior Men’s Sabre'));
  assert.ok(!lines.some((l) => /fees|register/i.test(l)));
  assert.equal(scheduleLines('<h3>Location</h3>'), null);
});

test('AFC #3: weapons, format, gender and level are read from the schedule', () => {
  const { details, unread } = readSchedule(afc3);
  assert.deepEqual(unread, []);
  assert.deepEqual(details, {
    weapons: ['foil', 'epee', 'saber'], format: ['individual', 'team'],
    gender: ['mens', 'womens'], level: ['open', 'veteran'],
  });
});

test('AYC #2: Boy’s/Girl’s become mens/womens, AYC becomes youth, the notes are ignored', () => {
  const { details, unread } = readSchedule(ayc2);
  assert.deepEqual(unread, []);
  assert.deepEqual(details, {
    weapons: ['foil', 'epee', 'saber'], format: ['individual', 'team'],
    gender: ['mens', 'womens'], level: ['youth'],
  });
});

test('lines we only half understand are reported, never guessed', () => {
  const page = (...lines) => `<h3>Tournament Schedule</h3><p>${lines.join('<br>')}</p></div>`;
  const read = readSchedule(page('Senior Men’s Foil', 'Open Foil', 'Equipment control for sabre fencers opens at 8'));
  assert.deepEqual(read.unread, ['Open Foil', 'Equipment control for sabre fencers opens at 8']); // no gender / no level
  assert.deepEqual(readSchedule('<h3>Location</h3>').problem, 'the page has no "Tournament Schedule" block');
  assert.match(readSchedule(page('Lunch at noon')).problem, /no competitions/);
});

test('a partial event plus its page becomes a complete event that passes the schema', async () => {
  const { event: partial } = mapAffEvent(feed.events[1]);
  const done = await completeEvent(partial, async () => ayc2);
  assert.deepEqual(eventProblems(done.event, schemaValidators.candidate), []); // complete enough for the queue
  assert.deepEqual(done.event.level, ['youth']);
});

test('when a page can\'t be read, the event is passed on with reasons', async () => {
  const { event: partial } = mapAffEvent(feed.events[0]);
  assert.match((await completeEvent(partial, async () => { throw new Error('boom'); })).uncertain[0], /couldn't fetch the page: boom/);
  assert.match((await completeEvent(partial, async () => '<p>nothing here</p>')).uncertain[0], /no "Tournament Schedule"/);
  assert.match((await completeEvent({ ...partial, url: undefined })).uncertain[0], /no link/);
  assert.match((await completeEvent(partial, async () => '<h3>Tournament Schedule</h3><p>Open Foil</p></div>')).uncertain[0], /couldn't read this line: "Open Foil"/);
});

// ---- the whole pipeline, in memory ----
const makeState = (events = []) => ({
  events, pending: [], validators: schemaValidators, changed: new Set(),
  organisers: [{ id: 'aff', name: 'AFF' }],
});
const fakeFeed = [
  { ...feed.events[0], url: 'https://www.ausfencing.org/tribe-events/circuit-3/' },
  { ...feed.events[1], url: 'https://www.ausfencing.org/tribe-events/ayc-2/' },
];
const getPage = async (url) => (url.endsWith('circuit-3/') ? afc3 : url.endsWith('ayc-2/') ? ayc2 : '<p>no schedule</p>');
const run = (items, state) => processFeed(items, state, { getPage, pause: async () => {} });

test('queues complete events as scraper entries, with the page as the source', async () => {
  const state = makeState();
  const results = await run(fakeFeed, state);
  assert.deepEqual(results.map((r) => r.outcome), ['queued', 'queued']);
  assert.equal(state.pending.length, 2);
  assert.equal(state.pending[0].source, 'scraper');
  assert.equal(state.pending[0].status, 'pending');
  assert.equal(state.pending[0].source_url, 'https://www.ausfencing.org/tribe-events/circuit-3/');
  assert.equal(state.pending[0].source_note, 'AFF events feed');
  assert.deepEqual(state.pending[1].event.level, ['youth']);
  assert.ok(state.changed.has('pending') && !state.changed.has('events')); // nothing is published
});

test('running it again adds nothing, and does not even fetch the pages', async () => {
  const state = makeState();
  await run(fakeFeed, state);
  let fetched = 0;
  const again = await processFeed(fakeFeed, state, { getPage: async () => { fetched++; return afc3; }, pause: async () => {} });
  assert.deepEqual(again.map((r) => r.outcome), ['known', 'known']);
  assert.equal(fetched, 0);
  assert.equal(state.pending.length, 2);
});

test('an event whose page can\'t be read is listed for a person, not queued', async () => {
  const state = makeState();
  const unreadable = [{ ...feed.events[0], url: 'https://www.ausfencing.org/tribe-events/unknown-page/' }];
  const [result] = await run(unreadable, state);
  assert.equal(result.outcome, 'needs-person');
  assert.match(result.notes[0], /no "Tournament Schedule"/);
  assert.equal(state.pending.length, 0);
});

test('unusable feed items are skipped, and a possible duplicate is queued with a warning', async () => {
  const published = { id: 'evt-0001', name: 'AFC 3 national circuit', start_date: '2026-11-20', end_date: '2026-11-22',
    weapons: ['foil'], format: ['individual'], gender: ['mens'], level: ['open'], organiser: 'aff',
    url: 'https://www.ausfencing.org/tribe-events/circuit-3/' };
  const state = makeState([published]);
  const results = await run([{ ...feed.events[0], status: 'draft' }, fakeFeed[0]], state);
  assert.equal(results[0].outcome, 'skipped');
  assert.equal(results[1].outcome, 'queued');
  assert.ok(results[1].notes.some((n) => n.includes('Possible duplicate of evt-0001') && n.includes('same link')));
});
