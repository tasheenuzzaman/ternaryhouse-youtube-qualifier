/**
 * v1.3.0 "Download all video descriptions".
 *
 * Runs the REAL lib/descriptions.js and background/description-jobs.js. The
 * YouTube API and the chrome.* surface are in-memory stand-ins; no network.
 *
 *   node tests/descriptions.test.mjs
 */

import {
  normalizeSnapshot, fetchDescriptions, buildDescriptionsText, descriptionsFilename, countRecords,
  STATUS, RECORD_DELIMITER, MAX_IDS_PER_REQUEST,
} from '../lib/descriptions.js';
import { createDescriptionJobs, JOB_KEY } from '../background/description-jobs.js';
import { createHarness, assert, equal } from './helpers/load-content.mjs';

const { test, group, run } = createHarness();
const KEY = 'AIzaSECRETKEY-must-never-leak';
const vid = (n) => `D${String(n).padStart(10, '0')}`;
const items = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: vid(from + i), kind: 'watch', title: `Page title ${from + i}` }));
const noSleep = async () => {};

/** A fake videos.list endpoint. `behave(ids, call)` may return a Response-like or throw. */
function fakeApi(descFor, behave) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const ids = u.searchParams.get('id').split(',');
    calls.push({ url, ids, part: u.searchParams.get('part') });
    const custom = behave && behave(ids, calls.length);
    if (custom) return custom;
    // Deliberately reversed: the API does not promise page order.
    const out = ids.filter((id) => descFor(id) !== undefined).reverse()
      .map((id) => ({ id, snippet: { title: `API ${id}`, description: descFor(id), publishedAt: '2026-10-01T12:00:00Z', liveBroadcastContent: 'none' } }));
    return { ok: true, status: 200, json: async () => ({ items: out }) };
  };
  return { fetchImpl, calls };
}
const httpError = (status, reason, message = 'err') => ({
  ok: false, status, json: async () => ({ error: { message, errors: [{ reason }] } }),
});

const SNAP = (n = 3) => normalizeSnapshot({
  items: items(n), capturedAt: Date.UTC(2026, 9, 31, 9, 15, 0), channelName: 'Paul J Lipsky', channelUrl: 'https://www.youtube.com/@PaulJLipsky',
  channelHandle: '@PaulJLipsky', tab: 'videos', tabLabel: 'Videos', sort: 'Latest',
}, Date.UTC(2026, 9, 31, 9, 15, 5));

/* ================================================================== */

group('RETRIEVAL');

test('R1. batches of at most 50, part=snippet, responses mapped by exact ID, page order kept', async () => {
  const api = fakeApi((id) => `desc ${id}`);
  const list = items(120);
  const { records, requestCount } = await fetchDescriptions(KEY, list, { fetchImpl: api.fetchImpl, sleep: noSleep });
  equal(api.calls.length, 3, 'ceil(120/50) requests');
  assert(api.calls.every((c) => c.ids.length <= MAX_IDS_PER_REQUEST && c.part === 'snippet'), 'batch size and part');
  equal(requestCount, 3, 'request count');
  equal(records.map((r) => r.id).join(','), list.map((i) => i.id).join(','), 'page order, not API order');
  assert(records.every((r) => r.description === `desc ${r.id}`), 'each description belongs to its own ID');
});

test('R2. descriptions are preserved byte for byte (Unicode, URLs, codes, delimiter-like lines)', async () => {
  const tricky = `  \n\tLeading whitespace kept\nBengali: ট্যাক্স রিটার্ন\nHindi: आयकर\nEmoji 🧾 and “quotes” \\ backslash\n\n00:00 Intro\n03:15 Sponsor — use code SAVE20 at https://example.com/?a=1&b=2\n${RECORD_DELIMITER}\nDESCRIPTION:\nTitle: fake\n  trailing spaces   \n\tTab\r\nCRLF line\n\n   `;
  const api = fakeApi(() => tricky);
  const { records } = await fetchDescriptions(KEY, items(1), { fetchImpl: api.fetchImpl, sleep: noSleep });
  equal(records[0].description, tricky, 'unchanged');
  const text = buildDescriptionsText(SNAP(1), records);
  assert(text.includes(`DESCRIPTION:\n${tricky}\n`), 'written verbatim into the TXT');
  assert(text.includes(`Description length (characters): ${[...tricky].length}`), 'length stated so a parser can find the end');
});

