// screenshots.mjs: the screenshots pasted into the admin tool's "From a post" tab.
//
// They are kept in data/screenshots/ (private: never in docs/, and gitignored) only while their
// event waits in the queue, so the reviewer can compare the AI's answer with the real post.
// Approving or rejecting the event deletes them.
//
// A browser sends them as base64 text. Before anything is saved or forwarded we check each one
// really is a PNG, JPEG or WebP by its first bytes (not by what the sender claims), and cap the
// count and size, because this is the only place in the tool that accepts files.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Problem } from '../scripts/lib/store.mjs';

export const MAX_IMAGES = 6;
export const MAX_BYTES = 4_000_000;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** The only filenames the tool will ever save, serve or delete. */
export const NAME = /^shot-[0-9a-f]{8}-\d\.(jpg|png|webp)$/;

/** "jpg" | "png" | "webp" from the first bytes of a file, or null if it is none of those. */
export function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/**
 * The browser's [{ data: "<base64>" }] -> [{ name, ext, mediaType, data, bytes }], or a Problem.
 * `data` is re-encoded from the decoded bytes, so only clean base64 is ever forwarded.
 */
export function decodeImages(list) {
  if (!Array.isArray(list)) throw new Problem(['images must be a list']);
  if (list.length > MAX_IMAGES) throw new Problem([`At most ${MAX_IMAGES} screenshots per post`]);
  const batch = randomBytes(4).toString('hex');
  return list.map((item, i) => {
    const bytes = Buffer.from(typeof item?.data === 'string' ? item.data : '', 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Problem([`Screenshot ${i + 1} is empty or larger than ${MAX_BYTES / 1_000_000} MB`]);
    const ext = sniff(bytes);
    if (!ext) throw new Problem([`Screenshot ${i + 1} isn't a PNG, JPEG or WebP image`]);
    return { name: `shot-${batch}-${i + 1}.${ext}`, ext, mediaType: TYPES[ext], data: bytes.toString('base64'), bytes };
  });
}

const folder = (root) => join(root, 'data', 'screenshots');

export function saveScreenshots(root, images) {
  mkdirSync(folder(root), { recursive: true });
  for (const image of images) writeFileSync(join(folder(root), image.name), image.bytes);
}

export function deleteScreenshots(root, names) {
  for (const name of names) if (NAME.test(name)) rmSync(join(folder(root), name), { force: true });
}

/** Where to read a served screenshot from, and its content type; null unless the name is exactly one of ours. */
export function screenshotFile(root, name) {
  const m = NAME.exec(name);
  return m ? { path: join(folder(root), name), type: TYPES[m[1]] } : null;
}
