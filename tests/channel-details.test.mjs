/**
 * v1.2 "Copy Channel Details" tests.
 *
 * Runs the REAL shipped content/channel-details.js with the shared selector
 * and export operation. Header and card markup are SIMULATED
 * (tests/fixtures/youtube-markup.mjs), not live captures.
 *
 *   node tests/channel-details.test.mjs
 */

import { parseHTML, fragment } from './helpers/mini-dom.mjs';
import { loadContentScripts, createHarness, assert, equal } from './helpers/load-content.mjs';
import {
  STATUS, publishedAt, modernCard, legacyRichCard, modernHeader, legacyHeader, grid, channelPage, tvMisericordiaShape,
} from './fixtures/youtube-markup.mjs';

const { VS, X, CD } = loadContentScripts();
const { test, group, run } = createHarness();
const P = VS.STATE;

const vid = (n) => `V${String(n).padStart(10, '0')}`;
const gridOf = (cards) => parseHTML(grid(cards.join(''))).children[0];
const publishedRun = (from, count, build = modernCard) => Array.from(
  { length: count },
  (_, i) => build({ id: vid(from + i), title: `Video ${from + i}`, ...publishedAt(1 + i * 3) }),
);

const HEADER = {
  name: 'Paul J Lipsky',
  handle: '@PaulJLipsky',
  subscribers: '1.2M subscribers',
  videoCount: '1.1K videos',
  description: 'Line one about taxes.\nLine two with "quotes" and a \\ backslash.',
};
const ROUTE = { base: '@PaulJLipsky', tab: 'videos' };
const TITLE = 'Paul J Lipsky - YouTube';
const NOW = Date.UTC(2026, 9, 10, 5, 30, 0); // 2026-10-10T05:30:00Z
const DHAKA = 360;

const headerNode = (opts = HEADER, build = modernHeader) => fragment(build(opts));
const identityFor = ({ header = HEADER, route = ROUTE, documentTitle = TITLE, build } = {}) => CD.resolveChannelIdentity({
  header: CD.readChannelHeader(headerNode(header, build)), route, documentTitle,
});

function evidenceFor(cards, identity = identityFor()) {
  const selection = VS.selectEligibleVideos(VS.readVideoCards(gridOf(cards)));
  const text = CD.buildChannelEvidence({ identity, selection, capturedAtMs: NOW, utcOffsetMinutes: DHAKA, toolVersion: '1.2.0-candidate' });
  return { selection, text, json: text === null ? null : JSON.parse(text) };
}

/* =================================================================== */

group('HARNESS SELF-CHECK');

test('0. a false assertion after an await is actually caught', async () => {
  let caught = false;
  try { await Promise.resolve(); equal(1, 2, 'deliberate'); } catch { caught = true; }
  assert(caught, 'async assertions must execute before the summary');
});

/* =================================================================== */

group('CHANNEL HEADER (simulated markup)');

test('H1. modern header: name, handle, counts and the description preview with line breaks', () => {
  const h = CD.readChannelHeader(headerNode());
  equal(h.name, 'Paul J Lipsky', 'name');
  equal(h.handle, '@PaulJLipsky', 'handle, case preserved');
  equal(h.subscriberCountText, '1.2M subscribers', 'subscribers');
  equal(h.videoCountText, '1.1K videos', 'video count');
  equal(h.descriptionText, HEADER.description, 'description: newline, quotes, backslash; "...more" removed');
});

test('H2. a description preview that is NOT inside a button is read the same way', () => {
  const h = CD.readChannelHeader(headerNode({ ...HEADER, descriptionInButton: false }));
  equal(h.descriptionText, HEADER.description, 'description');
});

test('H3. a handle-like word inside the description is never taken as the handle', () => {
  const h = CD.readChannelHeader(headerNode({ ...HEADER, handle: null, description: 'Collab with @SomeoneElse\n500 videos soon' }));
  equal(h.handle, null, 'no header handle');
  equal(h.videoCountText, '1.1K videos', 'count from the header row, not the description');
});

