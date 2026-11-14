// Tests for the scraper runner (admin/runner.mjs) with stand-in scrapers, so nothing touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunner } from '../admin/runner.mjs';

const dir = new URL('./fixtures/fake-scrapers', import.meta.url).pathname;
const withKey = { ANTHROPIC_API_KEY: 'test-key' };
const waitUntilDone = async (runner) => { while (runner.status().run.running) await new Promise((r) => setTimeout(r, 50)); };

test('a run collects stdout and stderr line by line, including a last line with no newline', async () => {
  const runner = createRunner({ dir, env: {} });
  assert.deepEqual(runner.start('aff'), { ok: true });
  await waitUntilDone(runner);
  const { run } = runner.status();
  assert.equal(run.exitCode, 0);
  assert.deepEqual(run.lines.map((l) => [l.stream, l.text]), [['out', 'line one'], ['err', 'a warning'], ['out', 'line two (no newline at the end)']]);
});

test('"since" only returns lines the page does not have yet', async () => {
  const runner = createRunner({ dir, env: {} });
  runner.start('aff');
  await waitUntilDone(runner);
  assert.deepEqual(runner.status(0).run.lines.map((l) => l.n), [1, 2]);
  assert.deepEqual(runner.status(2).run.lines, []);
});

test('only known scrapers run, and only one at a time', async () => {
  const runner = createRunner({ dir, env: withKey });
  assert.equal(runner.start('../../etc/passwd').status, 404);
  assert.equal(runner.start('constructor').status, 404);
  assert.deepEqual(runner.start('nswfa'), { ok: true });
  assert.equal(runner.start('aff').status, 409);
  assert.deepEqual(runner.stop(), { ok: true });
  await waitUntilDone(runner);
  assert.equal(runner.status().run.stopped, true);
  assert.equal(runner.stop().status, 409); // nothing left to stop
});

test('the AI scraper will not start without an API key, and the key is never in the status', () => {
  const runner = createRunner({ dir, env: {} });
  assert.match(runner.start('nswfa').error, /ANTHROPIC_API_KEY/);
  assert.equal(runner.status().scrapers.find((s) => s.id === 'nswfa').ready, false);
  assert.equal(runner.status().scrapers.find((s) => s.id === 'aff').ready, true);
  assert.ok(!JSON.stringify(createRunner({ dir, env: withKey }).status()).includes('test-key'));
});
