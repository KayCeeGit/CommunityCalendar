// Tests for the queue (scripts/lib/store.mjs) and the duplicate rules
// (scripts/lib/checks.mjs). They work on data held in memory, so no files are touched.
// Run with:  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileValidators, findDuplicates, similarNames, sanityWarnings, isKnown, shortenOrganisers, organisersNamedIn, missingCategories } from '../scripts/lib/checks.mjs';
import { enqueue, dropScreenshots, approve, reject, restore, addAndApprove, updatePending, updateEvent, deleteEvent, flagsFor, Problem } from '../scripts/lib/store.mjs';

const schema = JSON.parse(readFileSync(new URL('../schema/event.schema.json', import.meta.url), 'utf8'));
const validators = compileValidators(schema);

const raw = (over = {}) => ({
  name: 'Test Cup', start_date: '2027-03-06', end_date: '2027-03-06',
  weapons: ['epee'], format: ['individual'], gender: ['mens'], level: ['open'],
  venue: 'Some Hall', organiser: 'aff', url: 'https://example.com/cup', ...over,
});

const published = (id, over = {}) => ({ id, ...raw(over) });

// A fresh in-memory state for each test
const makeState = (events = [], pending = []) => ({
  events, pending, validators, changed: new Set(),
  organisers: [{ id: 'aff', name: 'AFF' }, { id: 'sifl', name: 'SIFL' }],
});

const problemsOf = (fn) => {
  try { fn(); } catch (err) { if (err instanceof Problem) return err.errors; throw err; }
  return null;
};

test('a valid manual event enters the queue without an id', () => {
  const state = makeState();
  const { entry } = enqueue(state, raw());
  assert.equal(entry.pid, 'q-0001');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.source, 'manual');
  assert.ok(!('id' in entry.event));
  assert.deepEqual([...state.changed], ['pending']);
});

test('invalid events are refused and nothing is queued', () => {
  const state = makeState();
  const errors = problemsOf(() => enqueue(state, raw({ weapons: ['sabre'], start_date: '2027-02-31' })));
  assert.ok(errors.some((e) => e.includes('weapons')));
  assert.equal(state.pending.length, 0);
  assert.ok(problemsOf(() => enqueue(state, raw({ id: 'evt-0099' }))).some((e) => e.includes('unknown field "id"')));
  assert.ok(problemsOf(() => enqueue(state, raw({ end_date: '2027-03-01' }))).some((e) => e.includes('before start_date')));
});

test('end date defaults to the start date, and text is trimmed', () => {
  const { entry } = enqueue(makeState(), raw({ end_date: '', name: '  Padded Cup  ' }));
  assert.equal(entry.event.end_date, '2027-03-06');
  assert.equal(entry.event.name, 'Padded Cup');
});

test('approving assigns the next id and publishes the event', () => {
  const state = makeState([published('evt-0007', { start_date: '2027-01-01', end_date: '2027-01-01' })]);
  const { entry } = enqueue(state, raw());
  const event = approve(state, entry.pid);
  assert.equal(event.id, 'evt-0008');
  assert.equal(Object.keys(event)[0], 'id');
  assert.equal(state.events.length, 2);
  assert.equal(entry.status, 'approved');
  assert.equal(entry.event_id, 'evt-0008');
  assert.ok(state.changed.has('events') && state.changed.has('pending'));
});

test('an entry can only be approved once', () => {
  const state = makeState();
  const { entry } = enqueue(state, raw());
  approve(state, entry.pid);
  assert.ok(problemsOf(() => approve(state, entry.pid)).join().includes('not pending'));
  assert.equal(state.events.length, 1);
});

test('ids are never reused, even after a delete', () => {
  const state = makeState();
  const first = approve(state, enqueue(state, raw()).entry.pid); // evt-0001
  deleteEvent(state, first.id);
  const second = approve(state, enqueue(state, raw({ name: 'Another Cup' })).entry.pid);
  assert.equal(second.id, 'evt-0002');
});