test('R3. empty, omitted (private/deleted) and malformed records are distinguished; nothing is dropped', async () => {
  const api = fakeApi((id) => (id === vid(1) ? '' : id === vid(2) ? undefined : 'x'), null);
  const list = items(4);
  const malformed = { ...api, fetchImpl: async (url) => {
    const r = await api.fetchImpl(url);
    const data = await r.json();
    data.items = data.items.map((it) => (it.id === vid(3) ? { id: it.id } : it));
    return { ok: true, status: 200, json: async () => data };
  } };
  const { records } = await fetchDescriptions(KEY, list, { fetchImpl: malformed.fetchImpl, sleep: noSleep });
  equal(records.map((r) => r.status).join(','), [STATUS.RETRIEVED, STATUS.EMPTY, STATUS.UNAVAILABLE, STATUS.ERROR].join(','), 'statuses');
  equal(records.length, 4, 'every loaded video has a record');
  const c = countRecords(records);
  equal(`${c.total}/${c.retrieved}/${c.empty}/${c.missing}`, '4/1/1/2', 'counts');
});

test('R4. transient failures are retried a bounded number of times', async () => {
  let n = 0;
  const flaky = fakeApi(() => 'ok', () => (++n <= 2 ? httpError(503, 'backendError') : null));
  const ok = await fetchDescriptions(KEY, items(1), { fetchImpl: flaky.fetchImpl, sleep: noSleep });
  equal(ok.records[0].status, STATUS.RETRIEVED, 'third attempt succeeds');
  equal(flaky.calls.length, 3, 'two retries');

  const down = fakeApi(() => 'ok', () => httpError(503, 'backendError'));
  const failed = await fetchDescriptions(KEY, items(60), { fetchImpl: down.fetchImpl, sleep: noSleep });
  equal(down.calls.length, 6, 'exactly 3 attempts per batch, no more');
  assert(failed.records.every((r) => r.status === STATUS.REQUEST_FAILED && /HTTP 503 after 3 attempts/.test(r.reason)), 'reported');

  const thrower = fakeApi(() => 'ok', () => { throw new Error(`boom ${KEY}`); });
  const net = await fetchDescriptions(KEY, items(1), { fetchImpl: thrower.fetchImpl, sleep: noSleep });
  assert(!JSON.stringify(net).includes(KEY), 'a thrown error carrying the key is never echoed');
});

test('R5. quota exhaustion stops further requests; finished batches are kept', async () => {
  const api = fakeApi(() => 'ok', (_ids, call) => (call === 2 ? httpError(403, 'quotaExceeded') : null));
  const { records, fatal } = await fetchDescriptions(KEY, items(150), { fetchImpl: api.fetchImpl, sleep: noSleep });
  equal(api.calls.length, 2, 'no request after the quota error, no retry of it');
  equal(fatal.code, 'QUOTA_EXCEEDED', 'fatal reported');
  equal(records.filter((r) => r.status === STATUS.RETRIEVED).length, 50, 'first batch kept');
  equal(records.filter((r) => r.status === STATUS.REQUEST_FAILED).length, 100, 'the rest marked failed, not dropped');
});

/* ================================================================== */

group('TXT FORMAT');

test('T1. exact header, # MISSING, records and delimiter', async () => {
  const api = fakeApi((id) => (id === vid(1) ? undefined : id === vid(2) ? '' : 'Line 1\n\nLine 3'));
  const snap = SNAP(3);
  const { records } = await fetchDescriptions(KEY, snap.items, { fetchImpl: api.fetchImpl, sleep: noSleep });
  const text = buildDescriptionsText(snap, records);
  const expected = `TERNARY HOUSE — VIDEO DESCRIPTIONS

Channel: Paul J Lipsky
Channel URL: https://www.youtube.com/@PaulJLipsky
Tab: Videos
Sort: Latest
Captured at (UTC): 2026-10-31T09:15:00Z
Total requested: 3
Descriptions retrieved: 1
Empty descriptions: 1
Missing/failed: 1

# MISSING

Title: Page title 1
URL: https://www.youtube.com/watch?v=${vid(1)}
Video ID: ${vid(1)}
Reason: Not returned by the YouTube API (private, deleted or otherwise unavailable)

${RECORD_DELIMITER}

Title: API ${vid(0)}
URL: https://www.youtube.com/watch?v=${vid(0)}
Video ID: ${vid(0)}
Published (UTC): 2026-10-01T12:00:00Z
Retrieval status: Retrieved
Description length (characters): 14

DESCRIPTION:
Line 1

Line 3

${RECORD_DELIMITER}

Title: Page title 1
URL: https://www.youtube.com/watch?v=${vid(1)}
Video ID: ${vid(1)}
Published (UTC): Not available
Retrieval status: Missing — unavailable, private or deleted (not returned by the API)
Description length (characters): Not available

DESCRIPTION:
[Not retrieved — see # MISSING]

${RECORD_DELIMITER}

Title: API ${vid(2)}
URL: https://www.youtube.com/watch?v=${vid(2)}
Video ID: ${vid(2)}
Published (UTC): 2026-10-01T12:00:00Z
Retrieval status: Retrieved — the description is empty
Description length (characters): 0

DESCRIPTION:

`;
  equal(text, expected, 'exact TXT');
  equal(RECORD_DELIMITER.length, 125, 'delimiter width');
});

