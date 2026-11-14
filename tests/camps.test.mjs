// Tests for event types (competition / camp / other) and status (postponed / cancelled):
// the schema rules, the queue, the public card and filter, and what the AI's answer may set.
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileValidators, eventProblems, findDuplicates, missingCategories } from '../scripts/lib/checks.mjs';
import { enqueue, Problem } from '../scripts/lib/store.mjs';
import { checkAnswer, setAside } from '../scrapers/lib/check-answer.mjs';
import { queuePost, readPost } from '../scrapers/post.mjs';
import { filterEvents, isValidEvent, typeOf } from '../docs/js/logic.js';
import { cardHtml } from '../docs/js/render.js';

const schema = JSON.parse(readFileSync(new URL('../schema/event.schema.json', import.meta.url), 'utf8'));
const validators = compileValidators(schema);
const { choices } = validators;
const base = { name: 'Squad Camp', start_date: '2027-01-09', end_date: '2027-01-10', organiser: 'aff' };
const comp = { ...base, name: 'Cup', weapons: ['epee'], format: ['individual'], gender: ['mens'], level: ['open'] };
const state = () => ({ events: [], pending: [], validators, changed: new Set(), organisers: [{ id: 'aff', name: 'AFF' }, { id: 'sifl', name: 'SIFL' }] });
const problems = (e, v = validators.candidate) => eventProblems(e, v).join(' | ');

test('a camp or other event needs no weapons, format, gender or level; a competition still does', () => {
  assert.equal(problems({ ...base, type: 'camp' }), '');
  assert.equal(problems({ ...base, type: 'other', weapons: ['foil'] }), '');
  assert.match(problems(base), /missing required field "weapons"/);
  assert.match(problems({ ...base, type: 'competition' }), /missing required field "weapons"/);
  assert.match(problems({ ...base, type: 'tournament' }), /type must be one of/);
  assert.equal(problems({ ...base, type: 'camp', weapons: ['laser'] }), 'weapons.0 must be one of: foil, epee, saber');
});

test('a draft competition may still lack categories, but a bad type is refused', () => {
  assert.equal(problems(base, validators.draft), '');
  assert.match(problems({ ...base, type: 'x' }, validators.draft), /type must be one of/);
});

test('status is postponed or cancelled, and a notice needs a status', () => {
  assert.equal(problems({ ...comp, status: 'postponed', status_note: 'New date to be announced' }), '');
  assert.match(problems({ ...comp, status: 'moved' }), /status must be one of/);
  assert.match(problems({ ...comp, status_note: 'Hello' }), /status_note/);
  assert.match(problems({ ...comp, status: 'cancelled', status_note: 'x'.repeat(201) }), /status_note/);
});

test('missingCategories only applies to competitions', () => {
  assert.deepEqual(missingCategories({ ...base, weapons: ['foil'] }), ['format', 'gender', 'level']);
  assert.deepEqual(missingCategories({ ...base, type: 'camp' }), []);
});

test('the queue tidies type and status: a competition carries no type, blanks are dropped', () => {
  const s = state();
  const { entry } = enqueue(s, { ...comp, type: 'competition', status: '', status_note: '' });
  assert.deepEqual(Object.keys(entry.event), ['name', 'start_date', 'end_date', 'weapons', 'format', 'gender', 'level', 'venue', 'organiser', 'url'].filter((k) => k in entry.event));
  assert.ok(!('type' in entry.event) && !('status' in entry.event) && !('status_note' in entry.event));
  const camp = enqueue(s, { ...base, type: 'camp', weapons: [], status: 'postponed', status_note: ' TBA ' }).entry;
  assert.equal(camp.event.type, 'camp');
  assert.ok(!('weapons' in camp.event));
  assert.equal(camp.event.status_note, 'TBA');
});

test('the site accepts camps without categories and can filter by type', () => {
  const camp = { id: 'evt-0001', ...base, type: 'camp' };
  const cup = { id: 'evt-0002', ...comp };
  assert.ok(isValidEvent(camp));
  assert.equal(typeOf(cup), 'competition');
  assert.deepEqual(filterEvents([camp, cup], { type: 'camp' }), [camp]);
  assert.deepEqual(filterEvents([camp, cup], { type: 'competition' }), [cup]);
  assert.deepEqual(filterEvents([camp, cup], { weapon: 'epee' }), [cup]); // a camp with no weapons doesn't match a weapon filter
  assert.equal(filterEvents([camp, cup]).length, 2);
});

