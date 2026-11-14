// Tests for the admin server (admin/server.mjs) as a running program: who it listens to, what it
// refuses, and that it only hands out the files it should. It runs against a throwaway copy of the
// data, on a random port, and is stopped when the tests finish. Run with:  npm test
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { tempRoot } from './helpers.mjs';

const PORT = 4400 + Math.floor(Math.random() * 500);
const root = tempRoot();
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const event = { name: 'Test Cup', start_date: '2027-03-06', weapons: ['epee'], format: ['individual'], gender: ['mens'], level: ['open'], organiser: 'sifl' };
let server;

before(async () => {
  server = spawn(process.execPath, [new URL('../admin/server.mjs', import.meta.url).pathname, root], { env: { ...process.env, PORT: String(PORT), SCRAPER_DIR: new URL('./fixtures/fake-scrapers', import.meta.url).pathname } });
  await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('exit', () => reject(new Error('the admin server did not start')));
  });
});
after(() => server.kill());

/** One request, with full control of the headers (fetch won't let us fake Host). */
const call = (method, path, { headers = {}, body, host = `localhost:${PORT}` } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers: { Host: host, ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
    });
  });
  req.on('error', reject);
  req.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : body === undefined ? undefined : JSON.stringify(body));
});
const post = (path, body, headers = {}) => call('POST', path, { headers: { ...JSON_HEADERS, ...headers }, body });

test('only requests addressed to localhost or 127.0.0.1 on our port are answered (DNS-rebinding guard)', async () => {
  assert.equal((await call('GET', '/api/state')).status, 200);
  assert.equal((await call('GET', '/api/state', { host: `127.0.0.1:${PORT}` })).status, 200);
  for (const host of ['evil.example', `localhost:${PORT + 1}`, `localhost.evil.example:${PORT}`]) {
    assert.equal((await call('GET', '/api/state', { host })).status, 403, host);
  }
});

test('changes must be JSON from our own page: other content types and other origins are refused', async () => {
  const send = (headers) => call('POST', '/api/queue', { headers, body: { event } });
  assert.equal((await send({ 'Content-Type': 'text/plain' })).status, 403);   // what a cross-site <form> can send
  assert.equal((await send({})).status, 403);                                 // no content type at all
  assert.equal((await send({ ...JSON_HEADERS, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await send({ ...JSON_HEADERS, Origin: 'null' })).status, 403); // sandboxed pages send the text "null"
  assert.equal((await send({ ...JSON_HEADERS, Origin: `http://localhost:${PORT}` })).status, 201);
  assert.equal((await call('GET', '/api/state')).json().pending.length, 1);   // only the allowed one was queued
});

test('bad bodies get a plain error: invalid JSON, oversized, wrong shape', async () => {
  assert.match((await call('POST', '/api/queue', { headers: JSON_HEADERS, body: '{not json' })).json().errors[0], /not valid JSON/);
  assert.equal((await post('/api/queue', { event, padding: 'x'.repeat(100_001) })).status, 413);
  assert.equal((await post('/api/queue', {})).status, 400);       // no event at all
  assert.equal((await post('/api/queue', { event: 'Test Cup' })).status, 400);
});

test('unknown routes and methods are 404, and answers are never cached or sniffed', async () => {
  for (const [method, path] of [['GET', '/api/nothing'], ['GET', '/data/pending.json'], ['GET', '/../package.json'], ['DELETE', '/api/queue/q-0001'], ['PUT', '/api/organisers']]) {
    assert.equal((await call(method, path, { headers: JSON_HEADERS })).status, 404, `${method} ${path}`);
  }
  const res = await call('GET', '/api/state');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('only real logos and our own screenshot names are served; odd paths are 404, not a crash', async () => {
  assert.equal((await call('GET', '/api/logos/sifl.jpg')).status, 200);
  for (const path of ['/api/logos/..%2F..%2Fdata%2Fpending.json', '/api/logos/%2e%2e/schema/event.schema.json', '/api/logos/%E0%A4%A', '/api/logos/', '/api/logos/missing.png',
    '/api/screenshots/../../package.json', '/api/screenshots/shot-00000000-1.png', '/api/screenshots/%00']) {
    const { status } = await call('GET', path);
    assert.ok(status === 404 || status === 400, `${path} -> ${status}`);
  }
});

test('adding an organiser with a logo: a refused organiser leaves no file behind; a path in the id is refused', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64');
  const refused = await post('/api/organisers', { organiser: { id: 'club', name: '', aliases: [] }, logo: { data: png } }); // no name
  assert.equal(refused.status, 400);
  assert.ok(!existsSync(join(root, 'docs', 'img', 'club.png')));

  const traversal = await post('/api/organisers', { organiser: { id: '../../escaped', name: 'X', aliases: [] }, logo: { data: png } });
  assert.equal(traversal.status, 400);
  assert.ok(!existsSync(join(root, '..', 'escaped.png')) && !existsSync(join(root, 'escaped.png')));

  const ok = await post('/api/organisers', { organiser: { id: 'club', name: 'Club', aliases: ['The Club'] }, logo: { data: png } });
  assert.equal(ok.status, 201);
  assert.ok(existsSync(join(root, 'docs', 'img', 'club.png')));
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'docs', 'data', 'organisers.json'), 'utf8')).at(-1), { id: 'club', name: 'Club', image: 'img/club.png', aliases: ['The Club'] });
});

test('the scrapers tab: a run can be started, read back, and is refused without the usual checks', async () => {
  assert.equal((await call('POST', '/api/run', { headers: { 'Content-Type': 'text/plain' }, body: '{"scraper":"aff"}' })).status, 403);
  assert.equal((await call('POST', '/api/run', { headers: { ...JSON_HEADERS, Origin: 'https://evil.example' }, body: { scraper: 'aff' } })).status, 403);
  assert.equal((await post('/api/run', { scraper: 'nope' })).status, 404);

  assert.equal((await post('/api/run', { scraper: 'aff' })).status, 202);
  let run;
  do {
    await new Promise((r) => setTimeout(r, 100));
    run = (await call('GET', '/api/run')).json().run;
  } while (run.running);
  assert.equal(run.exitCode, 0);
  assert.equal(run.lines[0].text, 'line one');
});
