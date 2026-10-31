/**
 * "Copy 12 URLs" export tests.
 *
 * Exercises the REAL shipped content/url-export.js, evaluated in a minimal
 * stub environment, so the formatting, structural filtering, sort guard,
 * clipboard contract, prepared-block safety and lock release are tested
 * against production code rather than a reimplementation.
 *
 * Tests are queued and awaited in order; the summary is printed only after
 * every test, including async ones, has finished.
 *
 *   node tests/url-export.test.mjs
 *   deno run --allow-read tests/url-export.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const queue = [];
let passed = 0;
const failures = [];
function test(name, fn) { queue.push({ name, fn }); }
function group(t) { queue.push({ group: t }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function equal(a, e, l = 'value') {
  if (a !== e) throw new Error(`${l}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}

/* ------------------------------------------------------------------ *
 * Load the REAL content/url-export.js
 * ------------------------------------------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'content', 'url-export.js'), 'utf8');
// v1.2: url-export.js takes its URL primitives and the shared card selector
// from content/video-selection.js, which the manifest loads first.
const selectionSource = readFileSync(join(here, '..', 'content', 'video-selection.js'), 'utf8');
const selfStub = {};
// eslint-disable-next-line no-new-func
new Function('self', selectionSource)(selfStub);
// eslint-disable-next-line no-new-func
new Function('self', source)(selfStub);
const X = selfStub.THQUrlExport;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

// Twelve distinct, valid, obviously synthetic 11-character IDs, newest first.
const IDS = [
  'AAAAAAAAAA1', 'BBBBBBBBBB2', 'CCCCCCCCCC3', 'DDDDDDDDDD4', 'EEEEEEEEEE5', 'FFFFFFFFFF6',
  'GGGGGGGGGG7', 'HHHHHHHHHH8', 'IIIIIIIIII9', 'JJJJJJJJJ_0', 'KKKKKKKKK-1', 'LLLLLLLLLL2',
];
const MORE = ['MMMMMMMMMM3', 'NNNNNNNNNN4', 'OOOOOOOOOO5'];

const EXPECTED_BLOCK = [
  'https://www.youtube.com/watch?v=AAAAAAAAAA1',
  'https://www.youtube.com/watch?v=BBBBBBBBBB2',
  'https://www.youtube.com/watch?v=CCCCCCCCCC3',
  'https://www.youtube.com/watch?v=DDDDDDDDDD4',
  'https://www.youtube.com/watch?v=EEEEEEEEEE5',
  'https://www.youtube.com/watch?v=FFFFFFFFFF6',
  'https://www.youtube.com/watch?v=GGGGGGGGGG7',
  'https://www.youtube.com/watch?v=HHHHHHHHHH8',
  'https://www.youtube.com/watch?v=IIIIIIIIII9',
  'https://www.youtube.com/watch?v=JJJJJJJJJ_0',
  'https://www.youtube.com/watch?v=KKKKKKKKK-1',
  'https://www.youtube.com/watch?v=LLLLLLLLLL2',
].join('\n');

/**
 * Grid entries as readGridEntries() produces them. v1.2: every normal entry
 * carries the publication state the production reader always reads from its
 * card; these fixtures are ordinary published uploads.
 */
const PUBLISHED = 'PUBLISHED_COMPLETED';
const video = (id, extra = '') => ({ shorts: false, href: `/watch?v=${id}${extra}`, state: PUBLISHED });
const short = (id) => ({ shorts: true, href: null, shortsId: id });
const pending = () => ({ shorts: false, href: null });

/** A fake page + clipboard for driving createUrlExporter(). */
function makeEnv({ entries, latest = true, scope = 'A', alive = true, copyResult = true, steps = [] } = {}) {
  const env = {
    entries: entries.slice(),
    latest,
    scope,
    alive,
    copyResult,
    steps: steps.slice(),          // each loadMore() pops a function that mutates env
    log: { copy: [], readEntries: 0, loadMore: 0, loadMoreScroll: [], saveScroll: 0, restoreScroll: [], isLatest: 0 },
    scrollY: 777,
    lock: X.createDomLock(),
    clock: 1000,
  };
  env.deps = {
    isLatest: () => { env.log.isLatest += 1; return env.latest; },
    scopeKey: () => env.scope,
    isAlive: () => env.alive,
    readEntries: () => { env.log.readEntries += 1; return env.entries.slice(); },
    loadMore: async (options = {}) => {
      env.log.loadMore += 1;
      env.log.loadMoreScroll.push(options.scroll !== false);
      const step = env.steps.shift();
      if (step) await step(env);
      return true;
    },
    saveScroll: () => { env.log.saveScroll += 1; return env.scrollY; },
    restoreScroll: (y) => { env.log.restoreScroll.push(y); },
    copy: async (text) => {
      env.log.copy.push(text);
      if (env.copyResult instanceof Error) throw env.copyResult;
      return env.copyResult;
    },
    lock: env.lock,
    maxLoadSteps: 4,
    readyTtlMs: 60000,
    now: () => env.clock,
  };
  env.exporter = X.createUrlExporter(env.deps);
  return env;
}