test('reject and restore', () => {
  const state = makeState();
  const { entry } = enqueue(state, raw());
  reject(state, entry.pid);
  assert.equal(entry.status, 'rejected');
  assert.ok(problemsOf(() => approve(state, entry.pid)));
  restore(state, entry.pid);
  assert.equal(entry.status, 'pending');
  assert.ok(problemsOf(() => restore(state, entry.pid))); // already pending
});

test('editing a queued event re-checks it', () => {
  const state = makeState();
  const { entry } = enqueue(state, raw());
  updatePending(state, entry.pid, raw({ name: 'Fixed Name' }));
  assert.equal(entry.event.name, 'Fixed Name');
  assert.ok(problemsOf(() => updatePending(state, entry.pid, raw({ url: 'javascript:alert(1)' }))));
  assert.equal(entry.event.name, 'Fixed Name'); // the failed edit changed nothing
});

test('save and approve in one step', () => {
  const state = makeState([published('evt-0001', { name: 'Test Cup' })]);
  const { event, flags } = addAndApprove(state, raw({ name: 'Test Cup' }));
  assert.equal(event.id, 'evt-0002');
  assert.ok(flags.some((f) => f.includes('Possible duplicate of evt-0001')));
});

test('scrapers: an event already known is skipped, manual entries never are', () => {
  const state = makeState([published('evt-0001', { name: 'SIFL #6' })]);
  const scraped = raw({ name: 'SIFL 6' }); // same words, different punctuation
  assert.match(enqueue(state, scraped, { source: 'scraper' }).skipped, /evt-0001/);

  const fresh = raw({ name: 'Brand New Open', start_date: '2027-05-01', end_date: '2027-05-01', venue: 'Elsewhere', url: 'https://example.com/new' });
  const first = enqueue(state, fresh, { source: 'scraper', source_url: 'https://example.com/list' });
  assert.ok(first.entry);
  assert.equal(first.entry.source_url, 'https://example.com/list');
  assert.match(enqueue(state, fresh, { source: 'scraper' }).skipped, /q-0001/); // already in the queue

  reject(state, first.entry.pid);
  assert.ok(enqueue(state, fresh, { source: 'scraper' }).skipped); // rejected events stay rejected
  assert.ok(enqueue(state, fresh, { source: 'manual' }).entry);   // but a person can still add it
});

test('only known sources are accepted', () => {
  assert.ok(problemsOf(() => enqueue(makeState(), raw(), { source: 'google-form' })));
});

test('editing and deleting published events', () => {
  const state = makeState([published('evt-0001')]);
  updateEvent(state, 'evt-0001', raw({ name: 'Renamed' }));
  assert.equal(state.events[0].name, 'Renamed');
  assert.equal(state.events[0].id, 'evt-0001');
  assert.ok(problemsOf(() => updateEvent(state, 'evt-0001', raw({ gender: [] }))));
  assert.equal(problemsOf(() => deleteEvent(state, 'evt-0099')).length, 1);
  deleteEvent(state, 'evt-0001');
  assert.equal(state.events.length, 0);
});

test('flags: unknown organiser and already-finished events', () => {
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10); // a month from now: never finished, never "too far off"
  const state = makeState();
  const { entry } = enqueue(state, raw({ organiser: 'newclub', start_date: '2020-01-01', end_date: '2020-01-01' }));
  const flags = flagsFor(state, entry);
  assert.ok(flags.some((f) => f.includes('"newclub"')));
  assert.ok(flags.some((f) => f.includes('already finished')));
  assert.deepEqual(flagsFor(state, enqueue(state, raw({ name: 'Clean', start_date: soon, end_date: soon, venue: 'X' })).entry), []);
});

