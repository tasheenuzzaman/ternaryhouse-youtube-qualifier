/**
 * v1.2 shared card reader, publication-aware 12-video selector, and the
 * general "Copy all video URLs" inventory.
 *
 * Runs the REAL shipped content/video-selection.js and content/url-export.js.
 * Card markup comes from tests/fixtures/youtube-markup.mjs — SIMULATED
 * YouTube markup, not live captures — parsed by tests/helpers/mini-dom.mjs so
 * the production DOM readers run unmodified under plain Node.
 *
 *   node tests/video-selection.test.mjs
 */

import { parseHTML, fragment } from './helpers/mini-dom.mjs';
import { loadContentScripts, createHarness, assert, equal, sourceOf } from './helpers/load-content.mjs';
import {
  STATUS, publishedAt, modernCard, legacyRichCard, legacyGridCard, shortsCard, unrenderedCard, playlistCard, grid,
} from './fixtures/youtube-markup.mjs';

const { VS, X } = loadContentScripts();
const { test, group, run } = createHarness();
const P = VS.STATE;

/** Distinct, valid, obviously synthetic 11-character IDs. */
const vid = (n) => `V${String(n).padStart(10, '0')}`;
const url = (id) => `https://www.youtube.com/watch?v=${id}`;
const gridOf = (cards) => parseHTML(grid(cards.join(''))).children[0];
const seg = (text, zone = 'meta') => ({ text, zone });
const classify = (segments, extra = {}) => VS.classifyCard({ hasTitle: true, segments, ...extra });

/** Card builders keyed by layout, so each scenario runs on every layout. */
const LAYOUTS = { modern: modernCard, legacyRich: legacyRichCard, legacyGrid: legacyGridCard };

/** Twelve published cards, newest first, n days apart. */
const publishedRun = (build, from, count, startDay = 1) => Array.from(
  { length: count },
  (_, i) => build({ id: vid(from + i), title: `Published video ${from + i}`, ...publishedAt(startDay + i * 3) }),
);

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

test('0b. the mini DOM parses, walks and matches the selectors the readers use', () => {
  const root = parseHTML('<div id="a" class="x y"><a href="/watch?v=AAAAAAAAAAA">t<b>u</b></a><a href="/shorts/S">s</a><p hidden="">h</p></div>');
  const div = root.children[0];
  equal(div.querySelectorAll('a[href*="/watch?v="]').length, 1, 'contains');
  equal(div.querySelectorAll('a[href^="/shorts/"]').length, 1, 'prefix');
  equal(div.querySelectorAll('a[href]').length, 2, 'presence');
  equal(div.querySelector('#a') , null, 'querySelector does not match the element itself');
  equal(root.querySelector('div.x.y#a'), div, 'compound');
  equal(root.querySelector('div a b').textContent, 'u', 'descendant');
  equal(div.querySelector('a').textContent, 'tu', 'textContent');
  equal(div.querySelector('p').hasAttribute('hidden'), true, 'hidden attribute');
  equal(div.querySelector('b').closest('#a'), div, 'closest');
});

/* =================================================================== *
 * Publication state from card text
 * =================================================================== */

group('PUBLICATION STATE (pure)');

test('C1. published ages, completed Premieres and completed streams are PUBLISHED', () => {
  for (const [text, basis] of [
    ['3 days ago', 'CARD_PUBLISHED_AGE_TEXT'],
    ['1 day ago', 'CARD_PUBLISHED_AGE_TEXT'],
    ['5 hours ago', 'CARD_PUBLISHED_AGE_TEXT'],
    ['2 years ago', 'CARD_PUBLISHED_AGE_TEXT'],
    ['Premiered 5 days ago', 'CARD_COMPLETED_PREMIERE_TEXT'],
    ['Streamed 6 days ago', 'CARD_COMPLETED_STREAM_TEXT'],
  ]) {
    const r = classify([seg('10:15', 'thumb'), seg('12K views'), seg(text)]);
    equal(r.state, P.PUBLISHED, text);
    equal(r.basis, basis, `${text} basis`);
    equal(r.publishedText, text, `${text} kept verbatim`);
  }
});

test('C2. every scheduled signal, alone, is SCHEDULED_UPCOMING', () => {
  for (const s of [
    seg('Premieres 10/11/26, 8:00 PM'), seg('Premieres in 3 hours'), seg('Scheduled for 10/11/26, 8:00 PM'),
    seg('UPCOMING', 'thumb'), seg('PREMIERE', 'thumb'), seg('12 waiting'), seg('1.2K waiting'), seg('Notify me', 'control'),
  ]) {
    const r = classify([s]);
    equal(r.state, P.SCHEDULED, s.text);
    equal(r.evidence, s.text, `${s.text} evidence`);
  }
});

test('C3. live signals are LIVE_NOW', () => {
  for (const t of ['LIVE', 'Live now', '1.2K watching', '87 watching now', 'Premiering now']) {
    equal(classify([seg(t)]).state, P.LIVE, t);
  }
});

