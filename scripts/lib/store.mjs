// store.mjs: the queue and everything that changes the data.
//
//   manual form ──┐
//                 ├──► enqueue() ──► data/pending.json ──► approve() ──► docs/data/events.json
//   scrapers ─────┘                   (the queue)
//
// The admin tool and the scrapers both call these same functions, so
// every event passes the same checks whichever way it arrives.
//
// Pattern: loadState() reads the data files, the functions below change the
// state in memory (throwing a Problem if something is wrong), and saveState()
// writes back only the files that changed.
//
// Entries in data/pending.json look like:
//   { pid: "q-0007", status: "pending" | "approved" | "rejected",
//     source: "manual" | "scraper" | "post", source_url, source_note, added,
//     screenshots: ["shot-1a2b3c4d-1.jpg"]   (only for "post" entries; files in data/screenshots/, removed on approve or reject)
//     event: { ...an event without an id... },
//     event_id: "evt-0042"   (only once approved) }
// Approved and rejected entries are kept so the same event isn't proposed twice.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, compileValidators, eventProblems, findDuplicates, fingerprint, missingCategories, organiserProblems, sanityWarnings } from './checks.mjs';
import { todaySydney } from '../../docs/js/logic.js';


const FIELD_ORDER = ['name', 'type', 'start_date', 'end_date', 'weapons', 'format', 'gender', 'level', 'venue', 'organiser', 'url', 'status', 'status_note'];
export const SOURCES = ['manual', 'scraper', 'post'];

/** An error the caller should show to a person: a list of plain sentences. */
export class Problem extends Error {
  constructor(errors, status = 400) {
    super(errors.join('; '));
    this.errors = errors;
    this.status = status;
  }
}

// ---------- files ----------

// The queue stays private in data/. Published files live in docs/data/, the only folder the website serves.
const dataFile = (root, name) => (name === 'pending.json' ? join(root, 'data', name) : join(root, 'docs', 'data', name));

function readList(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}

function writeJson(path, data) {
  const temp = `${path}.tmp`; // write beside the target, then swap, so a crash can't leave half a file
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temp, path);
}

export function loadState(root) {
  const schema = JSON.parse(readFileSync(join(root, 'schema', 'event.schema.json'), 'utf8'));
  return {
    root,
    events: readList(dataFile(root, 'events.json')),
    pending: readList(dataFile(root, 'pending.json')),
    organisers: readList(dataFile(root, 'organisers.json')),
    validators: compileValidators(schema),
    changed: new Set(), // which of 'events' / 'pending' / 'organisers' need writing
  };
}

export function saveState(state) {
  for (const name of state.changed) writeJson(dataFile(state.root, `${name}.json`), state[name]);
  state.changed.clear();
}

// ---------- helpers ----------

/** Trims text, fills a missing end_date from start_date, drops blank optional fields, and puts the fields in a tidy order. */
function normalise(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const e = {};
  for (const [k, v] of Object.entries(raw)) e[k] = typeof v === 'string' ? v.trim() : v;
  for (const k of ['venue', 'url', 'status', 'status_note']) if (e[k] === '') delete e[k];
  if (e.type === 'competition' || e.type === '') delete e.type; // a competition is the default, so published events don't carry it
  for (const k of CATEGORIES) if (Array.isArray(e[k]) && e[k].length === 0) delete e[k]; // nothing ticked = not filled in
  if (e.end_date === '' || e.end_date == null) e.end_date = e.start_date;
  const known = FIELD_ORDER.filter((k) => k in e);
  const extra = Object.keys(e).filter((k) => !FIELD_ORDER.includes(k)); // kept so validation can reject them
  return Object.fromEntries([...known, ...extra].map((k) => [k, e[k]]));
}

const nextNumber = (values, pattern) =>
  1 + Math.max(0, ...values.map((v) => Number(pattern.exec(v ?? '')?.[1] ?? 0)));

