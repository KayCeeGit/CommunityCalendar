// field-guide.mjs: the part of the model's instructions that is the same whatever it is reading
// (an NSWFA event page, a pasted social post): what counts as a competition, the allowed
// words for each field, and how to handle gender, level and venue. One copy, so the two
// prompts can't drift apart. The allowed words come from the schema via `choices`.

export function fieldGuide(choices) {
  const allowed = (field) => choices[field].join(', ');
  return `is_competition
  true for a fencing competition: a tournament, league round, championship, ranking event, friendly or practice tournament.
  false for anything else: camps, training or coaching sessions, open days, "come and try" sessions, meetings, social events.
  If you are unsure, answer true and say what you are unsure about in "reason". A person reviews every event, but an event wrongly set aside is never seen.
  When it is false, leave every other field empty.

Allowed values (use these exact words, lower case):
  weapons: ${allowed('weapons')}   ("sabre" is written "saber" here)
  format:  ${allowed('format')}   ("individual" is a single fencer, "team" is teams)
  gender:  ${allowed('gender')}   (male, men's, boys -> mens; female, women's, girls -> womens)
  level:   ${allowed('level')}   ("Senior" or "Open" -> open; "Under 14" or "U14" -> u14; and so on)

gender
  Use only explicit words: men's, women's, male, female, boys, girls, or "mixed" (which gives both).
  "Open to everyone" or "open to all fencers" says who may enter, not the gender, so it does not fill this field.
  In "Male Epee Open", "Open" is the level.

level
  Use a level only if the text names it. Never turn an age or a description into a level yourself.
  If the text names a level that is not in the allowed list (for example "U20" or "Junior"), leave it out and mention it in "reason".

venue
  The place name plus its suburb, short, like "Sydney Academy of Fencing, Alexandria". No street address, state or postcode.
  Take the suburb from an address given in the text, never from what you know about the place.
  If the text names several venues, or none, leave the venue empty.`;
}
