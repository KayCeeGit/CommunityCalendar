#!/usr/bin/env node
/**
 * Checks data/events.json and data/organisers.json before anything goes live.
 *
 *    npm run validate
 *
 * ERRORS stop the check (exit code 1, so GitHub shows a red cross).
 * WARNINGS are printed but don't fail it (exit code 0).
 *
 * Two kinds of checking happen here:
 *   1. Shape: Ajv (a standard JSON Schema library) checks every event against
 *      schema/event.schema.json: required fields, allowed values, date format.
 *   2. Meaning: things a schema can't express, such as duplicate ids, an end
 *      date before the start date, or a logo file that doesn't exist.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv from 'ajv';

const root = resolve(process.argv[2] ?? '.');
const errors = [];
const warnings = [];
const error = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

function readJson(relPath) {
  const file = join(root, relPath);
  if (!existsSync(file)) {
    error(relPath, 'file not found');
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    error(relPath, `is not valid JSON (${e.message})`);
    return null;
  }
}

/** True only for a date that really exists ("2026-02-31" is rejected). */
function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Turns one Ajv error into a plain-English sentence. */
function describe(err) {
  const field = err.instancePath ? err.instancePath.slice(1).replace(/\//g, '.') : '';
  switch (err.keyword) {
    case 'required': return `missing required field "${err.params.missingProperty}"`;
    case 'additionalProperties': return `unknown field "${err.params.additionalProperty}" (not in the schema)`;
    case 'enum': return `${field} must be one of: ${err.params.allowedValues.join(', ')}`;
    case 'pattern': {
      const hints = {
        id: 'must look like evt-0042',
        start_date: 'must be written YYYY-MM-DD, for example 2026-12-12',
        end_date: 'must be written YYYY-MM-DD, for example 2026-12-12',
        url: 'must be a web link starting with http:// or https://',
      };
      return `${field} ${hints[field] ?? 'has the wrong format'}`;
    }
    case 'minItems': return `${field} must not be empty`;
    case 'minLength': return `${field} must not be empty`;
    case 'uniqueItems': return `${field} contains a repeated value`;
    case 'type': return `${field} must be a ${err.params.type}`;
    default: return `${field} ${err.message}`;
  }
}

// ---------- organisers.json (maintained by hand, so checked in code, no schema) ----------
const organisers = readJson('data/organisers.json');
const organiserIds = new Set();
if (organisers !== null) {
  if (!Array.isArray(organisers)) {
    error('data/organisers.json', 'must be a list ([ ... ])');
  } else {
    const aliasOwner = new Map();
    organisers.forEach((o, i) => {
      const where = `organisers[${i}]${o?.id ? ` "${o.id}"` : ''}`;
      if (!o || typeof o !== 'object') return error(where, 'must be an object');
      if (typeof o.id !== 'string' || !/^[a-z0-9-]+$/.test(o.id)) error(where, 'id must be lowercase letters, numbers and hyphens');
      else if (organiserIds.has(o.id)) error(where, `duplicate organiser id "${o.id}"`);
      else organiserIds.add(o.id);
      if (typeof o.name !== 'string' || !o.name.trim()) error(where, 'missing name');
      if (typeof o.image !== 'string' || !/^img\/[\w\-. ]+$/.test(o.image)) error(where, 'image must be a file in img/ (e.g. "img/aff.jpg")');
      else if (!existsSync(join(root, o.image))) error(where, `logo file ${o.image} does not exist`);
      if (!Array.isArray(o.aliases)) error(where, 'aliases must be a list (can be empty)');
      else {
        for (const a of [o.name, ...o.aliases].filter((x) => typeof x === 'string')) {
          const key = a.trim().toLowerCase();
          if (aliasOwner.has(key) && aliasOwner.get(key) !== o.id) {
            error(where, `"${a}" is also used by "${aliasOwner.get(key)}". Scrapers couldn't tell them apart`);
          } else aliasOwner.set(key, o.id);
        }
      }
    });
  }
}

// ---------- events.json ----------
const events = readJson('data/events.json');
const schema = readJson('schema/event.schema.json');

if (events !== null && schema !== null) {
  if (!Array.isArray(events)) {
    error('data/events.json', 'must be a list ([ ... ])');
  } else {
    const validateShape = new Ajv({ allErrors: true, strict: true }).compile(schema);
    const seenIds = new Map();

    events.forEach((e, i) => {
      const label = `events[${i}]${e?.id ? ` ${e.id}` : ''}${e?.name ? ` "${e.name}"` : ''}`;

      // 1. Shape
      if (!validateShape(e)) {
        for (const err of validateShape.errors) error(label, describe(err));
        return; // the meaning checks below assume the basic shape is right
      }

      // 2. Meaning
      if (!isRealDate(e.start_date)) error(label, `start_date "${e.start_date}" is not a real date`);
      if (!isRealDate(e.end_date)) error(label, `end_date "${e.end_date}" is not a real date`);
      if (isRealDate(e.start_date) && isRealDate(e.end_date) && e.end_date < e.start_date) {
        error(label, `end_date ${e.end_date} is before start_date ${e.start_date}`);
      }
      if (seenIds.has(e.id)) error(label, `duplicate id (also used by events[${seenIds.get(e.id)}])`);
      else seenIds.set(e.id, i);

      if (organisers !== null && !organiserIds.has(e.organiser)) {
        warn(label, `organiser "${e.organiser}" is not in organisers.json, so it will show the placeholder image. Add the organiser and its logo`);
      }
    });

    // Possible duplicates: same start date and same venue
    const byDateVenue = new Map();
    events.forEach((e, i) => {
      if (!e || typeof e.venue !== 'string') return;
      const key = `${e.start_date}|${e.venue.trim().toLowerCase()}`;
      if (!byDateVenue.has(key)) byDateVenue.set(key, []);
      byDateVenue.get(key).push(e.id ?? `events[${i}]`);
    });
    for (const [key, ids] of byDateVenue) {
      if (ids.length > 1) {
        const [date, venue] = key.split('|');
        warn(ids.join(' + '), `possible duplicates (same date ${date} and venue "${venue}"). Fine if they are separate categories`);
      }
    }
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
console.log(`${warnings.length ? '\n' : ''}OK: ${count} events and ${organiserIds.size} organisers are valid${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.`);
