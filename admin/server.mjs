#!/usr/bin/env node
/**
 * The local admin tool.   npm run admin   then open http://localhost:4321
 *
 * A tiny web server. edits the files in
 * data/. Afterwards you commit and push in GitHub Desktop as usual.
 * The "From a post" tab also needs ANTHROPIC_API_KEY set in the terminal you start it from.
 *
 * It only listens on 127.0.0.1 (nothing outside your computer can reach it),
 * and refuses requests that don't look like they came from its own page, so a
 * website you happen to have open can't send it commands either.
 *
 * All the real work is in scripts/lib/store.mjs; this file is just the
 * doorway between that and the page in this folder.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../scripts/lib/store.mjs';
import { queuePost, readPost } from '../scrapers/post.mjs';
import { decodeImages, deleteScreenshots, saveScreenshots, screenshotFile } from './screenshots.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, '..'));
const PORT = Number(process.env.PORT ?? 4321);
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

// The only files the server will hand out.
const PAGES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/admin.css': ['admin.css', 'text/css; charset=utf-8'],
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new store.Problem(['Request too large'], 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new store.Problem(['The request was not valid JSON']);
  }
}

/** Handles /api/... Each change loads fresh data, changes it, and saves it. */
async function handleApi(req, res, path) {
  const method = req.method;

  if (method !== 'GET') {
    // A web page on another site can't send "application/json" or an Origin
    // we recognise without our permission, so this blocks cross-site attacks.
    const origin = req.headers.origin;
    if (!String(req.headers['content-type']).startsWith('application/json') ||
        (origin && !ALLOWED_HOSTS.has(new URL(origin).host))) {
      throw new store.Problem(['Request refused'], 403);
    }
  }
  // Only the "From a post" route takes screenshots, so only it gets a big limit.
  const body = method === 'GET' ? {} : await readBody(req, path === '/api/post' ? 10_000_000 : 100_000);
  const state = store.loadState(root);
  let m;

  if (method === 'GET' && path === '/api/state') return send(res, 200, store.view(state));

  // Add to the queue (manual entries only; scrapers call store.enqueue directly)
  if (method === 'POST' && path === '/api/queue') {
    const { entry } = store.enqueue(state, body.event, { source: 'manual' });
    const flags = store.flagsFor(state, entry);
    store.saveState(state);
    return send(res, 201, { pid: entry.pid, flags });
  }

  // A pasted post: screenshots and/or text -> the AI reads them -> a draft in the queue.
  if (method === 'POST' && path === '/api/post') {
    const images = decodeImages(body.images ?? []);
    const input = { text: body.text, organiser: body.organiser, url: String(body.url ?? '').trim(), images };
    const read = await readPost(state, { ...input, images: images.map(({ mediaType, data }) => ({ mediaType, data })) });
    const fresh = store.loadState(root); // the model took seconds; reload so we don't overwrite anything saved meanwhile
    const result = queuePost(fresh, input, read);
    if (!result.entry) return send(res, 200, { queued: false, message: result.message });
    saveScreenshots(root, images);
    store.saveState(fresh);
    return send(res, 201, { queued: true, pid: result.entry.pid, notes: result.notes });
  }

  // Add and approve in one step
  if (method === 'POST' && path === '/api/events') {
    const { event, flags } = store.addAndApprove(state, body.event);
    store.saveState(state);
    return send(res, 201, { id: event.id, flags });
  }

  if ((m = path.match(/^\/api\/queue\/(q-\d+)(?:\/(approve|reject|restore))?$/))) {
    const [, pid, action] = m;
    let result = {};
    let finished = []; // screenshots to delete once the decision is saved
    if (method === 'PUT' && !action) store.updatePending(state, pid, body.event);
    else if (method === 'POST' && action === 'approve') { result = { id: store.approve(state, pid).id }; finished = store.dropScreenshots(state, pid); }
    else if (method === 'POST' && action === 'reject') { store.reject(state, pid); finished = store.dropScreenshots(state, pid); }
    else if (method === 'POST' && action === 'restore') store.restore(state, pid);
    else throw new store.Problem(['Unknown request'], 404);
    store.saveState(state);
    deleteScreenshots(root, finished);
    return send(res, 200, result);
  }

  if ((m = path.match(/^\/api\/events\/(evt-\d+)$/))) {
    if (method === 'PUT') store.updateEvent(state, m[1], body.event);
    else if (method === 'DELETE') store.deleteEvent(state, m[1]);
    else throw new store.Problem(['Unknown request'], 404);
    store.saveState(state);
    return send(res, 200, {});
  }

  throw new store.Problem(['Unknown request'], 404);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host)) throw new store.Problem(['Request refused'], 403);
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && PAGES[pathname]) {
      const [file, type] = PAGES[pathname];
      return send(res, 200, readFileSync(join(here, file)), type);
    }
    const shot = req.method === 'GET' && pathname.startsWith('/api/screenshots/') ? screenshotFile(root, pathname.slice('/api/screenshots/'.length)) : null;
    if (shot) {
      try {
        return send(res, 200, readFileSync(shot.path), shot.type);
      } catch {
        throw new store.Problem(['Not found'], 404);
      }
    }
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    throw new store.Problem(['Not found'], 404);
  } catch (err) {
    if (err instanceof store.Problem) return send(res, err.status, { errors: err.errors });
    console.error(err);
    send(res, 500, { errors: [`Unexpected error: ${err.message}`] });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Calendar admin running at http://localhost:${PORT}`);
  console.log(`Editing data/pending.json and docs/data/`);
  console.log('Press Ctrl+C to stop.');
});
