/**
 * Runs the scrapers for the admin page's "Scrapers" tab and keeps what they print, so the page can show it.
 *
 * Safety:
 *  - the page can only pick a scraper by id; the file that runs comes from the list below, never from the request
 *  - the scraper is started without a shell and with no arguments
 *  - one run at a time, and a run that takes longer than TIMEOUT_MS is stopped
 *  - the API key is passed on to the scraper like any other environment variable but is never sent to the page
 *    (the page is only told whether it is set)
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LINES = 2000; // the oldest lines are dropped after this many

export const SCRAPERS = {
  aff: { file: 'aff.mjs', label: 'AFF', about: 'Australian Fencing Federation events feed. No AI needed.', needsKey: false },
  nswfa: { file: 'nswfa.mjs', label: 'NSWFA', about: 'NSW Fencing Association calendar. Reads each event page with the AI.', needsKey: true },
};

/** `dir` is where the scraper files live; tests point it at harmless fakes. */
export function createRunner({ dir = join(here, '..', 'scrapers'), env = process.env } = {}) {
  let job = null; // the current or most recent run
  let child = null;
  let timer = null;

  const add = (stream, text) => {
    job.lines.push({ n: job.count++, stream, text });
    if (job.lines.length > MAX_LINES) job.lines.shift();
  };

  /** Child output arrives in chunks, not lines; hold back the unfinished line until its end arrives. */
  const collect = (stream, source) => {
    let partial = '';
    source.setEncoding('utf8');
    source.on('data', (chunk) => {
      const parts = (partial + chunk).split(/\r?\n/);
      partial = parts.pop();
      for (const text of parts) add(stream, text);
    });
    source.on('end', () => { if (partial) add(stream, partial); });
  };

  function start(id) {
    if (!Object.hasOwn(SCRAPERS, id)) return { error: 'Unknown scraper', status: 404 };
    if (job?.running) return { error: `The ${SCRAPERS[job.scraper].label} scraper is still running`, status: 409 };
    if (SCRAPERS[id].needsKey && !env.ANTHROPIC_API_KEY) {
      return { error: 'ANTHROPIC_API_KEY is not set. Set it in the terminal you start the admin from, then restart the admin.', status: 400 };
    }
    job = { scraper: id, running: true, startedAt: Date.now(), endedAt: null, exitCode: null, stopped: false, count: 0, lines: [] };
    const mine = job;
    child = spawn(process.execPath, [join(dir, SCRAPERS[id].file)], { env: { ...env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    collect('out', child.stdout);
    collect('err', child.stderr);
    timer = setTimeout(() => { add('err', 'Stopped: this took longer than 10 minutes.'); child?.kill(); }, TIMEOUT_MS);
    const finish = (exitCode) => {
      if (!mine.running) return;
      clearTimeout(timer);
      mine.running = false;
      mine.endedAt = Date.now();
      mine.exitCode = exitCode;
    };
    child.on('error', (err) => { add('err', `Could not start: ${err.message}`); finish(1); });
    // 'close' (not 'exit') fires after all output has been read
    child.on('close', (code) => finish(code ?? 1));
    return { ok: true };
  }

  function stop() {
    if (!job?.running) return { error: 'Nothing is running', status: 409 };
    job.stopped = true;
    add('err', 'Stopped by you.');
    child.kill();
    return { ok: true };
  }

  /** What the page shows. `since` = the number of the last line it already has, so only newer ones are sent. */
  function status(since = -1) {
    return {
      scrapers: Object.entries(SCRAPERS).map(([id, s]) => ({ id, label: s.label, about: s.about, needsKey: s.needsKey, ready: !s.needsKey || Boolean(env.ANTHROPIC_API_KEY) })),
      run: job && {
        scraper: job.scraper, running: job.running, startedAt: job.startedAt, endedAt: job.endedAt,
        exitCode: job.exitCode, stopped: job.stopped,
        lines: job.lines.filter((l) => l.n > since),
      },
    };
  }

  return { start, stop, status };
}