/* =================================================================== *
 * Harness self-check
 * =================================================================== */

group('HARNESS SELF-CHECK');

test('0. a false assertion after an await is actually caught', async () => {
  let caught = false;
  try {
    await Promise.resolve();
    equal(1, 2, 'deliberate');
  } catch {
    caught = true;
  }
  assert(caught, 'async assertions must execute before the summary');
});

/* =================================================================== *
 * Format
 * =================================================================== */

group('FORMAT');

test('A. 12 known IDs produce exactly the locked 12-line block', () => {
  equal(X.formatExportBlock(IDS), EXPECTED_BLOCK, 'exact clipboard string');
});

test('B. order is preserved: newest stays first, oldest stays last', () => {
  const lines = X.formatExportBlock(IDS).split('\n');
  for (let i = 0; i < 12; i += 1) {
    equal(lines[i], `https://www.youtube.com/watch?v=${IDS[i]}`, `line ${i + 1}`);
  }
  const reversed = X.formatExportBlock(IDS.slice().reverse()).split('\n');
  equal(reversed[0], `https://www.youtube.com/watch?v=${IDS[11]}`, 'input order is never re-sorted');
});

test('C. duplicate DOM IDs cannot produce duplicate lines', () => {
  const entries = [video(IDS[0]), video(IDS[0]), video(IDS[1]), video(IDS[0], '&t=30s'), ...IDS.slice(2).map((id) => video(id))];
  const { ids } = X.selectExportIds(entries);
  equal(ids.length, 12, 'twelve unique');
  equal(new Set(ids).size, 12, 'all distinct');
  equal(ids.join(','), IDS.join(','), 'first occurrence kept, order intact');
  equal(X.formatExportBlock([IDS[0], ...IDS.slice(0, 11)]), null, 'a list containing a duplicate is refused');
});

test('D. a successful block always has exactly 12 lines', () => {
  equal(X.formatExportBlock(IDS).split('\n').length, 12, 'twelve lines');
  equal(X.formatExportBlock(IDS.slice(0, 11)), null, '11 refused');
  equal(X.formatExportBlock([...IDS, MORE[0]]), null, '13 refused');
  equal(X.formatExportBlock([]), null, 'empty refused');
  equal(X.formatExportBlock(null), null, 'null refused');
});

test('E. fewer than 12 never produces a complete-looking block', () => {
  for (let n = 0; n < 12; n += 1) equal(X.formatExportBlock(IDS.slice(0, n)), null, `${n} IDs`);
  const { ids } = X.selectExportIds(IDS.slice(0, 7).map((id) => video(id)));
  equal(ids.length, 7, 'selection reports what it found');
});

test('F. links are canonicalised: only the video ID survives', () => {
  const noisy = [
    '/watch?v=AAAAAAAAAA1&t=95s',
    '/watch?v=BBBBBBBBBB2&list=PLxyz&index=4',
    '/watch?v=CCCCCCCCCC3&pp=0gcJCf4LAYcqIYzv',
    '/watch?v=DDDDDDDDDD4&feature=youtu.be&si=abcdef',
    '/watch?v=EEEEEEEEEE5#comments',
    '/watch?app=desktop&v=FFFFFFFFFF6',
    'https://www.youtube.com/watch?v=GGGGGGGGGG7&utm_source=x',
    'https://m.youtube.com/watch?v=HHHHHHHHHH8',
    '/watch?v=IIIIIIIIII9&t=1h2m3s&start_radio=1',
    '/watch?v=JJJJJJJJJ_0&ab_channel=Creator',
    '/watch?v=KKKKKKKKK-1&lc=Ugx',
    '/watch?v=LLLLLLLLLL2&pp=ygU2#t=10',
  ];
  const { ids } = X.selectExportIds(noisy.map((href) => ({ shorts: false, href, state: PUBLISHED })));
  equal(X.formatExportBlock(ids), EXPECTED_BLOCK, 'canonical output');
  for (const line of X.formatExportBlock(ids).split('\n')) {
    assert(/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(line), `canonical, unnumbered: ${line}`);
  }
  equal(X.canonicalWatchUrl('AAAAAAAAAA1'), 'https://www.youtube.com/watch?v=AAAAAAAAAA1', 'canonicalWatchUrl');
});

