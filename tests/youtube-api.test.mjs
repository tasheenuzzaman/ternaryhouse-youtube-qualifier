/**
 * Deterministic tests for the data layer: duration parsing, statistic
 * normalization, long-form eligibility, and one end-to-end analysis over a
 * fabricated API response.
 *
 *   node tests/youtube-api.test.mjs
 *   deno run --allow-read tests/youtube-api.test.mjs
 */

import {
  parseIso8601Duration,
  normalizeVideo,
  classifyVideo,
  dominantChannelId,
  VIDEOS_SURFACE,
  LIVE_SURFACE,
} from '../lib/youtube-api.js';

import { analyzeVideos } from '../lib/analysis.js';
import { describeStorageIsolation, API_KEY_STORAGE_KEY, ACCESS_PROBE_KEY } from '../lib/security.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, message: err && err.message });
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}
function group(t) { console.log(`\n${t}`); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function equal(a, e, l = 'value') {
  if (a !== e) throw new Error(`${l}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}
function close(a, e, l = 'value', eps = 1e-9) {
  if (!Number.isFinite(a) || Math.abs(a - e) > eps) throw new Error(`${l}: expected ~${e}, got ${a}`);
}

const NOW = new Date(Date.UTC(2025, 5, 15, 12, 0, 0));
const DAY = 86400000;

/** Build a plausible videos.list item. */
function apiItem(id, overrides = {}) {
  const {
    daysAgo = 1,
    duration = 'PT10M30S',
    channelId = 'UCchannel00000000000000',
    viewCount = '1000',
    likeCount = '50',
    commentCount = '10',
    liveBroadcastContent = 'none',
    privacyStatus = 'public',
    uploadStatus = 'processed',
    liveStreamingDetails = undefined,
    omitStats = [],
  } = overrides;

  const statistics = { viewCount, likeCount, commentCount };
  for (const key of omitStats) delete statistics[key];

  const item = {
    id,
    snippet: {
      title: `Title ${id}`,
      publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
      channelId,
      channelTitle: 'Test Channel',
      liveBroadcastContent,
    },
    contentDetails: { duration },
    statistics,
    status: { privacyStatus, uploadStatus },
  };
  if (liveStreamingDetails) item.liveStreamingDetails = liveStreamingDetails;
  return item;
}

/* ------------------------------------------------------------------ */

group('DURATION PARSING');

test('A. parses hours, minutes and seconds', () => {
  equal(parseIso8601Duration('PT1H2M3S'), 3723, 'PT1H2M3S');
  equal(parseIso8601Duration('PT10M30S'), 630, 'PT10M30S');
  equal(parseIso8601Duration('PT45S'), 45, 'PT45S');
  equal(parseIso8601Duration('PT3M'), 180, 'PT3M');
  equal(parseIso8601Duration('P1DT2H'), 93600, 'P1DT2H');
});

test('B. unparseable or empty durations return null rather than zero', () => {
  equal(parseIso8601Duration('P0D'), null, 'P0D (live placeholder)');
  equal(parseIso8601Duration('PT0S'), null, 'PT0S');
  equal(parseIso8601Duration('nonsense'), null, 'nonsense');
  equal(parseIso8601Duration(undefined), null, 'undefined');
});

/* ------------------------------------------------------------------ */

group('STATISTIC NORMALIZATION');

test('A. an omitted like count becomes null, never zero', () => {
  const v = normalizeVideo(apiItem('x', { omitStats: ['likeCount'] }));
  equal(v.likeCount, null, 'likeCount');
  equal(v.viewCount, 1000, 'viewCount still read');
});

test('B. an omitted comment count becomes null, never a verified zero', () => {
  const v = normalizeVideo(apiItem('x', { omitStats: ['commentCount'] }));
  equal(v.commentCount, null, 'commentCount');
});

test('C. a reported zero is preserved as zero', () => {
  const v = normalizeVideo(apiItem('x', { commentCount: '0' }));
  equal(v.commentCount, 0, 'commentCount');
});

test('D. an omitted view count becomes null', () => {
  const v = normalizeVideo(apiItem('x', { omitStats: ['viewCount'] }));
  equal(v.viewCount, null, 'viewCount');
});

/* ------------------------------------------------------------------ */

group('LONG-FORM ELIGIBILITY');

const CHANNEL = 'UCchannel00000000000000';
const classify = (overrides) => classifyVideo(normalizeVideo(apiItem('v', overrides)), CHANNEL);

test('A. a normal public long-form upload is eligible', () => {
  const v = classify({});
  equal(v.eligible, true, `eligible (${v.ineligibleReasons.join(',')})`);
});

test('B. an upcoming or live broadcast is rejected', () => {
  equal(classify({ liveBroadcastContent: 'upcoming' }).ineligibleReasons.includes('LIVE_OR_UPCOMING'), true, 'upcoming');
  equal(classify({ liveBroadcastContent: 'live' }).ineligibleReasons.includes('LIVE_OR_UPCOMING'), true, 'live');
});

test('C. a COMPLETED broadcast from the Videos surface stays eligible (Premiere regression)', () => {
  // Regression for @TorinHofmann: every upload on that channel is a Premiere,
  // so the API keeps liveStreamingDetails forever. All 26 were being dropped.
  const v = classify({
    liveStreamingDetails: {
      scheduledStartTime: '2026-07-31T17:00:00Z',
      actualStartTime: '2026-07-31T17:00:00Z',
      actualEndTime: '2026-07-31T17:04:50Z',
    },
  });
  equal(v.eligible, true, `eligible (${v.ineligibleReasons.join(',')})`);
  equal(v.ineligibleReasons.length, 0, 'no rejection reason');
  equal(v.diagnosticFlags.includes('COMPLETED_BROADCAST'), true, 'flagged as a completed broadcast');
});

test('C2. a broadcast that has NOT finished is still rejected', () => {
  const v = classify({
    liveStreamingDetails: { scheduledStartTime: '2026-09-20T17:00:00Z' }, // no actualEndTime
  });
  equal(v.eligible, false, 'not eligible');
  equal(v.ineligibleReasons.includes('BROADCAST_NOT_COMPLETED'), true, 'reason');
});

test('C3. an item sourced from the separate Live surface is rejected', () => {
  const completed = normalizeVideo(apiItem('v', {
    liveStreamingDetails: { actualStartTime: '2026-07-01T00:00:00Z', actualEndTime: '2026-07-01T02:00:00Z' },
  }));
  const fromVideos = classifyVideo(completed, CHANNEL, VIDEOS_SURFACE);
  const fromLive = classifyVideo(completed, CHANNEL, LIVE_SURFACE);
  equal(fromVideos.eligible, true, 'same record is eligible from the Videos surface');
  equal(fromLive.eligible, false, 'and ineligible from the Live surface');
  equal(fromLive.ineligibleReasons.includes('NOT_VIDEOS_SURFACE'), true, 'reason');
});

test('C4. a normal video with no live metadata at all is eligible and unflagged', () => {
  const v = classify({});
  equal(v.eligible, true, 'eligible');
  equal(v.diagnosticFlags.includes('COMPLETED_BROADCAST'), false, 'no broadcast flag');
  equal(v.diagnosticFlags.length, 0, 'no diagnostic flags');
});

test('C5. an incomplete record is rejected as invalid', () => {
  const v = classifyVideo({ id: null, publishedAt: null }, CHANNEL, VIDEOS_SURFACE);
  equal(v.eligible, false, 'not eligible');
  equal(v.ineligibleReasons.includes('INVALID_RECORD'), true, 'reason');
});

test('D. a short runtime is flagged as diagnostic evidence but NEVER excludes the video', () => {
  for (const duration of ['PT45S', 'PT60S', 'PT30S', 'PT5S']) {
    const v = classify({ duration });
    equal(v.eligible, true, `${duration} stays eligible`);
    equal(v.ineligibleReasons.length, 0, `${duration} has no rejection reason`);
    equal(v.diagnosticFlags.includes('SHORT_FORM_DURATION'), true, `${duration} is flagged`);
  }
  const normal = classify({ duration: 'PT61S' });
  equal(normal.eligible, true, '61s eligible');
  equal(normal.diagnosticFlags.length, 0, '61s carries no flag');
});

test('E. a 2-minute long-form upload is NOT rejected by duration alone', () => {
  const v = classify({ duration: 'PT2M' });
  equal(v.eligible, true, 'a short long-form upload is still long-form');
  equal(v.diagnosticFlags.length, 0, 'no flag at 2 minutes');
});

test('F. non-public or unprocessed videos are rejected', () => {
  equal(classify({ privacyStatus: 'unlisted' }).ineligibleReasons.includes('NOT_PUBLIC'), true, 'unlisted');
  equal(classify({ uploadStatus: 'rejected' }).ineligibleReasons.includes('NOT_PROCESSED'), true, 'rejected upload');
});

test('G. a video from another channel is rejected', () => {
  const v = classify({ channelId: 'UCsomeoneelse000000000' });
  equal(v.ineligibleReasons.includes('OTHER_CHANNEL'), true, 'other channel');
});

test('H. an unreported runtime is flagged, not rejected', () => {
  const v = classifyVideo(normalizeVideo(apiItem('v', { duration: null })), CHANNEL);
  equal(v.eligible, true, 'still eligible — surface decides, not runtime');
  equal(v.diagnosticFlags.includes('UNKNOWN_DURATION'), true, 'flagged');
});

test('H2. currently-live and upcoming broadcasts are still rejected', () => {
  // "P0D" is the runtime YouTube reports for a live broadcast. Runtime no
  // longer rejects anything, so the live signals must carry it.
  const live = classifyVideo(normalizeVideo(apiItem('v', {
    duration: 'P0D', liveBroadcastContent: 'live',
    liveStreamingDetails: { actualStartTime: '2026-09-13T00:00:00Z' },
  })), CHANNEL);
  equal(live.eligible, false, 'live rejected');
  equal(live.ineligibleReasons.includes('LIVE_OR_UPCOMING'), true, 'by broadcast state');
  equal(live.ineligibleReasons.includes('BROADCAST_NOT_COMPLETED'), true, 'and by the missing end time');

  const upcoming = classifyVideo(normalizeVideo(apiItem('v', {
    liveBroadcastContent: 'upcoming',
    liveStreamingDetails: { scheduledStartTime: '2026-09-20T00:00:00Z' },
  })), CHANNEL);
  equal(upcoming.eligible, false, 'upcoming rejected');
});

test('I. the dominant channel id is the majority owner of the fetched set', () => {
  const videos = [
    { channelId: 'UCa' }, { channelId: 'UCa' }, { channelId: 'UCa' }, { channelId: 'UCb' },
  ];
  equal(dominantChannelId(videos), 'UCa', 'dominant');
  equal(dominantChannelId([]), null, 'empty');
});

/* ------------------------------------------------------------------ */

group('END-TO-END ANALYSIS');

test('A. a clean 12-video channel yields the trimmed average and full engagement evidence', () => {
  const views = [1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100];
  const items = views.map((v, i) => apiItem(`id${i}`, {
    daysAgo: i + 1,
    viewCount: String(v),
    likeCount: String(v * 0.05),
    commentCount: String(v * 0.01),
  }));
  const result = analyzeVideos(items.map(normalizeVideo), { now: NOW });

  equal(result.window.sampleCount, 12, 'sampleCount');
  equal(result.avgViews.status, 'OK', 'avg status');
  equal(result.avgViews.averagedCount, 10, 'averagedCount');
  equal(result.avgViews.average, 650, 'average');          // (7800 - 1200 - 100) / 10
  equal(result.avgViews.exactFormatted, '650', 'exact');
  equal(result.engagement.summary.validCount, 12, 'valid ER videos');
  equal(result.engagement.summary.status, 'OK', 'engagement status');
  equal(result.engagement.summary.includedCount, 10, 'ten ERs averaged after trimming');
  close(result.engagement.summary.creatorEr, 6, 'trimmed mean ER'); // every video is 6%
  equal(result.engagement.compact, '6.00%', 'compact label is the creator ER');
  equal(result.engagement.summary.atOrAboveThreshold, 12, 'screening evidence retained');
});

test('B. livestreams and out-of-window uploads are kept out; a short normal upload is kept IN', () => {
  const items = [
    apiItem('long1', { daysAgo: 2, viewCount: '1000' }),
    apiItem('long2', { daysAgo: 3, viewCount: '2000' }),
    apiItem('short1', { daysAgo: 4, duration: 'PT30S', viewCount: '3000' }),
    apiItem('live1', { daysAgo: 5, liveBroadcastContent: 'live', liveStreamingDetails: { actualStartTime: '2025-06-01T00:00:00Z' } }),
    apiItem('old1', { daysAgo: 200, viewCount: '9999' }),
  ];
  const result = analyzeVideos(items.map(normalizeVideo), { now: NOW });

  equal(result.discovery.ineligibleCount, 1, 'only the in-progress broadcast is ineligible');
  equal(result.window.sampleCount, 3, 'the 30-second normal upload is in the sample');
  assert(result.avgViews.rows.some((r) => r.videoId === 'short1'), 'short upload appears in the audit rows');
  equal(result.window.olderCount, 1, 'one older-context video');
  equal(result.avgViews.status, 'INSUFFICIENT', 'too few for a qualification average');
  assert(result.older.some((o) => o.videoId === 'old1'), 'older context surfaced');
  assert(
    result.warnings.some((w) => /60s or less/.test(w)),
    'the short runtime is surfaced as a warning rather than silently dropped',
  );
  const flag = result.discovery.diagnosticBreakdown.find((f) => f.flag === 'SHORT_FORM_DURATION');
  equal(flag && flag.count, 1, 'one short-runtime flag reported');
});

test('D. a channel of genuinely short normal uploads still produces a full average', () => {
  // Every upload runs 40 seconds. They came from the Videos tab, so they are
  // normal long-form uploads and must all count.
  const views = [1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100];
  const items = views.map((v, i) => apiItem(`s${i}`, { daysAgo: i + 1, duration: 'PT40S', viewCount: String(v) }));
  const result = analyzeVideos(items.map(normalizeVideo), { now: NOW });

  equal(result.discovery.ineligibleCount, 0, 'nothing excluded by runtime');
  equal(result.window.sampleCount, 12, 'all twelve sampled');
  equal(result.avgViews.status, 'OK', 'a normal trimmed average is produced');
  equal(result.avgViews.average, 650, 'average is correct');
});

test('C. a Premiere-only channel (the @TorinHofmann case) produces a full result', () => {
  // Every upload is a completed Premiere, so every record carries
  // liveStreamingDetails. Previously this produced "Eligible videos: 0".
  const views = [1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100];
  const items = views.map((v, i) => apiItem(`p${i}`, {
    daysAgo: i + 1,
    duration: 'PT4M50S',
    viewCount: String(v),
    liveStreamingDetails: {
      scheduledStartTime: '2026-07-31T17:00:00Z',
      actualStartTime: '2026-07-31T17:00:00Z',
      actualEndTime: '2026-07-31T17:04:50Z',
    },
  }));
  const result = analyzeVideos(items.map(normalizeVideo), { now: NOW });

  equal(result.discovery.ineligibleCount, 0, 'nothing excluded');
  equal(result.discovery.eligibleCount, 12, 'all twelve eligible');
  equal(result.window.sampleCount, 12, 'all twelve sampled');
  equal(result.avgViews.status, 'OK', 'a normal trimmed average is produced');
  equal(result.avgViews.average, 650, 'average is correct');
  const flag = result.discovery.diagnosticBreakdown.find((f) => f.flag === 'COMPLETED_BROADCAST');
  equal(flag && flag.count, 12, 'all twelve flagged as completed broadcasts');
  assert(
    result.warnings.some((w) => /completed broadcasts/i.test(w)),
    'the Premiere nature is surfaced as a note, not an exclusion',
  );
});

test('E. a pinned or reordered grid item cannot corrupt the chronological sample', () => {
  // Simulates the page rendering an OLD video first, as a pinned item would.
  // Recency comes from publishedAt, so ordering must be re-derived correctly.
  const items = [
    apiItem('pinned-old', { daysAgo: 80, viewCount: '500000' }),
    apiItem('newest', { daysAgo: 1, viewCount: '1000' }),
    apiItem('second', { daysAgo: 2, viewCount: '2000' }),
    apiItem('third', { daysAgo: 3, viewCount: '3000' }),
    apiItem('way-old', { daysAgo: 400, viewCount: '999999' }),
  ];
  const result = analyzeVideos(items.map(normalizeVideo), { now: NOW });

  equal(result.window.sampleCount, 4, 'four inside the 3-month window');
  equal(result.avgViews.rows[0].videoId, 'newest', 'newest video is first despite page order');
  equal(result.avgViews.rows[3].videoId, 'pinned-old', 'the pinned older video sorts to its true position');
  assert(!result.avgViews.rows.some((r) => r.videoId === 'way-old'), 'out-of-window video excluded');
});

test('F. a channel with a hidden like count reports partial engagement honestly', () => {
  const items = [
    apiItem('a', { daysAgo: 1, viewCount: '1000', likeCount: '30' }),
    apiItem('b', { daysAgo: 2, viewCount: '1000', omitStats: ['likeCount'] }),
  ];
  const result = analyzeVideos(items.map(normalizeVideo), { now: NOW });
  equal(result.engagement.summary.validCount, 1, 'one valid');
  equal(result.engagement.summary.unavailableCount, 1, 'one unavailable');
  assert(
    result.warnings.some((w) => /engagement data is unavailable/i.test(w)),
    'warns about unavailable engagement data',
  );
});

/* ------------------------------------------------------------------ */

group('STORAGE ISOLATION POLICY');

test('A. the probe key is a non-secret sentinel, never the API key', () => {
  assert(ACCESS_PROBE_KEY !== API_KEY_STORAGE_KEY, 'probe key differs from the key name');
  assert(!/api|key|youtube/i.test(ACCESS_PROBE_KEY.replace(/^__thq_/, '')), 'probe key carries no secret hint');
});

test('B. restriction applied AND confirmed blocked from the page reports as verified', () => {
  const s = describeStorageIsolation({ lockdown: 'applied', probe: 'blocked' });
  equal(s.level, 'verified', 'level');
  equal(s.secure, true, 'secure');
});

test('C. restriction applied but not yet probed is secure but unverified', () => {
  const s = describeStorageIsolation({ lockdown: 'applied', probe: null });
  equal(s.level, 'applied', 'level');
  equal(s.secure, true, 'secure');
});

test('D. restriction applied yet the page could still read is reported as insecure', () => {
  const s = describeStorageIsolation({ lockdown: 'applied', probe: 'allowed' });
  equal(s.level, 'contradiction', 'level');
  equal(s.secure, false, 'not treated as secure');
});

test('E. an unsupported or failed restriction is never reported as secure', () => {
  equal(describeStorageIsolation({ lockdown: 'unsupported' }).secure, false, 'unsupported');
  equal(describeStorageIsolation({ lockdown: 'failed' }).secure, false, 'failed');
  equal(describeStorageIsolation({}).secure, false, 'unknown');
  equal(describeStorageIsolation({}).level, 'unknown', 'unknown level');
});

/* ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);

const exit = (code) => {
  if (typeof process !== 'undefined' && process.exit) process.exit(code);
  else if (typeof Deno !== 'undefined') Deno.exit(code);
};
exit(failures.length ? 1 : 0);
