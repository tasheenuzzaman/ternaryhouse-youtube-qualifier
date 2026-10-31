/**
 * DEVELOPER-ONLY integration harness: the real unpacked extension in real
 * Chromium, on SIMULATED YouTube channel pages.
 *
 * Every request to https://www.youtube.com/ is answered locally from
 * tests/fixtures/youtube-markup.mjs; every other request is blocked. Nothing
 * touches the network, and nothing here is live YouTube. What it proves: the
 * shipped manifest, content scripts, Shadow DOM bar, clipboard path, Latest
 * guard, lazy-load top-up, SPA teardown and the three exports work together in
 * a real browser engine. What it cannot prove: that YouTube's current markup
 * matches the fixtures. See RELEASE_NOTES_v1.2.0.md for the live checks.
 *
 * Not part of `npm test` (it needs Playwright and a Chromium build):
 *
 *   node tests/browser/extension-harness.mjs
 *   THQ_EXT_DIR=/path/to/unpacked-release node tests/browser/extension-harness.mjs
 *
 * Requires the `playwright` package resolvable from Node (global install is
 * fine) and a Chromium that supports extensions in headless mode.
 */

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from '../helpers/mini-dom.mjs';
import { loadContentScripts } from '../helpers/load-content.mjs';
import {
  STATUS, publishedAt, modernCard, legacyRichCard, modernHeader, legacyHeader, channelPage, grid,
  realLockupCard, REAL_PUBLISHED, REAL_SCHEDULED, tvMisericordiaShape,
  shortsTabCard, playlistVideoCard, playlistGrid, playlistCard,
} from '../fixtures/youtube-markup.mjs';

// Lets context.route() see the extension service worker's own requests, so
// the YouTube Data API can be mocked for the description download.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed; this optional harness cannot run.');
  process.exit(2);
}

// THQ_EXT_DIR: test another extension folder (e.g. an unpacked release ZIP)
// instead of this checkout.
const EXT = process.env.THQ_EXT_DIR ? resolve(process.env.THQ_EXT_DIR) : join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vid = (n) => `V${String(n).padStart(10, '0')}`;
const wurl = (id) => `https://www.youtube.com/watch?v=${id}`;

/* ------------------------------------------------------------------ *
 * Simulated channels
 * ------------------------------------------------------------------ */

function publishedList(from, count, build = modernCard, startDay = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: vid(from + i), html: build({ id: vid(from + i), title: `Video ${from + i} — “quotes” & ভিডিও`, ...publishedAt(startDay + i * 4) }),
  }));
}

const CHANNELS = {
  '@FixtureTax': {
    name: 'Fixture Tax Pro',
    header: () => modernHeader({ name: 'Fixture Tax Pro', handle: '@FixtureTax', subscribers: '84.2K subscribers', videoCount: '312 videos', description: 'Tax help for small businesses.\nNew videos every week.' }),
    cards: [
      { id: vid(911), html: modernCard({ id: vid(911), title: 'Premiere: 11 Oct deadline', badge: 'UPCOMING', meta: ['12 waiting', 'Premieres 10/11/26, 8:00 PM'], button: 'Notify me' }) },
      { id: vid(912), html: modernCard({ id: vid(912), title: 'Premiere: 12 Oct Q&A', badge: 'UPCOMING', meta: ['Premieres 10/12/26, 8:00 PM'], button: 'Notify me' }) },
      ...publishedList(1000, 88),
    ],
    initial: 30,
  },
  '@OtherCreator': {
    name: 'Other Creator',
    header: () => legacyHeader({ name: 'Other Creator', handle: '@OtherCreator', subscribers: '9.9K subscribers' }),
    cards: publishedList(2000, 20, legacyRichCard),
    initial: 20,
  },
  '@SlowLoad': {
    name: 'Slow Load',
    header: () => modernHeader({ name: 'Slow Load', handle: '@SlowLoad', subscribers: '1K subscribers', videoCount: '38 videos', description: 'Loads slowly.' }),
    cards: publishedList(3000, 38),
    initial: 8,
  },
  // Real Oct-2026 card patterns (founder's DevTools excerpts); shell reconstructed.
  '@TvMisericordiaPL': {
    name: 'TV Misericordia',
    // descriptionCopy: SIMULATED second rendering of the description (live finding #2).
    header: () => modernHeader({ name: 'TV Misericordia', handle: '@TvMisericordiaPL', subscribers: '120K subscribers', videoCount: '4K videos', description: 'Telewizja katolicka.\nTransmisje Mszy Świętej.', descriptionCopy: 'measure' }),
    cards: tvMisericordiaShape().map(({ id, html }) => ({ id, html })),
    initial: 15,
  },
  '@ThousandCards': {
    name: 'Thousand Cards',
    header: () => modernHeader({ name: 'Thousand Cards', handle: '@ThousandCards', subscribers: '2M subscribers', videoCount: '1.1K videos', description: 'Deep history.' }),
    cards: publishedList(10000, 1000),
    initial: 1000,
  },
};

