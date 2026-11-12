// Shared by the tests that need real files: a throwaway copy of the project's data folders.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sifl = { id: 'sifl', name: 'Sydney Intervarsity Fencing League', image: 'img/sifl.jpg', aliases: ['SIFL'] };

/** A temporary project root with the schema, no events, one organiser (sifl) and two logo files. */
export function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cal-test-'));
  for (const dir of ['docs/data', 'docs/img', 'data', 'schema']) mkdirSync(join(root, dir), { recursive: true });
  cpSync(new URL('../schema/event.schema.json', import.meta.url), join(root, 'schema', 'event.schema.json'));
  writeFileSync(join(root, 'docs', 'data', 'events.json'), '[]');
  writeFileSync(join(root, 'docs', 'data', 'organisers.json'), JSON.stringify([sifl]));
  writeFileSync(join(root, 'docs', 'img', 'sifl.jpg'), 'x');
  writeFileSync(join(root, 'docs', 'img', 'other.png'), 'x');
  return root;
}