test('C4. contradictory status FAILS CLOSED as INDETERMINATE', () => {
  const cases = [
    [seg('3 days ago'), seg('Notify me', 'control')],
    [seg('3 days ago'), seg('LIVE', 'thumb')],
    [seg('Premiered 2 days ago'), seg('Premieres 10/11/26, 8:00 PM')],
    [seg('3 days ago'), seg('2 years ago')],
  ];
  for (const segments of cases) {
    const r = classify(segments);
    equal(r.state, P.INDETERMINATE, segments.map((s) => s.text).join(' + '));
    equal(r.basis, 'CARD_STATUS_CONFLICT', 'basis');
  }
  equal(classify([seg('3 days ago'), seg('3 days ago')]).state, P.PUBLISHED, 'the same age twice is not a conflict');
});

test('C5. no status, no title, disagreeing links or title: INDETERMINATE, never published', () => {
  equal(classify([seg('12K views'), seg('10:15', 'thumb')]).basis, 'CARD_STATUS_NOT_FOUND', 'no status text');
  equal(classify([]).state, P.INDETERMINATE, 'nothing rendered');
  equal(classify([seg('3 days ago')], { hasTitle: false }).basis, 'CARD_TITLE_NOT_FOUND', 'no title');
  equal(classify([seg('3 days ago')], { idConflict: true }).basis, 'CARD_LINKS_DISAGREE', 'links disagree');
  equal(classify([seg('3 days ago')], { titleConflict: true }).basis, 'CARD_TITLE_DISAGREES', 'title disagrees');
  equal(classify([seg('Oct 3, 2026')]).state, P.INDETERMINATE, 'an absolute date is not guessed at');
  equal(classify([seg('hace 3 días')]).state, P.INDETERMINATE, 'a non-English UI fails closed rather than guessing');
});

test('C6. the word "Premiere" alone never excludes a completed Premiere', () => {
  const r = classify([seg('24:03', 'thumb'), seg('48K views'), seg('Premiered 5 days ago')]);
  equal(r.state, P.PUBLISHED, 'completed Premiere is published');
});

test('C7. one text node holding several delimited parts is split', () => {
  equal(classify([seg('12K views • 3 days ago')]).state, P.PUBLISHED, 'bullet');
  equal(classify([seg('12 waiting · Premieres 10/11/26, 8:00 PM')]).state, P.SCHEDULED, 'middle dot');
});

test('C8. runtime never changes the outcome (0:58 and 3:00:00 alike)', () => {
  for (const runtime of ['0:58', '0:05', '10:15', '3:00:00', null]) {
    const segments = [runtime ? seg(runtime, 'thumb') : null, seg('3 days ago')].filter(Boolean);
    equal(classify(segments).state, P.PUBLISHED, `runtime ${runtime}`);
  }
  equal(VS.runtimeBadgeText([seg('0:58', 'thumb'), seg('3 days ago')]), '0:58', 'runtime captured as text only');
});

/* =================================================================== *
 * Reading real-shaped cards (simulated markup, real reader code)
 * =================================================================== */

group('CARD READER (simulated modern + legacy markup)');

for (const [layout, build] of Object.entries(LAYOUTS)) {
  test(`R1 [${layout}]. a published card: title, age, runtime and state from the same card`, () => {
    const card = fragment(build({ id: vid(1), title: 'How "Taxes" \\ Work', ...STATUS.published }));
    const [entry] = VS.readVideoCards({ querySelectorAll: () => [card] });
    equal(entry.shorts, false, 'not a Short');
    equal(entry.href, `/watch?v=${vid(1)}`, 'href');
    equal(entry.videoId, vid(1), 'id');
    equal(entry.title, 'How "Taxes" \\ Work', 'title, quotes and backslash intact');
    equal(entry.titleSource, 'DOM_TITLE_ATTRIBUTE', 'title source');
    equal(entry.publishedText, '3 days ago', 'published text');
    equal(entry.durationText, '10:15', 'runtime badge text');
    equal(entry.state, P.PUBLISHED, 'state');
  });

  test(`R2 [${layout}]. a scheduled Premiere card is SCHEDULED`, () => {
    const card = fragment(build({ id: vid(2), title: 'Upcoming tax deadline', ...STATUS.scheduled }));
    const [entry] = VS.readVideoCards({ querySelectorAll: () => [card] });
    equal(entry.state, P.SCHEDULED, 'state');
    equal(entry.publishedText, null, 'no published text');
  });

  test(`R3 [${layout}]. title words are never status evidence`, () => {
    const pub = fragment(build({ id: vid(3), title: 'Premieres tomorrow — Notify me! LIVE', ...STATUS.published }));
    equal(VS.readVideoCards({ querySelectorAll: () => [pub] })[0].state, P.PUBLISHED, 'scheduled/live words in a title');
    const sched = fragment(build({ id: vid(4), title: 'Recorded 3 days ago', ...STATUS.scheduledTextOnly }));
    equal(VS.readVideoCards({ querySelectorAll: () => [sched] })[0].state, P.SCHEDULED, 'an age in a title');
  });
}

