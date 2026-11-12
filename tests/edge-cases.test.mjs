// Unusual-but-possible situations, one test each: dates around time changes and leap years, text that
// tries to break the page, odd shapes of data, and replies from the AI that are almost right.
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileValidators, findDuplicates, sanityWarnings } from '../scripts/lib/checks.mjs';
import { approve, enqueue } from '../scripts/lib/store.mjs';
import { filterEvents, isRealDate, isValidEvent, splitEvents, todaySydney } from '../docs/js/logic.js';
import { cardHtml } from '../docs/js/render.js';
import { parseIcal, sydneyDate } from '../scrapers/lib/ical.mjs';
import { extractJson } from '../scrapers/lib/llm.mjs';
import { checkAnswer } from '../scrapers/lib/check-answer.mjs';

const validators = compileValidators(JSON.parse(readFileSync(new URL('../schema/event.schema.json', import.meta.url), 'utf8')));
const { choices } = validators;
const state = (events = [], pending = []) => ({ events, pending, validators, changed: new Set(), organisers: [{ id: 'aff', name: 'AFF' }] });
const raw = (over = {}) => ({ name: 'Test Cup', start_date: '2027-03-06', end_date: '2027-03-06', weapons: ['epee'], format: ['individual'], gender: ['mens'], level: ['open'], organiser: 'aff', ...over });
const ev = (over = {}) => ({ id: 'evt-0001', ...raw(over) });

// ---------- dates and times ----------

test('Sydney time follows daylight saving: UTC+11 in summer, UTC+10 in winter, changing on the right night', () => {
  assert.equal(todaySydney(new Date('2026-07-01T13:59:00Z')), '2026-07-01'); // winter: midnight is 14:00 UTC
  assert.equal(todaySydney(new Date('2026-07-01T14:00:00Z')), '2026-07-02');
  assert.equal(todaySydney(new Date('2026-12-31T13:00:00Z')), '2027-01-01'); // summer: midnight is 13:00 UTC, so New Year arrives early
  // Daylight saving ends 5 Apr 2026 (3am -> 2am) and starts 4 Oct 2026 (2am -> 3am): the date must be right either side
  assert.equal(todaySydney(new Date('2026-04-04T12:59:00Z')), '2026-04-04'); // still +11
  assert.equal(todaySydney(new Date('2026-04-04T13:00:00Z')), '2026-04-05');
  assert.equal(todaySydney(new Date('2026-04-05T13:59:00Z')), '2026-04-05'); // now +10
  assert.equal(todaySydney(new Date('2026-04-05T14:00:00Z')), '2026-04-06');
  assert.equal(todaySydney(new Date('2026-10-03T13:59:00Z')), '2026-10-03'); // still +10
  assert.equal(todaySydney(new Date('2026-10-03T14:00:00Z')), '2026-10-04');
  assert.equal(todaySydney(new Date('2026-10-04T12:59:00Z')), '2026-10-04'); // now +11
  assert.equal(todaySydney(new Date('2026-10-04T13:00:00Z')), '2026-10-05');
});

test('calendar timestamps become the Sydney date, including across DST and a leap day', () => {
  assert.equal(sydneyDate('20260701T140000Z'), '2026-07-02');   // winter (+10)
  assert.equal(sydneyDate('20261231T130000Z'), '2027-01-01');   // summer (+11)
  assert.equal(sydneyDate('20280228T130000Z'), '2028-02-29');   // 2028 is a leap year
  assert.equal(sydneyDate('20270228T130000Z'), '2027-03-01');   // 2027 is not
  for (const odd of ['20261115', '20261115T090000', '20261315T090000Z', '20270229T000000Z', '', null, undefined]) assert.equal(sydneyDate(odd), null, String(odd));
});

test('leap days: only real ones are accepted, by the site and by the schema', () => {
  assert.ok(isRealDate('2028-02-29') && isRealDate('2000-02-29'));
  assert.ok(!isRealDate('2027-02-29') && !isRealDate('2100-02-29')); // 2100 is not a leap year
  assert.ok(!isRealDate('2026-04-31') && !isRealDate('2026-00-10') && !isRealDate('2026-13-01') && !isRealDate('2026-1-5'));
  assert.ok(!isValidEvent(ev({ start_date: '2027-02-29', end_date: '2027-02-29' })));
  assert.throws(() => enqueue(state(), raw({ start_date: '2027-02-29', end_date: '2027-02-29' })), /start_date/);
});

