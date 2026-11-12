// html.mjs: turning scraped HTML into plain text we can search.
// No libraries: just a few text replacements, enough for the simple pages we read.

/** "&#8211;" -> "–", "&amp;" -> "&". Anything we don't recognise is left as it was. */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? whole;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return number > 0 && number < 0x110000 ? String.fromCodePoint(number) : whole;
  });
}

/**
 * HTML -> a list of text lines, one per visual line.
 * <br> and the end of a paragraph/row/heading start a new line; all other tags vanish.
 * Entities are decoded AFTER the tags are removed, so text like "&lt;b&gt;" stays as text.
 */
export function htmlToLines(html) {
  const text = String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|tr|div|li|h[1-6])>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