test('R4. legacy markup: hidden byline text and the CSS-hidden "Now playing" overlay are not signals', () => {
  // The legacy fixture carries a hidden byline reading "Premieres Weekly" and
  // a "Now playing" overlay on every card.
  const card = fragment(legacyRichCard({ id: vid(5), title: 'Ordinary upload', ...STATUS.published }));
  const entry = VS.readVideoCards({ querySelectorAll: () => [card] })[0];
  equal(entry.state, P.PUBLISHED, 'still published');
  assert(!VS.cardSegments(card).some((s) => /Premieres Weekly/.test(s.text)), 'hidden text skipped');
});

test('R5. the remaining scheduled shapes and live', () => {
  const read = (opts) => VS.readVideoCards({ querySelectorAll: () => [fragment(modernCard(opts))] })[0];
  equal(read({ id: vid(6), title: 't', ...STATUS.scheduledTextOnly }).state, P.SCHEDULED, '"Premieres ..." text only');
  equal(read({ id: vid(7), title: 't', ...STATUS.scheduledButtonOnly }).state, P.SCHEDULED, 'Notify me button text only');
  equal(read({ id: vid(8), title: 't', ...STATUS.scheduledButtonOnly, buttonAriaOnly: true }).state, P.SCHEDULED, 'icon button, accessible name only');
  equal(read({ id: vid(9), title: 't', ...STATUS.live }).state, P.LIVE, 'live');
  equal(read({ id: vid(10), title: 't', ...STATUS.completedPremiere }).state, P.PUBLISHED, 'completed Premiere');
  equal(read({ id: vid(11), title: 't', ...STATUS.noStatus }).state, P.INDETERMINATE, 'no status text');
  equal(read({ id: vid(12), title: 't', ...STATUS.conflicting }).state, P.INDETERMINATE, 'conflict');
});

test('R6. titles: full attribute over clipped text, visible-text fallback, and disagreement', () => {
  const read = (opts) => VS.readVideoCards({ querySelectorAll: () => [fragment(modernCard({ id: vid(13), ...opts }))] })[0];
  const clipped = read({ title: 'A very long title that YouTube clips in the grid', visibleTitle: 'A very long title that YouTube…' });
  equal(clipped.title, 'A very long title that YouTube clips in the grid', 'full title from the attribute');
  equal(clipped.titleSource, 'DOM_TITLE_ATTRIBUTE', 'source recorded');
  equal(clipped.titleTruncatedInUi, true, 'clipping detected');
  equal(clipped.state, P.PUBLISHED, 'still eligible');

  const same = read({ title: 'Short title' });
  equal(same.titleTruncatedInUi, null, 'CSS clipping is not detectable: null, not false');

  const visibleOnly = read({ title: 'Visible only', titleAttr: false });
  equal(visibleOnly.titleSource, 'VISIBLE_TEXT', 'no attribute -> visible text');
  equal(visibleOnly.title, 'Visible only', 'title');

  const mismatch = read({ title: 'Old recycled title', visibleTitle: 'New title' });
  equal(mismatch.state, P.INDETERMINATE, 'attribute and text disagree -> fail closed');
  equal(mismatch.stateBasis, 'CARD_TITLE_DISAGREES', 'basis');
});

test('R7. a card whose links point at two different videos fails closed', () => {
  const card = fragment(modernCard({ id: vid(14), title: 't', titleHref: `/watch?v=${vid(15)}` }));
  const entry = VS.readVideoCards({ querySelectorAll: () => [card] })[0];
  equal(entry.state, P.INDETERMINATE, 'state');
  equal(entry.stateBasis, 'CARD_LINKS_DISAGREE', 'basis');
});

test('R8. Shorts, unrendered items and the no-renderer fallback', () => {
  const entries = VS.readVideoCards(gridOf([shortsCard({ id: 'SHORTSHORT1' }), unrenderedCard()]));
  equal(entries[0].shorts, true, 'Short flagged');
  equal(entries[1].href, null, 'unrendered reported, not dropped');
  const bare = parseHTML(`<div><a href="/watch?v=${vid(16)}">x</a></div>`).children[0];
  const fallback = VS.readVideoCards(bare);
  equal(fallback.length, 1, 'fallback entry');
  equal(fallback[0].state, P.INDETERMINATE, 'no card -> no status -> never published');
  equal(VS.selectEligibleVideos(fallback).blocked.basis, 'NO_CARD_RENDERER', 'the selector stops there');
});

/* =================================================================== *
 * The shared 12-video selection (brief §6 acceptance cases)
 * =================================================================== */

group('SHARED 12-VIDEO SELECTION');

for (const [layout, build] of Object.entries(LAYOUTS)) {
  test(`A1 [${layout}]. scheduled Premieres at grid positions 2 and 4 are skipped; 12 published come from deeper`, () => {
    const pubs = publishedRun(build, 100, 14);
    const cards = [
      pubs[0],
      build({ id: vid(901), title: 'Premiere one', ...STATUS.scheduled }),
      pubs[1],
      build({ id: vid(902), title: 'Premiere two', ...STATUS.scheduled }),
      ...pubs.slice(2),
    ];
    const sel = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards)));
    equal(sel.ids.join(','), Array.from({ length: 12 }, (_, i) => vid(100 + i)).join(','), 'the 12 published, in order');
    equal(sel.excluded.map((x) => `${x.gridPosition}:${x.videoId}:${x.state}`).join(','),
      `2:${vid(901)}:${P.SCHEDULED},4:${vid(902)}:${P.SCHEDULED}`, 'both skips recorded');
    equal(sel.videos[11].gridPosition, 14, 'the 12th comes from grid position 14');
    assert(!sel.ids.includes(vid(901)) && !sel.ids.includes(vid(902)), 'no scheduled ID selected');
    equal(sel.blocked, null, 'nothing undecided');
    equal(sel.orderAnomaly, null, 'order is consistent');
  });
}

