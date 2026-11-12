// admin.js: the screen of the local admin tool. It asks server.mjs for the data
// and draws four tabs: Queue (review), From a post (paste screenshots), Add event (the form) and Published.
//
// Everything that comes from the data is put on the page as plain text, never
// as HTML, because scraped content can't be trusted not to contain markup.

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

// ---------- queue tab ----------

function queueCard(p) {
  const e = p.event;
  const rows = [
    ['When', dates(e)],
    ['Weapons', list(e.weapons)],
    ['Format', list(e.format)],
    ['Gender', list(e.gender)],
    ['Level', list(e.level)],
    ['Venue', e.venue || '—'],
    ['Organiser', organiserName(e.organiser)],
    ['Link', e.url ? link(e.url) : '—'],
  ];
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
        h('td', {}, e.name, ' ', h('span', { class: 'pid' }, e.id)),
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
  for (const field of ['name', 'start_date', 'end_date', 'venue', 'organiser', 'url']) event[field] = data.get(field) ?? '';
  for (const field of Object.keys(state.choices)) event[field] = data.getAll(field);
  return event;
}

function fillForm(event) {
  const f = form();
  for (const field of ['name', 'start_date', 'end_date', 'venue', 'url']) f.elements[field].value = event[field] ?? '';
  for (const field of Object.keys(state.choices)) {
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

// ---------- start-up ----------

async function refresh() {
  state = await api('GET', '/api/state');
  const waiting = state.pending.filter((p) => p.status === 'pending').length;
  $('#count-queue').textContent = waiting ? `(${waiting})` : '';
  $('#count-published').textContent = `(${state.events.length})`;
  renderQueue();
  renderPublished();
}

async function init() {
  for (const button of document.querySelectorAll('#tabs button')) {
    button.addEventListener('click', () => {
      if (button.dataset.tab !== 'form' && editing) resetForm(); // leaving the form abandons any edit
      showTab(button.dataset.tab);
    });
  }
  try {
    await refresh();
  } catch (err) {
    $('#tab-queue').replaceChildren(h('p', { class: 'errors' }, err.message));
    return;
  }
  // The checkboxes come from the schema, so they always match the rules.
  for (const fieldset of document.querySelectorAll('fieldset[data-field]')) {
    const field = fieldset.dataset.field;
    fieldset.append(...state.choices[field].map((v) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: field, value: v }), nice(v))));
  }
  form().addEventListener('submit', (ev) => { ev.preventDefault(); submit(editing ? 'save' : 'queue'); });
  fillOrganisers(lastOrganiser(), postForm().elements.organiser);
  postForm().addEventListener('submit', submitPost);
  document.addEventListener('paste', pasteShots);
  resetForm();
  showTab(state.pending.some((p) => p.status === 'pending') ? 'queue' : 'form');
}

init();
