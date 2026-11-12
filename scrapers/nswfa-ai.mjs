/**
 * NSWFA event pages, step 3 of the AI stage: put a page through the model. (Checking the answer
 * is lib/check-answer.mjs, shared with the pasted-post reader.)
 *
 * readEventPage(html, choices, ask) -> { answer, usage, text } or { problem }
 *   html     the downloaded event page
 *   choices  the allowed values (state.validators.choices)
 *   ask      the function that talks to the model; askModel by default, a stand-in in tests
 *   `answer` is the model's JSON exactly as it said it. It is NOT trusted yet.
 */
import { pageText } from './nswfa-page.mjs';
import { buildPrompt } from './nswfa-prompt.mjs';
import { askModel, extractJson, whyNotJson } from './lib/llm.mjs';

export async function readEventPage(html, choices, ask = askModel) {
  const text = pageText(html);
  if (!text) return { problem: "the page doesn't look like an NSWFA event page" };

  const { text: reply, usage, stopReason } = await ask(buildPrompt(text, choices));
  const answer = extractJson(reply);
  if (!answer) return { problem: whyNotJson(reply, stopReason) };
  return { answer, usage, text };
}
