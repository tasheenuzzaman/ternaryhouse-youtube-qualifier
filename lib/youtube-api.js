/**
 * Ternary House YouTube Qualifier — YouTube Data API v3 access and
 * normalization. Runs only in the trusted extension service worker.
 *
 * Only the official, documented API is used. No Innertube, no third-party
 * analytics service, no scraping proxy, no evasion behaviour.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3';
/** videos.list accepts up to 50 ids per request. */
const MAX_IDS_PER_REQUEST = 50;

/**
 * Runtime at or below this is *typical* of short-form, but it is NOT a
 * definition. Ternary House defines long-form by content surface, not by
 * runtime, so this only raises a diagnostic flag — it never excludes a video.
 */
export const SHORT_FORM_MAX_SECONDS = 60;

/**
 * Content surfaces. Surface is the PRIMARY format signal: an id is eligible
 * because of where it was harvested from, not because of what its metadata
 * looks like. The content script only ever harvests VIDEOS_SURFACE.
 */
export const VIDEOS_SURFACE = 'videos_grid';
export const LIVE_SURFACE = 'live_grid';

export class YouTubeApiError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'YouTubeApiError';
    this.code = code;
    this.detail = detail || null;
  }
}

/** ISO-8601 duration ("PT1H2M3S") -> seconds. Returns null if unparseable. */
export function parseIso8601Duration(value) {
  if (typeof value !== 'string') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!m) return null;
  const [, d, h, min, s] = m;
  if (d === undefined && h === undefined && min === undefined && s === undefined) return null;
  const total = (Number(d || 0) * 86400) + (Number(h || 0) * 3600)
    + (Number(min || 0) * 60) + Number(s || 0);
  // "P0D" is YouTube's placeholder for an in-progress livestream, and no real
  // upload is zero seconds long. Report it as unknown, not as a valid duration.
  return total > 0 ? total : null;
}

/**
 * The API omits a statistic entirely when it is hidden. Absent must stay
 * absent — never coerced to 0.
 */
function readCount(stats, key) {
  if (!stats || !Object.prototype.hasOwnProperty.call(stats, key)) return null;
  const n = Number(stats[key]);
  return Number.isFinite(n) ? n : null;
}

/** Turn one videos.list item into the shape the calculations expect. */
export function normalizeVideo(item) {
  const snippet = item.snippet || {};
  const stats = item.statistics || {};
  const content = item.contentDetails || {};
  const status = item.status || {};

  return {
    id: item.id,
    title: snippet.title || '(untitled)',
    publishedAt: snippet.publishedAt || null,
    channelId: snippet.channelId || null,
    channelTitle: snippet.channelTitle || null,
    durationSeconds: parseIso8601Duration(content.duration),
    liveBroadcastContent: snippet.liveBroadcastContent || 'none',
    hasLiveStreamingDetails: Boolean(item.liveStreamingDetails),
    // A finished broadcast (Premiere or past live) has an actualEndTime.
    // An upcoming or in-progress one does not.
    liveActualEndTime: (item.liveStreamingDetails || {}).actualEndTime || null,
    liveActualStartTime: (item.liveStreamingDetails || {}).actualStartTime || null,
    liveScheduledStartTime: (item.liveStreamingDetails || {}).scheduledStartTime || null,
    privacyStatus: status.privacyStatus || null,
    uploadStatus: status.uploadStatus || null,
    viewCount: readCount(stats, 'viewCount'),
    likeCount: readCount(stats, 'likeCount'),
    commentCount: readCount(stats, 'commentCount'),
    eligible: true,
    ineligibleReasons: [],
    diagnosticFlags: [],
  };
}

export const INELIGIBLE_REASON_TEXT = Object.freeze({
  LIVE_OR_UPCOMING: 'Currently live or upcoming broadcast',
  BROADCAST_NOT_COMPLETED: 'Broadcast has not finished',
  NOT_VIDEOS_SURFACE: 'Not harvested from the channel Videos surface',
  NOT_PUBLIC: 'Not public',
  NOT_PROCESSED: 'Not a processed upload',
  OTHER_CHANNEL: 'Belongs to a different channel',
  INVALID_RECORD: 'Incomplete or invalid video record',
});

/**
 * Diagnostic only. Surfaced in the audit view as supporting evidence; these
 * never remove a video from the sample.
 */
export const FLAG_TEXT = Object.freeze({
  SHORT_FORM_DURATION: `Runtime at or under ${SHORT_FORM_MAX_SECONDS}s — unusually short for long-form, included anyway`,
  UNKNOWN_DURATION: 'Runtime not reported by the API',
  COMPLETED_BROADCAST: 'Completed broadcast (Premiere or past live) — counted as a normal upload',
});

/**
 * Confirm a video belongs to the channel's normal long-form Videos surface.
 *
 * SURFACE IS PRIMARY. An id is eligible because it was harvested as a
 * /watch?v= link from the channel's own Videos -> Latest grid. Shorts render
 * as /shorts/ links and never enter the harvest; the Live tab is never
 * harvested at all.
 *
 * API live metadata and runtime are SUPPORTING evidence, not format
 * classifiers. In particular, the mere presence of `liveStreamingDetails` is
 * NOT grounds for exclusion: YouTube retains it on a video for its entire
 * life, and a completed Premiere keeps it forever even though the video is a
 * perfectly normal upload afterwards. Verified live on @TorinHofmann, whose
 * uploads are all Premieres and every one of which was being wrongly dropped.
 *
 * What still excludes a video:
 *   - it did not come from the Videos surface;
 *   - it is currently live or upcoming (`liveBroadcastContent`);
 *   - it is a broadcast that has not finished (no `actualEndTime`);
 *   - it is not public, not processed, owned by another channel, or the
 *     record itself is incomplete.
 */
