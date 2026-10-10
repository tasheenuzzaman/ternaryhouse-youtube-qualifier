/**
 * Loads the REAL shipped page-only export scripts, in manifest order, into a
 * stub `self`, exactly as the extension's isolated world shares them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const sourceOf = (rel) => readFileSync(join(root, rel), 'utf8');

export function loadContentScripts() {
  const selfStub = {};
  for (const rel of ['content/video-selection.js', 'content/url-export.js', 'content/channel-details.js']) {
    // eslint-disable-next-line no-new-func
    new Function('self', sourceOf(rel))(selfStub);
  }
  return { VS: selfStub.THQVideoSelection, X: selfStub.THQUrlExport, CD: selfStub.THQChannelDetails };
}

/** The same queued, awaited harness the existing suites use. */
export function createHarness() {
  const queue = [];
  const failures = [];
  let passed = 0;
  return {
    test(name, fn) { queue.push({ name, fn }); },
    group(title) { queue.push({ group: title }); },
    async run() {
      for (const item of queue) {
        if (item.group) { console.log(`\n${item.group}`); continue; }
        try {
          await item.fn();
          passed += 1;
          console.log(`  ok   ${item.name}`);
        } catch (err) {
          failures.push({ name: item.name, message: err && err.message });
          console.log(`  FAIL ${item.name}\n       ${err && err.message}`);
        }
      }
      console.log(`\n${passed} passed, ${failures.length} failed`);
      if (failures.length) for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
      if (typeof process !== 'undefined' && process.exit) process.exit(failures.length ? 1 : 0);
    },
  };
}

export function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
export function equal(a, e, l = 'value') {
  if (a !== e) throw new Error(`${l}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}