test('an event stays upcoming through its last day even if it crosses New Year', () => {
  const nye = ev({ start_date: '2026-12-30', end_date: '2027-01-02' });
  assert.equal(splitEvents([nye], '2027-01-02').upcoming.length, 1);
  assert.equal(splitEvents([nye], '2027-01-03').past.length, 1);
  assert.equal(filterEvents([nye], { year: '2026' }).length, 1); // filed under the year it starts
  assert.equal(filterEvents([nye], { year: '2027' }).length, 0);
});

test('the long-event warning allows a nine-day camp but not a nine-day competition', () => {
  const lasting = (n, over = {}) => ({ ...raw(over), start_date: '2027-03-01', end_date: `2027-03-${String(n).padStart(2, '0')}` });
  assert.equal(sanityWarnings(lasting(1), '2027-01-01').length, 0);
  assert.equal(sanityWarnings(lasting(5), '2027-01-01').length, 0);
  assert.match(sanityWarnings(lasting(9), '2027-01-01')[0], /Lasts 9 days/); // a competition: probably a typo
  assert.equal(sanityWarnings(lasting(9, { type: 'camp' }), '2027-01-01').length, 0);
  assert.match(sanityWarnings(lasting(20, { type: 'training' }), '2027-01-01')[0], /Lasts 20 days/); // even camps have a limit
});

// ---------- queue and ids ----------

test('ids keep counting past evt-9999 and never go backwards', () => {
  const s = state([ev({ id: 'evt-9999' }), ev({ id: 'evt-0003' })]);
  const { entry } = enqueue(s, raw({ name: 'Brand New Cup' }));
  assert.equal(approve(s, entry.pid).id, 'evt-10000');
});

test('unexpected fields in a submitted event are refused or dropped, never kept', () => {
  assert.throws(() => enqueue(state(), { ...raw(), extra: 'hello' }), /unknown field "extra"/);
  assert.throws(() => enqueue(state(), { ...raw(), ...JSON.parse('{"constructor": {"x": 1}}') }), /unknown field "constructor"/);
  const { entry } = enqueue(state(), { ...raw(), ...JSON.parse('{"__proto__": {"admin": true}}') }); // JSON.parse makes this a real key
  assert.equal(entry.event.admin, undefined);
  assert.equal({}.admin, undefined); // nothing was added to every object
  assert.throws(() => enqueue(state(), raw({ name: { $gt: '' } })), /name/); // an object where text belongs
  assert.throws(() => enqueue(state(), raw({ weapons: 'epee' })), /weapons/);  // text where a list belongs
});

test('names with accents, emoji or only punctuation are accepted as text and compared sensibly', () => {
  assert.doesNotThrow(() => enqueue(state(), raw({ name: 'Coupe de l’Épée 🤺' })));
  const pool = [{ ref: 'evt-0001', event: raw({ name: 'Coupe de l’Épée' }) }];
  assert.ok(findDuplicates(raw({ name: 'Coupe de l’Épée' }), pool).length); // same name, same day: a duplicate
  assert.throws(() => enqueue(state(), raw({ name: '   ' })), /name/);
});

test('a camp and a competition on the same days for one organiser are not called duplicates', () => {
  const { weapons, format, gender, level, ...camp } = raw({ name: 'Squad Camp', type: 'camp' });
  assert.deepEqual(findDuplicates(raw({ name: 'Open Cup' }), [{ ref: 'evt-0001', event: camp }]), []); // nothing to compare categories on
  assert.equal(findDuplicates(raw({ name: 'Open Cup', venue: 'Hall' }), [{ ref: 'evt-0001', event: { ...camp, venue: 'Hall' } }]).length, 1); // ...but the same venue on the same day still is
});

// ---------- text that tries to break the page ----------

