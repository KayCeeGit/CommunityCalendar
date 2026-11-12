// llm.mjs: asking a Claude model one question, and reading its JSON reply.
//
// This is the ONLY file that talks to the model. Everything else passes in a function with the
// same shape as askModel(), so tests use a stand-in that returns a canned answer and never
// touch the network or cost anything.
//
// The model gets text and returns text. It has no tools and cannot read or write any file:
// whatever it says is just data that the next step checks before anything is queued.

const API_URL = 'https://api.anthropic.com/v1/messages';
export const MODEL = 'claude-haiku-5-5'; // the small, cheap model: plenty for reading one event page

const imageBlock = ({ mediaType, data }) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });

/**
 * Sends { system, user, images } to the model. `images` is optional: a list of
 * { mediaType: 'image/jpeg', data: <base64> }, shown to the model before the text.
 * Returns { text, usage } (usage = token counts).
 * The key is read from the ANTHROPIC_API_KEY environment variable, never from a file,
 * so it can't end up on GitHub. `fetchImpl` is replaced in tests.
 */
export async function askModel({ system, user, images = [] }, { apiKey = process.env.ANTHROPIC_API_KEY, model = MODEL, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('no API key: set the ANTHROPIC_API_KEY environment variable first');

  const response = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: images.length ? [...images.map(imageBlock), { type: 'text', text: user }] : user }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`the model API said ${response.status}: ${body.error?.message ?? 'no details'}`);

  const text = (body.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('');
  if (!text) throw new Error('the model returned no text');
  return { text, usage: body.usage ?? {} };
}

/**
 * The model's reply -> a JSON object, or null if it isn't one.
 * We asked for JSON only, but models sometimes wrap it in ```json fences or add a sentence,
 * so this takes everything from the first { to the last }.
 */
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
