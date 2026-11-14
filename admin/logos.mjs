// logos.mjs: organiser logos for the admin tool's "Organisers" tab. They live in docs/img/ (the
// public folder), so a logo uploaded here is published with the site.
//
// Like screenshots.mjs, an upload is checked by its first bytes (not by what the sender claims)
// and capped in size. The name is made from the organiser's id, never from the uploaded filename,
// and an existing file is never overwritten.
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Problem } from '../scripts/lib/store.mjs';
import { sniff } from './screenshots.mjs';

export const MAX_LOGO_BYTES = 1_000_000;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const folder = (root) => join(root, 'docs', 'img');

/** The browser's { data: "<base64>" } -> { name, bytes } named after the organiser, or a Problem. */
export function decodeLogo(upload, id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Problem(['The organiser id must be lowercase letters, numbers and hyphens']); // it becomes a filename
  const bytes = Buffer.from(typeof upload?.data === 'string' ? upload.data : '', 'base64');
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw new Problem([`The logo is empty or larger than ${MAX_LOGO_BYTES / 1_000_000} MB`]);
  const ext = sniff(bytes);
  if (!ext) throw new Problem(["The logo isn't a PNG, JPEG or WebP image"]);
  return { name: `${id}.${ext}`, bytes };
}

/** Saves a decoded logo into docs/img/ and returns the path organisers.json uses ("img/<name>"). */
export function saveLogo(root, logo) {
  const file = join(folder(root), logo.name);
  if (existsSync(file)) throw new Problem([`img/${logo.name} already exists. Choose it from the list instead of uploading it again`]);
  writeFileSync(file, logo.bytes);
  return `img/${logo.name}`;
}

export function deleteLogo(root, logo) {
  rmSync(join(folder(root), logo.name), { force: true });
}

/** The images in docs/img/ an organiser could use. */
export function listLogos(root) {
  return readdirSync(folder(root)).filter((n) => /^[\w\-. ]+\.(jpe?g|png|webp)$/i.test(n) && !n.startsWith('placeholder')).sort();
}

/** Where to read a served logo from, and its content type; null unless the name is a real image in docs/img/. */
export function logoFile(root, name) {
  if (!listLogos(root).includes(name)) return null;
  return { path: join(folder(root), name), type: TYPES[name.split('.').pop().toLowerCase().replace('jpeg', 'jpg')] };
}