/** The page's own (main-world) behaviour: sort chips, lazy loading, SPA navigation. */
const PAGE_SCRIPT = `
(() => {
  let data;
  let orders;
  let sort = 0;
  let shown = 0;
  function use(fixture) {
    data = fixture;
    orders = {
      0: data.cards,
      1: data.cards.slice().sort((a, b) => a.pop - b.pop),
      2: data.cards.slice().reverse(),
    };
    sort = 0;
    shown = data.initial;
  }
  use(window.__thqFixture);
  const contents = () => document.querySelector('ytd-rich-grid-renderer #contents');
  function render() {
    contents().innerHTML = orders[sort].slice(0, shown).map((c) => c.html).join('');
  }
  window.__thqSetSort = (i) => {
    sort = i; shown = data.initial;
    document.querySelectorAll('chip-bar-view-model button[role="tab"]').forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    render();
  };
  document.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('chip-bar-view-model button[role="tab"]');
    if (!chip) return;
    window.__thqSetSort([...chip.parentNode.parentNode.children].indexOf(chip.parentNode));
  });
  let loading = false;
  window.addEventListener('scroll', () => {
    if (loading || shown >= data.cards.length) return;
    if (window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 300) return;
    loading = true;
    setTimeout(() => { shown = Math.min(shown + 30, data.cards.length); render(); loading = false; }, 150);
  });
  window.__thqNavigate = (path) => {
    history.pushState({}, '', path);
    const next = window.__thqPages[path.split('/')[1]];
    document.querySelector('ytd-browse').outerHTML = next.browse;
    use(next);
    render();
    document.title = next.name + ' - YouTube';
    document.dispatchEvent(new Event('yt-navigate-finish'));
  };
  window.__thqReload = () => { location.reload(); };
})();`;

const CSS = `
body { min-height: 3000px; margin: 0; }
ytd-app, ytd-page-manager, ytd-browse, ytd-tabbed-page-header, ytd-two-column-browse-results-renderer,
ytd-rich-grid-renderer, #contents, yt-page-header-renderer, ytd-c4-tabbed-header-renderer, chip-bar-view-model { display: block; }
#contents { display: flex; flex-wrap: wrap; gap: 8px; }
ytd-rich-item-renderer { display: block; width: 240px; height: 230px; overflow: hidden; }
img { display: block; width: 240px; height: 135px; background: #ccc; }
yt-flexible-actions-view-model { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
`;

function fixtureData(handle) {
  const ch = CHANNELS[handle];
  const pops = ch.cards.map((c, i) => ({ ...c, pop: (i * 7919) % ch.cards.length }));
  const html = channelPage({ header: ch.header(), cards: '' });
  const browse = /<ytd-browse[\s\S]*<\/ytd-browse>/.exec(html)[0];
  return { name: ch.name, cards: pops, initial: ch.initial, browse };
}

/* v1.3.0 surfaces: static simulated pages (no page script needed). */
const shortsIds = [vid(60001), vid(60002), vid(60003)];
const streamCards = [
  modernCard({ id: vid(61001), title: 'Live now', ...STATUS.live }),
  modernCard({ id: vid(61002), title: 'Upcoming stream', badge: 'UPCOMING', meta: ['Scheduled for 11/2/26, 6:00 PM'], button: 'Notify me' }),
  modernCard({ id: vid(61003), title: 'Past stream', ...STATUS.completedStream }),
];
const episodeIds = [vid(62001), vid(62002), vid(62003), vid(62004)];
function staticPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} - YouTube</title><style>${CSS}</style></head><body>${body}</body></html>`;
}
function surfaceHtml(handle, tab) {
  const header = CHANNELS[handle].header();
  if (tab === 'shorts') return staticPage(CHANNELS[handle].name, channelPage({ header, cards: shortsIds.map((id, i) => shortsTabCard({ id, title: `Short ${i} ✨` })).join('') }));
  if (tab === 'streams') return staticPage(CHANNELS[handle].name, channelPage({ header, cards: streamCards.join('') }));
  if (tab === 'podcasts') return staticPage(CHANNELS[handle].name, channelPage({ header, cards: [playlistCard({ list: 'PLpodcastAAAAAAAAA' }), playlistCard({ list: 'PLpodcastBBBBBBBBB' })].join('') }));
  return null;
}
function playlistHtml() {
  const rows = episodeIds.map((id, i) => playlistVideoCard({ id, title: `Episode ${i + 1} — الحلقة`, index: i + 1 })).join('');
  return staticPage('Fixture Podcast', `<ytd-app><ytd-page-manager><ytd-browse page-subtype="playlist"><yt-page-header-renderer><h1><span>Fixture Podcast</span></h1><a href="/@AbutaymiyyahMJ"><span>Abu Taymiyyah</span></a></yt-page-header-renderer><ytd-two-column-browse-results-renderer><div id="primary">${playlistGrid(rows)}</div></ytd-two-column-browse-results-renderer></ytd-browse></ytd-page-manager></ytd-app>`);
}

/* Mock YouTube Data API (videos.list?part=snippet) for the description job. */
const API_KEY = 'TESTKEY-harness-only-0001';
const MISSING_ID = vid(1005);
const apiCalls = [];
function mockApi(u) {
  const ids = (u.searchParams.get('id') || '').split(',');
  apiCalls.push({ part: u.searchParams.get('part'), ids, keyOk: u.searchParams.get('key') === API_KEY });
  const items = ids.filter((id) => id !== MISSING_ID).reverse().map((id) => ({
    id, snippet: { title: `API title ${id}`, description: `Описание ${id}\n\nSponsor: use code SAVE20 → https://example.com/?a=1&b=2\n${'-'.repeat(125)}\n00:00 Intro`, publishedAt: '2026-10-01T12:00:00Z', liveBroadcastContent: 'none' },
  }));
  return { status: 200, contentType: 'application/json', body: JSON.stringify({ items }) };
}

