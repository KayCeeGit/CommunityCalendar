// Tests for the model call (scrapers/lib/llm.mjs) and scrapers/nswfa-ai.mjs.
// The network is never touched: a stand-in plays the model, a stand-in plays fetch.
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileValidators } from '../scripts/lib/checks.mjs';
import { approve, flagsFor, Problem } from '../scripts/lib/store.mjs';
import { askModel, extractJson, whyNotJson, MODEL } from '../scrapers/lib/llm.mjs';
import { checkAnswer } from '../scrapers/lib/check-answer.mjs';
import { readEventPage } from '../scrapers/nswfa-ai.mjs';
import { parseIcal } from '../scrapers/lib/ical.mjs';
import { processNswfa } from '../scrapers/nswfa.mjs';

const schema = JSON.parse(readFileSync(new URL('../schema/event.schema.json', import.meta.url), 'utf8'));
const validators = compileValidators(schema);
const { choices } = validators;
const page = readFileSync(new URL('./fixtures/nswfa-page-sifl6.html', import.meta.url), 'utf8');

const problemsOf = (fn) => {
  try { fn(); } catch (err) { if (err instanceof Problem) return err.errors; throw err; }
  return null;
};

const reply = (text) => async () => ({ text, usage: { input_tokens: 900, output_tokens: 80 } });

test('the model\'s reply is read as JSON, even with fences or chatter around it', () => {
  assert.deepEqual(extractJson('{"a": 1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here it is: {"a": {"b": 2}} Hope that helps.'), { a: { b: 2 } });
  for (const bad of ['', 'no json here', '{broken', '[1, 2]', '{"a": 1} {"b": 2}']) assert.equal(extractJson(bad), null, bad);
});

test('a reply with real line breaks inside a quoted text is repaired, not rejected', () => {
  assert.deepEqual(extractJson('{"transcription": "SUNDAY 13/12\nEvents: Team Epee\n\tLocation", "n": 1}'), { transcription: 'SUNDAY 13/12\nEvents: Team Epee\n\tLocation', n: 1 });
  assert.deepEqual(extractJson('```json\n{"a": "x\r\ny", "b": "say \\"hi\\"\nthere"}\n```'), { a: 'x\ny', b: 'say "hi"\nthere' });
  assert.equal(extractJson('{"a": "unterminated\n'), null);
  assert.equal(extractJson('{"a": 1,}'), null); // other mistakes are still refused, not guessed at
});

test('the reason a reply was unusable is spelled out, with the start and end of it', () => {
  assert.match(whyNotJson('{"a": "cut', 'max_tokens'), /^The AI's reply wasn't JSON \(it was cut off for being too long\): \{"a": "cut$/);
  assert.match(whyNotJson('oops', 'end_turn'), /\(it is not valid JSON\): oops$/);
  const long = `START${'x'.repeat(2000)}END`;
  const shown = whyNotJson(long, 'end_turn');
  assert.ok(shown.includes('START') && shown.endsWith('END') && shown.includes(' ... ') && shown.length < 700);
});

test('a page goes through the model and the answer comes back unchanged', async () => {
  let sent;
  const ask = async (prompt) => { sent = prompt; return reply('{"type": "competition", "weapons": ["epee"]}')(); };
  const result = await readEventPage(page, choices, ask);
  assert.deepEqual(result.answer, { type: 'competition', weapons: ['epee'] });
  assert.deepEqual(result.usage, { input_tokens: 900, output_tokens: 80 });
  assert.match(sent.user, /<event_page>\nSydney Intervarsity Fencing League - Round 6/); // the model sees the cut-down page
  assert.match(sent.system, /"type"/);
});

test('problems are reported, not thrown or guessed at', async () => {
  assert.match((await readEventPage('<html></html>', choices, reply('{}'))).problem, /doesn't look like/);
  assert.match((await readEventPage(page, choices, reply('I cannot help with that.'))).problem, /wasn't JSON/);
});

test('askModel sends the right request and reads the reply', async () => {
  let call;
  const fetchImpl = async (url, options) => {
    call = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"ok": true}' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } }) };
  };
  const result = await askModel({ system: 'S', user: 'U' }, { apiKey: 'test-key', fetchImpl });
  assert.equal(result.text, '{"ok": true}');
  assert.equal(result.stopReason, 'end_turn');
  assert.deepEqual(result.usage, { input_tokens: 5, output_tokens: 3 });
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.options.headers['x-api-key'], 'test-key');
  assert.deepEqual([call.body.model, call.body.system, call.body.messages], [MODEL, 'S', [{ role: 'user', content: 'U' }]]);
  assert.ok(!('tools' in call.body)); // the model is given no tools
});

test('askModel sends screenshots as image blocks before the text', async () => {
  let body;
  const fetchImpl = async (url, options) => { body = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }] }) }; };
  await askModel({ system: 'S', user: 'U', images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] }, { apiKey: 'k', fetchImpl });
  assert.deepEqual(body.messages[0].content, [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }, { type: 'text', text: 'U' }]);
});