test('H4. legacy C4 header: name, handle, subscribers; no description', () => {
  const h = CD.readChannelHeader(headerNode({ name: 'Legacy Creator', handle: '@legacy_creator', subscribers: '532K subscribers' }, legacyHeader));
  equal(h.name, 'Legacy Creator', 'name');
  equal(h.handle, '@legacy_creator', 'handle');
  equal(h.subscriberCountText, '532K subscribers', 'subscribers');
  equal(h.descriptionText, null, 'no description');
});

test('H5. the extension\'s own bar inside the header is never read', () => {
  const node = headerNode({ ...HEADER, handle: null });
  const actions = node.querySelector('yt-flexible-actions-view-model');
  actions.appendChild(fragment('<div class="thq-host thq-bar-host"><span>@InjectedHandle</span><span>99 videos</span></div>'));
  const h = CD.readChannelHeader(node);
  equal(h.handle, null, 'own UI skipped');
});

test('H6. findChannelHeader finds the modern header on a full page', () => {
  const doc = parseHTML(channelPage({ header: modernHeader(HEADER), cards: '' }));
  const node = CD.findChannelHeader(doc);
  assert(node && node.tagName === 'YT-PAGE-HEADER-RENDERER', 'header found');
  equal(CD.findChannelHeader(parseHTML('<div></div>')), null, 'absent -> null');
});

/* =================================================================== */

group('CHANNEL IDENTITY');

test('I1. handle URL: page handle preserved, clean channel URL', () => {
  const id = identityFor({ route: { base: '@pauljlipsky', tab: 'videos' } });
  equal(id.ok, true, 'ok (handles are case-insensitive)');
  equal(id.channel.channel_handle, '@PaulJLipsky', 'the page\'s capitalisation, not the URL\'s');
  equal(id.channel.channel_handle_source, 'PAGE_HEADER', 'source');
  equal(id.channel.channel_url, 'https://www.youtube.com/@PaulJLipsky', 'canonical URL');
});

test('I2. a header from another channel (stale after SPA navigation) blocks the export', () => {
  const handle = identityFor({ route: { base: '@SomeoneElse', tab: 'videos' } });
  equal(handle.ok, false, 'handle mismatch refused');
  assert(handle.problems.includes('CHANNEL_HANDLE_MISMATCH'), 'problem named');
  const name = identityFor({ documentTitle: 'Someone Else - YouTube' });
  equal(name.ok, false, 'name mismatch refused');
  assert(name.problems.includes('CHANNEL_NAME_MISMATCH'), 'problem named');
  equal(identityFor({ documentTitle: '(3) Paul J Lipsky - YouTube' }).ok, true, 'notification count prefix tolerated');
});