test('duplicate rules, in order', () => {
  const pool = [{ ref: 'evt-0001', event: raw({ name: 'Alpha Open', venue: 'Hall A', url: 'https://example.com/events/alpha' }) }];
  const reasons = (over) => findDuplicates(raw({ start_date: '2030-01-01', end_date: '2030-01-01', url: 'https://other.example/x/y', venue: 'Z', name: 'Zed', ...over }), pool).map((m) => m.reason);

  assert.deepEqual(reasons({ url: 'https://www.example.com/events/alpha/?utm_source=fb' }), ['same link']);          // link wins, even on another date
  assert.deepEqual(reasons({ start_date: '2027-03-06', end_date: '2027-03-06', venue: 'hall a' }), ['same date and venue']);
  assert.deepEqual(reasons({ start_date: '2027-03-06', end_date: '2027-03-06', name: 'alpha open #2' }), ['similar name on the same date']);
  assert.deepEqual(reasons({}), []);
  assert.deepEqual(reasons({ start_date: '2027-03-06', end_date: '2027-03-06', name: 'Alpha Open', venue: 'Hall A' }), ['same date and venue']); // first matching rule only
});

test('same organiser, overlapping dates and categories is flagged even with different names and no venue', () => {
  const pool = [{ ref: 'evt-0001', event: raw({ name: 'Alpha Open', venue: undefined, url: undefined, weapons: ['foil', 'epee'] }) }];
  const base = { name: 'Totally Different', venue: undefined, url: undefined };
  const reasons = (over) => findDuplicates(raw({ ...base, ...over }), pool).map((m) => m.reason);
  assert.deepEqual(reasons({ weapons: ['epee', 'foil'] }), ['same organiser, overlapping dates and categories']);
  assert.deepEqual(reasons({ weapons: ['foil'] }), ['same organiser, overlapping dates and categories']); // hidden inside a bigger event
  assert.deepEqual(reasons({ weapons: ['saber'] }), []);                                                  // no weapon in common
  assert.deepEqual(reasons({ weapons: ['foil'], gender: ['womens'] }), []);                               // different gender
  assert.deepEqual(reasons({ weapons: ['foil'], organiser: 'sifl' }), []);                                // different organiser
  assert.deepEqual(reasons({ weapons: ['foil'], start_date: '2027-03-07', end_date: '2027-03-07' }), []); // different day
});

test('date ranges that overlap are flagged, ranges that only sit next to each other are not', () => {
  const pool = [{ ref: 'evt-0001', event: raw({ name: 'Weekend Open', venue: undefined, url: undefined, start_date: '2027-03-06', end_date: '2027-03-07' }) }];
  const reasons = (start, end) => findDuplicates(raw({ name: 'Other Name', venue: undefined, url: undefined, start_date: start, end_date: end }), pool).map((m) => m.reason);
  assert.deepEqual(reasons('2027-03-07', '2027-03-07'), ['same organiser, overlapping dates and categories']); // starts on the other's last day
  assert.deepEqual(reasons('2027-03-05', '2027-03-06'), ['same organiser, overlapping dates and categories']); // ends on the other's first day
  assert.deepEqual(reasons('2027-03-08', '2027-03-08'), []);                                                   // next day: no overlap
});

test('same name a few weeks apart is flagged as a possible date change', () => {
  const pool = [{ ref: 'evt-0001', event: raw({ name: 'SIFL #6', venue: undefined, url: undefined, start_date: '2027-03-06', end_date: '2027-03-06', weapons: ['foil'] }) }];
  const later = (over) => findDuplicates(raw({ name: 'SIFL 6', venue: undefined, url: undefined, weapons: ['foil'], start_date: '2027-03-20', end_date: '2027-03-20', ...over }), pool).map((m) => m.reason);
  assert.deepEqual(later({}), ['similar name close by in time (was the date changed?)']);
  assert.deepEqual(later({ start_date: '2027-08-01', end_date: '2027-08-01' }), []); // months later: a different event
  assert.deepEqual(later({ organiser: 'sifl' }), []);                                 // different organiser
  assert.deepEqual(later({ name: 'MQU Champs' }), []);                                // different name
  assert.deepEqual(later({ weapons: ['saber'] }), []);                                // same series, different weapon
});

test('sanity warnings: long events and far-off dates', () => {
  const today = '2027-01-01';
  assert.deepEqual(sanityWarnings(raw({ start_date: '2027-03-01', end_date: '2027-03-05' }), today), []); // 5 days is fine
  assert.match(sanityWarnings(raw({ start_date: '2027-03-01', end_date: '2027-03-06' }), today)[0], /6 days/);
  assert.match(sanityWarnings(raw({ start_date: '2062-03-01', end_date: '2062-03-01' }), today)[0], /18 months/);
  assert.deepEqual(sanityWarnings(raw({ start_date: '2026-06-01', end_date: '2026-06-01' }), today), []); // past events are not "far off"
});

