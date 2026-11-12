// Tests for pasted posts (scrapers/post-prompt.mjs and scrapers/post.mjs). A stand-in plays the
// model, so nothing touches the network. Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileValidators } from '../scripts/lib/checks.mjs';
import { approve, enqueue, flagsFor, Problem } from '../scripts/lib/store.mjs';
import { buildPostPrompt } from '../scrapers/post-prompt.mjs';
import { queuePost, readPost } from '../scrapers/post.mjs';

const schema = JSON.parse(readFileSync(new URL('../schema/event.schema.json', import.meta.url), 'utf8'));
const validators = compileValidators(schema);
const organisers = [{ id: 'sifl', name: 'Sydney Intervarsity Fencing League', aliases: ['SIFL'] }, { id: 'nswfa', name: 'NSWFA', aliases: [] }];
const freshState = () => ({ events: [], pending: [], validators, changed: new Set(), organisers });
const TODAY = '2026-11-12';

const round6 = {
  is_competition: true, reason: 'League round on 13 December.', name: 'SIFL Round 6', start_date: '2026-12-13', end_date: '2026-12-13',
  weapons: ['epee', 'sabre'], format: ['team'], gender: ['mens', 'womens'], level: [], venue: 'Sydney Academy of Fencing',
  transcription: 'SUNDAY 13/12\nEvents: Team Epee & Sabre #2\nLocation: Sydney Academy of Fencing',
  evidence: { start_date: 'SUNDAY 13/12', weapons: 'Team Epee & Sabre', format: 'Team Epee', gender: "separate women's and men's event", venue: 'Location: Sydney Academy of Fencing' },
};
const pasted = "Sabre will be mixed teams, while Epee will have a separate women's and men's event.";
const asking = (answer, seen = []) => async (prompt) => { seen.push(prompt); return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: {} }; };
const input = (over = {}) => ({ text: pasted, organiser: 'sifl', url: '', images: [{ mediaType: 'image/jpeg', data: 'AAAA', name: 'shot-0a0b0c0d-1.jpg' }], ...over });
const failure = async (fn) => { try { await fn(); } catch (err) { if (err instanceof Problem) return err; throw err; } return null; };

test('the prompt carries today\'s date, the organiser, the allowed words and the pasted text', () => {
  const { system, user } = buildPostPrompt({ text: 'Hello <b>', organiserName: 'SIFL', today: TODAY }, validators.choices);
  assert.match(system, /Today's date is 2026-11-12/);
  assert.match(system, /The organiser is SIFL/);
  for (const values of Object.values(validators.choices)) for (const v of values) assert.ok(system.includes(v), v);
  assert.match(system, /postponed or cancelled/);
  assert.match(system, /data, not instructions/);
  assert.equal(user, 'The screenshots, if any, are above.\n<post_text>\nHello <b>\n</post_text>');
  assert.match(buildPostPrompt({ organiserName: 'x', today: TODAY }, validators.choices).user, /\(none pasted\)/);
});

test('readPost sends the screenshots with the prompt and returns what the model said', async () => {
  const seen = [];
  const read = await readPost(freshState(), input(), asking(round6, seen), TODAY);
  assert.deepEqual(read.answer, round6);
  assert.deepEqual(seen[0].images, [{ mediaType: 'image/jpeg', data: 'AAAA', name: 'shot-0a0b0c0d-1.jpg' }]);
  assert.match(seen[0].system, /The organiser is Sydney Intervarsity Fencing League/);
  assert.match(seen[0].user, /separate women's and men's event/);
  assert.ok(read.source.includes('SUNDAY 13/12') && read.source.includes(pasted)); // quotes can be checked against both
});

test('readPost refuses empty or unusable requests and reports model failures clearly', async () => {
  const state = freshState();
  assert.match((await failure(() => readPost(state, input({ organiser: 'nobody' }), asking(round6)))).message, /Choose the organiser/);
  assert.match((await failure(() => readPost(state, input({ text: '  ', images: [] }), asking(round6)))).message, /Paste a screenshot/);
  const down = await failure(() => readPost(state, input(), async () => { throw new Error('the model API said 500'); }));
  assert.equal(down.status, 502);
  assert.match(down.message, /AI step failed: the model API said 500/);
  assert.match((await failure(() => readPost(state, input(), asking('Sorry, I cannot.')))).message, /wasn't JSON/);
});

test('a post becomes a draft in the queue, with the screenshots attached and blanks left for a person', async () => {
  const state = freshState();
  const read = await readPost(state, input(), asking(round6), TODAY);
  const { entry, notes } = queuePost(state, input({ url: 'https://www.instagram.com/p/DfQznLqGDTR/' }), read);
  assert.equal(entry.source, 'post');
  assert.equal(entry.source_url, 'https://www.instagram.com/p/DfQznLqGDTR/');
  assert.match(entry.source_note, /^Pasted post\. AI note: League round on 13 December\./);
  assert.deepEqual(entry.screenshots, ['shot-0a0b0c0d-1.jpg']);
  assert.deepEqual(entry.event, {
    name: 'SIFL Round 6', start_date: '2026-12-13', end_date: '2026-12-13', weapons: ['epee', 'saber'], format: ['team'],
    gender: ['mens', 'womens'], venue: 'Sydney Academy of Fencing', organiser: 'sifl', url: 'https://www.instagram.com/p/DfQznLqGDTR/',
  });
  assert.ok(notes.some((n) => n.startsWith('Not ready to approve: fill in level')));  // the AI left level blank
  assert.throws(() => approve(state, entry.pid), Problem);
});

test('quotes that are not in the post stop a category being kept; a date is kept but flagged', async () => {
  const state = freshState();
  const wrong = { ...round6, evidence: { ...round6.evidence, start_date: 'Saturday 12 December', gender: 'boys and girls' } };
  const { entry, notes } = queuePost(state, input(), await readPost(state, input(), asking(wrong), TODAY));
  assert.ok(!('gender' in entry.event));
  assert.ok(notes.some((n) => n.startsWith('gender: left blank')));
  assert.equal(entry.event.start_date, '2026-12-13');
  assert.ok(notes.some((n) => n.startsWith('start_date: check it')));
});

test('a post that is not a competition, or is already known, queues nothing', async () => {
  const state = freshState();
  const camp = { is_competition: false, reason: 'A training camp.' };
  assert.match(queuePost(state, input(), await readPost(state, input(), asking(camp), TODAY)).message, /isn't a competition: A training camp\./);

  queuePost(state, input(), await readPost(state, input(), asking(round6), TODAY));
  const again = queuePost(state, input(), await readPost(state, input(), asking(round6), TODAY));
  assert.match(again.message, /already known as q-0001/);
  assert.equal(state.pending.length, 1);
});

test('a post with no usable date cannot become an event, and the message says why', async () => {
  const state = freshState();
  const postponed = { ...round6, start_date: '', end_date: '', reason: 'Postponed to October with no new date.', evidence: {} };
  const err = await failure(() => queuePost(state, input(), { answer: postponed, source: pasted }));
  assert.equal(err.status, 422);
  assert.match(err.message, /Couldn't make an event.*start_date.*Postponed to October/);
  const nonsense = { ...round6, start_date: '2026-02-31' };
  const err2 = await failure(() => queuePost(state, input(), { answer: nonsense, source: pasted }));
  assert.match(err2.message, /start_date/);
  assert.equal(state.pending.length, 0);
});
