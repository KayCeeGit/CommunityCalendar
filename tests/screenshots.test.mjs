// Tests for admin/screenshots.mjs: the only place in the admin tool that accepts files.
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_BYTES, MAX_IMAGES, NAME, decodeImages, deleteScreenshots, saveScreenshots, screenshotFile, sniff } from '../admin/screenshots.mjs';
import { Problem } from '../scripts/lib/store.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const b64 = (buffer) => ({ data: buffer.toString('base64') });
const problem = (fn) => { try { fn(); } catch (err) { if (err instanceof Problem) return err.errors.join(' '); throw err; } return null; };

test('image type is decided by the first bytes, not by what the sender says', () => {
  assert.deepEqual([sniff(JPEG), sniff(PNG), sniff(WEBP)], ['jpg', 'png', 'webp']);
  for (const bad of ['<svg onload=alert(1)>', 'GIF89a....', '%PDF-1.7', 'RIFF....WAVE']) assert.equal(sniff(Buffer.from(bad)), null, bad);
  assert.equal(sniff(Buffer.alloc(0)), null);
});

test('good images get safe names and a content type; the data is re-encoded', () => {
  const images = decodeImages([b64(JPEG), b64(PNG)]);
  assert.equal(images.length, 2);
  assert.ok(images.every((i) => NAME.test(i.name)));
  assert.deepEqual(images.map((i) => i.mediaType), ['image/jpeg', 'image/png']);
  assert.ok(images[0].name.endsWith('-1.jpg') && images[1].name.endsWith('-2.png'));
  assert.equal(images[0].data, JPEG.toString('base64'));
  assert.deepEqual(decodeImages([]), []);
});

test('bad uploads are refused with a plain message', () => {
  assert.match(problem(() => decodeImages('nope')), /must be a list/);
  assert.match(problem(() => decodeImages(Array(MAX_IMAGES + 1).fill(b64(JPEG)))), /At most 6/);
  assert.match(problem(() => decodeImages([{ data: '' }])), /empty or larger/);
  assert.match(problem(() => decodeImages([{}])), /empty or larger/);
  assert.match(problem(() => decodeImages([b64(Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES)]))])), /empty or larger/);
  assert.match(problem(() => decodeImages([b64(Buffer.from('<script>alert(1)</script>'))])), /isn't a PNG, JPEG or WebP/);
});

test('only our own filenames can be served or deleted', () => {
  for (const bad of ['../../data/pending.json', 'shot-1234567-1.jpg', 'shot-1234567g-1.jpg', 'shot-12345678-1.gif', 'shot-12345678-1.jpg/../x', '..', 'pending.json', '']) {
    assert.equal(screenshotFile('/root', bad), null, bad);
  }
  assert.deepEqual(screenshotFile('/root', 'shot-0123abcd-2.webp'), { path: join('/root', 'data', 'screenshots', 'shot-0123abcd-2.webp'), type: 'image/webp' });
});

test('screenshots are saved under data/screenshots and deleted again; nothing else is touched', () => {
  const root = mkdtempSync(join(tmpdir(), 'cal-'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'pending.json'), '[]');
  const images = decodeImages([b64(JPEG), b64(PNG)]);
  saveScreenshots(root, images);
  const files = images.map((i) => join(root, 'data', 'screenshots', i.name));
  assert.ok(files.every(existsSync));

  deleteScreenshots(root, [images[0].name, '../pending.json', 'shot-00000000-9.jpg']); // a traversal name and a missing file are both ignored
  assert.ok(!existsSync(files[0]) && existsSync(files[1]));
  assert.ok(existsSync(join(root, 'data', 'pending.json')));
  deleteScreenshots(root, [images[1].name]);
  assert.ok(!existsSync(files[1]));
});