export function classifyVideo(video, expectedChannelId, sourceSurface = VIDEOS_SURFACE) {
  const reasons = [];
  const flags = [];

  if (sourceSurface !== VIDEOS_SURFACE) {
    reasons.push('NOT_VIDEOS_SURFACE');
  }

  if (!video.id || !video.publishedAt) {
    reasons.push('INVALID_RECORD');
  }

  if (video.liveBroadcastContent && video.liveBroadcastContent !== 'none') {
    reasons.push('LIVE_OR_UPCOMING');
  }

  // Presence of liveStreamingDetails alone means nothing. What matters is
  // whether the broadcast has actually finished.
  if (video.hasLiveStreamingDetails) {
    if (video.liveActualEndTime) {
      flags.push('COMPLETED_BROADCAST');
    } else {
      reasons.push('BROADCAST_NOT_COMPLETED');
    }
  }

  if (video.privacyStatus && video.privacyStatus !== 'public') {
    reasons.push('NOT_PUBLIC');
  }
  if (video.uploadStatus && video.uploadStatus !== 'processed') {
    reasons.push('NOT_PROCESSED');
  }
  if (expectedChannelId && video.channelId && video.channelId !== expectedChannelId) {
    reasons.push('OTHER_CHANNEL');
  }

  // Runtime is diagnostic only — deliberately never added to `reasons`.
  if (video.durationSeconds === null) {
    flags.push('UNKNOWN_DURATION');
  } else if (video.durationSeconds <= SHORT_FORM_MAX_SECONDS) {
    flags.push('SHORT_FORM_DURATION');
  }

  return {
    ...video,
    eligible: reasons.length === 0,
    ineligibleReasons: reasons,
    diagnosticFlags: flags,
    sourceSurface,
  };
}

/**
 * The channel id the sample actually belongs to: the most common channelId
 * across the fetched videos. Guards against ids picked up from recommendation
 * rails rather than the channel's own grid.
 */
export function dominantChannelId(videos) {
  const counts = new Map();
  for (const v of videos) {
    if (!v.channelId) continue;
    counts.set(v.channelId, (counts.get(v.channelId) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) { best = id; bestCount = count; }
  }
  return best;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Map an API failure onto a specific, human-readable error. The API key is
 * never included in the message or the detail.
 */
async function toApiError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* body may not be JSON */ }
  const err = payload && payload.error;
  const reason = err && err.errors && err.errors[0] && err.errors[0].reason;
  const rawMessage = (err && err.message) || '';

  if (response.status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) {
    return new YouTubeApiError('QUOTA_EXCEEDED', 'YouTube API quota exceeded for today — see details.', reason);
  }
  if (response.status === 400 && (reason === 'keyInvalid' || /API key not valid/i.test(rawMessage))) {
    return new YouTubeApiError('API_KEY_INVALID', 'YouTube API key is not valid — open Settings.', reason);
  }
  if (response.status === 403) {
    return new YouTubeApiError(
      'API_KEY_REJECTED',
      'YouTube API rejected the request (key restriction or API not enabled) — see details.',
      reason || `HTTP ${response.status}`,
    );
  }
  return new YouTubeApiError('API_ERROR', `YouTube API error (HTTP ${response.status}) — see details.`, reason || `HTTP ${response.status}`);
}

/**
 * Fetch statistics for up to a few hundred ids in batches of 50.
 * One creator calculation normally costs exactly one request.
 *
 * @param {string} apiKey stays inside this call; never returned or logged.
 * @param {string[]} videoIds
 * @returns {Promise<{videos: Array, requestCount: number, missingIds: string[]}>}
 */
export async function fetchVideoStatistics(apiKey, videoIds, fetchImpl = fetch) {
  if (!apiKey) throw new YouTubeApiError('NO_API_KEY', 'YouTube API key required — open extension settings.');
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (!ids.length) return { videos: [], requestCount: 0, missingIds: [] };

  const parts = 'snippet,contentDetails,statistics,status,liveStreamingDetails';
  const collected = [];
  let requestCount = 0;

  for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
    const url = new URL(`${API_BASE}/videos`);
    url.searchParams.set('part', parts);
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('maxResults', String(MAX_IDS_PER_REQUEST));
    url.searchParams.set('key', apiKey);

    let response;
    try {
      response = await fetchImpl(url.toString(), { method: 'GET' });
    } catch {
      // Deliberately does not echo the thrown error: the request URL carries the key.
      throw new YouTubeApiError('NETWORK_ERROR', 'Could not reach the YouTube API — check the network connection.');
    }
    requestCount += 1;
    if (!response.ok) throw await toApiError(response);

    const data = await response.json();
    for (const item of data.items || []) collected.push(normalizeVideo(item));
  }

  const returned = new Set(collected.map((v) => v.id));
  const missingIds = ids.filter((id) => !returned.has(id));

  // Restore the caller's ordering (newest-first as discovered on the page).
  const byId = new Map(collected.map((v) => [v.id, v]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  return { videos: ordered, requestCount, missingIds };
}

/** Cheap validity probe for the Settings page. Costs 1 quota unit. */
export async function testApiKey(apiKey, fetchImpl = fetch) {
  const url = new URL(`${API_BASE}/videos`);
  url.searchParams.set('part', 'id');
  url.searchParams.set('chart', 'mostPopular');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('key', apiKey);

  let response;
  try {
    response = await fetchImpl(url.toString(), { method: 'GET' });
  } catch {
    throw new YouTubeApiError('NETWORK_ERROR', 'Could not reach the YouTube API — check the network connection.');
  }
  if (!response.ok) throw await toApiError(response);
  return true;
}