test('T2. no missing videos: "None"; Shorts keep /shorts/ URLs; playlist line; upcoming noted', async () => {
  const snap = normalizeSnapshot({
    items: [{ id: vid(7), kind: 'shorts', title: 'S' }], capturedAt: Date.UTC(2026, 9, 31), tab: 'playlist',
    tabLabel: 'Podcast episodes / playlist', sort: 'Playlist order', playlistTitle: 'My Podcast',
    playlistUrl: 'https://www.youtube.com/playlist?list=PLabc', playlistId: 'PLabc', channelName: 'Abu', channelUrl: 'https://www.youtube.com/@AbutaymiyyahMJ', channelHandle: '@AbutaymiyyahMJ',
  }, Date.UTC(2026, 9, 31));
  const api = fakeApi(() => 'd');
  const live = { fetchImpl: async (u) => { const r = await api.fetchImpl(u); const d = await r.json(); d.items[0].snippet.liveBroadcastContent = 'upcoming'; return { ok: true, status: 200, json: async () => d }; } };
  const { records } = await fetchDescriptions(KEY, snap.items, { fetchImpl: live.fetchImpl, sleep: noSleep });
  const text = buildDescriptionsText(snap, records);
  assert(text.includes('# MISSING\n\nNone\n'), 'None');
  assert(text.includes(`URL: https://www.youtube.com/shorts/${vid(7)}`), 'Shorts URL');
  assert(text.includes('Playlist: My Podcast — https://www.youtube.com/playlist?list=PLabc'), 'playlist line');
  assert(text.includes('Retrieval status: Retrieved (upcoming broadcast/Premiere)'), 'upcoming included and noted');
  assert(!text.includes(KEY), 'no key');
});

test('T3. file names are safe and dated', () => {
  equal(descriptionsFilename(SNAP(1)), 'PaulJLipsky-videos-video-descriptions-2026-10-31.txt', 'handle');
  const odd = normalizeSnapshot({ items: items(1), capturedAt: Date.UTC(2026, 0, 2), channelName: 'A/B: C*?"<>|', tab: 'live' }, Date.UTC(2026, 0, 2));
  equal(descriptionsFilename(odd), 'A-B-C-live-video-descriptions-2026-01-02.txt', 'reserved characters replaced');
  const pl = normalizeSnapshot({ items: items(1), capturedAt: Date.UTC(2026, 0, 2), playlistId: 'PLx_y', tab: 'playlist' }, Date.UTC(2026, 0, 2));
  equal(descriptionsFilename(pl), 'playlist-PLx_y-playlist-video-descriptions-2026-01-02.txt', 'playlist fallback');
  equal(descriptionsFilename(normalizeSnapshot({ items: items(1), channelHandle: '@করদাতা', tab: 'shorts', capturedAt: Date.UTC(2026, 0, 2) }, Date.UTC(2026, 0, 2))),
    'করদাতা-shorts-video-descriptions-2026-01-02.txt', 'Unicode handle kept');
});