test('G. malformed IDs and foreign links create no URL', () => {
  for (const bad of ['', 'short', 'AAAAAAAAAA', 'AAAAAAAAAA12', 'AAAAA AAAAA', 'AAAAAAAAA$1', null, undefined, 42]) {
    equal(X.canonicalWatchUrl(bad), null, `canonicalWatchUrl(${JSON.stringify(bad)})`);
    equal(X.isValidVideoId(bad), false, `isValidVideoId(${JSON.stringify(bad)})`);
  }
  for (const href of ['/watch?v=bad', '/watch?x=AAAAAAAAAA1', '/watch', 'https://evil.example/watch?v=AAAAAAAAAA1',
    '/results?v=AAAAAAAAAA1', 'javascript:alert(1)', '/live/AAAAAAAAAA1', '']) {
    equal(X.watchIdFromHref(href), null, `watchIdFromHref(${JSON.stringify(href)})`);
  }
  const { ids } = X.selectExportIds([{ shorts: false, href: '/watch?v=bad' }, video(IDS[0])]);
  equal(ids.join(','), IDS[0], 'the malformed entry contributes nothing');
  equal(X.formatExportBlock([...IDS.slice(0, 11), 'not-an-id!!']), null, 'a block containing an invalid ID is refused');
});

test('H. newline format: no blanks, no Markdown, no extra text', () => {
  const block = X.formatExportBlock(IDS);
  assert(!block.endsWith('\n'), 'no trailing newline');
  assert(!block.startsWith('\n'), 'no leading newline');
  assert(!block.includes('\n\n'), 'no blank lines');
  assert(!block.includes('\r'), 'no carriage returns');
  for (const forbidden of ['[', ']', '(', ')', '*', '"', "'", '`', '- ', '#', '<', 'Video', 'URL']) {
    assert(!block.includes(forbidden), `contains no ${JSON.stringify(forbidden)}`);
  }
  equal(block.split('\n').filter((l) => l.trim() === '').length, 0, 'zero empty lines');
});

/* =================================================================== *
 * Surface rules
 * =================================================================== */

group('SURFACE');

test('I. Shorts are excluded structurally and never shift the numbering', () => {
  const entries = [video(IDS[0]), short('SHORTSHORT1'), video(IDS[1]), short('SHORTSHORT2'),
    ...IDS.slice(2).map((id) => video(id))];
  const { ids } = X.selectExportIds(entries);
  equal(ids.join(','), IDS.join(','), 'Shorts skipped, normal videos keep their order');
  equal(X.watchIdFromHref('/shorts/SHORTSHORT1'), null, '/shorts/ link yields nothing');
  // An item containing a Shorts link is a Short even if it also has a watch link.
  const mixed = X.selectExportIds([{ shorts: true, href: `/watch?v=${MORE[0]}` }, video(IDS[0])]).ids;
  equal(mixed.join(','), IDS[0], 'same rule as the metric harvester');
});

test('J. a 0:58 normal /watch?v= upload stays eligible: runtime is never considered', () => {
  // A decorated entry, as if the card showed "0:58". The export has no
  // duration rule, so the extra field is simply irrelevant.
  const entries = IDS.map((id, i) => ({ ...video(id), runtimeLabel: i === 3 ? '0:58' : '12:04' }));
  const { ids } = X.selectExportIds(entries);
  equal(ids[3], IDS[3], 'the 0:58 upload keeps its slot');
  equal(ids.length, 12, 'all twelve exported');
  assert(!/duration|seconds|runtime\s*[<>]/i.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    'url-export.js code contains no duration logic');
});