test('A1b. FinTaxPro shape (two upcoming Premieres, 11 and 12 Oct, at the top): both skipped', () => {
  const cards = [
    modernCard({ id: vid(911), title: 'Premiere 11 Oct', badge: 'UPCOMING', meta: ['Premieres 10/11/26, 8:00 PM'], button: 'Notify me' }),
    modernCard({ id: vid(912), title: 'Premiere 12 Oct', badge: 'UPCOMING', meta: ['Premieres 10/12/26, 8:00 PM'], button: 'Notify me' }),
    ...publishedRun(modernCard, 200, 14),
  ];
  const sel = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards)));
  equal(sel.ids[0], vid(200), 'position 1 is the newest PUBLISHED video');
  equal(sel.ids[11], vid(211), 'two older published videos pulled up to complete 12');
  equal(sel.excluded.length, 2, 'two skipped');
});

test('A2. a completed Premiere with published metadata stays in its slot', () => {
  const cards = publishedRun(modernCard, 300, 12);
  cards[3] = modernCard({ id: vid(303), title: 'Was a Premiere', badge: '24:03', meta: ['48K views', 'Premiered 10 days ago'] });
  const sel = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards)));
  equal(sel.ids[3], vid(303), 'kept at position 4');
  equal(sel.videos[3].stateBasis, 'CARD_COMPLETED_PREMIERE_TEXT', 'basis');
  equal(sel.excluded.length, 0, 'nothing excluded');
});

test('A3. a live broadcast and an upcoming stream are excluded', () => {
  const cards = [
    modernCard({ id: vid(401), title: 'Live now', ...STATUS.live }),
    modernCard({ id: vid(402), title: 'Stream later', badge: 'UPCOMING', meta: ['Scheduled for 10/14/26, 6:00 PM'], button: 'Notify me' }),
    ...publishedRun(modernCard, 410, 12),
  ];
  const sel = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards)));
  equal(sel.ids.length, 12, 'twelve');
  equal(sel.excluded.map((x) => x.state).join(','), `${P.LIVE},${P.SCHEDULED}`, 'live and upcoming excluded');
});

test('A4. a 0:58 normal upload is included; a Shorts item is excluded and does not shift numbering', () => {
  const pubs = publishedRun(modernCard, 500, 12);
  pubs[2] = modernCard({ id: vid(502), title: 'Quick one', badge: '0:58', meta: ['3.1K views', '7 days ago'] });
  const cards = [pubs[0], shortsCard({ id: 'SHORTSHORT1' }), ...pubs.slice(1)];
  const sel = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards)));
  equal(sel.ids[2], vid(502), '0:58 upload at position 3');
  equal(sel.videos[2].durationText, '0:58', 'its runtime captured');
  equal(sel.ids.length, 12, 'twelve');
  assert(!sel.ids.includes('SHORTSHORT1'), 'Short excluded');
});

test('A5. an unreadable or contradictory status stops selection there (fail closed)', () => {
  for (const status of [STATUS.noStatus, STATUS.conflicting]) {
    const pubs = publishedRun(modernCard, 600, 14);
    const cards = [...pubs.slice(0, 4), modernCard({ id: vid(699), title: 'Unclear', ...status }), ...pubs.slice(4)];
    const sel = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards)));
    equal(sel.ids.length, 4, 'only what precedes the undecided card');
    equal(sel.blocked.gridPosition, 5, 'blocked at grid position 5');
    equal(sel.blocked.videoId, vid(699), 'the undecided card');
    assert(!sel.ids.includes(vid(604)), 'a later video is never promoted past it');
  }
});

test('A6. duplicate cards and multiple anchors: one ID, metadata from the first card', () => {
  const pubs = publishedRun(modernCard, 700, 13);
  const dupe = modernCard({ id: vid(700), title: 'A different stale title', ...publishedAt(40) });
  const cards = [pubs[0], dupe, ...pubs.slice(1)];
  const sel = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards)));
  equal(new Set(sel.ids).size, 12, 'twelve unique');
  equal(sel.ids.filter((id) => id === vid(700)).length, 1, 'once');
  equal(sel.videos[0].title, 'Published video 700', 'metadata of the first card kept');
  // Every modern card has two anchors (thumbnail + title) to the same video.
  equal(gridOf([pubs[0]]).querySelectorAll('a[href*="/watch?v="]').length, 2, 'two anchors in one card');
});