test('T4. the snapshot is validated: bad IDs dropped, duplicates keep first position, URLs rebuilt', () => {
  const s = normalizeSnapshot({ items: [{ id: vid(1), url: 'https://evil.example' }, { id: 'bad' }, { id: vid(2), kind: 'shorts' }, { id: vid(1) }] });
  equal(s.items.map((i) => `${i.id}:${i.url}`).join(' '), `${vid(1)}:https://www.youtube.com/watch?v=${vid(1)} ${vid(2)}:https://www.youtube.com/shorts/${vid(2)}`, 'clean');
  equal(normalizeSnapshot({ items: [{ id: 'x' }] }), null, 'nothing valid -> null');
});

test('T5. 1,000 loaded videos: 20 requests, 1,000 records in order', async () => {
  const api = fakeApi((id) => `d${id}`);
  const list = items(1000);
  const { records } = await fetchDescriptions(KEY, list, { fetchImpl: api.fetchImpl, sleep: noSleep });
  equal(api.calls.length, 20, 'requests');
  const text = buildDescriptionsText({ ...SNAP(1), items: list }, records);
  equal(text.split(`\n\n${RECORD_DELIMITER}\n\n`).length, 1001, 'header + 1,000 records');
});

/* ================================================================== *
 * Background jobs (fake chrome.*)
 * ================================================================== */

group('BACKGROUND JOB');

function fakeChrome({ downloadOutcome = 'complete' } = {}) {
  const local = {};
  let session = {};
  const listeners = new Set();
  const downloads = [];
  const chromeApi = {
    runtime: { lastError: null, getPlatformInfo: (cb) => cb && cb({}) },
    storage: {
      local: { get: async (k) => ({ [k]: local[k] }), set: async (o) => { Object.assign(local, JSON.parse(JSON.stringify(o))); } },
      session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => { Object.assign(session, o); } },
    },
    downloads: {
      download: (opts, cb) => {
        const id = downloads.length + 1;
        downloads.push({ id, ...opts, state: 'in_progress' });
        cb(id);
        setTimeout(() => {
          downloads[id - 1].state = downloadOutcome;
          for (const l of listeners) l({ id, state: { current: downloadOutcome }, ...(downloadOutcome === 'interrupted' ? { error: { current: 'FILE_NO_SPACE' } } : {}) });
        }, 5);
      },
      search: (q, cb) => cb(downloads.filter((d) => d.id === q.id)),
      onChanged: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
    },
  };
  return { chromeApi, local, downloads, restartBrowser: () => { session = {}; } };
}

const decode = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf8');
const settle = async (jobs) => { while (jobs.running) await jobs.running; };
const rawSnap = (n) => ({ items: items(n), capturedAt: Date.now(), channelHandle: '@PaulJLipsky', channelName: 'Paul', tab: 'videos', tabLabel: 'Videos', sort: 'Latest' });

test('J1. start -> fetch -> download -> done; file is UTF-8 TXT with the right name; no key anywhere', async () => {
  const fc = fakeChrome();
  const api = fakeApi((id) => `ট্যাক্স ${id}`);
  const jobs = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: api.fetchImpl, sleep: noSleep });
  const started = await jobs.start(rawSnap(3));
  equal(started.ok, true, 'started');
  await settle(jobs);
  const { job } = await jobs.status();
  equal(job.state, 'done', 'done only after the download completed');
  equal(fc.downloads.length, 1, 'one file');
  assert(/^PaulJLipsky-videos-video-descriptions-\d{4}-\d\d-\d\d\.txt$/.test(fc.downloads[0].filename), fc.downloads[0].filename);
  const text = decode(fc.downloads[0].url);
  assert(text.startsWith('TERNARY HOUSE — VIDEO DESCRIPTIONS\n') && text.includes(`ট্যাক্স ${vid(0)}`), 'content decoded as UTF-8');
  assert(!JSON.stringify(fc.local).includes(KEY) && !text.includes(KEY) && !JSON.stringify(job).includes(KEY), 'key never stored, written or reported');
  assert(!JSON.stringify(job).includes('items'), 'status never carries the snapshot');
});

test('J2. a second start while running is refused (no duplicate job)', async () => {
  const fc = fakeChrome();
  let release;
  const gate = new Promise((r) => { release = r; });
  const api = fakeApi((id) => id);
  const slow = async (u) => { await gate; return api.fetchImpl(u); };
  const jobs = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: slow, sleep: noSleep });
  equal((await jobs.start(rawSnap(2))).ok, true, 'first');
  const second = await jobs.start(rawSnap(5));
  equal(second.ok, false, 'second refused');
  equal(second.error.code, 'BUSY', 'BUSY');
  release();
  await settle(jobs);
  equal(fc.downloads.length, 1, 'only one file');
  assert(decode(fc.downloads[0].url).includes('Total requested: 2'), 'the first snapshot, not the second');
});