test('J2. an item whose link has not rendered stops collection rather than shifting order', () => {
  const entries = [video(IDS[0]), video(IDS[1]), pending(), video(IDS[2]), video(IDS[3])];
  const { ids, pending: isPending } = X.selectExportIds(entries);
  equal(ids.join(','), `${IDS[0]},${IDS[1]}`, 'nothing after the unrendered item is taken');
  equal(isPending, true, 'reported as pending');
});

test('J3. readGridEntries mirrors the metric harvester on a stub grid', () => {
  const anchor = (href) => ({ getAttribute: (k) => (k === 'href' ? href : null), closest: () => null });
  const item = ({ watch = null, shortsHref = null }) => ({
    querySelector(sel) {
      if (sel === 'a[href^="/shorts/"]') return shortsHref ? anchor(shortsHref) : null;
      if (sel === 'a[href*="/watch?v="]') return watch ? anchor(watch) : null;
      return null;
    },
  });
  const items = [
    item({ watch: `/watch?v=${IDS[0]}&pp=x` }),
    item({ shortsHref: '/shorts/SHORTSHORT1' }),
    item({}), // not yet rendered
    item({ watch: `/watch?v=${IDS[1]}` }),
  ];
  const grid = { querySelectorAll: (sel) => (sel.includes('ytd-rich-item-renderer') ? items : []) };
  const entries = X.readGridEntries(grid);
  equal(entries.length, 4, 'one entry per item, in order');
  equal(entries[0].href, `/watch?v=${IDS[0]}&pp=x`, 'watch link read');
  equal(entries[1].shorts, true, 'Shorts item flagged');
  equal(entries[2].href, null, 'unrendered item reported, not dropped');
  equal(X.readGridEntries(null).length, 0, 'no grid -> no entries');
});

/* =================================================================== *
 * Export operation
 * =================================================================== */

group('EXPORT OPERATION');

test('K. Popular/Oldest: nothing collected, scrolled or copied', async () => {
  const env = makeEnv({ entries: IDS.map((id) => video(id)), latest: false });
  const result = await env.exporter.click();
  equal(result.status, 'WRONG_SORT', 'status');
  equal(X.exportButtonText(result), 'Switch to Latest', 'label');
  equal(env.log.copy.length, 0, 'clipboard untouched');
  equal(env.log.readEntries, 0, 'grid not read');
  equal(env.log.saveScroll, 0, 'scroll untouched');
  equal(env.log.loadMore, 0, 'no loading');
});

test('K2. switching away from Latest during a top-up aborts without copying', async () => {
  const env = makeEnv({
    entries: IDS.slice(0, 8).map((id) => video(id)),
    steps: [async (e) => { e.latest = false; e.entries = IDS.map((id) => video(id)); }],
  });
  const result = await env.exporter.click();
  equal(result.status, 'WRONG_SORT', 'status');
  equal(env.log.copy.length, 0, 'clipboard untouched');
  equal(env.log.restoreScroll.length, 1, 'scroll restored anyway');
});

test('L. 12 already mounted: exactly one clipboard write, no scrolling', async () => {
  const env = makeEnv({ entries: [...IDS, ...MORE].map((id) => video(id)) });
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'status');
  equal(X.exportButtonText(result), 'Copied 12 URLs', 'label');
  equal(env.log.copy.length, 1, 'exactly one write');
  equal(env.log.copy[0], EXPECTED_BLOCK, 'exact block');
  equal(env.log.loadMore, 0, 'no top-up needed');
  equal(env.log.saveScroll, 0, 'scroll untouched');
});

test('L2. fewer mounted: bounded top-up, one write, scroll restored', async () => {
  const env = makeEnv({
    entries: IDS.slice(0, 8).map((id) => video(id)),
    steps: [async (e) => { e.entries = [...IDS, ...MORE].map((id) => video(id)); }],
  });
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'status');
  equal(env.log.copy.length, 1, 'one write');
  equal(env.log.copy[0], EXPECTED_BLOCK, 'exact block');
  equal(env.log.loadMore, 1, 'stopped as soon as 12 were found');
  equal(env.log.saveScroll, 1, 'scroll saved once');
  equal(env.log.restoreScroll.join(','), '777', 'restored to the saved position');
});

