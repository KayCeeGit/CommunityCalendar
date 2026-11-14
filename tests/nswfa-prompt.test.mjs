// Tests for scrapers/nswfa-prompt.mjs: the instructions given to the model. No model is called.
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileValidators } from '../scripts/lib/checks.mjs';
import { buildPrompt } from '../scrapers/nswfa-prompt.mjs';

const schema = JSON.parse(readFileSync(new URL('../schema/event.schema.json', import.meta.url), 'utf8'));
const { choices } = compileValidators(schema);

test('every allowed value in the schema appears in the instructions', () => {
  const { system } = buildPrompt('x', choices);
  for (const values of Object.values(choices)) for (const v of values) assert.ok(system.includes(v), v);
});

test('the page goes in the user message, fenced, and is not mixed into the instructions', () => {
  const { system, user } = buildPrompt('Cadet Foil Team', choices);
  assert.equal(user, '<event_page>\nCadet Foil Team\n</event_page>');
  assert.ok(!system.includes('Cadet Foil Team'));
});

test('the worked example is valid JSON that uses only allowed values', () => {
  const { system } = buildPrompt('x', choices);
  const example = JSON.parse(system.slice(system.indexOf('{"type": "competition"')).trim());
  for (const k of ['weapons', 'format', 'gender', 'level']) for (const v of example[k]) assert.ok(choices[k].includes(v), v);
});
