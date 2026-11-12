// check-answer.mjs: deciding how much of a model's answer to believe.
//
// Used by every scraper that asks a model to read something (NSWFA pages, pasted posts).
// Nothing the model says goes further unless:
//   - its value is one of the schema's allowed words, and
//   - the quote it gave as evidence really appears in the text it was given.
// Anything that fails is left blank, which the queue treats as "a person fills this in".
import { CATEGORIES } from '../../scripts/lib/checks.mjs';

// Lower case, straight quotes and dashes, single spaces: so "Men\u2019s  &\nWomen\u2019s" matches "men's & women's".
const plain = (s) => String(s).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();

/** Is this quote really in the text? (Ignoring case, spacing, curly vs straight quotes and dashes.) */
export function quoteOnPage(quote, text) {
  return typeof quote === 'string' && quote.trim() !== '' && plain(text).includes(plain(quote));
}

/** True when the model says the text isn't an event to list (type "none"). Anything unclear counts as a competition. */
export const setAside = (answer) => String(answer.type).trim().toLowerCase() === 'none';

/**
 * answer = the model's JSON; text = what it was shown; choices = the allowed values.
 * Returns { fields, notes }: `fields` holds only what survived, ready to merge into an event,
 * and `notes` says in plain words what was thrown away and why.
 */
export function checkAnswer(answer, text, choices) {
  const notes = [];
  const fields = {};
  const supported = (field) => quoteOnPage(answer.evidence?.[field], text);

  for (const field of CATEGORIES) {
    const given = (Array.isArray(answer[field]) ? answer[field] : [])
      .map((v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/^sabre$/, 'saber') : v));
    const good = [...new Set(given.filter((v) => choices[field].includes(v)))];
    const bad = given.filter((v) => !choices[field].includes(v));
    if (bad.length) notes.push(`${field}: ignored ${bad.map((v) => `"${v}"`).join(', ')} (not an allowed value)`);
    if (!good.length) continue;
    if (!supported(field)) { notes.push(`${field}: left blank, the AI's supporting quote isn't in the text (it said ${good.join(', ')})`); continue; }
    fields[field] = good;
  }

  // A competition is the default, so only "camp" and "other" are recorded.
  const type = String(answer.type).trim().toLowerCase();
  if (type !== 'competition' && choices.type.includes(type)) fields.type = type;

  const status = String(answer.status ?? '').trim().toLowerCase();
  if (status) {
    if (!choices.status.includes(status)) notes.push(`status: ignored "${status}" (not an allowed value)`);
    else if (!supported('status')) notes.push(`status: left blank, the AI's supporting quote isn't in the text (it said ${status})`);
    else fields.status = status;
  }

  const venue = typeof answer.venue === 'string' ? answer.venue.trim() : '';
  if (venue) {
    if (supported('venue')) fields.venue = venue;
    else notes.push(`venue: left blank, the AI's supporting quote isn't in the text (it said "${venue}")`);
  }
  return { fields, notes };
}
