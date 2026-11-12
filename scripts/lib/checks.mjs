// checks.mjs: the rules for what a valid event is, and for spotting duplicates.
// Pure functions (no file access), shared by:
//   scripts/validate.mjs   checks the whole data folder
//   scripts/lib/store.mjs  checks events as they enter the queue or get edited
// so there is exactly one copy of each rule.

import Ajv from 'ajv';
import { isRealDate } from '../../docs/js/logic.js'; // the site needs this check too, so it lives there

/**
 * Turns schema/event.schema.json (already parsed) into three checkers:
 *   full       a published event (has an id)
 *   candidate  an event ready to approve: same rules, but NO id yet,
 *              because the id is only assigned when an event is approved
 *   draft      an event a scraper couldn't finish: like candidate, except weapons,
 *              format, gender and level may be missing (a person fills them in
 *              before approving). Anything that IS present must still be valid.
 * and the allowed values for the form's checkboxes, read from the schema.
 */
export const CATEGORIES = ['weapons', 'format', 'gender', 'level'];

export function compileValidators(schema) {
  const compile = (s) => new Ajv({ allErrors: true, strict: true }).compile(s);

  const candidate = structuredClone(schema);
  delete candidate.$id; // two schemas with one $id can't live in one Ajv
  delete candidate.properties.id;
  candidate.required = candidate.required.filter((k) => k !== 'id');

  const draft = structuredClone(candidate);
  delete draft.$id;
  draft.required = draft.required.filter((k) => !CATEGORIES.includes(k));

  const choices = Object.fromEntries(CATEGORIES.map((k) => [k, schema.properties[k].items.enum]));
  return { full: compile(schema), candidate: compile(candidate), draft: compile(draft), choices };
}

/** Turns one Ajv error into a plain-English sentence. */
function describe(err) {
  const field = err.instancePath ? err.instancePath.slice(1).replace(/\//g, '.') : 'event';
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
    case 'minItems':
    case 'minLength': return `${field} must not be empty`;
    case 'uniqueItems': return `${field} contains a repeated value`;
    case 'type': return `${field} must be ${err.params.type === 'object' ? 'an object' : `a ${err.params.type}`}`;
    default: return `${field} ${err.message}`;
  }
}

/**
 * Everything wrong with one event, as plain sentences ([] means it's fine).
 * `validate` is validators.full or validators.candidate.
 * Two layers: the schema (shape), then things a schema can't say (real dates).
 */
export function eventProblems(e, validate) {
  if (!validate(e)) return validate.errors.map(describe);
  const problems = [];
  if (!isRealDate(e.start_date)) problems.push(`start_date "${e.start_date}" is not a real date`);
  if (!isRealDate(e.end_date)) problems.push(`end_date "${e.end_date}" is not a real date`);
  if (isRealDate(e.start_date) && isRealDate(e.end_date) && e.end_date < e.start_date) {
    problems.push(`end_date ${e.end_date} is before start_date ${e.start_date}`);
  }
  return problems;
}

// ---------- duplicate detection ----------