test('an event is known when the same date and name words are published or queued', () => {
  const event = raw();
  const state = (events = [], pending = []) => ({ events, pending });
  assert.equal(isKnown(event, state()), false);
  assert.equal(isKnown(event, state([{ id: 'evt-0001', ...event }])), true);
  assert.equal(isKnown(event, state([], [{ pid: 'q-0001', status: 'rejected', event }])), true); // rejected stays handled
  assert.equal(isKnown(event, state([{ id: 'evt-0001', ...event, name: 'A different name' }])), false);
});

const orgs = [
  { id: 'sifl', name: 'Sydney Intervarsity Fencing League', aliases: ['SIFL', 'Sydney Intervarsity Fencing'] },
  { id: 'aff', name: 'Australian Fencing Federation', aliases: ['AFF', 'AFC'] },
];

test('organiser names in a title are found and shortened to the organiser id', () => {
  assert.equal(shortenOrganisers('Sydney Intervarsity Fencing League - Round 6', orgs), 'sifl - Round 6'); // the longest name wins
  assert.equal(shortenOrganisers('SIFL #6', orgs), 'sifl #6');
  assert.equal(shortenOrganisers('AFC3 Pre-comp', orgs), 'AFC3 Pre-comp');                                // "AFC3" is not the word "AFC"
  assert.equal(shortenOrganisers('Anything', []), 'Anything');
  assert.deepEqual(organisersNamedIn('SIFL vs AFF friendly (SIFL)', orgs), ['sifl', 'aff']);
  assert.deepEqual(organisersNamedIn('Open Day', orgs), []);
  assert.deepEqual(organisersNamedIn('x', []), []);
});

test('a long organiser name and its short form count as a similar name', () => {
  const pool = [{ ref: 'evt-0001', event: raw({ name: 'SIFL #6', organiser: 'sifl', venue: undefined, url: undefined, weapons: ['foil'] }) }];
  const repost = raw({ name: 'Sydney Intervarsity Fencing League - Round 6', organiser: 'sifl', venue: undefined, url: undefined, weapons: ['saber'] });
  assert.deepEqual(findDuplicates(repost, pool), []);                                                        // without the organiser list the names share nothing
  assert.deepEqual(findDuplicates(repost, pool, orgs).map((m) => m.reason), ['similar name on the same date']);
  const nextDay = { ...repost, start_date: '2027-03-07', end_date: '2027-03-07' };                           // reposted a day out: still caught
  assert.deepEqual(findDuplicates({ ...nextDay, weapons: ['foil'] }, pool, orgs).map((m) => m.reason), ['similar name close by in time (was the date changed?)']);
});

test('links shared by many events (a club page) are not duplicate evidence', () => {
  const club = 'https://www.instagram.com/someclub/';
  const pool = [{ ref: 'evt-0001', event: raw({ url: club, start_date: '2027-01-01', end_date: '2027-01-01', venue: 'A', name: 'One' }) }];
  assert.deepEqual(findDuplicates(raw({ url: club, venue: 'B', name: 'Two' }), pool), []); // bare profile page

  const specific = 'https://example.com/events/spring';
  const two = [
    { ref: 'evt-0001', event: raw({ url: specific, venue: 'A', name: 'One' }) },
    { ref: 'evt-0002', event: raw({ url: specific, venue: 'B', name: 'Two', start_date: '2027-04-01', end_date: '2027-04-01' }) },
  ];
  assert.deepEqual(findDuplicates(raw({ url: specific, start_date: '2030-01-01', end_date: '2030-01-01', venue: 'C', name: 'Three' }), two), []); // link used twice
});

test('name similarity compares words, not punctuation', () => {
  assert.ok(similarNames('SIFL #6', 'SIFL 6'));
  assert.ok(similarNames('AFC #3', 'AFC #3 Foil'));
  assert.ok(!similarNames('SIFL #6', 'MQU Champs'));
  assert.ok(!similarNames('', 'MQU Champs'));
});