test('J3. the snapshot is fixed at click time', async () => {
  const fc = fakeChrome();
  const api = fakeApi((id) => id);
  const jobs = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: api.fetchImpl, sleep: noSleep });
  const snap = rawSnap(2);
  await jobs.start(snap);
  snap.items.push(...items(5, 100)); // the page loads more / changes after the click
  snap.channelName = 'Other channel';
  await settle(jobs);
  const text = decode(fc.downloads[0].url);
  assert(text.includes('Total requested: 2') && text.includes('Channel: Paul') && !text.includes(vid(100)), 'unchanged');
});

test('J4. missing key, or a total quota/auth failure: no file, explicit error', async () => {
  const fc = fakeChrome();
  const none = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => null, fetchImpl: fakeApi(() => 'x').fetchImpl });
  const r = await none.start(rawSnap(2));
  equal(r.ok, false, 'refused');
  equal(r.error.code, 'NO_API_KEY', 'NO_API_KEY');

  const quota = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: fakeApi(() => 'x', () => httpError(403, 'quotaExceeded')).fetchImpl, sleep: noSleep });
  await quota.start(rawSnap(2));
  await settle(quota);
  const { job } = await quota.status();
  equal(job.state, 'failed', 'failed');
  equal(job.error.code, 'QUOTA_EXCEEDED', 'quota named');
  equal(fc.downloads.length, 0, 'no misleading empty export');
});

test('J5. partial failure still downloads, with the failures under # MISSING', async () => {
  const fc = fakeChrome();
  const api = fakeApi((id) => (id === vid(1) || id === vid(4) ? undefined : 'd'));
  const jobs = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: api.fetchImpl, sleep: noSleep });
  await jobs.start(rawSnap(6));
  await settle(jobs);
  const { job } = await jobs.status();
  equal(job.state, 'done', 'done');
  equal(`${job.counts.total}/${job.counts.missing}`, '6/2', 'counts');
  const text = decode(fc.downloads[0].url);
  const missing = text.slice(text.indexOf('# MISSING'), text.indexOf(RECORD_DELIMITER));
  assert(missing.includes(vid(1)) && missing.includes(vid(4)) && missing.includes('Title: Page title 1'), 'listed with page titles');
});

test('J6. service worker stopped mid-job: the next wake resumes from the saved snapshot', async () => {
  const fc = fakeChrome();
  const api = fakeApi((id) => id);
  const dead = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: () => new Promise(() => {}), sleep: noSleep });
  await dead.start(rawSnap(3)); // never finishes: this worker "dies"
  const revived = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: api.fetchImpl, sleep: noSleep });
  await revived.resume();
  await settle(revived);
  equal((await revived.status()).job.state, 'done', 'completed by the new worker');
  equal(fc.downloads.length, 1, 'one file');
});

test('J7. Chrome closed mid-job: marked INTERRUPTED, never downloaded silently later', async () => {
  const fc = fakeChrome();
  const dead = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: () => new Promise(() => {}), sleep: noSleep });
  await dead.start(rawSnap(3));
  fc.restartBrowser();
  const next = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: fakeApi((id) => id).fetchImpl, sleep: noSleep });
  const { job } = await next.status();
  equal(job.state, 'interrupted', 'interrupted');
  equal(fc.downloads.length, 0, 'nothing downloaded');
  equal((await next.start(rawSnap(1))).ok, true, 'a new job can start');
  await settle(next);
});

test('J8. a download Chrome interrupts is reported as failed, not done', async () => {
  const fc = fakeChrome({ downloadOutcome: 'interrupted' });
  const jobs = createDescriptionJobs({ chrome: fc.chromeApi, readApiKey: async () => KEY, fetchImpl: fakeApi(() => 'd').fetchImpl, sleep: noSleep });
  await jobs.start(rawSnap(1));
  await settle(jobs);
  const { job } = await jobs.status();
  equal(job.state, 'failed', 'failed');
  assert(/FILE_NO_SPACE/.test(job.error.message), job.error.message);
  assert(fc.local[JOB_KEY].finishedAt, 'persisted');
});

await run();
