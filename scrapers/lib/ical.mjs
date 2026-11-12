// ical.mjs: reading calendar files (.ics), the format sites like TidyHQ publish their events in.
//
// A calendar file is plain text: a list of BEGIN:VEVENT ... END:VEVENT blocks, each made of
// "NAME:value" lines. Two quirks:
//   - long lines are "folded": the next line starts with a space or tab, meaning "keep going"
//   - text has escapes: \n is a new line, and \, \; \\ are a comma, semicolon, backslash

import { isRealDate, todaySydney } from '../../docs/js/logic.js';

const unescapeText = (value) => value.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c)).trim();

/** A calendar file's text -> a list of events, each an object like { SUMMARY, DTSTART, DTEND, LOCATION, URL, ... }. */
export function parseIcal(text) {
  const unfolded = String(text ?? '').replace(/\r?\n[ \t]/g, '');
  return unfolded.split('BEGIN:VEVENT').slice(1).map((block) => {
    const props = {};
    for (const line of block.split('END:VEVENT')[0].split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon < 1) continue;
      const name = line.slice(0, colon).split(';')[0].toUpperCase(); // "URL;VALUE=URI" -> "URL"
      props[name] = unescapeText(line.slice(colon + 1));
    }
    return props;
  });
}

/**
 * A calendar time like "20261114T220000Z" (the Z means UTC) -> the date in Sydney, "2026-11-15".
 * The date can differ from the UTC date: 10pm UTC is 9am the next day in Sydney.
 * Returns null for anything else, so a format we haven't seen fails loudly instead of being guessed.
 */
export function sydneyDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value ?? '');
  if (!m || !isRealDate(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  return todaySydney(new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
}