test('L3. nothing more loads: stops, reports Found N of 12, clipboard untouched', async () => {
  const env = makeEnv({ entries: IDS.slice(0, 8).map((id) => video(id)) });
  const result = await env.exporter.click();
  equal(result.status, 'INSUFFICIENT', 'status');
  equal(result.count, 8, 'count');
  equal(X.exportButtonText(result), 'Found 8 of 12', 'label');
  equal(env.log.copy.length, 0, 'clipboard NOT overwritten');
  equal(env.log.loadMore, 1, 'gave up after a step with no growth');
  equal(env.log.restoreScroll.join(','), '777', 'scroll restored');
});

test('L4. top-up is hard-bounded even if the grid keeps trickling', async () => {
  const grow = (e) => { e.entries = e.entries.concat([video(`TRICKLE${String(e.entries.length).padStart(4, '0')}`)]); };
  const env = makeEnv({
    entries: IDS.slice(0, 2).map((id) => video(id)),
    steps: Array.from({ length: 50 }, () => async (e) => grow(e)),
  });
  const result = await env.exporter.click();
  equal(env.log.loadMore, 4, 'never more than maxLoadSteps');
  equal(result.status, 'INSUFFICIENT', 'still short');
  equal(result.count, 6, '2 + 4 trickled');
  equal(env.log.copy.length, 0, 'nothing copied');
});

test('L5. an unrendered item is waited for, then copied in true order', async () => {
  const env = makeEnv({
    entries: [video(IDS[0]), pending(), ...IDS.slice(2).map((id) => video(id))],
    steps: [async (e) => { e.entries[1] = video(IDS[1]); }],
  });
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'status');
  equal(env.log.copy[0], EXPECTED_BLOCK, 'slot 2 holds the video that rendered late');
});

test('L5b. a pending item is waited for WITHOUT scrolling, through unrelated grid changes', async () => {
  const env = makeEnv({
    entries: [...IDS.slice(0, 4).map((id) => video(id)), pending(), ...IDS.slice(5).map((id) => video(id))],
    steps: [
      async () => {},                                   // an unrelated mutation: nothing changes
      async () => {},                                   // another one
      async (e) => { e.entries[4] = video(IDS[4]); },   // the item finally renders
    ],
  });
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'not given up early');
  equal(env.log.copy[0], EXPECTED_BLOCK, 'true order');
  equal(env.log.loadMore, 3, 'kept waiting');
  equal(env.log.loadMoreScroll.join(','), 'false,false,false', 'never scrolled while waiting for a rendered item');
});

test('L5c. a pending item that never renders is still hard-bounded', async () => {
  const env = makeEnv({ entries: [video(IDS[0]), pending(), video(IDS[1])], steps: [] });
  const result = await env.exporter.click();
  equal(env.log.loadMore, 4, 'stops at maxLoadSteps');
  equal(result.status, 'INSUFFICIENT', 'reported');
  equal(result.count, 1, 'only what precedes the unrendered item');
  equal(env.log.copy.length, 0, 'nothing copied');
});

test('L5d. a genuinely short grid scrolls for more', async () => {
  const env = makeEnv({ entries: IDS.slice(0, 6).map((id) => video(id)) });
  await env.exporter.click();
  equal(env.log.loadMoreScroll.join(','), 'true', 'asked the page to load more');
});

test('L6. a second click while one is running is ignored (no double write)', async () => {
  let release;
  const env = makeEnv({
    entries: IDS.slice(0, 8).map((id) => video(id)),
    steps: [() => new Promise((r) => { release = () => { env.entries = IDS.map((id) => video(id)); r(); }; })],
  });
  const first = env.exporter.click();
  await Promise.resolve();
  await Promise.resolve();
  const second = await env.exporter.click();
  equal(second.status, 'IGNORED', 're-entrant click ignored');
  release();
  equal((await first).status, 'COPIED', 'first completes');
  equal(env.log.copy.length, 1, 'exactly one write');
});

test('L7. clipboard refusal in the immediate path reports Copy failed, prepares nothing', async () => {
  const env = makeEnv({ entries: IDS.map((id) => video(id)), copyResult: false });
  const result = await env.exporter.click();
  equal(result.status, 'COPY_FAILED', 'status');
  equal(X.exportButtonText(result), 'Copy failed', 'label');
  equal(env.exporter.hasPrepared, false, 'no prepared block for a synchronous failure');

  const thrower = makeEnv({ entries: IDS.map((id) => video(id)), copyResult: new Error('denied') });
  equal((await thrower.exporter.click()).status, 'COPY_FAILED', 'a throwing clipboard is surfaced, not thrown');
});

