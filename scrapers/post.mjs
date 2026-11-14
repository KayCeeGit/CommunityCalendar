/**
 * Pasted social posts, from screenshot to queue.
 *
 * The admin page sends the screenshots (and/or text) a person pasted from an Instagram or Facebook
 * post. Nothing here contacts Instagram or Facebook: a person did the looking and the copying.
 *
 *   readPost()    asks the model what the post says        (slow: a few seconds, needs no data files)
 *   queuePost()   checks the answer and queues the event   (instant: changes `state` in memory)
 *
 * They are separate because the admin server must load the queue AFTER the slow step, not before,
 * or a click on "Approve" during those seconds would be overwritten when this result is saved.
 */
import { isRealDate, todaySydney } from '../docs/js/logic.js';
import { enqueue, flagsFor, Problem } from '../scripts/lib/store.mjs';
import { askModel, extractJson, whyNotJson } from './lib/llm.mjs';
import { checkAnswer, quoteOnPage, setAside } from './lib/check-answer.mjs';
import { buildPostPrompt } from './post-prompt.mjs';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** A note if the post says "Sunday" but the date the model chose is not a Sunday (a likely wrong year). */
function weekdayNote(date, quote) {
  const said = WEEKDAYS.find((day) => new RegExp(`\\b${day}\\b`, 'i').test(quote ?? ''));
  const actual = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return said && said !== actual ? `start_date: check the year, the post says ${said} but ${date} is a ${actual}` : null;
}

/**
 * input = { text, images: [{ mediaType, data }], organiser: "sifl" }.
 * Returns { answer, source } where `source` is everything the model's quotes can be checked against.
 * Throws a Problem (status 502) if the model can't be reached or doesn't answer with JSON.
 */
export async function readPost(state, input, ask = askModel, today = todaySydney()) {
  const organiser = state.organisers.find((o) => o.id === input.organiser);
  if (!organiser) throw new Problem(['Choose the organiser first']);
  const text = String(input.text ?? '');
  const images = input.images ?? [];
  if (!text.trim() && !images.length) throw new Problem(['Paste a screenshot or some text first']);

  const knownVenues = [...new Set(state.events.map((e) => e.venue).filter(Boolean))].slice(0, 60); // so a bare "Sydney Academy of Fencing" is written the way the calendar already has it
  const prompt = buildPostPrompt({ text, organiserName: organiser.name, today, knownVenues }, state.validators.choices);
  let reply;
  try {
    reply = await ask({ ...prompt, images });
  } catch (err) {
    throw new Problem([`The AI step failed: ${err.message}`], 502);
  }
  const answer = extractJson(reply.text);
  if (!answer) throw new Problem([whyNotJson(reply.text, reply.stopReason)], 502);
  return { answer, source: `${answer.transcription ?? ''}\n${text}` };
}

/**
 * Turns the model's answer into a queued event.
 * Returns { entry, notes } when queued, or { message } when nothing was queued (not a competition, or
 * already known). Throws a Problem when the answer is missing something an event can't exist without.
 * `input.images[].name` are the filenames the caller will save the screenshots under.
 */
export function queuePost(state, input, { answer, source }) {
  const reason = String(answer.reason ?? '').trim().slice(0, 300);
  if (setAside(answer)) return { message: `The AI says this isn't an event to list: ${reason}` };

  const { fields, notes } = checkAnswer(answer, source, state.validators.choices);
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const event = { organiser: input.organiser, name: text(answer.name), ...fields };
  for (const key of ['start_date', 'end_date']) {
    const value = text(answer[key]);
    if (!value) continue;
    if (isRealDate(value)) event[key] = value;
    else notes.push(`${key}: ignored "${value}" (not a real date)`);
  }
  if (event.start_date && !quoteOnPage(answer.evidence?.start_date, source)) notes.push("start_date: check it, the AI's supporting quote isn't in the post");
  const weekday = event.start_date && weekdayNote(event.start_date, answer.evidence?.start_date);
  if (weekday) notes.push(weekday);
  if (input.url) event.url = input.url;

  let queued;
  try {
    queued = enqueue(state, event, {
      source: 'post',
      source_url: input.url || null,
      source_note: `Pasted post. AI note: ${reason || '(none)'}`,
      screenshots: (input.images ?? []).map((image) => image.name),
    });
  } catch (err) {
    if (!(err instanceof Problem)) throw err;
    throw new Problem([`Couldn't make an event from that post: ${err.errors.join('; ')}.${reason ? ` The AI said: ${reason}` : ''}`], 422);
  }
  if (queued.skipped) return { message: `Not queued: ${queued.skipped}` };
  return { entry: queued.entry, notes: [...notes, ...flagsFor(state, queued.entry)] };
}