test('A7. a pinned/out-of-order card is detected; DOM order is not claimed as chronology', () => {
  const pinned = modernCard({ id: vid(800), title: 'Pinned old video', ...publishedAt(800) });
  const sel = VS.selectEligibleVideos(VS.readVideoCards(gridOf([pinned, ...publishedRun(modernCard, 801, 12)])));
  assert(sel.orderAnomaly, 'anomaly reported');
  equal(sel.orderAnomaly.gridPosition, 2, 'at the first card younger than the pinned one');

  const coarse = ['5 hours ago', '6 days ago', '1 week ago', '4 weeks ago', '1 month ago', '11 months ago', '12 months ago', '1 year ago', '2 years ago']
    .map((age, i) => ({ videoId: vid(850 + i), gridPosition: i + 1, publishedText: age }));
  equal(VS.findOrderAnomaly(coarse), null, 'YouTube bucket boundaries in true order are not anomalies');
  equal(VS.findOrderAnomaly([{ publishedText: '1 month ago' }, { publishedText: '2 weeks ago', videoId: 'x', gridPosition: 2 }]).gridPosition, 2,
    'a clearly younger later card is');
});

test('A8. entries without a publication state are never counted as published', () => {
  const sel = VS.selectEligibleVideos([{ shorts: false, href: `/watch?v=${vid(1)}` }]);
  equal(sel.ids.length, 0, 'nothing selected');
  equal(sel.blocked.basis, 'CARD_STATUS_NOT_READ', 'blocked');
});

/* =================================================================== *
 * Copy 12 URLs operation with publication-aware selection
 * =================================================================== */

group('COPY 12 URLs — PUBLICATION-AWARE OPERATION');

const pubEntry = (id, publishedText = '3 days ago') => ({ shorts: false, href: `/watch?v=${id}`, state: P.PUBLISHED, publishedText, title: id, titleSource: 'DOM_TITLE_ATTRIBUTE' });
const schedEntry = (id) => ({ shorts: false, href: `/watch?v=${id}`, state: P.SCHEDULED, stateEvidence: 'Premieres 10/11/26, 8:00 PM' });
const unclearEntry = (id) => ({ shorts: false, href: `/watch?v=${id}`, state: P.INDETERMINATE, stateBasis: 'CARD_STATUS_NOT_FOUND' });
const TWELVE = Array.from({ length: 12 }, (_, i) => vid(1000 + i));

function makeEnv({ entries, latest = true, scope = 'A', copyResult = true, steps = [], format } = {}) {
  const env = {
    entries: entries.slice(), latest, scope, alive: true, copyResult, steps: steps.slice(),
    log: { copy: [], loadMoreScroll: [], restoreScroll: [] }, clock: 1000, lock: X.createDomLock(),
  };
  env.deps = {
    isLatest: () => env.latest,
    scopeKey: () => env.scope,
    isAlive: () => env.alive,
    readEntries: () => env.entries.slice(),
    loadMore: async (options = {}) => {
      env.log.loadMoreScroll.push(options.scroll !== false);
      const step = env.steps.shift();
      if (step) await step(env);
      return true;
    },
    saveScroll: () => 777,
    restoreScroll: (y) => env.log.restoreScroll.push(y),
    copy: async (text) => { env.log.copy.push(text); return env.copyResult; },
    lock: env.lock,
    format,
    now: () => env.clock,
  };
  env.exporter = X.createUrlExporter(env.deps);
  return env;
}

test('E1. scheduled cards push the 12 deeper; bounded top-up; exact 12-line block', async () => {
  const env = makeEnv({
    entries: [pubEntry(TWELVE[0]), schedEntry(vid(1901)), ...TWELVE.slice(1, 9).map((id) => pubEntry(id)), schedEntry(vid(1902))],
    steps: [async (e) => { e.entries = e.entries.concat(TWELVE.slice(9).map((id) => pubEntry(id))); }],
  });
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'status');
  equal(result.excludedCount, 2, 'skips reported');
  equal(env.log.copy[0], X.formatExportBlock(TWELVE), 'exactly the 12 published');
  equal(env.log.copy[0].split('\n').length, 12, 'twelve lines, format unchanged');
  equal(env.log.loadMoreScroll.join(','), 'true', 'one scroll step');
});

test('E2. an undecided card is waited for WITHOUT scrolling, then reported, nothing copied', async () => {
  const env = makeEnv({ entries: [pubEntry(TWELVE[0]), unclearEntry(vid(1950)), ...TWELVE.slice(1).map((id) => pubEntry(id))] });
  const result = await env.exporter.click();
  equal(result.status, 'REVIEW_STATUS', 'status');
  equal(X.exportButtonText(result), 'Review video status', 'label');
  equal(result.blocked.gridPosition, 2, 'which card');
  equal(env.log.copy.length, 0, 'clipboard untouched');
  equal(env.log.loadMoreScroll.join(','), 'false,false,false,false', 'bounded waiting, never scrolled');
  equal(env.log.restoreScroll.join(','), '777', 'scroll restored');
});

test('E3. an undecided card that finishes rendering as published is then copied in true order', async () => {
  const env = makeEnv({
    entries: [pubEntry(TWELVE[0]), unclearEntry(TWELVE[1]), ...TWELVE.slice(2).map((id) => pubEntry(id))],
    steps: [async (e) => { e.entries[1] = pubEntry(TWELVE[1]); }],
  });
  const result = await env.exporter.click();
  equal(result.status, 'COPIED', 'status');
  equal(env.log.copy[0], X.formatExportBlock(TWELVE), 'slot 2 kept');
});

