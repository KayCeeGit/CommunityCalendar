// Tests for scrapers/nswfa-page.mjs: cutting an NSWFA event page down to the text the AI will read.
// The fixtures are trimmed copies of two real saved pages (one paid with a ticket box, one free).
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageText } from '../scrapers/nswfa-page.mjs';

const page = (name) => pageText(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('a paid event keeps its title, date, venue, description, schedule and location', () => {
  const text = page('nswfa-page-pre-afc3.html');
  assert.match(text, /^PRE AFC3 - Open - All Weapons\n/);
  assert.match(text, /15 Nov 2026\n09:00 - 18:00/);
  assert.match(text, /Category: Senior \/ Open \(All Weapons – Men’s & Women’s\)/); // entities decoded
  assert.match(text, /Schedule\n9:00 am\nMale Epee Open/);
  assert.match(text, /Location\nSydney Academy of Fencing\nBldg 2\/190 Bourke Rd/);
});

test('the ticket box and page furniture are dropped', () => {
  const text = page('nswfa-page-pre-afc3.html');
  assert.doesNotMatch(text, /Tickets|Maximum number|Share this event|TidyHQ/);
});

test('a free event (no ticket box) still reads correctly', () => {
  const text = page('nswfa-page-sifl6.html');
  assert.match(text, /^Sydney Intervarsity Fencing League - Round 6\n/);
  assert.match(text, /13 Dec 2026\n10:00 - 17:00/);
  assert.match(text, /novice sabre and epee competitions/);
  assert.doesNotMatch(text, /<|function|iframe/); // scripts and map code are gone
});

test('a page that does not look like an event page gives null, not a guess', () => {
  assert.equal(pageText('<html><body><h1>Oops</h1></body></html>'), null);
  assert.equal(pageText(''), null);
});
