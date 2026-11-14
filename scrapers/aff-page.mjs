/**
 * Stage B (rules part) of the AFF scraper: read ONE AFF event page and work out the
 * weapons, format, gender and level, which the feed doesn't have.
 *
 * Every AFF event page has a "Tournament Schedule" block with one line per competition:
 *     Senior Men’s Sabre
 *     Club Women’s Epee Teams
 *     AYC Girl’s Foil
 * so we look at those lines only (the rest of the page, like the fees table, mentions
 * other levels that this event doesn't run). Each line is checked against the word tables
 * below. If ANY line can't be fully understood, we report that instead of guessing, and
 * the event is passed on to a person (later: to the AI).
 */
import { htmlToLines } from './lib/html.mjs';
import { getText } from './lib/http.mjs';

// ---------- the word tables: edit these when AFF uses a word we don't know ----------
// Each rule: [pattern to find in the lowercase line, value to record]

const WEAPONS = [[/\bfoil\b/, 'foil'], [/\bepee\b/, 'epee'], [/\bsab(?:re|er)\b/, 'saber']];
const GENDERS = [[/\b(?:men|man|boy)s?\b/, 'mens'], [/\b(?:women|woman|girl)s?\b/, 'womens']]; // "Men’s and Women’s" matches both
const LEVELS = [
  [/\bsenior\b/, 'open'],
  [/\bclub\b/, 'open'],
  [/\bveterans?\b/, 'veteran'],
  [/\bayc\b/, 'youth'], // Australian Youth Circuit
  [/\bcadet\b/, 'cadet'],
  [/\bjunior\b/, 'junior'],
];
const found = (line, table) => table.filter(([pattern]) => pattern.test(line)).map(([, value]) => value);
// The values we saw, listed in the order the table lists them, so results look the same every time.
const inTableOrder = (table, seen) => [...new Set(table.map(([, value]) => value))].filter((value) => seen.has(value));

/** The lines of text inside the "Tournament Schedule" block, or null if the page has none. */
export function scheduleLines(html) {
  const heading = String(html).match(/<h3[^>]*>\s*Tournament Schedule\s*<\/h3>/i);
  if (!heading) return null;
  const rest = html.slice(heading.index + heading[0].length);
  const end = rest.indexOf('</div>'); // the block ends at the first closing </div>
  return htmlToLines(end === -1 ? rest : rest.slice(0, end));
}

/** Plain version of a line for matching: lowercase, no accents, straight apostrophes. */
const simplify = (line) => line.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").toLowerCase();

/**
 * Reads the schedule of one page.
 * -> { details: { weapons, format, gender, level }, unread: [] }   every competition line was understood
 * -> { details, unread: ['...'] }                                    some lines mention a weapon but we couldn't fully read them
 * -> { problem }                                                     no schedule block, or no competitions in it
 */
export function readSchedule(html) {
  const lines = scheduleLines(html);
  if (lines === null) return { problem: 'the page has no "Tournament Schedule" block' };

  const seen = { weapons: new Set(), format: new Set(), gender: new Set(), level: new Set() };
  const unread = [];
  for (const line of lines) {
    const plain = simplify(line);
    const weapons = found(plain, WEAPONS);
    if (weapons.length === 0) continue; // times, equipment control, notices: not a competition

    const genders = found(plain, GENDERS);
    const levels = found(plain, LEVELS);
    if (genders.length === 0 || levels.length === 0) { unread.push(line); continue; } // looks like a competition but we can't read all of it

    weapons.forEach((v) => seen.weapons.add(v));
    genders.forEach((v) => seen.gender.add(v));
    levels.forEach((v) => seen.level.add(v));
    seen.format.add(/\bteams?\b/.test(plain) ? 'team' : 'individual');
  }

  const details = {
    weapons: inTableOrder(WEAPONS, seen.weapons),
    format: ['individual', 'team'].filter((v) => seen.format.has(v)),
    gender: inTableOrder(GENDERS, seen.gender),
    level: inTableOrder(LEVELS, seen.level),
  };
  if (details.weapons.length === 0 && unread.length === 0) return { problem: 'the schedule has no competitions we could recognise' };
  return { details, unread };
}

/**
 * Turns a partial event (from the feed) into a complete one by reading its page.
 * -> { event }                  complete, ready for the validator
 * -> { uncertain: [reasons] }   a person (or the AI) needs to look at it
 * `getPage` is passed in so tests can supply saved pages instead of using the network.
 */
export async function completeEvent(partial, getPage = getText) {
  if (!partial.url) return { uncertain: ['the event has no link to read'] };

  let html;
  try {
    html = await getPage(partial.url);
  } catch (err) {
    return { uncertain: [`couldn't fetch the page: ${err.message}`] };
  }

  const read = readSchedule(html);
  if (read.problem) return { uncertain: [read.problem] };
  if (read.unread.length) return { uncertain: read.unread.map((line) => `couldn't read this line: "${line}"`) };

  return { event: { ...partial, ...read.details } }; // enqueue() puts the fields in their usual order
}