test('cards never let data change the markup: odd links, odd logos, odd classes', () => {
  for (const url of ['//evil.example/x', 'javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>', 'ftp://x.example', 'https://a b', '', null, 42]) {
    assert.ok(!cardHtml(ev({ url })).includes('href='), String(url));
  }
  assert.match(cardHtml(ev({ url: 'HTTPS://Example.com/a?b=1&c="2"' })), /href="HTTPS:\/\/Example.com\/a\?b=1&amp;c=&quot;2&quot;"/); // allowed, and quotes escaped
  for (const image of ['img/../secret.png', 'img/a/b.png', '/etc/passwd', 'http://x.example/a.png', 'img/"onerror=x', 'img/a.png"><script>']) {
    const html = cardHtml(ev(), { name: 'Club', image });
    assert.ok(html.includes('img/placeholder.svg') && !html.includes('<script'), image);
  }
  // names that exist on every object must not turn into class names
  for (const status of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.ok(!cardHtml(ev({ status })).includes('is-'), status);
  assert.ok(!cardHtml(ev({ type: 'constructor' })).includes('type-tag'));
});

test('a card for an event with missing optional parts still draws', () => {
  const html = cardHtml({ id: 'evt-0001', name: 'Bare Camp', type: 'camp', start_date: '2027-01-01', end_date: '2027-01-01', organiser: 'zzz' });
  assert.match(html, /Bare Camp/);
  assert.ok(!html.includes('undefined'));
  assert.ok(!/<p class="info-(wep|format|gender)"><\/p>/.test(html)); // no empty lines where a camp has no weapons or gender
});

// ---------- calendar files ----------

test('calendar files: Windows line endings, folded lines, all-day dates and a time zone label', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Long \r\n title here\r\nDTSTART;VALUE=DATE:20261115\r\nDTEND;TZID=Australia/Sydney:20261116T090000\r\nLOCATION:Hall\\, Alexandria\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Second\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const [first, second] = parseIcal(ics);
  assert.equal(first.SUMMARY, 'Long title here');
  assert.equal(first.LOCATION, 'Hall, Alexandria');
  assert.equal(first.DTSTART, '20261115');                     // all-day: kept as written
  assert.equal(sydneyDate(first.DTSTART), null);               // ...and refused as a UTC time, not guessed at
  assert.equal(sydneyDate(first.DTEND), null);                 // a local time with a label isn't a UTC time either
  assert.equal(second.SUMMARY, 'Second');
  assert.deepEqual(parseIcal(''), []);
  assert.deepEqual(parseIcal(undefined), []);
  assert.deepEqual(parseIcal('BEGIN:VEVENT\r\nSUMMARY no colon here\r\nEND:VEVENT'), [{}]); // a broken line is skipped
});

// ---------- the AI's replies ----------

test('JSON in a reply: braces inside text are fine; braces in chatter before it are not guessed around', () => {
  assert.deepEqual(extractJson('{"venue": "Hall {Main}", "q": "say \\"hi\\" }"}'), { venue: 'Hall {Main}', q: 'say "hi" }' });
  assert.deepEqual(extractJson('```json\n{"a": {"b": [1, {"c": 2}]}}\n```\nDone.'), { a: { b: [1, { c: 2 }] } });
  assert.equal(extractJson('Here is {the answer}: {"a": 1}'), null);   // first { to last } isn't JSON: fail, don't guess
  assert.equal(extractJson('{"a": 1,}'), null);                          // trailing comma
  assert.equal(extractJson('{"a": undefined}'), null);
  assert.equal(extractJson('null'), null);
});

test('answers: repeated, mixed-case and oddly shaped values are tidied or ignored', () => {
  const text = 'EPEE and Foil, Open event. Men and Women.';
  const { fields } = checkAnswer({ weapons: ['Epee', 'epee', ' FOIL '], gender: ['Mens'], level: ['OPEN'], evidence: { weapons: 'epee and foil', gender: 'men and women', level: 'open' } }, text, choices);
  assert.deepEqual(fields.weapons, ['epee', 'foil']);         // each once, case and spacing ignored
  assert.deepEqual(fields.gender, ['mens']);
  assert.deepEqual(fields.level, ['open']);
  assert.deepEqual(checkAnswer({ weapons: [null, 5, {}], evidence: { weapons: 'epee' } }, text, choices).fields, {}); // wrong kinds of value
  assert.deepEqual(checkAnswer({ weapons: ['epee'], evidence: { weapons: '' } }, text, choices).fields, {});          // an empty quote proves nothing
});
