// field-guide.mjs: the part of the model's instructions that is the same whatever it is reading
// (an NSWFA event page, a pasted social post): the event type and status, the allowed
// words for each field, and how to handle gender, level and venue. One copy, so the two
// prompts can't drift apart. The allowed words come from the schema via `choices`.

export function fieldGuide(choices) {
  const allowed = (field) => choices[field].join(', ');
  return `type
  "competition": a fencing tournament, league round, championship, ranking event, friendly or practice tournament.
  "other": a fencing event that is not a competition: training camps (squad camp, holiday camp, intensive), coaching or training sessions, clinics, workshops, courses, open days, "come and try" sessions, meetings, social events, fundraisers.
  "none": not an event to list: results or recaps of past events, or nothing to do with fencing.
  If you are unsure, pick "competition" or "other" and say what you are unsure about in "reason". A person reviews every event, but an event wrongly set aside is never seen.
  When it is "none", leave every other field empty.
  Weapons, format, gender and level are optional for an "other" event: fill them in only if the text states them.

status
  "postponed" or "cancelled" if the text says the event itself is postponed or cancelled, otherwise empty (""). Fill it only with an "evidence" quote.
  Only the event being described counts; a different event or a general notice does not.

Allowed values (use these exact words, lower case):
  type:    ${allowed('type')}, none
  status:  ${allowed('status')}
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
  If the text names a level that is not in the allowed list (for example "U20"), leave it out and mention it in "reason".

venue
  The place name plus its suburb, short, like "Sydney Academy of Fencing, Alexandria". No street address, state or postcode.
  Take the suburb from an address given in the text, never from what you know about the place.
  If the text gives only the place's name ("Location: Sydney Academy of Fencing"), report just the name; a person can add the suburb.
  If the text names several venues, or none, leave the venue empty. "TBA" and "online" count as none.

Reply format
  The reply must be valid JSON: write a line break inside a string as \\n, and escape any double quote inside a string.
  Keep "reason" to one sentence of under 25 words.
  A quote in "evidence" is a short piece copied exactly from a single line of the text: no "..." and no joining of lines.`;
}
