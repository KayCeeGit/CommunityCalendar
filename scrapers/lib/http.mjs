// http.mjs: polite fetching, shared by every scraper.
// Before fetching anything from a site, a scraper reads that site's robots.txt and
// stays away from paths it asks bots to avoid. Requests say who we are and time out.

// Sites can see this in their logs. It says who is asking and why.
const USER_AGENT = 'NSWFencingCalendarBot/1.0 (events calendar)';
const TIMEOUT_MS = 15000;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Does this robots.txt text allow bots to fetch `path`?
 * Only the "User-agent: *" group is read (the rules for all bots).
 * The longest matching rule wins; if an Allow and a Disallow tie, Allow wins.
 * Rules may use * (anything) and a trailing $ (end of path), as real robots.txt files do.
 */
export function robotsAllows(text, path) {
  const rules = [];
  let inStarGroup = false;
  let sawRule = false; // consecutive "User-agent" lines share one group; a rule line closes the list
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      if (sawRule) { inStarGroup = false; sawRule = false; }
      if (value === '*') inStarGroup = true;
    } else if (field === 'allow' || field === 'disallow') {
      sawRule = true;
      if (inStarGroup && value) rules.push({ allow: field === 'allow', pattern: value });
    }
  }

  const toRegex = (p) => new RegExp('^' + p.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
  let best = null;
  for (const rule of rules) {
    if (!toRegex(rule.pattern).test(path)) continue;
    const longer = !best || rule.pattern.length > best.pattern.length;
    const tieAllow = best && rule.pattern.length === best.pattern.length && rule.allow;
    if (longer || tieAllow) best = rule;
  }
  return best ? best.allow : true; // no matching rule means allowed
}

/** The site's robots.txt text, or null if it has none (404 = no restrictions). */
async function fetchRobots(origin) {
  const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${origin}/robots.txt answered ${res.status}, so we can't tell what is allowed`);
  return res.text();
}

/** GET a URL, but only if the site's robots.txt allows it. Returns the response text. */
async function getAllowed(url, accept) {
  const { origin, pathname } = new URL(url);
  const robots = await fetchRobots(origin);
  if (robots !== null && !robotsAllows(robots, pathname)) {
    throw new Error(`${origin}/robots.txt asks bots not to fetch ${pathname}`);
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

/** A page's text: HTML by default, or another type (like 'text/calendar') if we ask for it. */
export const getText = (url, accept = 'text/html') => getAllowed(url, accept);

/** A URL that returns JSON. */
export async function getJson(url) {
  const body = await getAllowed(url, 'application/json');
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${url} did not return JSON (it starts with "${body.slice(0, 40).replace(/\s+/g, ' ')}")`);
  }
}