function pageHtml(handle) {
  const data = fixtureData(handle);
  // Only the SPA targets are embedded, to keep pages small.
  const pages = Object.fromEntries(['@FixtureTax', '@OtherCreator'].map((h) => [h, fixtureData(h)]));
  const html = channelPage({ header: CHANNELS[handle].header(), cards: data.cards.slice(0, data.initial).map((c) => c.html).join('') });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${data.name} - YouTube</title><style>${CSS}</style></head>
<body>${html}
<script>window.__thqFixture = ${JSON.stringify(data)}; window.__thqPages = ${JSON.stringify(pages)};</script>
<script>${PAGE_SCRIPT}</script></body></html>`;
}

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'thq-harness-'));
const requests = [];

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.youtube.com' });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    requests.push(u.href);
    if (u.hostname === 'www.googleapis.com' && u.pathname === '/youtube/v3/videos') {
      return new Promise((r) => setTimeout(r, 1200)).then(() => route.fulfill(mockApi(u)));
    }
    if (u.hostname === 'www.youtube.com') {
      if (u.pathname === '/playlist') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: playlistHtml() });
      const [, handle, tab] = u.pathname.split('/');
      const surface = CHANNELS[handle] && surfaceHtml(handle, tab);
      if (surface) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: surface });
      if (CHANNELS[handle]) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: pageHtml(handle) });
      return route.fulfill({ status: 404, body: 'not a fixture' });
    }
    return route.abort();
  });

  const page = await context.newPage();
  const bar = () => page.locator('.thq-bar-host');
  const button = (label) => bar().locator('button.thq-export').filter({ hasText: label });
  const exportButtons = () => bar().locator('button.thq-export');
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  const setClip = (t) => page.evaluate((x) => navigator.clipboard.writeText(x), t);
  const labelOf = async (i) => (await exportButtons().nth(i).textContent()).trim();
  const waitLabel = async (i, re, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const t = await labelOf(i);
      if (re.test(t)) return t;
      await sleep(50);
    }
    return labelOf(i);
  };
  const clickExport = async (i, re) => {
    await exportButtons().nth(i).click();
    return waitLabel(i, re);
  };
  const DONE = /^(Copied|Switch|Found|Review|Ready|Copy failed|Channel|No loaded|Video grid|Busy|Open the|\d+ cards?)/;

  console.log('\nBAR');
  await page.goto('https://www.youtube.com/@FixtureTax/videos');
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });
  const barText = (await bar().locator('.bar').first().innerText()).replace(/\s+/g, ' ').trim();
  check('one bar mounted', (await bar().count()) === 1, `count=${await bar().count()}`);
  check('bar order: TH | Avg Views | Engagement | Copy 12 URLs | Copy Channel Details | Copy all video URLs | Download all video descriptions | ⟳',
    /^TH Avg Views Engagement Copy 12 URLs Copy Channel Details Copy all video URLs Download all video descriptions ⟳/.test(barText), barText);
  check('bar lives in the extension Shadow DOM, not in the sort chips',
    await page.evaluate(() => !document.querySelector('chip-bar-view-model .thq-host') && Boolean(document.querySelector('.thq-bar-host').shadowRoot)));

  console.log('\nCOPY 12 URLs + COPY CHANNEL DETAILS (scheduled Premieres at grid positions 1-2)');
  await setClip('SENTINEL');
  const l12 = await clickExport(0, DONE);
  const block = await clip();
  const lines = block.split('\n');
  const expected12 = Array.from({ length: 12 }, (_, i) => wurl(vid(1000 + i)));
  check('Copy 12 URLs label', l12 === 'Copied 12 URLs', l12);
  check('Copy 12 URLs: exactly the 12 published, scheduled skipped', block === expected12.join('\n'), lines[0]);
  check('skip notice shown', /Skipped 2 upcoming\/live/.test(await bar().locator('.toast').innerText()));

  const ld = await clickExport(1, DONE);
  const detailsText = await clip();
  let json = null;
  try { json = JSON.parse(detailsText); } catch { /* reported below */ }
  check('Copy Channel Details label', ld === 'Copied channel details', ld);
  check('details: strict JSON', json !== null);
  if (json) {
    check('details: same 12 IDs, same positions as Copy 12 URLs',
      json.sample.videos.map((v) => v.video_url).join('\n') === block);
    check('details: channel identity from the page',
      json.channel.channel_name === 'Fixture Tax Pro' && json.channel.channel_handle === '@FixtureTax'
      && json.channel.channel_url === 'https://www.youtube.com/@FixtureTax', JSON.stringify(json.channel).slice(0, 120));
    check('details: description preview with line break, PARTIAL',
      json.channel.description_text === 'Tax help for small businesses.\nNew videos every week.' && json.channel.description_extent === 'PARTIAL');
    check('details: counts from the header', json.channel_more_info.subscriber_count_text === '84.2K subscribers'
      && json.channel_more_info.video_count_text === '312 videos');
    check('details: Unicode/quotes title intact', json.sample.videos[0].title === 'Video 1000 — “quotes” & ভিডিও', json.sample.videos[0].title);
    check('details: scheduled listed only as excluded', json.sample.excluded_not_in_sample.map((x) => x.video_id).join(',') === `${vid(911)},${vid(912)}`);
    check('details: tool version is the candidate build', json.source.tool_version === '1.3.0', json.source.tool_version);
    check('details: captured_at has a timezone offset', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(json.captured_at), json.captured_at);
  }

  console.log('\nCOPY ALL VIDEO URLs');
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const la = await clickExport(2, DONE);
  const all = (await clip()).split('\n');
  check('all URLs label shows the true count', la === 'Copied 30 URLs', la);
  check('all URLs header', all[0] === 'Total URLs: 30' && all[1] === 'Sort: Latest' && all[2] === '', all.slice(0, 2).join(' | '));
  check('all URLs includes the scheduled Premieres at their card positions', all[3] === wurl(vid(911)) && all[4] === wurl(vid(912)));
  check('all URLs did not scroll the page', (await page.evaluate(() => window.scrollY)) === scrollBefore);

  await page.click('chip-bar-view-model button[role="tab"] >> nth=2'); // Oldest
  await sleep(100);
  const lo = await clickExport(2, DONE);
  const oldest = (await clip()).split('\n');
  check('Oldest: copied without a sort guard', lo === 'Copied 30 URLs', lo);
  check('Oldest: Sort line and DOM order', oldest[1] === 'Sort: Oldest' && oldest[3] === wurl(vid(1087)), `${oldest[1]} | ${oldest[3]}`);

  await page.click('chip-bar-view-model button[role="tab"] >> nth=1'); // Popular
  await sleep(100);
  await clickExport(2, DONE);
  const popular = (await clip()).split('\n');
  const domFirst = await page.evaluate(() => document.querySelector('ytd-rich-item-renderer a[href*="/watch?v="]').getAttribute('href'));
  check('Popular: Sort line and DOM order', popular[1] === 'Sort: Popular' && popular[3] === `https://www.youtube.com${domFirst}`, popular[3]);

  await setClip('SENTINEL');
  const lp = await clickExport(0, DONE);
  check('Popular: Copy 12 URLs refuses, clipboard untouched', lp === 'Switch to Latest' && (await clip()) === 'SENTINEL', lp);
  const lpd = await clickExport(1, DONE);
  check('Popular: Copy Channel Details refuses, clipboard untouched', lpd === 'Switch to Latest' && (await clip()) === 'SENTINEL', lpd);

  await page.click('chip-bar-view-model button[role="tab"] >> nth=0'); // Latest
  await sleep(100);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  const lm = await clickExport(2, DONE);
  check('after manual scrolling, all loaded cards are exported', lm === 'Copied 60 URLs', lm);

  console.log('\nBOUNDED TOP-UP (8 cards loaded; the 12 need a load step)');
  await page.goto('https://www.youtube.com/@SlowLoad/videos');
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 120));
  const y0 = await page.evaluate(() => window.scrollY);
  const ls = await clickExport(0, DONE);
  check('Copy 12 URLs loads more within bounds and copies', ls === 'Copied 12 URLs' || ls === 'Ready — click to copy', ls);
  check('scroll position restored', (await page.evaluate(() => window.scrollY)) === y0, `y0=${y0}`);
  if (ls === 'Ready — click to copy') {
    const second = await clickExport(0, DONE);
    check('Ready fallback second click copies', second === 'Copied 12 URLs', second);
  }
  check('slow page: 12 lines', (await clip()).split('\n').length === 12);

  console.log('\nREAL CARD PATTERNS (TvMisericordiaPL shape: Premieres at 3, 4, 5)');
  await page.goto('https://www.youtube.com/@TvMisericordiaPL/videos');
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });
  const realShape = tvMisericordiaShape();
  const realExpected = realShape.filter((c) => !c.scheduled).map((c) => wurl(c.id)).join('\n');
  const r12 = await clickExport(0, DONE);
  const realBlock = await clip();
  check('real patterns: Copy 12 URLs copies (was "Review video status")', r12 === 'Copied 12 URLs', r12);
  check('real patterns: positions 1, 2, 6-15; Premieres omitted', realBlock === realExpected, realBlock.split('\n')[0]);
  const rd = await clickExport(1, DONE);
  const realJson = JSON.parse(await clip());
  check('real patterns: Copy Channel Details copies', rd === 'Copied channel details', rd);
  check('real patterns: both exports agree position by position',
    realJson.sample.videos.map((v) => v.video_url).join('\n') === realBlock);
  check('real patterns: age from the accessible label, source recorded',
    realJson.sample.videos[0].published_text === '2 hours ago' && realJson.sample.videos[0].published_text_source === 'ACCESSIBLE_LABEL');
  check('description: a second rendering in the page is recorded once, line break kept',
    realJson.channel.description_text === 'Telewizja katolicka.\nTransmisje Mszy Świętej.', JSON.stringify(realJson.channel.description_text));
  check('description: extent/source unchanged and the collapse disclosed',
    realJson.channel.description_extent === 'PARTIAL' && realJson.channel.description_source === 'CHANNEL_HEADER_PREVIEW'
    && realJson.capture_limitations.some((n) => /held 2 identical copies/.test(n)));
  check('real patterns: Premiere evidence keeps U+202F', realJson.sample.excluded_not_in_sample[0].status_text === 'Premieres 10/11/26, 1:00\u202FAM');
  const ra = await clickExport(2, DONE);
  const realAll = (await clip()).split('\n');
  check('real patterns: Copy all video URLs keeps all 15, Premieres included in grid order',
    ra === 'Copied 15 URLs' && realAll.slice(3).join('\n') === realShape.map((c) => wurl(c.id)).join('\n'), ra);

  console.log('\nSPA NAVIGATION');
  await page.goto('https://www.youtube.com/@FixtureTax/videos');
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });
  await page.evaluate(() => window.__thqNavigate('/@OtherCreator/videos'));
  await sleep(1500);
  check('exactly one bar after SPA navigation', (await bar().count()) === 1, `count=${await bar().count()}`);
  const lspa = await clickExport(1, DONE);
  const spaJson = JSON.parse(await clip());
  check('details after SPA: new creator only', lspa === 'Copied channel details' && spaJson.channel.channel_handle === '@OtherCreator'
    && spaJson.sample.videos.map((v) => v.video_id).join(',') === Array.from({ length: 12 }, (_, i) => vid(2000 + i)).join(','),
    `${lspa} ${spaJson.channel.channel_handle} ${spaJson.sample.videos.map((v) => v.video_id).slice(0, 3).join(',')}...`);
  check('legacy header fallback read', spaJson.channel.channel_name === 'Other Creator' && spaJson.channel.description_extent === 'UNAVAILABLE');

  console.log('\n1,000 LOADED CARDS');
  await page.goto('https://www.youtube.com/@ThousandCards/videos');
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });
  const t0 = Date.now();
  const lt = await clickExport(2, DONE);
  const thousandMs = Date.now() - t0;
  const thousand = (await clip()).split('\n');
  check('1,000 cards: all exported, no cap', lt === 'Copied 1000 URLs' && thousand[0] === 'Total URLs: 1000' && thousand.length === 1003, lt);
  check('1,000 cards: one unnumbered URL per line, DOM order', thousand[1002] === wurl(vid(10999)) && thousand[3] === wurl(vid(10000)));
  const readMs = await page.evaluate((src) => {
    const s = {};
    new Function('self', src)(s); // eslint-disable-line no-new-func
    const g = document.querySelector('ytd-rich-grid-renderer');
    const t = performance.now();
    const r = s.THQVideoSelection.readLoadedVideoUrls(g);
    return { ms: performance.now() - t, n: r.ids.length };
  }, readFileSync(join(EXT, 'content', 'video-selection.js'), 'utf8'));
  check('1,000-card DOM pass timing (fixture)', readMs.n === 1000, `${readMs.ms.toFixed(1)} ms in-page read; ${thousandMs} ms click-to-label incl. harness polling`);

  console.log('\nMINI-DOM vs CHROMIUM (same readers, same markup)');
  const { VS } = loadContentScripts();
  const sampleCards = [
    ...CHANNELS['@FixtureTax'].cards.slice(0, 6).map((c) => c.html),
    modernCard({ id: vid(5001), title: 'Clipped', visibleTitle: 'Cli…', ...publishedAt(40) }),
    modernCard({ id: vid(5002), title: 'x', ...STATUS.conflicting }),
    modernCard({ id: vid(5003), title: 'x', ...STATUS.live }),
    legacyRichCard({ id: vid(5004), title: 'Legacy "q"', ...STATUS.scheduled }),
    legacyRichCard({ id: vid(5005), title: 'Legacy pub', ...publishedAt(50) }),
    realLockupCard({ ...REAL_PUBLISHED, title: 'Real published' }),
    realLockupCard({ ...REAL_SCHEDULED, title: 'Real premiere' }),
    realLockupCard({ ...REAL_PUBLISHED, id: 'NOLABEL0001', title: 'No label', stampLabel: null }),
  ].join('');
  const gridHtml = grid(sampleCards);
  const nodeSide = JSON.stringify(VS.readVideoCards(parseHTML(gridHtml).children[0]));
  const browserSide = await page.evaluate(({ src, html }) => {
    const s = {};
    new Function('self', src)(s); // eslint-disable-line no-new-func
    const holder = document.createElement('div');
    holder.innerHTML = html;
    return JSON.stringify(s.THQVideoSelection.readVideoCards(holder.firstElementChild));
  }, { src: readFileSync(join(EXT, 'content', 'video-selection.js'), 'utf8'), html: gridHtml });
  check('card reader output identical in mini-DOM and Chromium', nodeSide === browserSide,
    nodeSide === browserSide ? `${JSON.parse(nodeSide).length} cards` : `node=${nodeSide.slice(0, 200)} browser=${browserSide.slice(0, 200)}`);

  const headerVariants = [
    { name: 'A', handle: '@aaa_channel', description: 'P1.\nP2.' },
    { name: 'B', handle: '@bbb_channel', description: 'Same.\nSame.' },
    { name: 'C', handle: '@ccc_channel', description: 'Copy.\nTwo.', descriptionCopy: 'measure' },
    { name: 'D', handle: '@ddd_channel', description: 'Copy.', descriptionCopy: 'inMore' },
  ];
  const cdSrc = ['video-selection.js', 'url-export.js', 'channel-details.js'].map((f) => readFileSync(join(EXT, 'content', f), 'utf8'));
  const nodeHeaders = JSON.stringify(headerVariants.map((v) => loadContentScripts().CD.readChannelHeader(parseHTML(modernHeader(v)).children[0])));
  const browserHeaders = await page.evaluate(({ srcs, htmls }) => {
    const s = {};
    for (const src of srcs) new Function('self', src)(s); // eslint-disable-line no-new-func
    return JSON.stringify(htmls.map((html) => {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      return s.THQChannelDetails.readChannelHeader(holder.firstElementChild);
    }));
  }, { srcs: cdSrc, htmls: headerVariants.map((v) => modernHeader(v)) });
  check('header reader output identical in mini-DOM and Chromium (incl. description copies)', nodeHeaders === browserHeaders,
    nodeHeaders === browserHeaders ? `${headerVariants.length} headers` : `node=${nodeHeaders.slice(0, 160)} browser=${browserHeaders.slice(0, 160)}`);

  console.log('\nLAYOUT (fixture page, not YouTube CSS)');
  await page.goto('https://www.youtube.com/@FixtureTax/videos');
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });
  for (const width of [1280, 800, 420]) {
    await page.setViewportSize({ width, height: 900 });
    await sleep(150);
    const geo = await page.evaluate(() => {
      const host = document.querySelector('.thq-bar-host');
      const chips = document.querySelector('chip-bar-view-model').getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const buttons = [...host.shadowRoot.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      return {
        inView: buttons.every((r) => r.left >= 0 && r.right <= window.innerWidth + 0.5),
        overlapChips: !(h.bottom <= chips.top || h.top >= chips.bottom),
        rows: new Set(buttons.map((r) => Math.round(r.top))).size,
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    check(`width ${width}: every bar button within the viewport, no overlap with sort chips`,
      geo.inView && !geo.overlapChips, `rows=${geo.rows}, pageHorizontalOverflow=${geo.pageOverflow}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  console.log('\nMETRICS PATH WITHOUT AN API KEY (fresh profile)');
  await bar().locator('button[data-metric="views"]').click();
  await sleep(2500);
  const panel = await page.evaluate(() => {
    const host = document.querySelector('.thq-panel-host');
    return host && host.shadowRoot ? host.shadowRoot.textContent : '';
  });
  check('Avg Views reports the missing key; exports did not need one', /API key/i.test(panel), panel.slice(0, 160));


  console.log('\nv1.3.0 SURFACES: SHORTS, LIVE, PODCASTS, PLAYLIST EPISODES');
  const inventoryBar = async (url) => {
    await page.goto(url);
    await bar().first().waitFor({ state: 'attached', timeout: 15000 });
    return (await bar().locator('.bar').first().innerText()).replace(/\s+/g, ' ').trim();
  };
  const sbar = await inventoryBar('https://www.youtube.com/@FixtureTax/shorts');
  check('Shorts tab: reduced bar (no metrics, no 12-video exports)', /^TH Copy all video URLs Download all video descriptions$/.test(sbar), sbar);
  const lsh = await clickExport(0, DONE);
  check('Shorts tab: native /shorts/ URLs in card order', lsh === 'Copied 3 URLs' && (await clip()) === `Total URLs: 3\nSort: Latest\n\n${shortsIds.map((id) => `https://www.youtube.com/shorts/${id}`).join('\n')}`, lsh);
  const rich = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return item.types.includes('text/html') ? (await (await item.getType('text/html')).text()) : '';
  });
  check('rich clipboard: text/html with clickable links alongside plain text', (rich.match(/<a href="https:\/\/www\.youtube\.com\/shorts\//g) || []).length === 3, rich.slice(0, 90));
  await inventoryBar('https://www.youtube.com/@FixtureTax/streams');
  const lst = await clickExport(0, DONE);
  check('Live tab: live, upcoming and completed streams, watch URLs', lst === 'Copied 3 URLs' && (await clip()).endsWith([vid(61001), vid(61002), vid(61003)].map(wurl).join('\n')), lst);
  await inventoryBar('https://www.youtube.com/@FixtureTax/podcasts');
  await setClip('SENTINEL');
  const lp2 = await clickExport(0, /^(Open a podcast|Copied|No loaded)/);
  check('Podcasts tab: playlist tiles are not passed off as videos', lp2 === 'Open a podcast to export its episodes' && (await clip()) === 'SENTINEL', lp2);
  const pbar = await inventoryBar('https://www.youtube.com/playlist?list=PLpodcastAAAAAAAAA');
  const lpl = await clickExport(0, DONE);
  check('Podcast episode list (playlist page): episodes, playlist order, &list= stripped', /Copy all video URLs Download all video descriptions/.test(pbar)
    && lpl === 'Copied 4 URLs' && (await clip()) === `Total URLs: 4\nSort: Playlist order\n\n${episodeIds.map(wurl).join('\n')}`, lpl);

  console.log('\nv1.3.0 DOWNLOAD ALL VIDEO DESCRIPTIONS (mocked YouTube Data API)');
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await sw.evaluate((k) => chrome.storage.local.set({ youtubeApiKey: k }), API_KEY);
  const jobState = () => sw.evaluate(async () => (await chrome.storage.local.get('descriptionJob')).descriptionJob);
  const waitJob = async (pred, ms = 30000) => {
    const end = Date.now() + ms;
    let j;
    while (Date.now() < end) { j = await jobState(); if (j && pred(j)) return j; await sleep(200); }
    return j;
  };
  // Playwright stores downloads under GUID paths, so the file is found by the
  // job's download id; the requested name is checked on the job record.
  const savedFile = (j, nameRe) => (j && typeof j.downloadId === 'number' && nameRe.test(j.filename || '')
    ? sw.evaluate((id) => new Promise((res) => chrome.downloads.search({ id }, (all) => res(all.map((d) => ({ id: d.id, state: d.state, filename: d.filename }))))), j.downloadId)
    : Promise.resolve([]));

  await page.goto('https://www.youtube.com/@FixtureTax/videos');
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });
  const pageOrder = await page.evaluate(() => [...document.querySelectorAll('ytd-rich-item-renderer a[href*="/watch?v="]')].map((a) => new URL(a.href).searchParams.get('v')).filter((v, i, arr) => arr.indexOf(v) === i));
  await exportButtons().nth(3).click();
  const first = await waitLabel(3, /^(Descriptions|Saving|Downloaded|API key|Could not|Download failed)/);
  await exportButtons().nth(3).click();
  const dupe = await waitLabel(3, /^(Already running|Downloaded)/, 4000);
  check('description job starts from the page; a second click does not start a duplicate', /^Descriptions \d+\/30/.test(first) && /^Already running/.test(dupe), `${first} | ${dupe}`);
  await page.goto('https://www.youtube.com/@OtherCreator/videos'); // leave the page mid-job
  const job = await waitJob((j) => ['done', 'failed', 'interrupted'].includes(j.state));
  const files = await savedFile(job, /^FixtureTax-videos-video-descriptions-\d{4}-\d\d-\d\d\.txt$/);
  check('job finished after leaving the page; success reported only for a completed download', job && job.state === 'done' && files.length === 1 && files[0].state === 'complete', `${job && job.state} ${job && job.filename}`);
  const txt = files[0] ? readFileSync(files[0].filename, 'utf8') : '';
  check('TXT header: channel, tab, sort, counts', txt.startsWith('TERNARY HOUSE — VIDEO DESCRIPTIONS\n\nChannel: Fixture Tax Pro\nChannel URL: https://www.youtube.com/@FixtureTax\nTab: Videos\nSort: Latest\nCaptured at (UTC): ')
    && txt.includes('Total requested: 30\nDescriptions retrieved: 29\nEmpty descriptions: 0\nMissing/failed: 1\n'), txt.slice(0, 160));
  const missingSection = txt.slice(txt.indexOf('# MISSING'), txt.indexOf('-'.repeat(125)));
  check('# MISSING lists the omitted video with its page title, URL and ID', missingSection.includes(`Video ID: ${MISSING_ID}`) && missingSection.includes(`URL: ${wurl(MISSING_ID)}`) && /Title: Video 1005/.test(missingSection), missingSection.slice(0, 200));
  const recordIds = [...txt.matchAll(/^Video ID: (\S+)$/gm)].map((m) => m[1]).slice(1);
  check('records follow loaded page order (Premieres included), API order ignored', recordIds.join(',') === pageOrder.join(','), `${recordIds.length} records`);
  check('descriptions verbatim (Unicode, codes, URLs, delimiter-like line)', txt.includes(`DESCRIPTION:\nОписание ${vid(1000)}\n\nSponsor: use code SAVE20 → https://example.com/?a=1&b=2\n${'-'.repeat(125)}\n00:00 Intro`));
  check('API: part=snippet, ≤50 IDs per request, key never in the file', apiCalls.every((c) => c.part === 'snippet' && c.ids.length <= 50 && c.keyOk) && !txt.includes(API_KEY), `${apiCalls.length} request(s)`);
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });

  await page.goto('https://www.youtube.com/playlist?list=PLpodcastAAAAAAAAA');
  await bar().first().waitFor({ state: 'attached', timeout: 15000 });
  await exportButtons().nth(1).click();
  const pjob = await waitJob((j) => j.snapshot && j.snapshot.tab === 'playlist' && ['done', 'failed'].includes(j.state));
  const pfiles = await savedFile(pjob, /^AbutaymiyyahMJ-playlist-video-descriptions-\d{4}-\d\d-\d\d\.txt$/);
  const ptxt = pfiles[0] ? readFileSync(pfiles[0].filename, 'utf8') : '';
  check('podcast episodes: TXT with owner channel, playlist line and 4 episodes', pjob && pjob.state === 'done'
    && ptxt.includes('Channel: Abu Taymiyyah\nChannel URL: https://www.youtube.com/@AbutaymiyyahMJ\nTab: Podcast episodes / playlist\nPlaylist: Fixture Podcast — https://www.youtube.com/playlist?list=PLpodcastAAAAAAAAA\nSort: Playlist order')
    && ptxt.includes('Total requested: 4\n'), ptxt.slice(0, 260));
  const plabel = await waitLabel(1, /^Downloaded/, 5000);
  check('button reports the finished download', plabel === 'Downloaded 4', plabel);

  console.log('\nNETWORK');
  const outside = requests.filter((u) => !u.startsWith('https://www.youtube.com/') && !u.startsWith('https://i.ytimg.com/')
    && !(u.startsWith('https://www.googleapis.com/youtube/v3/videos?') && new URL(u).searchParams.get('part') === 'snippet'));
  check('no request outside the fixture origin except the descriptions videos.list?part=snippet calls', outside.length === 0, outside.slice(0, 3).join(', '));
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed (simulated markup; not live YouTube)`);
process.exit(failed.length ? 1 : 0);
