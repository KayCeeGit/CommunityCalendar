// admin.js: the screen of the local admin tool. It asks server.mjs for the data
// and draws six tabs: Queue (review), From a post (paste screenshots), Add event (the form), Published, Organisers
// and Scrapers (run the scrapers and watch their output).
//
// Everything that comes from the data is put on the page as plain text, never
// as HTML, because scraped content can't be trusted not to contain markup. TEST

const $ = (selector) => document.querySelector(selector);

/** Builds an element: h('p', { class: 'note' }, 'some text', otherElement) */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

class ApiError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.errors = errors;
  }
}

async function api(method, url, body) {
  const options = { method };
  if (method !== 'GET') {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body ?? {});
  }
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError(['Could not reach the admin server. Is it still running in the terminal?']);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.errors ?? ['Something went wrong']);
  return data;
}

// ---------- state ----------

let state;          // everything from /api/state
let editing = null; // null = adding; { pid } = a queued event; { id } = a published event

// ---------- small helpers ----------

const SOURCE_LABEL = { manual: 'Manual', scraper: 'Scraper', post: 'Post' };
const NICE = { mens: 'Mens', womens: 'Womens', u14: 'U14', u18: 'U18' };
const nice = (v) => NICE[v] ?? v.charAt(0).toUpperCase() + v.slice(1);
const CATEGORIES = ['weapons', 'format', 'gender', 'level']; // the checkbox groups (state.choices also holds type and status)
const list = (values = []) => (values.length ? values.map(nice).join(', ') : '— missing');

const day = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const dates = (e) => (e.start_date === e.end_date ? day(e.start_date) : `${day(e.start_date)} to ${day(e.end_date)}`);

/** Only real web links become clickable. */
function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
const link = (url) => {
  const href = safeHref(url);
  return href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, url) : url;
};

const organiserName = (id) => state.organisers.find((o) => o.id === id)?.name ?? `${id} (not in organisers.json)`;

let toastTimer;
function toast(message, bad = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = bad ? 'bad' : 'good';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 8000);
}

/** Runs a change, reloads the data, and reports the result. */
async function act(change, successMessage) {
  try {
    const result = await change();
    await refresh();
    toast(successMessage(result));
  } catch (err) {
    toast(err.errors ? err.errors.join(' ') : err.message, true);
  }
}

function showTab(name) {
  for (const section of document.querySelectorAll('main > section')) section.hidden = section.id !== `tab-${name}`;
  for (const button of document.querySelectorAll('#tabs button')) button.classList.toggle('active', button.dataset.tab === name);
}

/** Opens a tab from the menu. Leaving the form abandons any edit. */
function goTo(name) {
  if (name !== 'form' && editing) resetForm();
  showTab(name);
}

// ---------- queue tab ----------

function queueCard(p) {
  const e = p.event;
  const rows = [
    ['When', dates(e)],
    e.type ? ['Type', nice(e.type)] : null,
    e.status ? ['Status', nice(e.status) + (e.status_note ? `: ${e.status_note}` : '')] : null,
    ...CATEGORIES.filter((c) => !e.type || e[c]?.length).map((c) => [nice(c), list(e[c])]), // an "other" event needn't have them
    ['Venue', e.venue || '—'],
    ['Organiser', organiserName(e.organiser)],
    ['Link', e.url ? link(e.url) : '—'],
  ].filter(Boolean);
  return h('article', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', {}, e.name),
      h('span', { class: `badge ${p.source}` }, SOURCE_LABEL[p.source] ?? p.source),
      h('span', { class: 'pid' }, p.pid)),
    h('dl', {}, ...rows.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
    p.source_url && p.source_url !== e.url ? h('p', { class: 'note' }, 'Found at ', link(p.source_url)) : null,
    p.source_note ? h('p', { class: 'note' }, p.source_note) : null,
    p.screenshots?.length ? h('div', { class: 'shots' }, ...p.screenshots.map((name) => h('a', { href: `/api/screenshots/${name}`, target: '_blank', rel: 'noopener' }, h('img', { src: `/api/screenshots/${name}`, alt: 'Screenshot of the post' })))) : null,
    p.flags.length ? h('ul', { class: 'flags' }, ...p.flags.map((f) => h('li', {}, f))) : null,
    h('div', { class: 'buttons' },
      h('button', { class: 'primary', onclick: () => act(() => api('POST', `/api/queue/${p.pid}/approve`), (r) => `Published "${e.name}" as ${r.id}.`) }, 'Approve'),
      h('button', { onclick: () => startEdit({ pid: p.pid }, e) }, 'Edit'),
      h('button', { class: 'danger', onclick: () => act(() => api('POST', `/api/queue/${p.pid}/reject`), () => `Rejected "${e.name}".`) }, 'Reject')));
}