// Looks at events AND approved queue entries, so an id is never reused after a delete.
const nextEventId = (state) =>
  `evt-${String(nextNumber([...state.events.map((e) => e.id), ...state.pending.map((p) => p.event_id)], /^evt-(\d+)$/)).padStart(4, '0')}`;

const nextPid = (state) =>
  `q-${String(nextNumber(state.pending.map((p) => p.pid), /^q-(\d+)$/)).padStart(4, '0')}`;

function findEntry(state, pid) {
  const entry = state.pending.find((p) => p.pid === pid);
  if (!entry) throw new Problem([`No queue entry ${pid}`], 404);
  return entry;
}

function mustBe(entry, status) {
  if (entry.status !== status) throw new Problem([`${entry.pid} is ${entry.status}, not ${status}`], 409);
}

const touch = (state, ...names) => names.forEach((n) => state.changed.add(n));

// ---------- the queue ----------

/**
 * Adds a new event to the queue. `meta` = { source, source_url, source_note, screenshots }.
 * Throws a Problem if the event isn't valid. Scraper and post events may leave out weapons, format,
 * gender and level (see `draft` in checks.mjs); they can't be approved until a person adds them.
 * Manual events must be complete. Returns { entry }, or
 * { skipped } when a scraper offers something already known (published,
 * queued, approved or rejected), so nightly runs don't pile up repeats.
 * Manual entries are never skipped: a person meant to add it.
 */
export function enqueue(state, raw, meta = {}) {
  const source = meta.source ?? 'manual';
  if (!SOURCES.includes(source)) throw new Problem([`source must be one of: ${SOURCES.join(', ')}`]);

  const event = normalise(raw);
  const problems = eventProblems(event, source === 'manual' ? state.validators.candidate : state.validators.draft);
  if (problems.length) throw new Problem(problems);

  if (source !== 'manual') {
    const seen = fingerprint(event);
    const known = [...state.events.map((e) => [e.id, e]), ...state.pending.map((p) => [p.pid, p.event])]
      .find(([, other]) => fingerprint(other) === seen);
    if (known) return { skipped: `already known as ${known[0]}` };
  }

  const entry = {
    pid: nextPid(state),
    status: 'pending',
    source,
    source_url: meta.source_url ?? null,
    source_note: meta.source_note ?? null,
    ...(meta.screenshots?.length ? { screenshots: meta.screenshots } : {}),
    added: todaySydney(),
    event,
  };
  state.pending.push(entry);
  touch(state, 'pending');
  return { entry };
}

/** Replaces the details of a queued event (after fixing a typo, say). Half-finished is fine; approve() checks it's complete. */
export function updatePending(state, pid, raw) {
  const entry = findEntry(state, pid);
  mustBe(entry, 'pending');
  const event = normalise(raw);
  const problems = eventProblems(event, state.validators.draft);
  if (problems.length) throw new Problem(problems);
  entry.event = event;
  touch(state, 'pending');
  return entry;
}

/** Publishes a queued event: gives it the next permanent id and adds it to events.json. */
export function approve(state, pid) {
  const entry = findEntry(state, pid);
  mustBe(entry, 'pending');
  const problems = eventProblems(entry.event, state.validators.candidate);
  if (problems.length) throw new Problem(problems);

  const event = { id: nextEventId(state), ...entry.event };
  state.events.push(event);
  entry.status = 'approved';
  entry.event_id = event.id;
  touch(state, 'events', 'pending');
  return event;
}

export function reject(state, pid) {
  const entry = findEntry(state, pid);
  mustBe(entry, 'pending');
  entry.status = 'rejected';
  touch(state, 'pending');
  return entry;
}

/** Forgets an entry's screenshot filenames and returns them, so the caller can delete the files. */
export function dropScreenshots(state, pid) {
  const entry = findEntry(state, pid);
  const names = entry.screenshots ?? [];
  if (names.length) {
    delete entry.screenshots;
    touch(state, 'pending');
  }
  return names;
}

/** Undoes a rejection by putting the entry back in the queue. */
export function restore(state, pid) {
  const entry = findEntry(state, pid);
  mustBe(entry, 'rejected');
  entry.status = 'pending';
  touch(state, 'pending');
  return entry;
}

