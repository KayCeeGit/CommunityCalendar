// Green or amber phosphor. Runs in the <head> so the colour is right before the page first paints.
// The choice is remembered; until you pick one, the calendar is green and the archive is amber.
const KEY = 'calendar-phosphor';
const root = document.documentElement;
const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
const isArchive = location.pathname.endsWith('archive.html');
root.dataset.phosphor = saved === 'green' || saved === 'amber' ? saved : (isArchive ? 'amber' : 'green');

addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('phosphor');
  if (!button) return;
  const show = () => {
    const amber = root.dataset.phosphor === 'amber';
    button.textContent = amber ? 'Green' : 'Amber';   // the button offers the *other* colour
    button.setAttribute('aria-pressed', String(amber));
  };
  button.addEventListener('click', () => {
    root.dataset.phosphor = root.dataset.phosphor === 'amber' ? 'green' : 'amber';
    try { localStorage.setItem(KEY, root.dataset.phosphor); } catch { /* private mode: still works for this visit */ }
    show();
  });
  show();
});