const words = (s) => String(s ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

const sameText = (a, b) => {
  const x = words(a).join(' ');
  return x !== '' && x === words(b).join(' ');
};

// Do two lists share at least one choice? ['foil'] and ['epee','foil'] do.
// A list that is still empty (a draft a person hasn't finished) could be anything, so it counts as
// matching, but at least one category must be filled on both sides, or every blank draft would
// match every event from the same organiser.
const share = (a, b) => a.some((x) => b.includes(x));
const overlappingCategories = (a, b) => {
  const known = CATEGORIES.filter((k) => a[k]?.length && b[k]?.length);
  return known.length > 0 && CATEGORIES.every((k) => !(a[k]?.length && b[k]?.length) || share(a[k], b[k]));
};

/** Which of weapons / format / gender / level this event doesn't have yet. */
export const missingCategories = (e) => CATEGORIES.filter((k) => !e[k]?.length);

const dayNumber = (s) => Date.parse(`${s}T00:00:00Z`) / 86400000; // whole days since 1970
const datesOverlap = (a, b) => a.start_date <= b.end_date && b.start_date <= a.end_date; // ISO dates compare correctly as text
const NEARBY_DAYS = 60; // "same event, date changed" window
const nearbyDate = (a, b) => Math.abs(dayNumber(a.start_date) - dayNumber(b.start_date)) <= NEARBY_DAYS;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds organiser names in text. An organiser is named by its full name or any alias in organisers.json.
 * Longer names are tried first, so "Sydney Intervarsity Fencing League" wins over "Sydney Intervarsity Fencing".
 * Returns null when there are no organisers to look for.
 */
function organiserMatcher(organisers) {
  const idOf = new Map(); // lowercase name -> organiser id
  for (const o of organisers) for (const term of [o.name, ...(o.aliases ?? [])]) if (term) idOf.set(term.toLowerCase(), o.id);
  if (!idOf.size) return null;
  const names = [...idOf.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  return { idOf, regex: new RegExp(`(?<![a-z0-9])(?:${names})(?![a-z0-9])`, 'gi') };
}

/** The ids of the organisers named in a title, without repeats. */
export function organisersNamedIn(title, organisers) {
  const m = organiserMatcher(organisers);
  return m ? [...new Set([...String(title ?? '').matchAll(m.regex)].map((hit) => m.idOf.get(hit[0].toLowerCase())))] : [];
}

/**
 * Replaces organiser names in a title with the organiser's id, so a long name and its short form
 * read the same: "Sydney Intervarsity Fencing League - Round 6" and "SIFL #6" both start with "sifl".
 */
export function shortenOrganisers(title, organisers) {
  const m = organiserMatcher(organisers);
  return m ? String(title ?? '').replace(m.regex, (hit) => m.idOf.get(hit.toLowerCase())) : String(title ?? '');
}

/** "SIFL #6" and "SIFL 6" match; words are compared, not punctuation. */
export function similarNames(a, b) {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared) >= 0.6;
}

/**
 * A comparable form of an event's link, or null if the link isn't specific to
 * one event. A bare profile such as instagram.com/someclub/ is shared by every
 * event that club runs, so it says nothing about duplicates. Tracking
 * parameters (?utm_..., ?acontext=...) are ignored.
 */
function specificLink(url) {
  try {
    const u = new URL(url);
    if (u.pathname.split('/').filter(Boolean).length < 2) return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|acontext$|ref$)/i.test(k)) u.searchParams.delete(k);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A short label for "this exact event": start date + the words of its name.
 * The queue uses it so a scraper that finds the same event every night
 * doesn't add it again.
 */
export const fingerprint = (e) => `${e.start_date}|${words(e.name).join(' ')}`;

/** Do we already hold this event (same fingerprint), published or queued in any state? `state` has .events and .pending. */
export function isKnown(event, state) {
  const seen = new Set([...state.events, ...state.pending.map((p) => p.event)].map(fingerprint));
  return seen.has(fingerprint(event));
}

/**
 * Which events in `pool` might be the same event as `event`?
 * pool is a list of { ref, event }. `organisers` (from organisers.json) lets names like
 * "Sydney Intervarsity Fencing League - Round 6" and "SIFL #6" count as similar.
 * Checked in this order, first hit wins:
 *   1. same link (only if the link is specific to ONE event in the pool)
 *   2. same start date and same venue
 *   3. same start date and a similar name
 *   4. same organiser, date ranges that overlap, and each of weapons, format, gender and level
 *      shares at least one choice
 *   5. same organiser, a similar name, overlapping categories and a start date within 60 days
 *      (a postponed event keeps its weapons; a series like "Club Champs" changes them each round)
 * Matches are hints for a human, not decisions.
 */
export function findDuplicates(event, pool, organisers = []) {
  const name = shortenOrganisers(event.name, organisers);
  const similar = (other) => similarNames(shortenOrganisers(other.name, organisers), name);
  const link = specificLink(event.url);
  const linkUses = link ? pool.filter((p) => specificLink(p.event.url) === link).length : 0;
  const found = [];
  for (const { ref, event: other } of pool) {
    let reason = null;
    if (link && linkUses === 1 && specificLink(other.url) === link) reason = 'same link';
    else if (other.start_date === event.start_date && sameText(other.venue, event.venue)) reason = 'same date and venue';
    else if (other.start_date === event.start_date && similar(other)) reason = 'similar name on the same date';
    else if (other.organiser === event.organiser && datesOverlap(other, event) && overlappingCategories(other, event)) reason = 'same organiser, overlapping dates and categories';
    else if (other.organiser === event.organiser && similar(other) && nearbyDate(other, event) && overlappingCategories(other, event)) reason = 'similar name close by in time (was the date changed?)';
    if (reason) found.push({ ref, name: other.name, reason });
  }
  return found;
}

// ---------- sanity warnings (not duplicates, just "does this look like a typo?") ----------

const MAX_EVENT_DAYS = 5;
const MAX_DAYS_AHEAD = 548; // about 18 months

/** Plain-sentence warnings for an event that is valid but looks odd. `today` is YYYY-MM-DD. */
export function sanityWarnings(e, today) {
  const warnings = [];
  const days = dayNumber(e.end_date) - dayNumber(e.start_date) + 1;
  if (days > MAX_EVENT_DAYS) warnings.push(`Lasts ${days} days. Check the end date`);
  if (dayNumber(e.start_date) - dayNumber(today) > MAX_DAYS_AHEAD) warnings.push('Starts more than 18 months from now. Check the year');
  return warnings;
}