test('askModel fails clearly: no key, API errors, empty replies', async () => {
  await assert.rejects(askModel({ system: 'S', user: 'U' }, { apiKey: '' }), /ANTHROPIC_API_KEY/);
  const failing = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
  await assert.rejects(askModel({ system: 'S', user: 'U' }, { apiKey: 'k', fetchImpl: failing }), /401: invalid x-api-key/);
  const empty = async () => ({ ok: true, status: 200, json: async () => ({ content: [] }) });
  await assert.rejects(askModel({ system: 'S', user: 'U' }, { apiKey: 'k', fetchImpl: empty }), /no text/);
});

// ---------- checking the answer ----------

const preText = 'Male Epee Open\nFemale Foil Open\nMen\u2019s & Women\u2019s\nSydney Academy of Fencing\nBldg 2/190 Bourke Rd, Alexandria NSW 2015, Australia';

test('answers are kept only when the value is allowed and the quote is on the page', () => {
  const { fields, notes } = checkAnswer({
    weapons: ['epee', 'Sabre', 'laser'], format: ['team'], gender: ['mens', 'womens'], level: ['open'],
    venue: 'Sydney Academy of Fencing, Alexandria',
    evidence: { weapons: 'male  epee open', gender: "men's & women's", level: 'senior open', venue: 'Bldg 2/190 Bourke Rd, Alexandria NSW 2015, Australia' },
  }, preText, choices);
  assert.deepEqual(fields.weapons, ['epee', 'saber']);                 // "Sabre" is understood; "laser" is not a weapon here
  assert.deepEqual(fields.gender, ['mens', 'womens']);                 // curly apostrophes and spacing don't matter
  assert.equal(fields.venue, 'Sydney Academy of Fencing, Alexandria');
  assert.ok(!('level' in fields) && notes.some((n) => /^level: left blank/.test(n)));   // quote not on the page
  assert.ok(!('format' in fields) && notes.some((n) => /^format: left blank/.test(n))); // no quote at all
  assert.ok(notes.some((n) => n.includes('"laser"')));

  // nonsense yields nothing, not an error
  assert.deepEqual(checkAnswer({}, preText, choices), { fields: {}, notes: [] });
  assert.deepEqual(checkAnswer({ weapons: 'epee', venue: 42, evidence: 'x' }, preText, choices), { fields: {}, notes: [] });
});

// ---------- the whole run ----------