test('E4. an out-of-order grid is refused with "Review video order"', async () => {
  const entries = TWELVE.map((id, i) => pubEntry(id, `${i + 1} days ago`));
  entries[0] = pubEntry(TWELVE[0], '3 years ago');
  const env = makeEnv({ entries });
  const result = await env.exporter.click();
  equal(result.status, 'REVIEW_ORDER', 'status');
  equal(X.exportButtonText(result), 'Review video order', 'label');
  equal(env.log.copy.length, 0, 'nothing copied');
});

test('E5. a prepared block is refused once a selected card is no longer published', async () => {
  const env = makeEnv({
    entries: TWELVE.slice(0, 8).map((id) => pubEntry(id)),
    copyResult: false,
    steps: [async (e) => { e.entries = TWELVE.map((id) => pubEntry(id)); }],
  });
  equal((await env.exporter.click()).status, 'READY', 'prepared after async copy refusal');
  env.copyResult = true;
  env.log.copy.length = 0;
  env.entries = TWELVE.map((id) => pubEntry(id));
  env.entries[5] = schedEntry(TWELVE[5]); // now shown as scheduled
  const result = await env.exporter.click();
  assert(!env.log.copy.includes(X.formatExportBlock(TWELVE)), 'stale block never written');
  equal(result.status, 'INSUFFICIENT', 'fresh collection reports honestly');
});

test('E5b. a prepared block is refused if the same 12 now read out of date order', async () => {
  const env = makeEnv({
    entries: TWELVE.slice(0, 8).map((id, i) => pubEntry(id, `${i + 1} days ago`)),
    copyResult: false,
    steps: [async (e) => { e.entries = TWELVE.map((id, i) => pubEntry(id, `${i + 1} days ago`)); }],
  });
  equal((await env.exporter.click()).status, 'READY', 'prepared');
  env.copyResult = true;
  env.log.copy.length = 0;
  env.entries = TWELVE.map((id, i) => pubEntry(id, i === 0 ? '3 years ago' : `${i + 1} days ago`));
  const result = await env.exporter.click();
  equal(env.log.copy.length, 0, 'the prepared block is not written');
  equal(result.status, 'REVIEW_ORDER', 'a fresh collection reports the order problem');
});

test('E6. labels unchanged for v1.1.0 states; two new refusal labels', () => {
  equal(X.exportButtonText({ status: 'COPIED' }), 'Copied 12 URLs', 'copied');
  equal(X.exportButtonText({ status: 'INSUFFICIENT', count: 10 }), 'Found 10 of 12', 'found');
  equal(X.exportButtonText({ status: 'REVIEW_STATUS' }), 'Review video status', 'review status');
  equal(X.exportButtonText({ status: 'REVIEW_ORDER' }), 'Review video order', 'review order');
});

/* =================================================================== *
 * Copy all video URLs
 * =================================================================== */

group('COPY ALL VIDEO URLs — GENERAL LOADED-GRID INVENTORY');

/** Parse the clipboard block strictly; throws on any deviation. */
function parseAllUrls(text) {
  const lines = text.split('\n');
  const total = /^Total URLs: (\d+)$/.exec(lines[0]);
  const sort = /^Sort: (Latest|Popular|Oldest|Unknown)$/.exec(lines[1]);
  assert(total && sort && lines[2] === '', `header: ${JSON.stringify(lines.slice(0, 3))}`);
  const urls = lines.slice(3).map((line, i) => {
    const m = /^(\d+)\. (https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11})$/.exec(line);
    assert(m, `line ${i + 4}: ${JSON.stringify(line)}`);
    equal(Number(m[1]), i + 1, `numbering at line ${i + 4}`);
    return m[2];
  });
  equal(Number(total[1]), urls.length, 'Total URLs equals the numbered lines');
  equal(new Set(urls).size, urls.length, 'unique');
  assert(!text.endsWith('\n'), 'no trailing newline');
  return { total: Number(total[1]), sort: sort[1], urls };
}

function allEnv({ cards, sort = 'Latest', busy = false, onRoute = true, alive = true, copyResult = true, gridNode } = {}) {
  const env = { cards, sort, busy, onRoute, alive, copyResult, copies: [], reads: 0 };
  env.exporter = X.createAllUrlsExporter({
    isAlive: () => env.alive,
    onVideosRoute: () => env.onRoute,
    isBusy: () => env.busy,
    readInventory: () => { env.reads += 1; return X.readLoadedVideoUrls(gridNode === undefined ? gridOf(env.cards) : gridNode); },
    readSort: () => env.sort,
    copy: async (text) => { env.copies.push(text); return env.copyResult; },
  });
  return env;
}