/** The "Save and approve" shortcut for manual entries: queue it and approve it in one go. */
export function addAndApprove(state, raw) {
  const { entry } = enqueue(state, raw, { source: 'manual' });
  const flags = flagsFor(state, entry); // taken before approving, so it can still warn about duplicates
  return { event: approve(state, entry.pid), flags };
}

// ---------- published events ----------

export function updateEvent(state, id, raw) {
  const index = state.events.findIndex((e) => e.id === id);
  if (index === -1) throw new Problem([`No event ${id}`], 404);
  const event = { id, ...normalise(raw) };
  const problems = eventProblems(event, state.validators.full);
  if (problems.length) throw new Problem(problems);
  state.events[index] = event;
  touch(state, 'events');
  return event;
}

export function deleteEvent(state, id) {
  const index = state.events.findIndex((e) => e.id === id);
  if (index === -1) throw new Problem([`No event ${id}`], 404);
  const [removed] = state.events.splice(index, 1);
  touch(state, 'events');
  return removed;
}

// ---------- organisers ----------

/** Tidy fields in a fixed order; aliases are trimmed with blanks and repeats dropped. */
function normaliseOrganiser(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const text = (v) => (typeof v === 'string' ? v.trim() : v);
  const aliases = Array.isArray(raw.aliases) ? [...new Set(raw.aliases.map(text).filter((a) => a !== ''))] : raw.aliases;
  return { id: text(raw.id), name: text(raw.name), image: text(raw.image), aliases };
}

/** Checks an organiser against the shared rules (and that its logo file exists), then stores it at `index`. */
function putOrganiser(state, index, raw) {
  const organiser = normaliseOrganiser(raw);
  const others = state.organisers.filter((_, i) => i !== index);
  const problems = organiserProblems(organiser, others);
  if (!problems.length && !existsSync(join(state.root, 'docs', organiser.image))) problems.push(`logo file ${organiser.image} does not exist`);
  if (problems.length) throw new Problem(problems);
  state.organisers[index === -1 ? state.organisers.length : index] = organiser;
  touch(state, 'organisers');
  return organiser;
}

export const addOrganiser = (state, raw) => putOrganiser(state, -1, raw);

/** Changes an organiser's name, logo or aliases. The id stays, because events refer to it. */
export function updateOrganiser(state, id, raw) {
  const index = state.organisers.findIndex((o) => o.id === id);
  if (index === -1) throw new Problem([`No organiser ${id}`], 404);
  return putOrganiser(state, index, { ...raw, id });
}

// ---------- warnings for the reviewer ----------

/** Things worth a second look before approving. Never blocks anything. */
export function flagsFor(state, entry) {
  const e = entry.event;
  const pool = [
    ...state.events.map((ev) => ({ ref: ev.id, event: ev })),
    ...state.pending.filter((p) => p.status === 'pending' && p.pid !== entry.pid).map((p) => ({ ref: p.pid, event: p.event })),
  ];
  const missing = missingCategories(e);
  const flags = missing.length ? [`Not ready to approve: fill in ${missing.join(', ')}`] : [];
  flags.push(...findDuplicates(e, pool, state.organisers).map((m) => `Possible duplicate of ${m.ref} "${m.name}" (${m.reason})`));
  if (!state.organisers.some((o) => o.id === e.organiser)) {
    flags.push(`Organiser "${e.organiser}" isn't in organisers.json yet, so the card will show the placeholder image`);
  }
  if (e.end_date < todaySydney()) flags.push('This event has already finished, so it would go straight to the archive');
  flags.push(...sanityWarnings(e, todaySydney()));
  return flags;
}

/** Everything the admin screen needs, in one object. */
export function view(state) {
  return {
    today: todaySydney(),
    choices: state.validators.choices,
    organisers: state.organisers,
    events: state.events,
    pending: state.pending.map((p) => (p.status === 'pending' ? { ...p, flags: flagsFor(state, p) } : p)),
  };
}