const partial = (over = {}) => {
  const { weapons, format, gender, level, ...rest } = raw(over);
  return rest;
};

test('scrapers may queue a draft with no categories; a person must complete it before approving', () => {
  const state = makeState();
  const { entry } = enqueue(state, partial(), { source: 'scraper' });
  assert.equal(entry.status, 'pending');
  assert.deepEqual(missingCategories(entry.event), ['weapons', 'format', 'gender', 'level']);
  assert.ok(flagsFor(state, entry)[0].startsWith('Not ready to approve: fill in weapons, format, gender, level'));

  const errors = problemsOf(() => approve(state, entry.pid));
  assert.ok(errors.some((e) => e.includes('weapons')));
  assert.equal(entry.status, 'pending');
  assert.equal(state.events.length, 0);

  updatePending(state, entry.pid, raw({ gender: [] }));   // half-finished edits can be saved...
  assert.deepEqual(missingCategories(entry.event), ['gender']);
  assert.ok(problemsOf(() => approve(state, entry.pid)));  // ...but not approved
  updatePending(state, entry.pid, raw());
  assert.equal(approve(state, entry.pid).id, 'evt-0001');
});

test('manual entries must be complete, and what a draft does contain is still checked', () => {
  const state = makeState();
  assert.ok(problemsOf(() => enqueue(state, partial()))); // manual: refused
  assert.ok(problemsOf(() => enqueue(state, raw({ weapons: [] }))).some((e) => e.includes('weapons')));
  assert.ok(problemsOf(() => enqueue(state, partial({ start_date: '2027-02-31' }), { source: 'scraper' })).some((e) => e.includes('start_date')));
  assert.ok(problemsOf(() => enqueue(state, raw({ weapons: ['sabre'] }), { source: 'scraper' })).some((e) => e.includes('weapons')));
  assert.equal(state.pending.length, 0);
});

test('a draft is compared on the categories it has; a draft with none is compared on dates and name only', () => {
  const existing = [{ ref: 'evt-0001', event: published('evt-0001') }];             // epee, individual, mens, open
  const draft = (over) => ({ ...partial({ name: 'Different Name', venue: 'Elsewhere' }), ...over });  // no categories, plus whatever `over` adds
  const clash = { start_date: '2027-03-06', end_date: '2027-03-06' };
  assert.deepEqual(findDuplicates(draft(clash), existing), []);                                                  // nothing filled in: no category evidence
  assert.equal(findDuplicates(draft({ ...clash, weapons: ['epee'] }), existing)[0].reason, 'same organiser, overlapping dates and categories');
  assert.deepEqual(findDuplicates(draft({ ...clash, weapons: ['foil'] }), existing), []);                         // a filled field that disagrees still rules it out
  assert.equal(findDuplicates(draft({ ...clash, weapons: ['epee'], level: ['open'] }), existing).length, 1);     // blank gender/format don't block
  assert.deepEqual(findDuplicates(draft({ ...clash, weapons: ['epee'], organiser: 'sifl' }), existing), []);      // another organiser
});

test('post entries keep their screenshot names until the decision, then forget them', () => {
  const state = makeState();
  const { entry } = enqueue(state, partial(), { source: 'post', screenshots: ['shot-0a0b0c0d-1.jpg', 'shot-0a0b0c0d-2.png'] });
  assert.deepEqual(entry.screenshots, ['shot-0a0b0c0d-1.jpg', 'shot-0a0b0c0d-2.png']);
  assert.deepEqual(dropScreenshots(state, entry.pid), ['shot-0a0b0c0d-1.jpg', 'shot-0a0b0c0d-2.png']);
  assert.ok(!('screenshots' in entry));
  assert.deepEqual(dropScreenshots(state, entry.pid), []);                       // nothing left to delete the second time
  assert.ok(!('screenshots' in enqueue(state, partial({ name: 'Another' }), { source: 'post' }).entry)); // no screenshots, no field
  assert.ok(problemsOf(() => enqueue(state, partial(), { source: 'carrier pigeon' })));
});
