// Run with:  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todaySydney, isValidEvent, splitEvents, sortEvents, filterEvents, groupByMonth,
  yearsIn, monthLabel, formatDateRange,
} from '../js/logic.js';
import { cardHtml } from '../js/render.js';

const ev = (over = {}) => ({
  id: 'evt-0001', name: 'Test', start_date: '2026-12-12', end_date: '2026-12-12',
  weapons: ['epee'], format: ['individual'], gender: ['mens'], level: ['open'],
  venue: 'Somewhere', organiser: 'sifl', url: 'https://example.com', ...over,
});

test('today is taken in Sydney time, not the viewer\'s', () => {
  // 13:30 UTC on 5 Nov is already 00:30 on 6 Nov in Sydney (UTC+11)
  assert.equal(todaySydney(new Date('2026-11-05T13:30:00Z')), '2026-11-06');
  assert.equal(todaySydney(new Date('2026-11-05T12:30:00Z')), '2026-11-05');
});

test('a multi-day event stays upcoming until its last day is over', () => {
  const afc = ev({ start_date: '2026-11-20', end_date: '2026-11-22' });
  assert.equal(splitEvents([afc], '2026-11-21').upcoming.length, 1); // mid-event
  assert.equal(splitEvents([afc], '2026-11-22').upcoming.length, 1); // last day
  assert.equal(splitEvents([afc], '2026-11-23').past.length, 1);     // day after
});

test('sorting crosses year boundaries correctly', () => {
  const jan = ev({ name: 'Jan', start_date: '2027-01-10', end_date: '2027-01-10' });
  const dec = ev({ name: 'Dec', start_date: '2026-12-12', end_date: '2026-12-12' });
  assert.deepEqual(sortEvents([jan, dec]).map((e) => e.name), ['Dec', 'Jan']);
});

test('month grouping keeps Jan 2026 and Jan 2027 apart', () => {
  const list = sortEvents([
    ev({ start_date: '2026-12-12', end_date: '2026-12-12' }),
    ev({ start_date: '2027-01-10', end_date: '2027-01-10' }),
    ev({ start_date: '2027-01-24', end_date: '2027-01-24' }),
  ]);
  assert.deepEqual(groupByMonth(list).map((g) => [g.key, g.events.length]), [['2026-12', 1], ['2027-01', 2]]);
  assert.equal(monthLabel('2027-01'), 'January 2027');
  assert.equal(monthLabel('2027-01', false), 'January');
});

test('year dropdown lists each year once, newest first', () => {
  const list = [
    ev({ start_date: '2025-03-01', end_date: '2025-03-01' }),
    ev({ start_date: '2027-01-10', end_date: '2027-01-10' }),
    ev({ start_date: '2026-12-12', end_date: '2026-12-12' }),
    ev({ start_date: '2026-05-01', end_date: '2026-05-01' }),
  ];
  assert.deepEqual(yearsIn(list), ['2027', '2026', '2025']);
});

test('filters', () => {
  const a = ev({ weapons: ['epee', 'foil'], format: ['individual'] });                                  // Dec 2026
  const b = ev({ start_date: '2027-01-10', end_date: '2027-01-10', weapons: ['saber'], format: ['team'] }); // Jan 2027
  assert.equal(filterEvents([a, b], { weapon: 'epee' }).length, 1);
  assert.equal(filterEvents([a, b], { format: 'team' }).length, 1);
  assert.equal(filterEvents([a, b], { year: '2026' }).length, 1);
  assert.equal(filterEvents([a, b], { weapon: 'foil', format: 'team' }).length, 0);
  assert.equal(filterEvents([a, b], {}).length, 2);
});

test('month and year filters work independently and together', () => {
  const dec26 = ev({ start_date: '2026-12-12', end_date: '2026-12-12' });
  const jan26 = ev({ start_date: '2026-01-10', end_date: '2026-01-10' });
  const jan27 = ev({ start_date: '2027-01-10', end_date: '2027-01-10' });
  const all = [dec26, jan26, jan27];
  assert.equal(filterEvents(all, { month: '01' }).length, 2);                // any January
  assert.equal(filterEvents(all, { year: '2026' }).length, 2);               // anything in 2026
  assert.deepEqual(filterEvents(all, { month: '01', year: '2027' }), [jan27]); // January 2027 only
  assert.equal(filterEvents(all, { month: '12', year: '2027' }).length, 0);
});

test('date display matches the existing d/m style', () => {
  assert.equal(formatDateRange(ev()), '12/12');
  assert.equal(formatDateRange(ev({ start_date: '2026-09-11', end_date: '2026-09-13' })), '11-13/9');
  assert.equal(formatDateRange(ev({ start_date: '2026-09-30', end_date: '2026-10-02' })), '30/9 - 2/10');
});

test('bad events are rejected', () => {
  assert.ok(isValidEvent(ev()));
  assert.ok(!isValidEvent(ev({ start_date: '12/12' })));
  assert.ok(!isValidEvent(ev({ start_date: '2026-02-31', end_date: '2026-02-31' })));
  assert.ok(!isValidEvent(ev({ end_date: '2026-12-01' })));
  assert.ok(!isValidEvent(ev({ weapons: 'epee' })));
  assert.ok(!isValidEvent(ev({ gender: undefined })));
  assert.ok(!isValidEvent(ev({ venue: undefined })));
  assert.ok(!isValidEvent(ev({ name: '' })));
  assert.ok(!isValidEvent(null));
});

test('card output escapes text and blocks unsafe links and images', () => {
  const html = cardHtml(
    ev({ name: '<script>alert(1)</script> "Cup"', url: 'javascript:alert(1)', venue: '<img src=x onerror=alert(1)>' }),
    { name: 'Club', image: '../secret.png' },
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('secret.png'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('img/placeholder.svg')); // the unsafe logo path was replaced
});

test('card uses the organiser logo, or the placeholder when there is no organiser', () => {
  assert.ok(cardHtml(ev(), { name: 'SIFL', image: 'img/sifl.jpg' }).includes('src="img/sifl.jpg"'));
  assert.ok(cardHtml(ev(), undefined).includes('src="img/placeholder.svg"'));
});