test('I3. /channel/UC... with no handle on the page: handle null, never fabricated', () => {
  const id = identityFor({ header: { ...HEADER, handle: null }, route: { base: 'channel/UCabcdefghijklmnopqrstuv', tab: 'videos' } });
  equal(id.ok, true, 'ok');
  equal(id.channel.channel_handle, null, 'no invented handle');
  equal(id.channel.channel_url, 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', 'channel URL from the route');
});

test('I4. handle only in the URL: used, with its source recorded', () => {
  const id = identityFor({ header: { ...HEADER, handle: null } });
  equal(id.channel.channel_handle, '@PaulJLipsky', 'from route');
  equal(id.channel.channel_handle_source, 'URL_ROUTE', 'source');
});

test('I5. name falls back to the tab title; nothing at all is refused', () => {
  const fallback = identityFor({ header: { ...HEADER, name: null } });
  equal(fallback.channel.channel_name, 'Paul J Lipsky', 'from the title');
  equal(fallback.channel.channel_name_source, 'DOCUMENT_TITLE', 'source');
  const none = identityFor({ header: { ...HEADER, name: null }, documentTitle: 'YouTube' });
  equal(none.ok, false, 'no name -> refused');
  assert(none.problems.includes('CHANNEL_NAME_UNAVAILABLE'), 'problem named');
});

test('I6. Unicode handle routes are decoded and re-encoded consistently', () => {
  const id = identityFor({ header: { ...HEADER, handle: '@করদাতা' }, route: { base: encodeURIComponent('@করদাতা'), tab: 'videos' } });
  equal(id.ok, true, 'encoded route matches the page handle');
  equal(id.channel.channel_handle, '@করদাতা', 'handle as shown');
  equal(id.channel.channel_url, `https://www.youtube.com/@${encodeURIComponent('করদাতা')}`, 'URL percent-encoded');
});

test('I7. More info: present counts kept; About-panel fields null; description PARTIAL or UNAVAILABLE', () => {
  const full = identityFor();
  equal(full.moreInfo.subscriber_count_text, '1.2M subscribers', 'subscribers');
  equal(full.moreInfo.video_count_text, '1.1K videos', 'videos');
  equal(full.moreInfo.country_or_region, null, 'country never inferred');
  equal(full.moreInfo.joined_text, null, 'joined not read');
  equal(full.moreInfo.lifetime_views_text, null, 'lifetime views not read');
  equal(full.channel.description_extent, 'PARTIAL', 'a preview is never claimed FULL');
  const bare = identityFor({ header: { name: 'Bare', handle: '@bare_channel', description: null }, route: { base: '@bare_channel', tab: 'videos' }, documentTitle: 'Bare - YouTube' });
  equal(bare.moreInfo.subscriber_count_text, null, 'missing count -> null');
  equal(bare.channel.description_text, null, 'no description -> null');
  equal(bare.channel.description_extent, 'UNAVAILABLE', 'extent');
});

/* =================================================================== */

group('EVIDENCE BLOCK');

test('J1. one strict JSON block: source evidence, never a READY packet', () => {
  const { json, text } = evidenceFor(publishedRun(100, 12));
  equal(json.capture_type, 'TERNARY_HOUSE_BROWSER_EVIDENCE_INPUT', 'capture_type');
  equal(json.capture_format_version, '1.0', 'format version');
  equal(json.is_creator_evidence_packet, false, 'not a CEP');
  equal(json.evidence_maker_validation_required, true, 'validation required');
  equal(json.source.type, 'browser_dom_capture', 'source type');
  equal(json.source.source_ref, 'D1', 'source ref');
  equal(json.source.tab, 'VIDEOS', 'tab');
  equal(json.source.sort, 'LATEST', 'sort');
  equal(json.source.tool_version, '1.2.0-candidate', 'tool version');
  assert(!/\bREADY\b/.test(text), 'never labelled READY');
  assert(!/\]\(http/.test(text), 'no Markdown links');
  equal(JSON.stringify(JSON.parse(text), null, 2), text, 'canonical, strictly parseable JSON');
});

test('J2. captured_at is the capture clock with its offset', () => {
  equal(evidenceFor(publishedRun(100, 12)).json.captured_at, '2026-10-10T11:30:00+06:00', 'Dhaka');
  equal(CD.isoWithOffset(NOW, 0), '2026-10-10T05:30:00+00:00', 'UTC');
  equal(CD.isoWithOffset(NOW, -330), '2026-10-10T00:00:00-05:30', 'negative half hour');
  equal(CD.isoWithOffset(NOW, 345), '2026-10-10T11:15:00+05:45', 'Nepal');
});

test('J3. exactly 12 videos, positions 1-12, every field from its own card', () => {
  const cards = publishedRun(200, 12);
  cards[4] = modernCard({ id: vid(204), title: 'Clipped in the grid, full in the attribute', visibleTitle: 'Clipped in the grid…', ...publishedAt(13) });
  cards[7] = modernCard({ id: vid(207), title: 'No runtime badge here', badge: null, meta: ['1K views', '3 weeks ago'] });
  const { json } = evidenceFor(cards);
  const s = json.sample;
  equal(s.selection_method, '12_MOST_RECENT_CONSECUTIVE_ELIGIBLE_PUBLISHED_VIDEOS', 'method');
  equal(s.required_count, 12, 'required');
  equal(s.actual_count, 12, 'actual');
  equal(s.ordering, 'NEWEST_TO_OLDEST', 'ordering');
  equal(s.videos.length, 12, 'twelve objects');
  s.videos.forEach((v, i) => {
    equal(v.position, i + 1, `position ${i + 1}`);
    equal(v.video_id, vid(200 + i), `id ${i + 1}`);
    equal(v.video_url, `https://www.youtube.com/watch?v=${vid(200 + i)}`, `url ${i + 1}`);
    equal(v.source_ref, 'D1', `source_ref ${i + 1}`);
    equal(v.thumbnail_text, null, `thumbnail_text ${i + 1} (no OCR)`);
    equal(v.publication_state, 'PUBLISHED_COMPLETED', `state ${i + 1}`);
  });
  equal(s.videos[0].title, 'Video 200', 'title');
  equal(s.videos[0].title_source, 'DOM_TITLE_ATTRIBUTE', 'title source');
  equal(s.videos[0].published_text, '1 day ago', 'published text');
  equal(s.videos[0].duration_text, '10:15', 'duration text');
  equal(s.videos[4].title, 'Clipped in the grid, full in the attribute', 'full title');
  equal(s.videos[4].title_truncated_in_ui, true, 'clipping recorded');
  equal(s.videos[7].duration_text, null, 'absent runtime -> null');
  assert(json.capture_limitations.some((n) => /position\(s\) 8\b/.test(n)), 'missing runtime noted');
  assert(json.capture_limitations.some((n) => /About panel/.test(n)), 'About-panel fields noted');
  assert(json.capture_limitations.some((n) => /no OCR/.test(n)), 'thumbnail text noted');
});

test('J4. scheduled Premieres are skipped, and listed separately as NOT in the sample', () => {
  const cards = [
    modernCard({ id: vid(901), title: 'Premiere 11 Oct', badge: 'UPCOMING', meta: ['Premieres 10/11/26, 8:00 PM'], button: 'Notify me' }),
    ...publishedRun(300, 1),
    modernCard({ id: vid(902), title: 'Premiere 12 Oct', badge: 'UPCOMING', meta: ['Premieres 10/12/26, 8:00 PM'], button: 'Notify me' }),
    ...publishedRun(301, 13),
  ];
  const { json } = evidenceFor(cards);
  assert(!json.sample.videos.some((v) => v.video_id === vid(901) || v.video_id === vid(902)), 'not in the sample');
  equal(json.sample.excluded_not_in_sample.map((x) => `${x.grid_position}:${x.video_id}:${x.publication_state}`).join(','),
    `1:${vid(901)}:SCHEDULED_UPCOMING,3:${vid(902)}:SCHEDULED_UPCOMING`, 'listed with positions');
  equal(json.sample.excluded_not_in_sample[0].status_text, 'Premieres 10/11/26, 8:00 PM', 'evidence kept');
});

test('J5. strict JSON round-trip: quotes, backslashes, newlines, Bengali, Hindi, emoji', () => {
  const titles = [
    'He said "don\'t" — then left',
    'C:\\Users\\tax\\file.pdf explained',
    'ট্যাক্স রিটার্ন ২০২৬: সম্পূর্ণ গাইড',
    'आयकर रिटर्न कैसे भरें 🧾',
    'Tabs\tand <angle> & ampersands',
    'Line one\nLine two',
  ];
  const cards = publishedRun(400, 12);
  titles.forEach((title, i) => { cards[i] = modernCard({ id: vid(400 + i), title, ...publishedAt(1 + i * 3) }); });
  const description = 'বাংলা লাইন\nहिंदी पंक्ति\n"Quoted" \\ backslash';
  const identity = identityFor({ header: { ...HEADER, description } });
  const { json, text } = evidenceFor(cards, identity);
  titles.forEach((title, i) => equal(json.sample.videos[i].title, title, `title ${i + 1} round-trips exactly`));
  equal(json.channel.description_text, description, 'description round-trips exactly');
  assert(text.includes('ট্যাক্স'), 'Unicode written as characters, not escapes');
});

test('J6. legacy-layout cards produce the same JSON shape', () => {
  const { json } = evidenceFor(publishedRun(500, 12, legacyRichCard));
  equal(json.sample.videos.length, 12, 'twelve');
  equal(json.sample.videos[0].title_source, 'DOM_TITLE_ATTRIBUTE', 'title source');
});

test('J7. no partial block: fewer than 12, undecided, or channel problems give null', () => {
  equal(evidenceFor(publishedRun(600, 11)).text, null, '11 published');
  const blocked = [...publishedRun(610, 5), modernCard({ id: vid(699), title: 'Unclear', ...STATUS.noStatus }), ...publishedRun(620, 10)];
  equal(evidenceFor(blocked).text, null, 'undecided card before the 12th');
  equal(evidenceFor(publishedRun(630, 12), identityFor({ documentTitle: 'Someone Else - YouTube' })).text, null, 'identity problem');
  const fake = VS.selectEligibleVideos(VS.readVideoCards(gridOf(publishedRun(640, 12))));
  fake.videos[3] = { ...fake.videos[3], state: P.SCHEDULED };
  equal(CD.buildChannelEvidence({ identity: identityFor(), selection: fake, capturedAtMs: NOW, utcOffsetMinutes: 0 }), null, 'a non-published video is refused');
});

/* =================================================================== */

group('BOTH 12-VIDEO BUTTONS — SAME PAGE, SAME VIDEOS');

/** An exporter pair over ONE simulated page, as the Controller builds them. */
function pagePair({ cards, header = HEADER, route = ROUTE, documentTitle = TITLE, latest = true, copyResult = true }) {
  const page = { gridNode: gridOf(cards), header, route, documentTitle, latest, scope: 'A', alive: true, copies: [], copyResult, clock: NOW };
  const lock = X.createDomLock();
  const common = {
    isLatest: () => page.latest,
    scopeKey: () => page.scope,
    isAlive: () => page.alive,
    readEntries: () => X.readGridEntries(page.gridNode),
    loadMore: async () => true,
    saveScroll: () => 0,
    restoreScroll: () => {},
    copy: async (text) => { page.copies.push(text); return page.copyResult; },
    lock,
    now: () => page.clock,
  };
  page.lock = lock;
  page.urls = X.createUrlExporter({ ...common, name: 'export' });
  page.details = X.createUrlExporter({
    ...common,
    name: 'details',
    format: CD.createDetailsFormat({
      readPage: () => ({ header: CD.readChannelHeader(headerNode(page.header)), route: page.route, documentTitle: page.documentTitle }),
      now: () => page.clock,
      utcOffsetMinutes: () => DHAKA,
      toolVersion: '1.2.0-candidate',
    }),
  });
  return page;
}

test('B1. FinTaxPro-shaped page: Copy 12 URLs and Copy Channel Details agree position by position', async () => {
  const cards = [
    modernCard({ id: vid(911), title: 'Premiere 11 Oct', badge: 'UPCOMING', meta: ['Premieres 10/11/26, 8:00 PM'], button: 'Notify me' }),
    modernCard({ id: vid(912), title: 'Premiere 12 Oct', badge: 'UPCOMING', meta: ['Premieres 10/12/26, 8:00 PM'], button: 'Notify me' }),
    ...publishedRun(700, 14),
  ];
  const page = pagePair({ cards });
  const a = await page.urls.click();
  const b = await page.details.click();
  equal(a.status, 'COPIED', 'urls copied');
  equal(b.status, 'COPIED', 'details copied');
  equal(CD.detailsButtonText(b), 'Copied channel details', 'details label');
  const lines = page.copies[0].split('\n');
  equal(lines.length, 12, 'URL output still exactly 12 numbered lines');
  const json = JSON.parse(page.copies[1]);
  lines.forEach((line, i) => {
    equal(line, `${i + 1}. ${json.sample.videos[i].video_url}`, `position ${i + 1} identical`);
  });
  assert(!page.copies[0].includes(vid(911)) && !page.copies[0].includes(vid(912)), 'scheduled not in the URL block');
  assert(!json.sample.videos.some((v) => v.video_id === vid(911) || v.video_id === vid(912)), 'scheduled not in the details sample');
  equal(json.sample.excluded_not_in_sample.length, 2, 'listed only as excluded');
});

test('B2. wrong sort: both refuse, clipboard untouched', async () => {
  const page = pagePair({ cards: publishedRun(800, 12), latest: false });
  equal((await page.urls.click()).status, 'WRONG_SORT', 'urls');
  const r = await page.details.click();
  equal(r.status, 'WRONG_SORT', 'details');
  equal(CD.detailsButtonText(r), 'Switch to Latest', 'label');
  equal(page.copies.length, 0, 'nothing copied');
});

test('B3. channel identity problems refuse the details block only', async () => {
  const page = pagePair({ cards: publishedRun(810, 12), route: { base: '@SomeoneElse', tab: 'videos' } });
  const r = await page.details.click();
  equal(r.status, 'CHANNEL_UNCLEAR', 'status');
  equal(CD.detailsButtonText(r), 'Channel identity unclear', 'label');
  equal(page.copies.length, 0, 'nothing copied');
  equal((await page.urls.click()).status, 'COPIED', 'Copy 12 URLs does not depend on the header');
});

test('B4. fewer than 12 and undecided status are refused with distinct labels', async () => {
  const few = pagePair({ cards: publishedRun(820, 10) });
  const r = await few.details.click();
  equal(r.status, 'INSUFFICIENT', 'status');
  equal(CD.detailsButtonText(r), 'Found 10 of 12 — load/retry', 'label says load/retry, not "the channel has 10"');
  const unclear = pagePair({ cards: [...publishedRun(830, 3), modernCard({ id: vid(899), title: 'x', ...STATUS.conflicting }), ...publishedRun(840, 12)] });
  const u = await unclear.details.click();
  equal(u.status, 'REVIEW_STATUS', 'undecided status');
  equal(CD.detailsButtonText(u), 'Review video status', 'label');
  equal(few.copies.length + unclear.copies.length, 0, 'nothing copied');
});

test('B5. prepared details block: never copied after SPA navigation, sort change or expiry', async () => {
  const prepare = async () => {
    const page = pagePair({ cards: publishedRun(850, 12), copyResult: false });
    // Force the asynchronous path: the first read shows 8 cards, the 12 load.
    const full = page.gridNode;
    page.gridNode = gridOf(publishedRun(850, 8));
    const realRead = X.readGridEntries;
    let loads = 0;
    page.details = X.createUrlExporter({
      isLatest: () => page.latest, scopeKey: () => page.scope, isAlive: () => page.alive,
      readEntries: () => realRead(page.gridNode),
      loadMore: async () => { loads += 1; page.gridNode = full; return true; },
      saveScroll: () => 0, restoreScroll: () => {},
      copy: async (text) => { page.copies.push(text); return page.copyResult; },
      lock: page.lock, name: 'details', now: () => page.clock,
      format: CD.createDetailsFormat({
        readPage: () => ({ header: CD.readChannelHeader(headerNode(page.header)), route: page.route, documentTitle: page.documentTitle }),
        now: () => page.clock, utcOffsetMinutes: () => DHAKA, toolVersion: 'x',
      }),
    });
    const first = await page.details.click();
    equal(first.status, 'READY', 'prepared after the async copy was refused');
    equal(CD.detailsButtonText(first), 'Ready — click to copy', 'label');
    assert(loads === 1, 'it loaded');
    page.copyResult = true;
    page.copies.length = 0;
    return page;
  };

  const same = await prepare();
  equal((await same.details.click()).status, 'COPIED', 'same page: second click copies');
  equal(JSON.parse(same.copies[0]).sample.videos.length, 12, 'the prepared block');

  const spa = await prepare();
  spa.scope = 'B';
  spa.gridNode = gridOf(publishedRun(950, 12));
  spa.route = { base: '@OtherCreator', tab: 'videos' };
  spa.header = { ...HEADER, name: 'Other Creator', handle: '@OtherCreator' };
  spa.documentTitle = 'Other Creator - YouTube';
  await spa.details.click();
  assert(!spa.copies.some((t) => t.includes(vid(850))), 'creator A videos never copied after SPA navigation');

  const sorted = await prepare();
  sorted.latest = false;
  equal((await sorted.details.click()).status, 'WRONG_SORT', 'sort change refuses');
  equal(sorted.copies.length, 0, 'nothing copied');

  const old = await prepare();
  old.clock += 60001;
  await old.details.click();
  equal(old.copies.length, 1, 'expired: a fresh export ran instead');
  equal(JSON.parse(old.copies[0]).captured_at, CD.isoWithOffset(old.clock, DHAKA), 'with a fresh capture time');
});

test('B6. clipboard refusal without async work: Copy failed, nothing prepared', async () => {
  const page = pagePair({ cards: publishedRun(860, 12), copyResult: false });
  const r = await page.details.click();
  equal(r.status, 'COPY_FAILED', 'status');
  equal(CD.detailsButtonText(r), 'Copy failed', 'label');
  equal(page.details.hasPrepared, false, 'nothing prepared');
});

test('B7. details and metric collection share the DOM lock (never scroll at once)', async () => {
  const page = pagePair({ cards: publishedRun(870, 12) });
  let release;
  const metric = page.lock.run('metrics', () => new Promise((r) => { release = r; }));
  const exporting = page.details.click();
  await new Promise((r) => setTimeout(r, 5));
  equal(page.copies.length, 0, 'waits for the metric collection');
  release();
  await metric;
  equal((await exporting).status, 'COPIED', 'then completes');
});

test('B9. real-pattern page (TvMisericordiaPL shape): both Latest exports agree; Premieres omitted', async () => {
  const shape = tvMisericordiaShape();
  const page = pagePair({
    cards: shape.map((c) => c.html),
    header: { name: 'TV Misericordia', handle: '@TvMisericordiaPL', subscribers: '120K subscribers', videoCount: '4K videos', description: 'Telewizja katolicka.' },
    route: { base: '@TvMisericordiaPL', tab: 'videos' },
    documentTitle: 'TV Misericordia - YouTube',
  });
  const a = await page.urls.click();
  const b = await page.details.click();
  equal(a.status, 'COPIED', `Copy 12 URLs (${X.exportButtonText(a)})`);
  equal(b.status, 'COPIED', `Copy Channel Details (${CD.detailsButtonText(b)})`);
  equal(a.excludedCount, 3, 'three Premieres skipped');
  const lines = page.copies[0].split('\n');
  const json = JSON.parse(page.copies[1]);
  const expected = shape.filter((c) => !c.scheduled).map((c) => c.id);
  equal(lines.length, 12, 'still exactly 12 numbered lines');
  lines.forEach((line, i) => {
    equal(line, `${i + 1}. https://www.youtube.com/watch?v=${expected[i]}`, `URL line ${i + 1}`);
    equal(json.sample.videos[i].video_id, expected[i], `JSON position ${i + 1}`);
  });
  equal(json.sample.videos[0].published_text, '2 hours ago', 'published_text from the label');
  equal(json.sample.videos[0].published_text_source, 'ACCESSIBLE_LABEL', 'and its source');
  equal(json.sample.videos[0].duration_text, '7:32', 'runtime');
  equal(json.sample.videos[0].title, 'Msza Święta 1 — „Różaniec”', 'Polish title intact');
  equal(json.sample.excluded_not_in_sample.map((x) => x.grid_position).join(','), '3,4,5', 'Premieres listed as excluded only');
  equal(json.sample.excluded_not_in_sample[0].status_text, 'Premieres 10/11/26, 1:00 AM', 'U+202F survives the JSON round-trip');
  assert(json.capture_limitations.some((n) => /ACCESSIBLE_LABEL/.test(n)), 'the label source is explained');
});

test('B8. labels', () => {
  equal(CD.DETAILS_TEXT.IDLE, 'Copy Channel Details', 'idle');
  equal(CD.detailsButtonText({ status: 'REVIEW_ORDER' }), 'Review video order', 'order');
  equal(CD.detailsButtonText({ status: 'ABORTED' }), 'Copy Channel Details', 'aborted resets');
  equal(CD.detailsButtonText({ status: 'IGNORED' }), null, 'ignored leaves the label alone');
});

await run();
