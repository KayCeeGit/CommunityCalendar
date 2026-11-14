#!/usr/bin/env node
/**
 * Checks the data files before anything goes live:
 *   docs/data/events.json, docs/data/organisers.json, data/pending.json (the queue)
 *
 *   node scripts/validate.mjs [project-dir]      (also: npm run validate)
 *
 * ERRORS stop the check (exit code 1, so GitHub shows a red cross).
 * WARNINGS are printed but don't fail it (exit code 0).
 *
 * The rules themselves live in scripts/lib/checks.mjs, shared with the admin
 * tool, so a bad event is judged the same way everywhere. This file just runs
 * them over every entry and reports what it finds.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SOURCES } from './lib/store.mjs';
import { compileValidators, eventProblems, findDuplicates, organiserProblems, sanityWarnings } from './lib/checks.mjs';
import { todaySydney } from '../docs/js/logic.js';

const root = resolve(process.argv[2] ?? '.');
const errors = [];
const warnings = [];
const error = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

function readJson(relPath, { optional = false } = {}) {
  const file = join(root, relPath);
  if (!existsSync(file)) {
    if (!optional) error(relPath, 'file not found');
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    error(relPath, `is not valid JSON (${e.message})`);
    return null;
  }
}

// ---------- organisers.json (maintained by hand, so checked here, no schema) ----------
const organisers = readJson('docs/data/organisers.json');
const organiserIds = new Set();
if (organisers !== null) {
  if (!Array.isArray(organisers)) {
    error('docs/data/organisers.json', 'must be a list ([ ... ])');
  } else {
    organisers.forEach((o, i) => {
      const where = `organisers[${i}]${o?.id ? ` "${o.id}"` : ''}`;
      organiserProblems(o, organisers.slice(0, i)).forEach((m) => error(where, m));
      if (typeof o?.id === 'string') organiserIds.add(o.id);
      if (typeof o?.image === 'string' && /^img\/[\w\-. ]+$/.test(o.image) && !existsSync(join(root, 'docs', o.image))) error(where, `logo file ${o.image} does not exist`);
    });
  }
}

const schema = readJson('schema/event.schema.json');
const validators = schema ? compileValidators(schema) : null;

// ---------- events.json ----------
const events = readJson('docs/data/events.json');
if (events !== null && validators) {
  if (!Array.isArray(events)) {
    error('docs/data/events.json', 'must be a list ([ ... ])');
  } else {
    const seenIds = new Map();
    const validSoFar = []; // events that passed, for the duplicate check

    events.forEach((e, i) => {
      const label = `events[${i}]${e?.id ? ` ${e.id}` : ''}${e?.name ? ` "${e.name}"` : ''}`;
      const problems = eventProblems(e, validators.full);
      problems.forEach((p) => error(label, p));

      if (typeof e?.id === 'string') {
        if (seenIds.has(e.id)) error(label, `duplicate id (also used by events[${seenIds.get(e.id)}])`);
        else seenIds.set(e.id, i);
      }
      if (typeof e?.organiser === 'string' && organisers !== null && !organiserIds.has(e.organiser)) {
        warn(label, `organiser "${e.organiser}" is not in organisers.json, so it will show the placeholder image. Add the organiser and its logo`);
      }
      if (problems.length === 0) {
        for (const m of findDuplicates(e, validSoFar, Array.isArray(organisers) ? organisers : [])) {
          warn(`${m.ref} + ${e.id}`, `possible duplicates (${m.reason}). Fine if they are separate categories`);
        }
        for (const w of sanityWarnings(e, todaySydney())) warn(label, w);
        validSoFar.push({ ref: e.id, event: e });
      }
    });
  }
}

// ---------- pending.json (the queue; optional) ----------
const pending = readJson('data/pending.json', { optional: true });
let queued = 0;
if (pending !== null && validators) {
  if (!Array.isArray(pending)) {
    error('data/pending.json', 'must be a list ([ ... ])');
  } else {
    const seenPids = new Set();
    pending.forEach((p, i) => {
      const label = `pending[${i}]${p?.pid ? ` ${p.pid}` : ''}`;
      if (typeof p?.pid !== 'string' || !/^q-\d+$/.test(p.pid)) error(label, 'pid must look like q-0007');
      else if (seenPids.has(p.pid)) error(label, 'duplicate pid');
      else seenPids.add(p.pid);
      if (!['pending', 'approved', 'rejected'].includes(p?.status)) error(label, 'status must be pending, approved or rejected');
      if (!SOURCES.includes(p?.source)) error(label, `source must be one of: ${SOURCES.join(', ')}`);
      if (p?.status === 'pending') {
        queued += 1; // only live queue entries are checked; old ones are history. Drafts may lack categories: the admin flags those
        eventProblems(p.event, validators.draft).forEach((m) => error(`${label} "${p.event?.name ?? ''}"`, m));
      }
    });
  }
}

// ---------- report ----------
for (const w of warnings) console.log(`WARNING  ${w}`);
for (const e of errors) console.log(`ERROR    ${e}`);
const count = Array.isArray(events) ? events.length : 0;
if (errors.length) {
  console.log(`\nFailed: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`${warnings.length ? '\n' : ''}OK: ${count} events, ${organiserIds.size} organisers and ${queued} queued event${queued === 1 ? '' : 's'} are valid${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.`);