function renderQueue() {
  const waiting = state.pending.filter((p) => p.status === 'pending');
  const rejected = state.pending.filter((p) => p.status === 'rejected');
  $('#tab-queue').replaceChildren(...[
    h('h2', {}, `Waiting for review (${waiting.length})`),
    ...(waiting.length
      ? waiting.map(queueCard)
      : [h('p', { class: 'empty' }, 'Nothing waiting. Events from the form or the scrapers appear here before they go live.')]),
    rejected.length
      ? h('details', {},
        h('summary', {}, `Rejected (${rejected.length})`),
        ...rejected.map((p) => h('div', { class: 'rejected-row' },
          h('span', {}, `${p.event.name} (${dates(p.event)})`),
          h('button', { onclick: () => act(() => api('POST', `/api/queue/${p.pid}/restore`), () => `Moved "${p.event.name}" back to the queue.`) }, 'Restore'))))
      : null,
  ].filter(Boolean));
}

// ---------- published tab ----------

function renderPublished() {
  const rows = [...state.events].sort((a, b) => b.start_date.localeCompare(a.start_date));
  $('#tab-published').replaceChildren(
    h('h2', {}, `Published events (${rows.length})`),
    h('table', {},
      h('thead', {}, h('tr', {}, ...['Date', 'Name', 'Organiser', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((e) => h('tr', { class: e.end_date < state.today ? 'past' : '' },
        h('td', {}, dates(e)),
        h('td', {}, e.name, ' ', h('span', { class: 'pid' }, [e.id, e.type, e.status].filter(Boolean).join(' · '))),
        h('td', {}, organiserName(e.organiser)),
        h('td', { class: 'actions' },
          h('button', { onclick: () => startEdit({ id: e.id }, e) }, 'Edit'), ' ',
          h('button', { class: 'danger', onclick: () => removeEvent(e) }, 'Delete')))))));
}

function removeEvent(e) {
  if (!confirm(`Delete "${e.name}" (${e.id}) from the calendar?\n\nGit keeps the history, so you can get it back if needed.`)) return;
  act(() => api('DELETE', `/api/events/${e.id}`), () => `Deleted "${e.name}".`);
}

// ---------- post tab ----------

const postForm = () => $('#post-form');
const MAX_SHOTS = 6;   // the server enforces the same limit
const MAX_SIDE = 1500; // pixels; bigger screenshots are shrunk, which keeps uploads small and AI reading cheap
let shots = [];        // pasted screenshots waiting to be sent, as base64 JPEG

/** An image file -> base64 JPEG whose long side is at most MAX_SIDE. */
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent areas would turn black in a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function showPostErrors(errors) {
  const box = $('#post-errors');
  box.replaceChildren(...errors.map((m) => h('li', {}, m)));
  box.hidden = errors.length === 0;
}

function renderShots() {
  $('#post-shots').replaceChildren(...shots.map((data, i) => h('figure', {},
    h('img', { src: `data:image/jpeg;base64,${data}`, alt: `Pasted screenshot ${i + 1}` }),
    h('button', { type: 'button', onclick: () => { shots.splice(i, 1); renderShots(); } }, 'Remove'))));
}

/** Ctrl+V on the "From a post" tab: images become screenshots; plain text pastes into the text box as usual. */
async function pasteShots(ev) {
  if ($('#tab-post').hidden) return;
  const files = [...ev.clipboardData.files].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  ev.preventDefault();
  showPostErrors([]);
  try {
    for (const file of files) {
      if (shots.length >= MAX_SHOTS) { showPostErrors([`At most ${MAX_SHOTS} screenshots per post`]); break; }
      shots.push(await shrink(file));
    }
  } catch {
    showPostErrors(['Could not read that image. Try taking the screenshot again.']);
  }
  renderShots();
}

async function submitPost(ev) {
  ev.preventDefault();
  const f = postForm().elements;
  const button = $('#post-submit');
  button.disabled = true;
  button.textContent = 'Reading the post…';
  showPostErrors([]);
  try {
    const organiser = f.organiser.value;
    const r = await api('POST', '/api/post', { images: shots.map((data) => ({ data })), text: f.text.value, organiser, url: f.url.value });
    if (!r.queued) return showPostErrors([r.message]);
    shots = [];
    renderShots();
    postForm().reset();
    fillOrganisers(organiser, f.organiser); // keep the same organiser selected for the next post
    saveLastOrganiser(organiser);
    await refresh();
    showTab('queue');
    toast(`Added to the queue as ${r.pid}.${r.notes.length ? ` Check: ${r.notes.join('; ')}.` : ''}`);
  } catch (err) {
    showPostErrors(err.errors ?? [err.message]);
  } finally {
    button.disabled = false;
    button.textContent = 'Read the post';
  }
}

// The organiser you picked last time is chosen again (browser storage can be unavailable, so it is optional).
const saveLastOrganiser = (id) => { try { localStorage.setItem('lastOrganiser', id); } catch { /* fine */ } };
const lastOrganiser = () => { try { return localStorage.getItem('lastOrganiser') ?? ''; } catch { return ''; } };

// ---------- form tab ----------

const form = () => $('#event-form');

function fillOrganisers(selected, select = form().elements.organiser) {
  const options = state.organisers.map((o) => [o.id, o.name]);
  if (selected && !options.some(([id]) => id === selected)) options.push([selected, `${selected} (not in organisers.json)`]);
  select.replaceChildren(h('option', { value: '' }, 'Choose organiser…'), ...options.map(([id, name]) => h('option', { value: id }, name)));
  select.value = selected ?? '';
}

function readForm() {
  const data = new FormData(form());
  const event = {};
  for (const field of ['name', 'type', 'start_date', 'end_date', 'venue', 'organiser', 'url', 'status', 'status_note']) event[field] = data.get(field) ?? '';
  for (const field of CATEGORIES) event[field] = data.getAll(field);
  return event;
}

function fillForm(event) {
  const f = form();
  for (const field of ['name', 'start_date', 'end_date', 'venue', 'url', 'status_note']) f.elements[field].value = event[field] ?? '';
  f.elements.type.value = event.type ?? 'competition';
  f.elements.status.value = event.status ?? '';
  for (const field of CATEGORIES) {
    for (const box of f.querySelectorAll(`input[name=${field}]`)) box.checked = (event[field] ?? []).includes(box.value);
  }
  fillOrganisers(event.organiser);
}

function showFormErrors(errors) {
  const box = $('#form-errors');
  box.replaceChildren(...errors.map((m) => h('li', {}, m)));
  box.hidden = errors.length === 0;
}

function drawFormChrome() {
  $('#form-title').textContent = editing?.pid ? `Edit queued event ${editing.pid}`
    : editing?.id ? `Edit published event ${editing.id}` : 'Add event';
  showFormErrors([]);
  $('#form-buttons').replaceChildren(...(editing
    ? [
      h('button', { type: 'button', class: 'primary', onclick: () => submit('save') }, 'Save changes'),
      h('button', { type: 'button', onclick: cancelEdit }, 'Cancel'),
    ]
    : [
      h('button', { type: 'button', class: 'primary', onclick: () => submit('queue') }, 'Add to queue'),
      h('button', { type: 'button', onclick: () => submit('publish') }, 'Save and approve'),
    ]));
}

function resetForm() {
  editing = null;
  form().reset();
  fillOrganisers('');
  drawFormChrome();
}

function startEdit(target, event) {
  editing = target;
  fillForm(event);
  drawFormChrome();
  showTab('form');
}

function cancelEdit() {
  const wasQueued = Boolean(editing?.pid);
  resetForm();
  showTab(wasQueued ? 'queue' : 'published');
}

async function submit(kind) {
  const event = readForm();
  const flagText = (flags) => (flags.length ? ` Check: ${flags.join('; ')}.` : '');
  try {
    let message;
    if (kind === 'queue') {
      const r = await api('POST', '/api/queue', { event });
      message = `Added to the queue as ${r.pid}.${flagText(r.flags)}`;
    } else if (kind === 'publish') {
      const r = await api('POST', '/api/events', { event });
      message = `Published as ${r.id}.${flagText(r.flags)}`;
    } else if (editing.pid) {
      await api('PUT', `/api/queue/${editing.pid}`, { event });
      message = 'Changes saved.';
    } else {
      await api('PUT', `/api/events/${editing.id}`, { event });
      message = 'Changes saved.';
    }
    const was = editing;
    resetForm();
    await refresh();
    if (was) showTab(was.pid ? 'queue' : 'published');
    toast(message);
  } catch (err) {
    showFormErrors(err.errors ?? [err.message]);
  }
}

// ---------- organisers tab ----------

const orgForm = () => $('#org-form');
let editingOrganiser = null; // null = adding; an id = changing that organiser

const showOrgErrors = (errors) => {
  const box = $('#org-errors');
  box.replaceChildren(...errors.map((e) => h('li', {}, e)));
  box.hidden = errors.length === 0;
};

/** A chosen file -> base64 text (the part after "data:...;base64,"). */
const readBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

function drawOrganiserForm() {
  const f = orgForm().elements;
  const adding = editingOrganiser === null;
  $('#org-title').textContent = adding ? 'Add organiser' : `Edit ${editingOrganiser}`;
  f.id.disabled = !adding;
  showOrgErrors([]);
  $('#org-buttons').replaceChildren(
    h('button', { type: 'submit', class: 'primary' }, adding ? 'Add organiser' : 'Save changes'),
    ...(adding ? [] : [h('button', { type: 'button', onclick: () => { editingOrganiser = null; orgForm().reset(); drawOrganiserForm(); } }, 'Cancel')]));
}

function renderOrganisers() {
  const select = orgForm().elements.image;
  const chosen = select.value;
  select.replaceChildren(h('option', { value: '' }, 'Choose a logo…'), ...state.logos.map((n) => h('option', { value: `img/${n}` }, n)));
  select.value = chosen;
  $('#org-list').replaceChildren(...state.organisers.map((o) => h('div', { class: 'org' },
    h('img', { src: `/api/logos/${encodeURIComponent(o.image.replace(/^img\//, ''))}`, alt: '' }),
    h('div', {}, h('strong', {}, o.name), ` (${o.id})`, h('br'), h('small', {}, o.aliases.length ? o.aliases.join(', ') : 'no aliases')),
    h('button', { onclick: () => {
      const f = orgForm().elements;
      editingOrganiser = o.id;
      f.id.value = o.id;
      f.name.value = o.name;
      f.aliases.value = o.aliases.join(', ');
      f.image.value = o.image;
      f.upload.value = '';
      drawOrganiserForm();
      window.scrollTo(0, 0);
    } }, 'Edit'))));
}

async function submitOrganiser(ev) {
  ev.preventDefault();
  const f = orgForm().elements;
  const file = f.upload.files[0];
  try {
    const organiser = { id: f.id.value, name: f.name.value, image: f.image.value, aliases: f.aliases.value.split(',') };
    const logo = file ? { data: await readBase64(file) } : undefined;
    const adding = editingOrganiser === null;
    await api(adding ? 'POST' : 'PUT', adding ? '/api/organisers' : `/api/organisers/${editingOrganiser}`, { organiser, logo });
    editingOrganiser = null;
    orgForm().reset();
    await refresh();
    drawOrganiserForm();
    toast(`${adding ? 'Added' : 'Saved'} ${organiser.name.trim()}.`);
  } catch (err) {
    showOrgErrors(err.errors ?? [err.message]);
  }
}

// ---------- scrapers tab ----------

const POLL_MS = 700;
let scraperInfo = [];  // from /api/run: which scrapers exist and whether they can run
let shownRun = null;   // startedAt of the run whose output is on screen
let lastLine = -1;     // number of the last output line we have (the server only sends newer ones)
let runPoll;

/** Colours a line of scraper output by its first word (the scrapers print QUEUED, NEEDS YOU, KNOWN, SKIPPED). */
function lineClass(line) {
  if (line.stream === 'err') return /^Scrape failed/.test(line.text) ? 'fail' : 'err';
  if (/^QUEUED/.test(line.text)) return 'queued';
  if (/^(NEEDS YOU|DRAFT)/.test(line.text)) return 'needs';
  if (/^(KNOWN|SKIPPED)/.test(line.text)) return 'dim';
  return '';
}

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function drawScraperButtons(running) {
  $('#scraper-buttons').replaceChildren(...scraperInfo.map((s) => h('button', {
    type: 'button', class: `scraper-card${running === s.id ? ' is-running' : ''}`, disabled: Boolean(running) || !s.ready,
    onclick: () => startScraper(s.id),
  }, h('strong', {}, `Run ${s.label}`), h('span', {}, s.ready ? s.about : `${s.about} Needs ANTHROPIC_API_KEY set before starting the admin.`))));
}

function drawRun(run) {
  const out = $('#term-out');
  const state = $('#term-state');
  const running = run?.running ? run.scraper : null;
  drawScraperButtons(running);
  $('#count-scrapers').textContent = running ? '●' : '';
  $('#term-stop').hidden = !running;
  out.classList.toggle('is-running', Boolean(running));
  if (!run) return;
  $('#term-title').textContent = `npm run scrape:${run.scraper}`;
  if (run.running) {
    state.textContent = `running ${clock(Date.now() - run.startedAt)}`;
    state.className = 'running';
  } else {
    const ok = run.exitCode === 0;
    state.textContent = run.stopped ? 'stopped' : ok ? `done in ${clock(run.endedAt - run.startedAt)}` : `failed (exit ${run.exitCode})`;
    state.className = ok && !run.stopped ? 'ok' : 'fail';
  }
}

/** Fetches whatever is new and draws it. Keeps polling while a scraper is running. */
async function loadRun() {
  clearTimeout(runPoll);
  const asked = lastLine;
  let data;
  try {
    data = await api('GET', `/api/run?since=${asked}`);
  } catch {
    return; // the server is gone; the next click will say so
  }
  scraperInfo = data.scrapers;
  const run = data.run;
  const out = $('#term-out');
  if (run && run.startedAt !== shownRun) {
    // A different run than the one on screen (a new run, or the first look after a reload): start the output again
    shownRun = run.startedAt;
    lastLine = -1;
    out.replaceChildren(h('p', { class: 'line dim start' }, `npm run scrape:${run.scraper}`));
    if (asked !== -1) return loadRun(); // we asked for "newer than N" about the old run, so ask again for everything
  }
  if (run) {
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
    for (const line of run.lines) out.append(h('p', { class: `line ${lineClass(line)}` }, line.text || ' '));
    if (run.lines.length) lastLine = run.lines.at(-1).n;
    if (atBottom) out.scrollTop = out.scrollHeight;
  }
  const wasRunning = out.classList.contains('is-running');
  drawRun(run);
  if (run?.running) runPoll = setTimeout(loadRun, POLL_MS);
  else if (wasRunning) {
    await refresh(); // a finished scraper may have added to the queue
    const waiting = state.pending.filter((p) => p.status === 'pending').length;
    toast(run.exitCode === 0 ? `Scraper finished. ${waiting} waiting in the queue.` : 'Scraper stopped or failed. See the output.', run.exitCode !== 0);
  }
}

async function startScraper(id) {
  try {
    await api('POST', '/api/run', { scraper: id });
    shownRun = null; // so loadRun draws the new run from its first line
    await loadRun();
  } catch (err) {
    toast(err.errors ? err.errors.join(' ') : err.message, true);
  }
}

// ---------- start-up ----------

async function refresh() {
  state = await api('GET', '/api/state');
  const waiting = state.pending.filter((p) => p.status === 'pending').length;
  $('#count-queue').textContent = waiting ? `(${waiting})` : '';
  $('#count-published').textContent = `(${state.events.length})`;
  renderQueue();
  renderPublished();
  renderOrganisers();
  // A newly added organiser appears in the event and post forms, keeping whatever was chosen
  for (const select of [form().elements.organiser, postForm().elements.organiser]) fillOrganisers(select.value, select);
}

async function init() {
  for (const button of document.querySelectorAll('#tabs button')) {
    button.addEventListener('click', () => goTo(button.dataset.tab));
  }
  // Number keys jump between pages (not while typing in a field)
  const tabNames = [...document.querySelectorAll('#tabs button')].map((b) => b.dataset.tab);
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    const tab = tabNames[Number(ev.key) - 1];
    if (tab) goTo(tab);
  });
  $('#term-stop').addEventListener('click', async () => {
    try { await api('POST', '/api/run/stop'); await loadRun(); } catch (err) { toast(err.message, true); }
  });
  try {
    await refresh();
  } catch (err) {
    $('#tab-queue').replaceChildren(h('p', { class: 'errors' }, err.message));
    return;
  }
  // The type and status dropdowns and the checkboxes come from the schema, so they always match the rules.
  const fillSelect = (name, values, first) => form().elements[name].replaceChildren(...[first, ...values.map((v) => [v, nice(v)])].map(([value, text]) => h('option', { value }, text)));
  fillSelect('type', state.choices.type.filter((t) => t !== 'competition'), ['competition', 'Competition']);
  fillSelect('status', state.choices.status, ['', 'Going ahead']);
  for (const fieldset of document.querySelectorAll('fieldset[data-field]')) {
    const field = fieldset.dataset.field;
    fieldset.append(...state.choices[field].map((v) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: field, value: v }), nice(v))));
  }
  form().addEventListener('submit', (ev) => { ev.preventDefault(); submit(editing ? 'save' : 'queue'); });
  fillOrganisers(lastOrganiser(), postForm().elements.organiser);
  postForm().addEventListener('submit', submitPost);
  orgForm().addEventListener('submit', submitOrganiser);
  drawOrganiserForm();
  document.addEventListener('paste', pasteShots);
  resetForm();
  showTab(state.pending.some((p) => p.status === 'pending') ? 'queue' : 'form');
  loadRun(); // shows the last run (if any) and carries on polling if one is still going
}

init();
