// switcher.js: the "Style" bar fixed to the bottom of every page in docs/v/.
// Each design lives in its own folder (docs/v/<name>/) with the same page names, so a button
// just opens the current page (index, archive or about) in another folder.
// For a demo only: delete docs/v/ when you have picked a design.

const STYLES = [['piste', 'Piste'], ['fixtures', 'Fixtures'], ['terminal', 'Terminal'], ['stage', 'Stage'], ['duel', 'Duel'], ['clear', 'Clear'], ['hybrid', 'Hybrid'], ['board', 'Board']];

const parts = location.pathname.split('/').filter(Boolean);
const onFile = parts.at(-1)?.endsWith('.html');
const page = onFile ? parts.at(-1) : 'index.html';
const current = parts.at(onFile ? -2 : -1);

const bar = document.createElement('nav');
bar.className = 'style-switcher';
bar.setAttribute('aria-label', 'Design style');

const label = document.createElement('span');
label.textContent = 'Style';
bar.append(label);

for (const [id, name] of STYLES) {
  const link = document.createElement('a');
  link.href = `../${id}/${page}`;
  link.textContent = name;
  if (id === current) link.setAttribute('aria-current', 'page');
  bar.append(link);
}
document.body.append(bar);
// on a phone the bar scrolls sideways; bring the current style into view
bar.querySelector('[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
