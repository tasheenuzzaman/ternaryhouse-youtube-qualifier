/**
 * Deterministic tests for the Ternary House business calculations.
 *
 * Runtime-agnostic ESM, no test framework and no dependencies:
 *   node tests/calculations.test.mjs
 *   deno run --allow-read tests/calculations.test.mjs
 */

import {
  CONFIG,
  subtractCalendarMonthsUTC,
  selectRecentSample,
  computeAverageViews,
  computeVideoEngagement,
  computeEngagement,
  engagementCompactLabel,
  formatCompactNumber,
  formatDate,
  recencyCutoff,
} from '../lib/calculations.js';

/* ----------------------------- harness ----------------------------- */

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

function group(title) {
  console.log(`\n${title}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function equal(actual, expected, label = 'value') {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function close(actual, expected, label = 'value', epsilon = 1e-9) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > epsilon) {
    throw new Error(`${label}: expected ~${expected}, got ${actual}`);
  }
}

/* ----------------------------- fixtures ----------------------------- */

const NOW = new Date(Date.UTC(2025, 5, 15, 12, 0, 0)); // 2025-06-15T12:00:00Z
const DAY = 86400000;

/** Newest-first helper: index 0 is the most recent. */
function sampleFromViews(views, opts = {}) {
  return views.map((viewCount, i) => ({
    id: `id${i}`,
    title: `Video ${i}`,
    publishedAt: new Date(NOW.getTime() - (i + 1) * DAY).toISOString(),
    viewCount,
    eligible: true,
    ...(opts.extra ? opts.extra(i) : {}),
  }));
}

function engVideo(id, viewCount, likeCount, commentCount, daysAgo = 1) {
  return {
    id,
    title: id,
    publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    viewCount,
    likeCount,
    commentCount,
    eligible: true,
  };
}

/* =================================================================== *
 * AVERAGE VIEWS
 * =================================================================== */

group('AVERAGE VIEWS');

test('A. 12-video sample excludes exactly the highest and lowest, averages the remaining 10', () => {
  const views = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];
  const r = computeAverageViews(sampleFromViews(views));
  equal(r.status, 'OK', 'status');
  equal(r.method, 'trimmed_high_low', 'method');
  equal(r.averagedCount, 10, 'averagedCount');
  equal(r.excludedHigh.viewCount, 1200, 'excludedHigh');
  equal(r.excludedLow.viewCount, 100, 'excludedLow');
  close(r.averageRaw, 650, 'averageRaw');
  equal(r.average, 650, 'average');
  equal(r.rows.filter((x) => x.status === 'INCLUDED').length, 10, 'included rows');
  equal(r.rows.filter((x) => x.status === 'EXCLUDED HIGH').length, 1, 'one high row');
  equal(r.rows.filter((x) => x.status === 'EXCLUDED LOW').length, 1, 'one low row');
});

test('B. 8-video sample averages the remaining 6', () => {
  const r = computeAverageViews(sampleFromViews([10, 20, 30, 40, 50, 60, 70, 80]));
  equal(r.status, 'OK', 'status');
  equal(r.averagedCount, 6, 'averagedCount');
  close(r.averageRaw, 45, 'averageRaw'); // (360 - 80 - 10) / 6
});

test('C. 6-video sample averages the remaining 4', () => {
  const r = computeAverageViews(sampleFromViews([5, 10, 15, 20, 25, 30]));
  equal(r.status, 'OK', 'status');
  equal(r.averagedCount, 4, 'averagedCount');
  close(r.averageRaw, 17.5, 'averageRaw'); // (105 - 30 - 5) / 4
  equal(r.average, 18, 'rounded average');
});

test('D. 5-video sample returns the small-sample state, not a trimmed qualification average', () => {
  const r = computeAverageViews(sampleFromViews([100, 200, 300, 400, 500]));
  equal(r.status, 'SMALL_SAMPLE', 'status');
  equal(r.method, 'untrimmed_mean', 'method');
  equal(r.averagedCount, 5, 'all five used');
  close(r.averageRaw, 300, 'untrimmed mean');
  equal(r.excludedHigh, null, 'no high exclusion');
  equal(r.excludedLow, null, 'no low exclusion');
  equal(r.confident, false, 'not presented as confident');
  assert(/manual outlier review/i.test(r.note), 'carries the manual-review note');
  equal(r.rows.every((x) => x.status === 'SMALL-SAMPLE CONTEXT'), true, 'rows labelled as context');
});

test('E. 3-video sample returns the insufficient-sample state with no average', () => {
  const r = computeAverageViews(sampleFromViews([100, 200, 300]));
  equal(r.status, 'INSUFFICIENT', 'status');
  equal(r.average, null, 'no average');
  equal(r.averagedCount, 0, 'nothing averaged');
  equal(r.confident, false, 'not confident');
  equal(r.note, 'Insufficient recent sample — inspect older context.', 'Avg Views keeps its own wording');
});

test('F. duplicate highest values exclude only ONE occurrence', () => {
  const r = computeAverageViews(sampleFromViews([10, 50, 50, 20, 30, 40]));
  equal(r.averagedCount, 4, 'averagedCount');
  equal(r.excludedHigh.viewCount, 50, 'high is 50');
  equal(r.excludedLow.viewCount, 10, 'low is 10');
  close(r.averageRaw, 35, 'averageRaw'); // 50 + 20 + 30 + 40 = 140 / 4
  const keptFifties = r.rows.filter((x) => x.viewCount === 50 && x.status === 'INCLUDED').length;
  equal(keptFifties, 1, 'the second 50 is retained');
});

test('G. duplicate lowest values exclude only ONE occurrence', () => {
  const r = computeAverageViews(sampleFromViews([10, 10, 20, 30, 40, 50]));
  equal(r.averagedCount, 4, 'averagedCount');
  equal(r.excludedLow.viewCount, 10, 'low is 10');
  equal(r.excludedHigh.viewCount, 50, 'high is 50');
  close(r.averageRaw, 25, 'averageRaw'); // 10 + 20 + 30 + 40 = 100 / 4
  const keptTens = r.rows.filter((x) => x.viewCount === 10 && x.status === 'INCLUDED').length;
  equal(keptTens, 1, 'the second 10 is retained');
});

test('H. all-equal values still exclude one high and one low observation', () => {
  const r = computeAverageViews(sampleFromViews([42, 42, 42, 42, 42, 42]));
  equal(r.status, 'OK', 'status');
  equal(r.averagedCount, 4, 'averagedCount');
  close(r.averageRaw, 42, 'averageRaw');
  const excluded = r.rows.filter((x) => x.status.startsWith('EXCLUDED'));
  equal(excluded.length, 2, 'exactly two exclusions');
  assert(excluded[0].videoId !== excluded[1].videoId, 'two distinct videos excluded');
});

test('I. hidden view counts are excluded and never treated as zero', () => {
  const sample = sampleFromViews([100, 200, 300, 400, 500, 600, 700]);
  sample[3].viewCount = null;
  const r = computeAverageViews(sample);
  equal(r.viewsHiddenCount, 1, 'one hidden');
  equal(r.eligibleCount, 6, 'six usable');
  equal(r.averagedCount, 4, 'four averaged');
  close(r.averageRaw, (200 + 300 + 500 + 600) / 4, 'averageRaw excludes the hidden video entirely');
  equal(r.rows.some((x) => x.status === 'VIEWS UNAVAILABLE'), true, 'hidden row surfaced');
});

test('J. empty sample reports no eligible videos', () => {
  const r = computeAverageViews([]);
  equal(r.status, 'NO_ELIGIBLE', 'status');
  equal(r.average, null, 'no average');
});

/* =================================================================== *
 * ENGAGEMENT
 * =================================================================== */

group('ENGAGEMENT');

test('A. 100,000 views / 8,000 likes / 1,000 comments = 9%', () => {
  const r = computeVideoEngagement(engVideo('a', 100000, 8000, 1000));
  equal(r.available, true, 'available');
  close(r.er, 9, 'er');
});

test('B. zero views is handled safely, with no division by zero', () => {
  const r = computeVideoEngagement(engVideo('b', 0, 10, 2));
  equal(r.available, false, 'unavailable');
  equal(r.reason, 'ZERO_VIEWS', 'reason');
  equal(r.er, null, 'no er');
});

test('C. a hidden like count makes ER unavailable rather than assuming zero', () => {
  const r = computeVideoEngagement(engVideo('c', 1000, null, 10));
  equal(r.available, false, 'unavailable');
  equal(r.reason, 'LIKES_UNAVAILABLE', 'reason');
  equal(r.er, null, 'no er');
});

test('C2. an unreported comment count makes ER unavailable rather than a verified zero', () => {
  const r = computeVideoEngagement(engVideo('c2', 1000, 50, null));
  equal(r.available, false, 'unavailable');
  equal(r.reason, 'COMMENTS_UNAVAILABLE', 'reason');
});

test('D. an explicitly reported 0 comments is a valid calculation', () => {
  const r = computeVideoEngagement(engVideo('d', 1000, 50, 0));
  equal(r.available, true, 'available');
  close(r.er, 5, 'er'); // 50 / 1000 * 100
});

test('E. 12 valid videos: exactly one highest and one lowest ER removed, mean of the remaining 10', () => {
  // ERs are 1%..12%: likes = views * n/100, comments = 0, views = 10000.
  const videos = [];
  for (let n = 1; n <= 12; n += 1) videos.push(engVideo(`v${n}`, 10000, n * 100, 0, n));
  const { rows, summary } = computeEngagement(videos);

  equal(summary.status, 'OK', 'status');
  equal(summary.appliedMethod, 'trimmed_high_low', 'method');
  equal(summary.validCount, 12, 'validCount');
  equal(summary.includedCount, 10, 'ten averaged');
  close(summary.excludedHigh.er, 12, 'highest ER excluded');
  close(summary.excludedLow.er, 1, 'lowest ER excluded');
  // mean of 2..11 = 6.5
  close(summary.creatorEr, 6.5, 'trimmed mean ER');
  equal(rows.filter((r) => r.status === 'EXCLUDED HIGHEST ER').length, 1, 'one high row');
  equal(rows.filter((r) => r.status === 'EXCLUDED LOWEST ER').length, 1, 'one low row');
  equal(rows.filter((r) => r.status === 'INCLUDED').length, 10, 'ten included rows');
});

test('F. duplicate HIGHEST ER values exclude only ONE observation', () => {
  // ERs: 9, 9, 2, 3, 4, 5  -> drop one 9 and the 2 -> mean(9,3,4,5) = 5.25
  const videos = [
    engVideo('a', 10000, 900, 0, 1),
    engVideo('b', 10000, 900, 0, 2),
    engVideo('c', 10000, 200, 0, 3),
    engVideo('d', 10000, 300, 0, 4),
    engVideo('e', 10000, 400, 0, 5),
    engVideo('f', 10000, 500, 0, 6),
  ];
  const { rows, summary } = computeEngagement(videos);
  equal(summary.includedCount, 4, 'four averaged');
  close(summary.excludedHigh.er, 9, 'high is 9%');
  close(summary.excludedLow.er, 2, 'low is 2%');
  close(summary.creatorEr, 5.25, 'trimmed mean');
  const keptNines = rows.filter((r) => r.available && Math.abs(r.er - 9) < 1e-9 && r.status === 'INCLUDED');
  equal(keptNines.length, 1, 'the second 9% is retained');
});

test('G. duplicate LOWEST ER values exclude only ONE observation', () => {
  // ERs: 1, 1, 2, 3, 4, 5 -> drop one 1 and the 5 -> mean(1,2,3,4) = 2.5
  const videos = [
    engVideo('a', 10000, 100, 0, 1),
    engVideo('b', 10000, 100, 0, 2),
    engVideo('c', 10000, 200, 0, 3),
    engVideo('d', 10000, 300, 0, 4),
    engVideo('e', 10000, 400, 0, 5),
    engVideo('f', 10000, 500, 0, 6),
  ];
  const { rows, summary } = computeEngagement(videos);
  equal(summary.includedCount, 4, 'four averaged');
  close(summary.excludedLow.er, 1, 'low is 1%');
  close(summary.excludedHigh.er, 5, 'high is 5%');
  close(summary.creatorEr, 2.5, 'trimmed mean');
  const keptOnes = rows.filter((r) => r.available && Math.abs(r.er - 1) < 1e-9 && r.status === 'INCLUDED');
  equal(keptOnes.length, 1, 'the second 1% is retained');
});

test('H. all-equal ERs still drop two distinct observations and average correctly', () => {
  const videos = [];
  for (let i = 0; i < 6; i += 1) videos.push(engVideo(`v${i}`, 10000, 400, 0, i + 1));
  const { rows, summary } = computeEngagement(videos);
  equal(summary.includedCount, 4, 'four averaged');
  close(summary.creatorEr, 4, 'mean unchanged at 4%');
  const excluded = rows.filter((r) => String(r.status).startsWith('EXCLUDED'));
  equal(excluded.length, 2, 'exactly two exclusions');
  assert(excluded[0].videoId !== excluded[1].videoId, 'two distinct videos');
});

test('I. videos with unavailable data never enter the trimmed mean', () => {
  // Six valid at 1..6%, plus three unusable records that must be ignored.
  const videos = [];
  for (let n = 1; n <= 6; n += 1) videos.push(engVideo(`v${n}`, 10000, n * 100, 0, n));
  videos.push(engVideo('hidden-likes', 10000, null, 0, 7));   // likes hidden
  videos.push(engVideo('no-comments', 10000, 500, null, 8));  // comments not reported
  videos.push(engVideo('zero-views', 0, 500, 5, 9));          // zero views
  const { summary } = computeEngagement(videos);

  equal(summary.sampleCount, 9, 'nine in the sample');
  equal(summary.validCount, 6, 'six valid');
  equal(summary.unavailableCount, 3, 'three unavailable');
  equal(summary.includedCount, 4, 'four averaged after trimming');
  close(summary.excludedHigh.er, 6, 'high from the valid set only');
  close(summary.excludedLow.er, 1, 'low from the valid set only');
  close(summary.creatorEr, 3.5, 'mean of 2,3,4,5');
});

test('J. an explicitly reported 0 comments is valid and counts', () => {
  const videos = [];
  for (let n = 1; n <= 6; n += 1) videos.push(engVideo(`v${n}`, 10000, n * 100, 0, n));
  const { rows, summary } = computeEngagement(videos);
  equal(summary.validCount, 6, 'all six valid with zero comments');
  equal(rows.every((r) => r.commentCount === 0), true, 'zero preserved');
  close(summary.creatorEr, 3.5, 'mean of 2,3,4,5');
});

test('K. screening evidence is retained as secondary information', () => {
  const videos = [];
  for (let n = 1; n <= 6; n += 1) videos.push(engVideo(`v${n}`, 10000, n * 100, 0, n));
  const { summary } = computeEngagement(videos);
  equal(summary.atOrAboveThreshold, 5, 'five videos at or above 2%');  // 2,3,4,5,6
  equal(summary.belowThreshold, 1, 'one below 2%');                    // 1
  close(summary.erMin, 1, 'erMin');
  close(summary.erMax, 6, 'erMax');
});

test('L. the compact button shows the trimmed creator ER, not an "X/Y >=2%" count', () => {
  const videos = [];
  for (let n = 1; n <= 12; n += 1) videos.push(engVideo(`v${n}`, 10000, n * 100, 0, n));
  const { summary } = computeEngagement(videos);
  const label = engagementCompactLabel(summary);
  equal(label, '6.50%', 'two decimal places, percent sign');
  assert(!/\u2265|\//.test(label), 'no threshold-count format');
});

test('M. the production method is the coach-confirmed trimmed mean', () => {
  equal(CONFIG.ER_METHOD, 'trimmed_mean_of_video_ers', 'configured method');
  const videos = [];
  for (let n = 1; n <= 12; n += 1) videos.push(engVideo(`v${n}`, 10000, n * 100, 0, n));
  const { summary } = computeEngagement(videos);
  equal(summary.confident, true, 'presented as confident');
  equal('aggregations' in summary, false, 'no competing aggregations exposed');
  equal('viewWeighted' in summary, false, 'view-weighted removed');
});

test('N. 0 and 1-3 valid observations keep the conservative insufficient behaviour', () => {
  const make = (count) => {
    const out = [];
    for (let n = 1; n <= count; n += 1) out.push(engVideo(`v${n}`, 10000, n * 100, 0, n));
    return out;
  };

  const zero = computeEngagement([]).summary;
  equal(zero.status, 'NO_DATA', '0 valid');
  equal(zero.creatorEr, null, '0 valid -> no rate');
  equal(engagementCompactLabel(zero), 'N/A', '0 label');

  for (const count of [1, 2, 3]) {
    const { rows, summary } = computeEngagement(make(count));
    equal(summary.status, 'INSUFFICIENT', `${count} valid -> insufficient`);
    equal(summary.creatorEr, null, `${count} valid -> no creator rate`);
    equal(summary.confident, false, `${count} valid -> not confident`);
    equal(summary.excludedHigh, null, `${count} valid -> nothing trimmed`);
    equal(summary.excludedLow, null, `${count} valid -> nothing trimmed`);
    equal(engagementCompactLabel(summary), 'insufficient', `${count} label`);
    equal(rows.every((r) => !String(r.status).startsWith('EXCLUDED')), true, `${count} valid -> no EXCLUDED rows`);
    equal(
      summary.note,
      'Insufficient recent engagement sample — review posting consistency and individual recent videos.',
      `${count} valid -> engagement-specific wording`,
    );
    assert(!/older context/i.test(summary.note), `${count} valid -> does not point at older context`);
  }
});

test('O. EXACTLY 4 valid observations: manual assessment, nothing excluded automatically', () => {
  // ERs 2.00, 3.00, 4.00, 7.00 -> untrimmed mean 4.00
  const videos = [
    engVideo('a', 10000, 200, 0, 1),
    engVideo('b', 10000, 300, 0, 2),
    engVideo('c', 10000, 400, 0, 3),
    engVideo('d', 10000, 700, 0, 4),
  ];
  const { rows, summary } = computeEngagement(videos);

  equal(summary.status, 'SMALL_SAMPLE', 'status');
  equal(summary.appliedMethod, 'untrimmed_mean', 'untrimmed');
  equal(summary.validCount, 4, 'validCount');
  equal(summary.includedCount, 4, 'all four kept');
  equal(summary.excludedHigh, null, 'no automatic high exclusion');
  equal(summary.excludedLow, null, 'no automatic low exclusion');
  close(summary.creatorEr, 4, 'untrimmed contextual mean');
  equal(summary.confident, false, 'not a confident qualification figure');

  equal(
    summary.note,
    '4-video sample — manual outlier assessment required. No ER automatically excluded.',
    'manual-outlier-assessment warning',
  );

  equal(engagementCompactLabel(summary), '4.00%*', 'compact label carries the asterisk');

  equal(rows.length, 4, 'all four individual ERs shown');
  equal(rows.every((r) => r.available), true, 'all four have an ER');
  equal(rows.every((r) => !String(r.status).startsWith('EXCLUDED')), true, 'no row labelled EXCLUDED');
});

test('P. EXACTLY 5 valid observations: one highest and one lowest removed, remaining 3 averaged', () => {
  // ERs 1.00, 2.00, 3.00, 4.00, 9.00 -> drop 9 and 1 -> mean(2,3,4) = 3.00
  const videos = [
    engVideo('a', 10000, 100, 0, 1),
    engVideo('b', 10000, 200, 0, 2),
    engVideo('c', 10000, 300, 0, 3),
    engVideo('d', 10000, 400, 0, 4),
    engVideo('e', 10000, 900, 0, 5),
  ];
  const { rows, summary } = computeEngagement(videos);

  equal(summary.status, 'OK', 'normal confirmed result, not a small-sample fallback');
  equal(summary.appliedMethod, 'trimmed_high_low', 'trimmed');
  equal(summary.includedCount, 3, 'remaining three averaged');
  close(summary.excludedHigh.er, 9, 'highest removed');
  close(summary.excludedLow.er, 1, 'lowest removed');
  close(summary.creatorEr, 3, 'mean of 2, 3 and 4');
  equal(summary.confident, true, 'coach-confirmed, presented as confident');
  equal(summary.note, null, 'no small-sample note');

  const label = engagementCompactLabel(summary);
  equal(label, '3.00%', 'compact label');
  assert(!label.includes('*'), 'no small-sample asterisk on a 5-video trimmed result');

  equal(rows.filter((r) => r.status === 'EXCLUDED HIGHEST ER').length, 1, 'one high row');
  equal(rows.filter((r) => r.status === 'EXCLUDED LOWEST ER').length, 1, 'one low row');
  equal(rows.filter((r) => r.status === 'INCLUDED').length, 3, 'three included rows');
});

test('Q. 5 valid observations with duplicate extremes still remove only ONE each', () => {
  // ERs 2.00, 2.00, 5.00, 5.00, 3.00 -> drop one 5 and one 2 -> mean(2,5,3) = 3.3333
  const videos = [
    engVideo('a', 10000, 200, 0, 1),
    engVideo('b', 10000, 200, 0, 2),
    engVideo('c', 10000, 500, 0, 3),
    engVideo('d', 10000, 500, 0, 4),
    engVideo('e', 10000, 300, 0, 5),
  ];
  const { rows, summary } = computeEngagement(videos);
  equal(summary.includedCount, 3, 'three averaged');
  close(summary.excludedHigh.er, 5, 'high is 5%');
  close(summary.excludedLow.er, 2, 'low is 2%');
  close(summary.creatorEr, (2 + 5 + 3) / 3, 'one of each duplicate retained');
  equal(rows.filter((r) => r.available && Math.abs(r.er - 5) < 1e-9 && r.status === 'INCLUDED').length, 1, 'one 5% kept');
  equal(rows.filter((r) => r.available && Math.abs(r.er - 2) < 1e-9 && r.status === 'INCLUDED').length, 1, 'one 2% kept');
});

test('R. 6 valid observations keep the existing trim-high/low behaviour unchanged', () => {
  // ERs 1..6 -> drop 6 and 1 -> mean(2,3,4,5) = 3.5
  const videos = [];
  for (let n = 1; n <= 6; n += 1) videos.push(engVideo(`v${n}`, 10000, n * 100, 0, n));
  const { summary } = computeEngagement(videos);
  equal(summary.status, 'OK', 'status');
  equal(summary.appliedMethod, 'trimmed_high_low', 'method');
  equal(summary.includedCount, 4, 'four averaged');
  close(summary.excludedHigh.er, 6, 'high');
  close(summary.excludedLow.er, 1, 'low');
  close(summary.creatorEr, 3.5, 'unchanged from before this patch');
  equal(engagementCompactLabel(summary), '3.50%', 'compact label');
});

test('S. the configured engagement bands are 4 = manual, 5+ = trimmed', () => {
  equal(CONFIG.ER_MIN_TRIMMED_SAMPLE, 5, 'trim from five');
  equal(CONFIG.ER_MANUAL_REVIEW_SAMPLE, 4, 'four is manual');
  equal(CONFIG.MIN_NORMAL_SAMPLE, 6, 'average-views band untouched');
  equal(CONFIG.MIN_SMALL_SAMPLE, 4, 'average-views band untouched');
});

/* =================================================================== *
 * RECENCY
 * =================================================================== */

group('RECENCY');

test('A. calendar subtraction clamps to a shorter target month (UTC)', () => {
  const d = subtractCalendarMonthsUTC(new Date('2025-05-31T09:00:00Z'), 3);
  equal(d.getUTCFullYear(), 2025, 'year');
  equal(d.getUTCMonth(), 1, 'month is February');
  equal(d.getUTCDate(), 28, 'clamped to 28 in a non-leap year');
  equal(d.toISOString(), '2025-02-28T00:00:00.000Z', 'normalised to UTC midnight');
});

test('B. calendar subtraction respects a leap year (UTC)', () => {
  const d = subtractCalendarMonthsUTC(new Date('2024-05-31T09:00:00Z'), 3);
  equal(d.getUTCMonth(), 1, 'month is February');
  equal(d.getUTCDate(), 29, 'clamped to 29 in a leap year');
  equal(d.toISOString(), '2024-02-29T00:00:00.000Z', 'normalised to UTC midnight');
});

test('C. calendar subtraction crosses a year boundary (UTC)', () => {
  const d = subtractCalendarMonthsUTC(new Date('2025-01-15T09:00:00Z'), 3);
  equal(d.toISOString(), '2024-10-15T00:00:00.000Z', 'October 15th of the previous year');
});

test('D. the cutoff is exactly 00:00:00.000 UTC of the cutoff date', () => {
  // Requirement A: now = 2026-09-14 -> cutoff exactly 2026-06-14T00:00:00.000Z
  const cutoff = subtractCalendarMonthsUTC(new Date('2026-09-14T14:30:00Z'), CONFIG.WINDOW_MONTHS);
  equal(cutoff.toISOString(), '2026-06-14T00:00:00.000Z', 'exact cutoff instant');
  equal(cutoff.getUTCHours(), 0, 'UTC hours');
  equal(cutoff.getUTCMinutes(), 0, 'UTC minutes');
  equal(cutoff.getUTCSeconds(), 0, 'UTC seconds');
  equal(cutoff.getUTCMilliseconds(), 0, 'UTC milliseconds');
  equal(recencyCutoff(new Date('2026-09-14T14:30:00Z')).toISOString(), cutoff.toISOString(), 'recencyCutoff agrees');
});

test('D2. the whole cutoff UTC date is inclusive; the day before is excluded', () => {
  // Requirement B.
  const now = new Date('2026-09-14T14:30:00Z');
  const videos = [
    { id: 'cut-midnight', publishedAt: '2026-06-14T00:00:00.000Z', viewCount: 1, eligible: true },
    { id: 'cut-morning', publishedAt: '2026-06-14T03:23:05.000Z', viewCount: 1, eligible: true },
    { id: 'cut-lastms', publishedAt: '2026-06-14T23:59:59.999Z', viewCount: 1, eligible: true },
    { id: 'day-before', publishedAt: '2026-06-13T23:59:59.999Z', viewCount: 1, eligible: true },
  ];
  const { sample, older } = selectRecentSample(videos, now);
  const ids = sample.map((v) => v.id).sort();

  equal(ids.join(','), 'cut-lastms,cut-midnight,cut-morning', 'all three cutoff-day videos included');
  equal(older.length, 1, 'one excluded');
  equal(older[0].id, 'day-before', 'only the previous UTC day is excluded');

  // Stated relative to the computed cutoff rather than to a literal, so the
  // invariant is unambiguous: the cutoff instant itself is IN, and one
  // millisecond before it is OUT.
  const cutoff = recencyCutoff(now);
  equal(cutoff.toISOString(), '2026-06-14T00:00:00.000Z', 'cutoff');

  const at = (ms) => selectRecentSample(
    [{ id: 'probe', publishedAt: new Date(ms).toISOString(), viewCount: 1, eligible: true }],
    now,
  ).sample.length === 1;

  equal(at(cutoff.getTime() - 1), false, 'cutoff MINUS 1ms (2026-06-13T23:59:59.999Z) is EXCLUDED');
  equal(at(cutoff.getTime()), true, 'cutoff exactly is INCLUDED');
  equal(at(cutoff.getTime() + 1), true, 'cutoff PLUS 1ms is INCLUDED');
  equal(
    new Date(cutoff.getTime() - 1).toISOString(),
    '2026-06-13T23:59:59.999Z',
    'cutoff minus 1ms lands on the PREVIOUS UTC calendar day',
  );
});

test('D3. time of day does not change the cutoff or the sample', () => {
  // Requirement C: the defect fixed in 1.0.1 was a mid-day silent change.
  const videos = [
    { id: 'boundary', publishedAt: '2026-06-14T03:23:05.000Z', viewCount: 1, eligible: true },
    { id: 'before', publishedAt: '2026-06-13T22:00:00.000Z', viewCount: 1, eligible: true },
    { id: 'after', publishedAt: '2026-07-01T10:00:00.000Z', viewCount: 1, eligible: true },
  ];
  const times = [
    '2026-09-14T00:00:00.000Z', '2026-09-14T03:22:59.000Z', '2026-09-14T09:00:00.000Z',
    '2026-09-14T14:30:00.000Z', '2026-09-14T23:59:59.999Z',
  ];
  let expectedCutoff = null;
  let expectedIds = null;
  for (const t of times) {
    const now = new Date(t);
    const { cutoff, sample } = selectRecentSample(videos, now);
    const ids = sample.map((v) => v.id).sort().join(',');
    if (expectedCutoff === null) { expectedCutoff = cutoff.toISOString(); expectedIds = ids; }
    equal(cutoff.toISOString(), expectedCutoff, `cutoff stable at ${t}`);
    equal(ids, expectedIds, `sample stable at ${t}`);
  }
  equal(expectedCutoff, '2026-06-14T00:00:00.000Z', 'cutoff');
  equal(expectedIds, 'after,boundary', 'sample');
});

test('D4. operator timezone cannot change eligibility', () => {
  // Requirement D. Every value below is an absolute instant and every date
  // component used by the rule is a UTC component, so this assertion holds
  // identically under any TZ. The suite is also executed under UTC,
  // Asia/Dhaka and America/Los_Angeles to prove it end to end.
  const now = new Date('2026-09-14T14:30:00Z');
  const videos = [
    { id: 'a', publishedAt: '2026-06-13T18:00:00.000Z', viewCount: 1, eligible: true },
    { id: 'b', publishedAt: '2026-06-14T00:00:00.000Z', viewCount: 1, eligible: true },
    { id: 'c', publishedAt: '2026-06-14T07:00:00.000Z', viewCount: 1, eligible: true },
    { id: 'd', publishedAt: '2026-06-14T21:30:00.000Z', viewCount: 1, eligible: true },
    { id: 'e', publishedAt: '2026-08-01T12:00:00.000Z', viewCount: 1, eligible: true },
  ];
  const { cutoff, sample } = selectRecentSample(videos, now);
  equal(cutoff.toISOString(), '2026-06-14T00:00:00.000Z', 'cutoff identical in every timezone');
  equal(sample.map((v) => v.id).sort().join(','), 'b,c,d,e', 'selected ids identical in every timezone');

  // The cutoff must not be derived from any local-time component.
  equal(cutoff.toISOString().endsWith('T00:00:00.000Z'), true, 'cutoff is UTC midnight');
});

test('D5. regression: the real Matt Maher video stays eligible all day on 2026-09-14', () => {
  // Requirement E. Real data: youtube.com/watch?v=N459K9wmxcc
  // ld+json uploadDate 2026-06-13T20:23:05-07:00 == 2026-06-14T03:23:05Z
  const MATT = { id: 'N459K9wmxcc', publishedAt: '2026-06-14T03:23:05.000Z', viewCount: 11000, eligible: true };
  for (const hour of [0, 3, 6, 9, 12, 15, 18, 21, 23]) {
    const now = new Date(Date.UTC(2026, 8, 14, hour, 30, 0));
    const { sample } = selectRecentSample([MATT], now);
    equal(sample.length, 1, `included at ${String(hour).padStart(2, '0')}:30 UTC`);
  }
  // And correctly drops out the following UTC day, when the window moves on.
  const nextDay = new Date('2026-09-15T00:00:00.000Z');
  equal(selectRecentSample([MATT], nextDay).sample.length, 0, 'excluded once the window rolls to 2026-06-15');
});

test('D6. formatDate renders the cutoff and publish dates in UTC', () => {
  equal(formatDate('2026-06-14T00:00:00.000Z'), '2026-06-14', 'midnight UTC');
  equal(formatDate('2026-06-14T23:59:59.999Z'), '2026-06-14', 'last millisecond of the UTC day');
  equal(formatDate('2026-06-13T20:23:05-07:00'), '2026-06-14', 'offset timestamp normalised to its UTC date');
});

test('E. the window is capped at the 12 most recent videos, newest first', () => {
  const videos = Array.from({ length: 20 }, (_, i) => ({
    id: `id${i}`,
    publishedAt: new Date(NOW.getTime() - (i + 1) * DAY).toISOString(),
    viewCount: 100 + i,
    eligible: true,
  }));
  const { sample, inWindowCount } = selectRecentSample(videos, NOW);
  equal(inWindowCount, 20, 'all twenty are inside the window');
  equal(sample.length, CONFIG.MAX_SAMPLE, 'capped at 12');
  equal(sample[0].id, 'id0', 'newest first');
  equal(sample[11].id, 'id11', 'twelfth is the twelfth newest');
});

test('F. a sample smaller than 12 uses whatever the window holds', () => {
  const videos = [
    { id: 'recent', publishedAt: new Date(NOW.getTime() - 5 * DAY).toISOString(), viewCount: 10, eligible: true },
    { id: 'old', publishedAt: new Date(NOW.getTime() - 200 * DAY).toISOString(), viewCount: 10, eligible: true },
  ];
  const { sample, older } = selectRecentSample(videos, NOW);
  equal(sample.length, 1, 'one in window');
  equal(older.length, 1, 'one older');
});

test('G. ineligible videos never enter the sample', () => {
  const videos = [
    { id: 'ok', publishedAt: new Date(NOW.getTime() - DAY).toISOString(), viewCount: 10, eligible: true },
    { id: 'short', publishedAt: new Date(NOW.getTime() - DAY).toISOString(), viewCount: 10, eligible: false },
  ];
  const { sample, ineligibleCount } = selectRecentSample(videos, NOW);
  equal(sample.length, 1, 'only the eligible video');
  equal(sample[0].id, 'ok', 'correct video');
  equal(ineligibleCount, 1, 'one ineligible counted');
});

test('H. videos with an unusable publication date are not silently included', () => {
  const videos = [
    { id: 'ok', publishedAt: new Date(NOW.getTime() - DAY).toISOString(), viewCount: 10, eligible: true },
    { id: 'undated', publishedAt: null, viewCount: 10, eligible: true },
  ];
  const { sample, undatedCount } = selectRecentSample(videos, NOW);
  equal(sample.length, 1, 'only the dated video');
  equal(undatedCount, 1, 'one undated counted');
});

/* =================================================================== *
 * FORMATTING
 * =================================================================== */

group('FORMATTING');

test('A. compact abbreviation matches the operational examples', () => {
  equal(formatCompactNumber(67814), '67.8K', '67814');
  equal(formatCompactNumber(187100), '187.1K', '187100');
  equal(formatCompactNumber(999), '999', '999');
  equal(formatCompactNumber(1000), '1K', '1000');
  equal(formatCompactNumber(999500), '999.5K', '999500');
  equal(formatCompactNumber(1250000), '1.3M', '1250000');
  equal(formatCompactNumber(2500000000), '2.5B', '2500000000');
  equal(formatCompactNumber(null), 'N/A', 'null');
});

/* ----------------------------- summary ----------------------------- */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}

const exit = (code) => {
  if (typeof process !== 'undefined' && process.exit) process.exit(code);
  else if (typeof Deno !== 'undefined') Deno.exit(code);
};
exit(failures.length ? 1 : 0);
