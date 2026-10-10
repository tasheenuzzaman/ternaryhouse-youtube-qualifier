/**
 * Ternary House YouTube Qualifier — analysis orchestration.
 *
 * Takes normalized videos (already fetched once) and produces the single
 * payload that powers BOTH the Avg Views control and the Engagement control.
 * There is deliberately no second retrieval path.
 */

import {
  CONFIG,
  selectRecentSample,
  computeAverageViews,
  computeEngagement,
  engagementCompactLabel,
  averageViewsBand,
  formatCompactNumber,
  formatExactNumber,
} from './calculations.js';

import {
  SHORT_FORM_MAX_SECONDS,
  VIDEOS_SURFACE,
  classifyVideo,
  dominantChannelId,
  INELIGIBLE_REASON_TEXT,
  FLAG_TEXT,
} from './youtube-api.js';

/** How many older videos to keep for the "Older context" section. */
const OLDER_CONTEXT_LIMIT = 6;

/**
 * @param {Array} rawVideos normalized videos in newest-first page order
 * @param {{now?: Date, expectedChannelId?: string|null, meta?: object}} options
 */
export function analyzeVideos(rawVideos, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const videos = Array.isArray(rawVideos) ? rawVideos : [];

  // Trust the fetched data over the page hint for identity.
  const channelId = dominantChannelId(videos) || options.expectedChannelId || null;
  // The content script only harvests the Videos -> Latest grid, so that is the
  // surface unless a caller explicitly says otherwise.
  const sourceSurface = options.sourceSurface || VIDEOS_SURFACE;
  const classified = videos.map((v) => classifyVideo(v, channelId, sourceSurface));

  const eligible = classified.filter((v) => v.eligible);
  const ineligible = classified.filter((v) => !v.eligible);

  const breakdown = {};
  for (const v of ineligible) {
    for (const reason of v.ineligibleReasons) {
      breakdown[reason] = (breakdown[reason] || 0) + 1;
    }
  }

  const flagBreakdown = {};
  for (const v of classified) {
    for (const flag of v.diagnosticFlags || []) {
      flagBreakdown[flag] = (flagBreakdown[flag] || 0) + 1;
    }
  }

  // Recency is derived from authoritative publishedAt timestamps, never from
  // the order the page happened to render. A pinned or otherwise reordered
  // grid item therefore cannot displace a newer video or bias the sample.
  const selection = selectRecentSample(classified, now);
  const sample = selection.sample;

  const avg = computeAverageViews(sample);
  const engagement = computeEngagement(sample);

  const warnings = [];
  if (avg.viewsHiddenCount > 0) {
    warnings.push(`${avg.viewsHiddenCount} video(s) in the sample hide their view count and were left out of the average.`);
  }
  if (engagement.summary.unavailableCount > 0) {
    warnings.push('Some engagement data is unavailable — see the engagement detail.');
  }
  if (selection.inWindowCount > CONFIG.MAX_SAMPLE) {
    warnings.push(`${selection.inWindowCount} eligible videos fall inside the window; the ${CONFIG.MAX_SAMPLE} most recent were used.`);
  }

  // Completed Premieres and past broadcasts count as normal uploads when they
  // sit on the Videos surface; the count is reported so a human can judge.
  const completedBroadcasts = sample.filter((v) => (v.diagnosticFlags || []).includes('COMPLETED_BROADCAST'));
  if (completedBroadcasts.length) {
    warnings.push(`${completedBroadcasts.length} video(s) in the sample are completed broadcasts (Premiere or past live). They are on the channel's Videos tab, so they count as normal uploads.`);
  }

  // Duration never removes a video; it is reported so a human can judge.
  const shortRuntime = sample.filter((v) => (v.diagnosticFlags || []).includes('SHORT_FORM_DURATION'));
  if (shortRuntime.length) {
    warnings.push(`${shortRuntime.length} video(s) in the sample run ${SHORT_FORM_MAX_SECONDS}s or less. They came from the channel's Videos tab, so they are counted as normal long-form uploads — review them if that looks wrong.`);
  }
  const unknownRuntime = sample.filter((v) => (v.diagnosticFlags || []).includes('UNKNOWN_DURATION'));
  if (unknownRuntime.length) {
    warnings.push(`${unknownRuntime.length} video(s) in the sample did not report a runtime.`);
  }

  const older = selection.older.slice(0, OLDER_CONTEXT_LIMIT).map((v) => ({
    videoId: v.id,
    title: v.title,
    publishedAt: v.publishedAt,
    viewCount: Number.isFinite(v.viewCount) ? v.viewCount : null,
  }));

  return {
    generatedAt: now.toISOString(),
    channelId,
    channelTitle: (videos.find((v) => v.channelId === channelId) || {}).channelTitle || null,

    window: {
      months: CONFIG.WINDOW_MONTHS,
      cutoff: selection.cutoff.toISOString(),
      maxSample: CONFIG.MAX_SAMPLE,
      inWindowCount: selection.inWindowCount,
      sampleCount: sample.length,
      olderCount: selection.older.length,
    },

    discovery: {
      fetchedCount: videos.length,
      eligibleCount: eligible.length,
      ineligibleCount: ineligible.length,
      ineligibleBreakdown: Object.entries(breakdown).map(([reason, count]) => ({
        reason,
        label: INELIGIBLE_REASON_TEXT[reason] || reason,
        count,
      })),
      diagnosticBreakdown: Object.entries(flagBreakdown).map(([flag, count]) => ({
        flag,
        label: FLAG_TEXT[flag] || flag,
        count,
      })),
      sourceSurface,
      requestCount: options.meta && options.meta.requestCount,
      missingIds: (options.meta && options.meta.missingIds) || [],
    },

    avgViews: {
      ...avg,
      band: averageViewsBand(avg.average),
      display: avg.average === null ? 'N/A' : formatCompactNumber(avg.average),
      exact: avg.average === null ? null : avg.average,
      exactFormatted: avg.average === null ? 'N/A' : formatExactNumber(avg.average),
    },

    engagement: {
      rows: engagement.rows,
      summary: engagement.summary,
      compact: engagementCompactLabel(engagement.summary),
    },

    older,
    warnings,
  };
}
