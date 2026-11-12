// Tests for adding and changing organisers: the shared rules (checks.mjs), the store functions
// and the logo upload (admin/logos.mjs). Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { organiserProblems } from '../scripts/lib/checks.mjs';
import { addOrganiser, updateOrganiser, loadState, saveState, Problem } from '../scripts/lib/store.mjs';
import { sifl, tempRoot } from './helpers.mjs';
import { decodeLogo, deleteLogo, listLogos, logoFile, saveLogo, MAX_LOGO_BYTES } from '../admin/logos.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const problems = (o, others = []) => organiserProblems(o, others).join(' | ');
const errorsOf = (fn) => { try { fn(); } catch (err) { if (err instanceof Problem) return err.errors.join(' | '); throw err; } return null; };

test('organiserProblems accepts a good entry and explains each bad one', () => {
  assert.equal(problems({ id: 'saf', name: 'SAF', image: 'img/saf.png', aliases: ['Sydney Academy'] }, [sifl]), '');
  assert.match(problems({ id: 'Bad Id', name: 'x', image: 'img/x.png', aliases: [] }), /id must be/);
  assert.match(problems({ id: 'sifl', name: 'x', image: 'img/x.png', aliases: [] }, [sifl]), /duplicate organiser id/);
  assert.match(problems({ id: 'a', name: '  ', image: 'img/x.png', aliases: [] }), /missing name/);
  assert.match(problems({ id: 'a', name: 'A', image: '../secret.png', aliases: [] }), /image must be a file in img/);
  assert.match(problems({ id: 'a', name: 'A', image: 'img/x.png', aliases: 'SAF' }), /aliases must be a list/);
  assert.match(problems({ id: 'a', name: 'A', image: 'img/x.png', aliases: ['sifl'] }, [sifl]), /also used by "sifl"/);
  assert.match(problems('nope'), /must be an object/);
});

test('addOrganiser tidies the entry, saves it and refuses a missing logo', () => {
  const root = tempRoot();
  const state = loadState(root);
  addOrganiser(state, { id: ' saf ', name: ' SAF ', image: 'img/other.png', aliases: [' SAF Club ', '', 'SAF Club'] });
  assert.deepEqual(state.organisers[1], { id: 'saf', name: 'SAF', image: 'img/other.png', aliases: ['SAF Club'] });
  saveState(state);
  assert.equal(JSON.parse(readFileSync(join(root, 'docs', 'data', 'organisers.json'), 'utf8')).length, 2);

  assert.match(errorsOf(() => addOrganiser(state, { id: 'new', name: 'New', image: 'img/missing.png', aliases: [] })), /does not exist/);
  assert.match(errorsOf(() => addOrganiser(state, { id: 'saf', name: 'Again', image: 'img/other.png', aliases: [] })), /duplicate organiser id/);
  assert.equal(state.organisers.length, 2);
});

test('updateOrganiser changes name, logo and aliases but never the id', () => {
  const state = loadState(tempRoot());
  updateOrganiser(state, 'sifl', { id: 'hacked', name: 'SIFL', image: 'img/other.png', aliases: ['S.I.F.L'] });
  assert.deepEqual(state.organisers[0], { id: 'sifl', name: 'SIFL', image: 'img/other.png', aliases: ['S.I.F.L'] });
  assert.match(errorsOf(() => updateOrganiser(state, 'nobody', sifl)), /No organiser/);
  // an organiser can keep its own name and aliases (they only clash with *other* organisers)
  assert.equal(errorsOf(() => updateOrganiser(state, 'sifl', { ...sifl, image: 'img/sifl.jpg' })), null);
});

test('logo uploads are checked by content, named after the id and never overwrite', () => {
  const root = tempRoot();
  const logo = decodeLogo({ data: PNG.toString('base64') }, 'saf');
  assert.equal(logo.name, 'saf.png');
  assert.equal(saveLogo(root, logo), 'img/saf.png');
  assert.ok(existsSync(join(root, 'docs', 'img', 'saf.png')));
  assert.match(errorsOf(() => saveLogo(root, logo)), /already exists/);
  deleteLogo(root, logo);
  assert.ok(!existsSync(join(root, 'docs', 'img', 'saf.png')));

  assert.match(errorsOf(() => decodeLogo({ data: Buffer.from('<svg onload=x>').toString('base64') }, 'a')), /isn't a PNG/);
  assert.match(errorsOf(() => decodeLogo({ data: '' }, 'a')), /empty or larger/);
  for (const id of ['../escaped', 'a/b', 'A', '', 'a.b']) assert.match(errorsOf(() => decodeLogo({ data: PNG.toString('base64') }, id)), /lowercase letters/, id); // the id becomes a filename
  assert.match(errorsOf(() => decodeLogo({ data: Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]).toString('base64') }, 'a')), /empty or larger/);
});

test('only real images in docs/img are listed and served', () => {
  const root = tempRoot();
  writeFileSync(join(root, 'docs', 'img', 'placeholder.svg'), '<svg/>');
  writeFileSync(join(root, 'docs', 'img', 'favicon.ico'), 'x');
  assert.deepEqual(listLogos(root), ['other.png', 'sifl.jpg']);
  assert.equal(logoFile(root, 'sifl.jpg').type, 'image/jpeg');
  for (const bad of ['../data/pending.json', 'placeholder.svg', 'favicon.ico', 'nope.png', '']) assert.equal(logoFile(root, bad), null, bad);
});