test('cards label camps and show postponed / cancelled notices; unknown values show nothing', () => {
  const camp = cardHtml({ id: 'evt-0001', ...base, type: 'camp' });
  assert.match(camp, /type-tag">Camp</);
  assert.ok(!camp.includes('status-notice'));
  assert.ok(!cardHtml({ id: 'evt-0002', ...comp }).includes('type-tag'));

  const off = cardHtml({ id: 'evt-0002', ...comp, status: 'cancelled', status_note: 'Venue <flooded>' });
  assert.match(off, /item-container is-cancelled/);
  assert.match(off, /status-notice">Cancelled: Venue &lt;flooded&gt;</);
  assert.match(cardHtml({ id: 'evt-0002', ...comp, status: 'postponed' }), /status-notice">Postponed</);

  const odd = cardHtml({ id: 'evt-0003', ...comp, type: '"><script>', status: '"><script>' });
  assert.ok(!odd.includes('<script>') && !odd.includes('is-'));
});

test('the AI may set camp / other and a supported status; "none" is set aside', () => {
  const text = 'Squad camp 9 Jan. The camp is POSTPONED until further notice.';
  const ok = checkAnswer({ type: 'camp', status: 'postponed', evidence: { status: 'is POSTPONED' } }, text, choices);
  assert.deepEqual(ok.fields, { type: 'camp', status: 'postponed' });
  assert.deepEqual(checkAnswer({ type: 'competition' }, text, choices).fields, {});
  assert.ok(!('type' in checkAnswer({ type: 'bogus' }, text, choices).fields));

  const unsupported = checkAnswer({ status: 'cancelled', evidence: { status: 'is cancelled' } }, text, choices);
  assert.deepEqual(unsupported.fields, {});
  assert.match(unsupported.notes.join(), /status: left blank/);
  assert.match(checkAnswer({ status: 'moved' }, text, choices).notes.join(), /status: ignored "moved"/);

  assert.ok(setAside({ type: 'none' }) && setAside({ type: ' None ' }));
  assert.ok(!setAside({ type: 'camp' }) && !setAside({ type: 'other' }) && !setAside({}) && !setAside({ type: 'bogus' })); // unsure means keep it for a person
});

test('a pasted post about a camp is queued as a camp with its notice', async () => {
  const s = state();
  const answer = { type: 'camp', reason: 'A holiday camp.', name: 'Holiday Camp', start_date: '2027-01-09', end_date: '2027-01-10', status: 'postponed', evidence: { start_date: '9-10 Jan', status: 'postponed' }, };
  const input = { text: 'Holiday Camp 9-10 Jan postponed', organiser: 'sifl', url: '', images: [] };
  const read = await readPost(s, input, async () => ({ text: JSON.stringify(answer), usage: {} }), '2026-11-12');
  const { entry } = queuePost(s, input, read);
  assert.equal(entry.event.type, 'camp');
  assert.equal(entry.event.status, 'postponed');
  assert.ok(!entry.event.weapons);
  assert.ok(!(entry instanceof Problem));
});

test('two camps at the same venue on overlapping days are flagged, whoever runs them', () => {
  const camp = (over) => ({ name: 'Camp', start_date: '2027-04-10', end_date: '2027-04-11', organiser: 'sifl', type: 'camp', venue: 'Sydney Uni, Camperdown', ...over });
  const pool = [{ ref: 'evt-0001', event: camp({ name: 'Winter Squad Camp' }) }];
  const reasons = (over) => findDuplicates(camp({ name: 'Totally different', organiser: 'aff', ...over }), pool).map((m) => m.reason);
  const rule = ['camps at the same venue on overlapping days'];
  assert.deepEqual(reasons({}), ['same date and venue']);                                // the older rule gets there first
  assert.deepEqual(reasons({ start_date: '2027-04-11', end_date: '2027-04-12' }), rule);  // overlaps on the second day
  assert.deepEqual(reasons({ venue: 'sydney uni' }), rule);                              // a shorter way of writing the venue
  assert.deepEqual(reasons({ venue: 'Parramatta Park' }), []);                           // another venue
  assert.deepEqual(reasons({ venue: undefined }), []);                                   // no venue to compare
  assert.deepEqual(reasons({ start_date: '2027-04-12', end_date: '2027-04-12' }), []);   // the next day
  assert.deepEqual(reasons({ type: 'other', start_date: '2027-04-11', end_date: '2027-04-12' }), []);                                      // only camps are compared this way
});
