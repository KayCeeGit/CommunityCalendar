// Run with:  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todaySydney, isValidEvent, splitEvents, sortEvents, filterEvents, groupByMonth,
  monthOptions, monthLabel, formatDateRange,
} from '../js/logic.js';
import { cardHtml, safeLink, safeImage } from '../js/render.js';

const ev = (over = {}) => ({
  id: 'evt-1', name: 'Test', start_date: '2026-12-12', end_date: '2026-12-12',
  weapons: ['epee'], format: ['individual'], gender: ['mens'], level: ['open'],
  venue: 'Somewhere', url: 'https://example.com', image: 'img/sifl.jpg', ...over,
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
  assert.deepEqual(sortEvents([jan, dec], { newestFirst: true }).map((e) => e.name), ['Jan', 'Dec']);
});

test('month grouping and dropdown keep Jan 2026 and Jan 2027 apart', () => {
  const list = sortEvents([
    ev({ start_date: '2026-12-12', end_date: '2026-12-12' }),
    ev({ start_date: '2027-01-10', end_date: '2027-01-10' }),
    ev({ start_date: '2027-01-24', end_date: '2027-01-24' }),
  ]);
  assert.deepEqual(groupByMonth(list).map((g) => [g.key, g.events.length]), [['2026-12', 1], ['2027-01', 2]]);
  assert.deepEqual(monthOptions(list).map((o) => o.label), ['December 2026', 'January 2027']);
  assert.equal(monthLabel('2027-01', false), 'January');
});

test('filters', () => {
  const a = ev({ weapons: ['epee', 'foil'], format: ['individual'] });
  const b = ev({ start_date: '2027-01-10', end_date: '2027-01-10', weapons: ['saber'], format: ['team'] });
  assert.equal(filterEvents([a, b], { weapon: 'epee' }).length, 1);
  assert.equal(filterEvents([a, b], { format: 'team' }).length, 1);
  assert.equal(filterEvents([a, b], { month: '2027-01' }).length, 1);
  assert.equal(filterEvents([a, b], { year: '2026' }).length, 1);
  assert.equal(filterEvents([a, b], { weapon: 'foil', format: 'team' }).length, 0);
  assert.equal(filterEvents([a, b], {}).length, 2);
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
  assert.ok(!isValidEvent(ev({ name: '' })));
  assert.ok(!isValidEvent(null));
});

test('card output escapes text and blocks unsafe links and images', () => {
  const html = cardHtml(ev({
    name: '<script>alert(1)</script> "Cup"',
    url: 'javascript:alert(1)',
    image: '../secret.png',
    venue: '<img src=x onerror=alert(1)>',
  }));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('secret.png'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(safeLink('https://www.ausfencing.org/x'), 'https://www.ausfencing.org/x');
  assert.equal(safeImage('img/sifl.jpg'), 'img/sifl.jpg');
  assert.equal(safeImage('img\\sifl.jpg'), null);
});