/* =================================================================== *
 * Prepared-block (second-click) safety
 * =================================================================== */

group('PREPARED BLOCK SAFETY');

/** A creator-A exporter left holding a READY block after an async copy failure. */
async function readyForCreatorA() {
  const env = makeEnv({
    entries: IDS.slice(0, 8).map((id) => video(id)),
    copyResult: false,
    steps: [async (e) => { e.entries = IDS.map((id) => video(id)); }],
  });
  const first = await env.exporter.click();
  equal(first.status, 'READY', 'READY only after an async copy failure');
  equal(X.exportButtonText(first), 'Ready — click to copy', 'label');
  equal(env.exporter.hasPrepared, true, 'prepared');
  env.copyResult = true;
  env.log.copy.length = 0;
  // Count lock acquisitions: a FRESH export collects under the DOM lock, a
  // prepared-block copy never touches the lock. That is how the tests tell
  // the two paths apart when they would copy identical text.
  env.lockRuns = [];
  const realRun = env.lock.run;
  env.lock.run = (name, work) => { env.lockRuns.push(name); return realRun(name, work); };
  return env;
}

test('N0. same creator, same Latest grid: second click copies the prepared block once', async () => {
  const env = await readyForCreatorA();
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'copied');
  equal(env.log.copy.length, 1, 'one write');
  equal(env.log.copy[0], EXPECTED_BLOCK, 'the prepared block');
  equal(env.lockRuns.length, 0, 'copied from the prepared block, not re-collected');
  equal(env.exporter.hasPrepared, false, 'single-use');
});

test('N. creator A prepared -> SPA to creator B -> click: A URLs are NEVER copied', async () => {
  const env = await readyForCreatorA();
  const aBlock = X.formatExportBlock(IDS);
  const bIds = ['BBBBBBBBB01', 'BBBBBBBBB02', 'BBBBBBBBB03', 'BBBBBBBBB04', 'BBBBBBBBB05', 'BBBBBBBBB06',
    'BBBBBBBBB07', 'BBBBBBBBB08', 'BBBBBBBBB09', 'BBBBBBBBB10', 'BBBBBBBBB11', 'BBBBBBBBB12'];
  env.scope = 'B';
  env.entries = bIds.map((id) => video(id));
  const result = await env.exporter.click();
  assert(!env.log.copy.includes(aBlock), 'creator A block was not copied');
  equal(result.status, 'COPIED', 'a fresh export of creator B ran instead');
  equal(env.log.copy[0], X.formatExportBlock(bIds), 'creator B block');
});

test('N2. even with an identical scope key, a different grid invalidates the block', async () => {
  const env = await readyForCreatorA();
  env.entries = [...MORE, ...IDS].map((id) => video(id)); // grid now starts differently
  const result = await env.exporter.click();
  assert(!env.log.copy.includes(EXPECTED_BLOCK), 'stale block not copied');
  equal(result.status, 'COPIED', 'fresh export instead');
});

test('N3. switching away from Latest invalidates the block', async () => {
  const env = await readyForCreatorA();
  env.latest = false;
  const result = await env.exporter.click();
  equal(result.status, 'WRONG_SORT', 'refused');
  equal(env.log.copy.length, 0, 'nothing copied');
  equal(env.exporter.hasPrepared, false, 'block discarded');
});

test('N4. Controller destroyed (not alive) invalidates the block', async () => {
  const env = await readyForCreatorA();
  env.alive = false;
  const result = await env.exporter.click();
  equal(env.log.copy.length, 0, 'nothing copied');
  equal(result.status, 'ABORTED', 'no work on a dead controller');
});

test('N5. the block expires: an old block is never copied, a fresh export runs', async () => {
  const env = await readyForCreatorA();
  env.clock += 60001;
  await env.exporter.click();
  equal(env.lockRuns.join(','), 'export', 'expired block discarded; the grid was freshly collected');
  equal(env.log.copy.length, 1, 'one write');
  equal(env.exporter.hasPrepared, false, 'nothing left prepared');

  const fresh = await readyForCreatorA();
  fresh.clock += 59999;
  await fresh.exporter.click();
  equal(fresh.lockRuns.length, 0, 'just inside the TTL, the prepared block is used');
});