test('U1. Latest, Popular and Oldest each export the rendered card order; no Latest guard', async () => {
  const ids = Array.from({ length: 9 }, (_, i) => vid(2000 + i));
  const orders = {
    Latest: ids,
    Popular: [ids[4], ids[0], ids[8], ids[2], ids[6], ids[1], ids[7], ids[3], ids[5]],
    Oldest: ids.slice().reverse(),
  };
  for (const [sort, order] of Object.entries(orders)) {
    const env = allEnv({ cards: order.map((id) => modernCard({ id, title: id })), sort });
    const result = await env.exporter.click();
    equal(result.status, 'COPIED', `${sort} status`);
    equal(X.allUrlsButtonText(result), 'Copied 9 URLs', `${sort} label`);
    const parsed = parseAllUrls(env.copies[0]);
    equal(parsed.sort, sort, `${sort} label line`);
    equal(parsed.urls.join(','), order.map(url).join(','), `${sort}: DOM order, not re-sorted`);
  }
});

test('U2. 12, 60, 120 and 1,100 loaded cards: every one, no 12/60 cap, no loading', async () => {
  for (const n of [12, 60, 120, 1100]) {
    const cards = Array.from({ length: n }, (_, i) => legacyGridCard({ id: vid(10000 + i), title: `v${i}` }));
    const env = allEnv({ cards });
    const result = await env.exporter.click();
    equal(result.count, n, `${n}: count`);
    const parsed = parseAllUrls(env.copies[0]);
    equal(parsed.total, n, `${n}: Total URLs`);
    equal(parsed.urls[n - 1], url(vid(10000 + n - 1)), `${n}: last card present`);
    equal(env.reads, 1, `${n}: one snapshot`);
  }
  equal(X.formatAllUrlsBlock([vid(1)], 'Latest'), `Total URLs: 1\nSort: Latest\n\n1. ${url(vid(1))}`, 'exact format');
  equal(X.allUrlsButtonText({ status: 'COPIED', count: 1 }), 'Copied 1 URL', 'singular');
});

test('U3. duplicates, invalid IDs, foreign hosts, playlist links and Shorts are not counted', async () => {
  const foreign = `<ytd-rich-item-renderer><div><a href="https://evil.example/watch?v=${vid(3009)}">x</a><h3><a href="https://evil.example/watch?v=${vid(3009)}">x</a></h3></div></ytd-rich-item-renderer>`;
  const invalid = '<ytd-rich-item-renderer><div><a href="/watch?v=bad">x</a></div></ytd-rich-item-renderer>';
  const cards = [
    modernCard({ id: vid(3001), title: 'a', hrefSuffix: '&list=PLabc&index=2&t=30s' }),
    modernCard({ id: vid(3001), title: 'a again' }), // duplicate card
    shortsCard({ id: 'SHORTSHORT1' }),
    playlistCard(),
    foreign,
    invalid,
    modernCard({ id: vid(3002), title: 'b' }),
  ];
  const env = allEnv({ cards });
  const result = await env.exporter.click();
  const parsed = parseAllUrls(env.copies[0]);
  equal(parsed.urls.join(','), [url(vid(3001)), url(vid(3002))].join(','), 'only the two real videos, canonical');
  equal(result.inventory.duplicates, 1, 'duplicate counted once');
  equal(result.inventory.shorts, 1, 'Short ignored');
  equal(result.inventory.nonVideo, 3, 'playlist, foreign host and invalid ID ignored');
});

test('U4. FinTaxPro distinction: a scheduled Premiere is IN the general export and OUT of the 12', async () => {
  const cards = [
    modernCard({ id: vid(4001), title: 'Premiere 11 Oct', badge: 'UPCOMING', meta: ['Premieres 10/11/26, 8:00 PM'], button: 'Notify me' }),
    modernCard({ id: vid(4002), title: 'Premiere 12 Oct', badge: 'UPCOMING', meta: ['Premieres 10/12/26, 8:00 PM'], button: 'Notify me' }),
    ...publishedRun(modernCard, 4100, 14),
  ];
  const env = allEnv({ cards });
  await env.exporter.click();
  const general = parseAllUrls(env.copies[0]).urls;
  equal(general.length, 16, 'all 16 loaded cards');
  equal(general[0], url(vid(4001)), 'scheduled Premiere included at its card position');
  equal(general[1], url(vid(4002)), 'second scheduled Premiere included');
  const twelve = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards))).ids;
  assert(!twelve.includes(vid(4001)) && !twelve.includes(vid(4002)), 'both excluded from the 12');
  equal(twelve[0], vid(4100), 'the 12 start at the first published video');
});

test('U5. a sort change between clicks changes the output; every click is a fresh snapshot', async () => {
  const ids = [vid(5001), vid(5002), vid(5003)];
  const env = allEnv({ cards: ids.map((id) => modernCard({ id, title: id })), sort: 'Latest' });
  await env.exporter.click();
  env.cards = ids.slice().reverse().map((id) => modernCard({ id, title: id }));
  env.sort = 'Oldest';
  await env.exporter.click();
  equal(parseAllUrls(env.copies[0]).urls[0], url(ids[0]), 'first click: Latest order');
  const second = parseAllUrls(env.copies[1]);
  equal(second.sort, 'Oldest', 'second click: new sort');
  equal(second.urls[0], url(ids[2]), 'second click: new order');
  equal(env.reads, 2, 'one read per click, never reused');
  equal(env.exporter.hasPrepared, undefined, 'no prepared block exists to go stale');
});