const calendar = parseIcal(readFileSync(new URL('./fixtures/nswfa-events.ics', import.meta.url), 'utf8'));
const pageFor = (url) => {
  if (url.includes('pre-afc3')) return readFileSync(new URL('./fixtures/nswfa-page-pre-afc3.html', import.meta.url), 'utf8');
  if (url.includes('sydney-intervarsity')) return page;
  return '<h1>Join Us</h1><h2>About this event</h2><p>A nine day camp.</p><h2>Share this event</h2>';
};
const answers = (prompt) => {
  const body = prompt.user;
  const json = body.includes('PRE AFC3')
    ? { type: 'competition', reason: 'State points event.', weapons: ['epee', 'foil', 'saber'], format: [], gender: ['mens', 'womens'], level: ['open'], venue: 'Sydney Academy of Fencing, Alexandria',
        evidence: { weapons: 'Male Epee Open', gender: 'Men\u2019s & Women\u2019s', level: 'Senior / Open', venue: 'Bldg 2/190 Bourke Rd, Alexandria NSW 2015, Australia' } }
    : body.includes('Intervarsity')
      ? { type: 'competition', reason: 'League round.', weapons: ['epee', 'saber'], format: ['individual', 'team'], gender: [], level: ['novice'], venue: '',
          evidence: { weapons: 'novice sabre and epee competitions', format: 'individual, team', level: 'novice' } }
      : { type: 'other', reason: 'A camp, not a competition.' };
  return Promise.resolve({ text: JSON.stringify(json), usage: {} });
};
const orgs = [{ id: 'nswfa', name: 'NSWFA', aliases: ['NSWFA'] }, { id: 'sifl', name: 'Sydney Intervarsity Fencing League', aliases: ['SIFL'] }];
const freshState = (events = [], pending = []) => ({ events, pending, validators, changed: new Set(), organisers: orgs });
const run = (state, over = {}) => processNswfa(calendar, state, { getPage: async (u) => pageFor(u), ask: answers, pause: async () => {}, today: '2026-11-09', ...over });

test('a run queues competitions (complete or draft), sets aside the camp and ignores finished events', async () => {
  const state = freshState();
  const results = await run(state);
  assert.deepEqual(results.map((r) => r.outcome), ['queued', 'queued', 'set-aside', 'past']);  // calendar order: PRE AFC3, SIFL, camp, 2024
  assert.equal(state.pending.length, 2);

  const [pre, sifl] = state.pending;
  assert.equal(pre.source, 'scraper');
  assert.equal(pre.source_url, 'https://nswfencing.org.au/public/schedule/events/90805-pre-afc3-open-all-weapons');
  assert.match(pre.source_note, /NSWFA events calendar\. AI note: State points event\./);
  assert.deepEqual(pre.event.gender, ['mens', 'womens']);
  assert.equal(pre.event.venue, 'Sydney Academy of Fencing, Alexandria');
  assert.ok(!('format' in pre.event));                      // the AI left it blank, so a person fills it in
  assert.equal(sifl.event.organiser, 'sifl');
  assert.ok(!('gender' in sifl.event) && !('venue' in sifl.event));
  assert.ok(flagsFor(state, sifl)[0].startsWith('Not ready to approve'));
  assert.ok(problemsOf(() => approve(state, sifl.pid)));    // and it cannot be approved like that
  assert.match(results[2].notes[0], /camp/);
});

test('events we already hold are not fetched or asked about again', async () => {
  const state = freshState();
  await run(state);
  let fetched = 0;
  const again = await run(state, { getPage: async (u) => { fetched++; return pageFor(u); } });
  assert.deepEqual(again.map((r) => r.outcome), ['known', 'known', 'set-aside', 'past']);
  assert.equal(fetched, 1);        // only the camp, which is never recorded; it costs a fraction of a cent to re-check
  assert.equal(state.pending.length, 2);
});

test('a failure on one event does not stop the others', async () => {
  const state = freshState();
  const results = await run(state, { ask: async (p) => { if (p.user.includes('PRE AFC3')) throw new Error('the model API said 500'); return answers(p); } });
  assert.deepEqual(results.map((r) => r.outcome), ['needs-person', 'queued', 'set-aside', 'past']);
  assert.match(results[0].notes[0], /500/);
  const badReply = await run(freshState(), { ask: async () => ({ text: 'Sorry, no.', usage: {} }) });
  assert.match(badReply[0].notes[0], /wasn't JSON/);
});