test('N6. invalidate() (refresh / destroy / route change) discards the block', async () => {
  const env = await readyForCreatorA();
  env.exporter.invalidate();
  equal(env.exporter.hasPrepared, false, 'discarded');
});

test('N7 (A). only the first 11 are live and match: block REJECTED, never written', async () => {
  const env = await readyForCreatorA();
  env.entries = IDS.slice(0, 11).map((id) => video(id)); // 12th not exposed; nothing more loads
  const result = await env.exporter.click();
  equal(env.lockRuns.join(','), 'export', 'prepared path refused; a fresh collection ran instead');
  equal(env.log.copy.length, 0, 'NOTHING written to the clipboard');
  assert(!env.log.copy.includes(EXPECTED_BLOCK), 'the stale 12-line block was never written');
  equal(result.status, 'INSUFFICIENT', 'the fresh collection honestly reports what it found');
  equal(result.count, 11, 'Found 11 of 12');
  equal(env.exporter.hasPrepared, false, 'stale block discarded');
});

test('N8 (B). only the first 5 are live and match: block REJECTED, never written', async () => {
  const env = await readyForCreatorA();
  env.entries = IDS.slice(0, 5).map((id) => video(id));
  const result = await env.exporter.click();
  equal(env.lockRuns.join(','), 'export', 'prepared path refused');
  equal(env.log.copy.length, 0, 'NOTHING written to the clipboard');
  assert(!env.log.copy.includes(EXPECTED_BLOCK), 'the stale 12-line block was never written');
  equal(result.status, 'INSUFFICIENT', 'status');
  equal(result.count, 5, 'Found 5 of 12');
});

test('N8b. matching 5-prefix, but the grid now continues differently: only fresh content is written', async () => {
  const env = await readyForCreatorA();
  const changedTail = ['TAILTAILT01', 'TAILTAILT02', 'TAILTAILT03', 'TAILTAILT04', 'TAILTAILT05', 'TAILTAILT06', 'TAILTAILT07'];
  env.entries = IDS.slice(0, 5).map((id) => video(id));
  env.steps = [async (e) => { e.entries = [...IDS.slice(0, 5), ...changedTail].map((id) => video(id)); }];
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'a fresh, fully collected block was copied');
  equal(env.log.copy.length, 1, 'one write');
  assert(env.log.copy[0] !== EXPECTED_BLOCK, 'it is NOT the stale prepared block');
  equal(env.log.copy[0], X.formatExportBlock([...IDS.slice(0, 5), ...changedTail]), 'it is the live grid');
});

test('N9 (C). all 12 live and matching position for position: block remains valid', async () => {
  const env = await readyForCreatorA();
  env.entries = [...IDS, ...MORE].map((id) => video(id)); // more than 12 mounted is fine
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'copied');
  equal(env.lockRuns.length, 0, 'served from the prepared block, no re-collection');
  equal(env.log.copy.join('|'), EXPECTED_BLOCK, 'exactly the prepared block, once');
});

test('N10 (D). all 12 present but one position differs: block REJECTED', async () => {
  const env = await readyForCreatorA();
  const swapped = IDS.slice();
  [swapped[6], swapped[7]] = [swapped[7], swapped[6]];
  env.entries = swapped.map((id) => video(id));
  const result = await env.exporter.click();
  equal(env.lockRuns.join(','), 'export', 'prepared path refused');
  assert(!env.log.copy.includes(EXPECTED_BLOCK), 'the stale block was never written');
  equal(result.status, 'COPIED', 'the fresh, correctly ordered list was copied instead');
  equal(env.log.copy[0], X.formatExportBlock(swapped), 'live order');
});

/* =================================================================== *
 * Locking
 * =================================================================== */

group('LOCKING');

test('O. a failed collection releases the lock and the exporter', async () => {
  const env = makeEnv({
    entries: IDS.slice(0, 5).map((id) => video(id)),
    steps: [async () => { throw new Error('YouTube changed its DOM'); }],
  });
  const result = await env.exporter.click();
  equal(result.status, 'INSUFFICIENT', 'reported, not thrown');
  equal(env.lock.holder, null, 'lock released');
  equal(env.exporter.running, false, 'exporter free');
  equal(env.log.restoreScroll.join(','), '777', 'scroll restored in finally');
  let metricsRan = false;
  await env.lock.run('metrics', async () => { metricsRan = true; });
  equal(metricsRan, true, 'metric collection is not blocked afterwards');
});