test('U6. the clipboard write starts synchronously inside the click (user activation)', () => {
  const env = allEnv({ cards: [modernCard({ id: vid(6001), title: 'x' })] });
  const pending = env.exporter.click(); // not awaited
  equal(env.copies.length, 1, 'copy already requested before click() yields');
  return pending;
});

test('U7. off-screen but retained cards count; the result is bounded by the DOM, not the channel', async () => {
  // The mini DOM has no viewport: all 350 cards are "retained". A real
  // browser check of virtualization is listed as a manual test.
  const cards = Array.from({ length: 350 }, (_, i) => modernCard({ id: vid(7000 + i), title: `v${i}` }));
  const env = allEnv({ cards });
  const result = await env.exporter.click();
  equal(result.count, 350, 'every retained card');
  equal(result.inventory.cardCount, 350, 'card count reported for the tooltip');
});

test('U8. refusals never touch the clipboard', async () => {
  const cases = [
    [{ cards: [] }, 'NONE', 'No loaded video URLs'],
    [{ cards: [playlistCard()] }, 'NONE', 'No loaded video URLs'],
    [{ cards: [modernCard({ id: vid(8001), title: 'x' }), unrenderedCard()] }, 'NOT_READY', '1 card not ready — retry'],
    [{ cards: [modernCard({ id: vid(8002), title: 'x', titleHref: `/watch?v=${vid(8003)}` })] }, 'NOT_READY', '1 card not ready — retry'],
    [{ cards: [], gridNode: null }, 'NO_GRID', 'Video grid not found'],
    [{ cards: [modernCard({ id: vid(8004), title: 'x' })], onRoute: false }, 'OFF_ROUTE', 'Open the Videos tab'],
    [{ cards: [modernCard({ id: vid(8005), title: 'x' })], busy: true }, 'BUSY', 'Busy — retry'],
    [{ cards: [modernCard({ id: vid(8006), title: 'x' })], alive: false }, 'ABORTED', 'Copy all video URLs'],
  ];
  for (const [opts, status, label] of cases) {
    const env = allEnv(opts);
    const result = await env.exporter.click();
    equal(result.status, status, `${status} status`);
    equal(X.allUrlsButtonText(result), label, `${status} label`);
    equal(env.copies.length, 0, `${status}: clipboard untouched`);
  }
});

test('U9. a refused clipboard write is reported and nothing is prepared', async () => {
  const env = allEnv({ cards: [modernCard({ id: vid(9001), title: 'x' })], copyResult: false });
  const result = await env.exporter.click();
  equal(result.status, 'COPY_FAILED', 'status');
  equal(X.allUrlsButtonText(result), 'Copy failed', 'label');
  const thrower = X.createAllUrlsExporter({
    isAlive: () => true, onVideosRoute: () => true, isBusy: () => false, readSort: () => 'Latest',
    readInventory: () => X.readLoadedVideoUrls(gridOf([modernCard({ id: vid(9002), title: 'x' })])),
    copy: async () => { throw new Error('denied'); },
  });
  equal((await thrower.click()).status, 'COPY_FAILED', 'a throwing clipboard is surfaced');
});

test('U10. the Sort line: chip text, 3-chip position, otherwise Unknown — never a guess', () => {
  const s = VS.sortLabelFromChips;
  equal(s({ count: 3, selectedIndex: 2, selectedText: ' Oldest ' }), 'Oldest', 'text');
  equal(s({ count: 3, selectedIndex: 1, selectedText: 'Populares' }), 'Popular', '3 chips: position');
  equal(s({ count: 4, selectedIndex: 1, selectedText: 'Shorts' }), 'Unknown', 'unexpected chip set');
  equal(s({ count: 3, selectedIndex: -1, selectedText: '' }), 'Unknown', 'nothing selected');
  equal(s(null), 'Unknown', 'no chips');
  equal(X.formatAllUrlsBlock([vid(1)], 'Newest').split('\n')[1], 'Sort: Unknown', 'unknown labels are written as Unknown');
});

/* =================================================================== *
 * Isolation
 * =================================================================== */

group('ISOLATION');

test('S1. no new permissions; content scripts load in dependency order', () => {
  const manifest = JSON.parse(sourceOf('manifest.json'));
  equal(JSON.stringify(manifest.permissions), JSON.stringify(['storage']), 'permissions');
  equal(JSON.stringify(manifest.host_permissions), JSON.stringify(['https://www.googleapis.com/youtube/v3/*']), 'host permissions');
  equal(manifest.content_scripts[0].js.join(','),
    'content/render.js,content/video-selection.js,content/url-export.js,content/channel-details.js,content/content.js', 'load order');
});

test('S2. the export scripts make no network, storage, messaging or code-loading calls', () => {
  for (const rel of ['content/video-selection.js', 'content/url-export.js', 'content/channel-details.js']) {
    const code = sourceOf(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'chrome.', 'browser.', 'localStorage', 'indexedDB', 'eval(', 'importScripts', 'new Function', 'scrollTo(', 'scrollBy(', 'window.', 'document.', '.click()']) {
      assert(!code.includes(forbidden), `${rel} contains ${forbidden}`);
    }
  }
});

await run();