test('O2. a throwing grid read is surfaced and still releases everything', async () => {
  const env = makeEnv({ entries: IDS.map((id) => video(id)) });
  env.deps.readEntries = () => { throw new Error('boom'); };
  const exporter = X.createUrlExporter(env.deps);
  const result = await exporter.click();
  equal(result.status, 'COPY_FAILED', 'surfaced as a failure');
  equal(env.lock.holder, null, 'lock released');
  equal(exporter.running, false, 'exporter free');
});

test('O3. the lock serialises metric and export scrolling', async () => {
  const lock = X.createDomLock();
  let active = 0;
  let maxActive = 0;
  const order = [];
  const work = (name, ms) => lock.run(name, async () => {
    active += 1; maxActive = Math.max(maxActive, active); order.push(`${name}:start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${name}:end`); active -= 1;
  });
  await Promise.all([work('metrics', 15), work('export', 5), work('metrics', 1)]);
  equal(maxActive, 1, 'never two scrolling operations at once');
  equal(order.join(' '), 'metrics:start metrics:end export:start export:end metrics:start metrics:end', 'FIFO');
});

test('O4. a throwing holder never deadlocks the next one', async () => {
  const lock = X.createDomLock();
  let threw = false;
  try { await lock.run('export', async () => { throw new Error('x'); }); } catch { threw = true; }
  equal(threw, true, 'error propagated to its own caller');
  equal(lock.holder, null, 'released');
  equal(await lock.run('metrics', async () => 'ran'), 'ran', 'next holder runs');
});

test('O5. controller destroyed mid-collection: no copy, no scroll on the new page', async () => {
  const env = makeEnv({
    entries: IDS.slice(0, 6).map((id) => video(id)),
    steps: [async (e) => { e.alive = false; e.scope = 'B'; e.entries = IDS.map((id) => video(id)); }],
  });
  const result = await env.exporter.click();
  equal(result.status, 'ABORTED', 'aborted');
  equal(env.log.copy.length, 0, 'nothing copied');
  equal(env.log.restoreScroll.length, 0, "the new creator's page is not scrolled");
  equal(env.lock.holder, null, 'lock released');
});

test('O6. an export waiting behind a metric lock still completes', async () => {
  const env = makeEnv({ entries: IDS.map((id) => video(id)) });
  let release;
  const metric = env.lock.run('metrics', () => new Promise((r) => { release = r; }));
  const exporting = env.exporter.click();
  await new Promise((r) => setTimeout(r, 5));
  equal(env.log.copy.length, 0, 'export waits for the metric collection');
  release();
  await metric;
  equal((await exporting).status, 'COPIED', 'then completes');
  equal(env.log.copy.length, 1, 'one write');
});

/* =================================================================== *
 * Labels
 * =================================================================== */

group('LABELS');

test('P. every button label is exactly as specified', () => {
  equal(X.EXPORT_TEXT.IDLE, 'Copy 12 URLs', 'normal');
  equal(X.EXPORT_TEXT.WORKING, 'Copying...', 'working');
  equal(X.exportButtonText({ status: 'COPIED', count: 12 }), 'Copied 12 URLs', 'success');
  equal(X.exportButtonText({ status: 'WRONG_SORT' }), 'Switch to Latest', 'wrong sort');
  equal(X.exportButtonText({ status: 'INSUFFICIENT', count: 7 }), 'Found 7 of 12', 'insufficient');
  equal(X.exportButtonText({ status: 'INSUFFICIENT', count: 0 }), 'Found 0 of 12', 'nothing found');
  equal(X.exportButtonText({ status: 'COPY_FAILED' }), 'Copy failed', 'clipboard failure');
  equal(X.exportButtonText({ status: 'READY' }), 'Ready — click to copy', 'ready');
  equal(X.exportButtonText({ status: 'IGNORED' }), null, 'ignored leaves the label alone');
});

/* ------------------------------------------------------------------ */

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
const exit = (code) => {
  if (typeof process !== 'undefined' && process.exit) process.exit(code);
  else if (typeof Deno !== 'undefined') Deno.exit(code);
};
exit(failures.length ? 1 : 0);
