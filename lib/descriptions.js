/**
 * Ternary House YouTube Qualifier — "Download all video descriptions".
 *
 * Pure helpers, run in the trusted service worker:
 *
 *   normalizeSnapshot()      validate the inventory the content script captured
 *   fetchDescriptions()      videos.list?part=snippet in batches of 50, bounded
 *                            retries, exact-ID mapping, page order preserved
 *   buildDescriptionsText()  the UTF-8 TXT, descriptions verbatim
 *   descriptionsFilename()   a safe cross-platform file name
 *
 * The API key is only ever placed in the request URL. It never appears in a
 * record, an error, the TXT or a message.
 */

import { toApiError } from './youtube-api.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
/** videos.list accepts up to 50 ids per request. */
export const MAX_IDS_PER_REQUEST = 50;
const MAX_ATTEMPTS = 3;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const RECORD_DELIMITER = '-'.repeat(125);

/** Per-video outcome. */
export const STATUS = Object.freeze({
  RETRIEVED: 'RETRIEVED',
  EMPTY: 'EMPTY',
  UNAVAILABLE: 'UNAVAILABLE',
  REQUEST_FAILED: 'REQUEST_FAILED',
  ERROR: 'ERROR',
});

/** Errors that make every further request pointless. Never retried. */
const FATAL_CODES = new Set(['QUOTA_EXCEEDED', 'API_KEY_INVALID', 'API_KEY_REJECTED', 'NO_API_KEY']);

export const canonicalUrl = (id, kind) => (kind === 'shorts'
  ? `https://www.youtube.com/shorts/${id}`
  : `https://www.youtube.com/watch?v=${id}`);

const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * The inventory as captured on the page, validated. Order is kept; repeated
 * IDs keep their first position; URLs are rebuilt from the ID, never trusted.
 * Returns null when there is nothing valid to fetch.
 */
export function normalizeSnapshot(raw, now = Date.now()) {
  if (!raw || !Array.isArray(raw.items)) return null;
  const seen = new Set();
  const items = [];
  for (const it of raw.items) {
    if (!it || !VIDEO_ID_RE.test(it.id) || seen.has(it.id)) continue;
    seen.add(it.id);
    const kind = it.kind === 'shorts' ? 'shorts' : 'watch';
    items.push({ id: it.id, kind, url: canonicalUrl(it.id, kind), title: str(it.title, 1000) || null });
  }
  if (!items.length) return null;
  const captured = Number(raw.capturedAt);
  const capturedAt = Number.isFinite(captured) && Math.abs(captured - now) < 86400000 ? captured : now;
  return {
    items,
    capturedAt,
    channelName: str(raw.channelName, 300) || null,
    channelUrl: str(raw.channelUrl, 500) || null,
    channelHandle: str(raw.channelHandle, 100) || null,
    tab: str(raw.tab, 40) || 'videos',
    tabLabel: str(raw.tabLabel, 80) || 'Videos',
    sort: str(raw.sort, 40) || 'Unknown',
    playlistTitle: str(raw.playlistTitle, 300) || null,
    playlistUrl: str(raw.playlistUrl, 500) || null,
    playlistId: str(raw.playlistId, 100) || null,
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch every item's snippet. Never throws for API problems: each record says
 * what happened. `fatal` is set when a quota/key error stopped the run.
 *
 * opts: fetchImpl, sleep, onProgress(processedCount) (may be async)
 */
export async function fetchDescriptions(apiKey, items, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const sleep = opts.sleep || defaultSleep;
  const results = new Map();
  let fatal = null;
  let requestCount = 0;
  let processed = 0;

  for (let start = 0; start < items.length; start += MAX_IDS_PER_REQUEST) {
    const batch = items.slice(start, start + MAX_IDS_PER_REQUEST);
    if (fatal) {
      for (const it of batch) results.set(it.id, { status: STATUS.REQUEST_FAILED, reason: `Not requested: ${fatal.message}` });
    } else {
      const outcome = await fetchBatch(apiKey, batch.map((it) => it.id), fetchImpl, sleep);
      requestCount += outcome.attempts;
      if (outcome.items) {
        const byId = new Map();
        for (const item of outcome.items) if (item && typeof item.id === 'string') byId.set(item.id, item);
        for (const it of batch) {
          const item = byId.get(it.id);
          if (!item) {
            results.set(it.id, { status: STATUS.UNAVAILABLE, reason: 'Not returned by the YouTube API (private, deleted or otherwise unavailable)' });
          } else if (!item.snippet || typeof item.snippet.description !== 'string') {
            results.set(it.id, { status: STATUS.ERROR, reason: 'The API response had no snippet/description for this video' });
          } else {
            const s = item.snippet;
            results.set(it.id, {
              status: s.description === '' ? STATUS.EMPTY : STATUS.RETRIEVED,
              apiTitle: typeof s.title === 'string' ? s.title : null,
              description: s.description,
              publishedAt: typeof s.publishedAt === 'string' ? s.publishedAt : null,
              liveBroadcastContent: typeof s.liveBroadcastContent === 'string' ? s.liveBroadcastContent : 'none',
            });
          }
        }
      } else {
        const status = outcome.kind === 'error' ? STATUS.ERROR : STATUS.REQUEST_FAILED;
        for (const it of batch) results.set(it.id, { status, reason: outcome.reason });
        if (outcome.fatal) fatal = outcome.fatal;
      }
    }
    processed += batch.length;
    if (opts.onProgress) await opts.onProgress(processed);
  }

  const records = items.map((it) => ({ ...it, ...results.get(it.id) }));
  return { records, requestCount, fatal };
}

/** One batch, with bounded retries for network errors, HTTP 429 and 5xx. */
async function fetchBatch(apiKey, ids, fetchImpl, sleep) {
  const url = new URL(`${API_BASE}/videos`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', ids.join(','));
  url.searchParams.set('maxResults', String(MAX_IDS_PER_REQUEST));
  url.searchParams.set('fields', 'items(id,snippet(title,description,publishedAt,liveBroadcastContent))');
  url.searchParams.set('key', apiKey);

  let last = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await sleep(1000 * 2 ** (attempt - 2));
    let response;
    try {
      response = await fetchImpl(url.toString(), { method: 'GET' });
    } catch {
      // The thrown error is not echoed: the request URL carries the key.
      last = 'network error';
      continue;
    }
    if (response.ok) {
      try {
        const data = await response.json();
        return { items: Array.isArray(data.items) ? data.items : [], attempts: attempt };
      } catch {
        return { kind: 'error', reason: 'Error: the API response could not be read', attempts: attempt };
      }
    }
    if (response.status === 429 || response.status >= 500) {
      last = `HTTP ${response.status}`;
      continue;
    }
    const err = await toApiError(response);
    const reason = `API request failed: ${err.message}${err.detail ? ` (${err.detail})` : ''}`;
    return { reason, attempts: attempt, fatal: FATAL_CODES.has(err.code) ? { code: err.code, message: err.message, detail: err.detail } : null };
  }
  return { reason: `API request failed: ${last} after ${MAX_ATTEMPTS} attempts`, attempts: MAX_ATTEMPTS };
}

export function countRecords(records) {
  const counts = { total: records.length, retrieved: 0, empty: 0, missing: 0 };
  for (const r of records) {
    if (r.status === STATUS.RETRIEVED) counts.retrieved += 1;
    else if (r.status === STATUS.EMPTY) counts.empty += 1;
    else counts.missing += 1;
  }
  return counts;
}

const isoUtc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function statusText(r) {
  const live = r.liveBroadcastContent && r.liveBroadcastContent !== 'none' ? ` (${r.liveBroadcastContent} broadcast/Premiere)` : '';
  switch (r.status) {
    case STATUS.RETRIEVED: return `Retrieved${live}`;
    case STATUS.EMPTY: return `Retrieved — the description is empty${live}`;
    case STATUS.UNAVAILABLE: return 'Missing — unavailable, private or deleted (not returned by the API)';
    case STATUS.REQUEST_FAILED: return `Failed — ${r.reason}`;
    default: return `Failed — ${r.reason || 'Error: unknown'}`;
  }
}

const titleOf = (r) => r.apiTitle || r.title || '(title not available)';
const hasDescription = (r) => r.status === STATUS.RETRIEVED || r.status === STATUS.EMPTY;

/**
 * The TXT. Metadata lines come first in every record; the description follows
 * "DESCRIPTION:" byte for byte. Its length is stated so a parser never has to
 * guess where it ends, even if it contains a line that looks like the
 * delimiter.
 */
export function buildDescriptionsText(snapshot, records) {
  const c = countRecords(records);
  const header = [
    'TERNARY HOUSE — VIDEO DESCRIPTIONS',
    '',
    `Channel: ${snapshot.channelName || 'Not available'}`,
    `Channel URL: ${snapshot.channelUrl || 'Not available'}`,
    `Tab: ${snapshot.tabLabel}`,
  ];
  if (snapshot.playlistUrl) header.push(`Playlist: ${snapshot.playlistTitle || 'Not available'} — ${snapshot.playlistUrl}`);
  header.push(
    `Sort: ${snapshot.sort}`,
    `Captured at (UTC): ${isoUtc(snapshot.capturedAt)}`,
    `Total requested: ${c.total}`,
    `Descriptions retrieved: ${c.retrieved}`,
    `Empty descriptions: ${c.empty}`,
    `Missing/failed: ${c.missing}`,
    '',
    '# MISSING',
    '',
  );
  const missing = records.filter((r) => !hasDescription(r));
  if (!missing.length) header.push('None');
  else {
    header.push(missing.map((r) => [
      `Title: ${titleOf(r)}`,
      `URL: ${r.url}`,
      `Video ID: ${r.id}`,
      `Reason: ${r.reason || statusText(r)}`,
    ].join('\n')).join('\n\n'));
  }

  const blocks = records.map((r) => [
    `Title: ${titleOf(r)}`,
    `URL: ${r.url}`,
    `Video ID: ${r.id}`,
    `Published (UTC): ${r.publishedAt || 'Not available'}`,
    `Retrieval status: ${statusText(r)}`,
    `Description length (characters): ${hasDescription(r) ? [...r.description].length : 'Not available'}`,
    '',
    'DESCRIPTION:',
    hasDescription(r) ? r.description : '[Not retrieved — see # MISSING]',
  ].join('\n'));

  return `${[header.join('\n'), ...blocks].join(`\n\n${RECORD_DELIMITER}\n\n`)}\n`;
}

const slug = (s) => String(s || '').replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);

/** CHANNEL_HANDLE-TAB-video-descriptions-YYYY-MM-DD.txt */
export function descriptionsFilename(snapshot) {
  const who = slug((snapshot.channelHandle || '').replace(/^@/, ''))
    || slug(snapshot.channelName)
    || (snapshot.playlistId ? `playlist-${slug(snapshot.playlistId)}` : '')
    || 'youtube';
  const tab = slug(snapshot.tab) || 'videos';
  const day = new Date(snapshot.capturedAt).toISOString().slice(0, 10);
  return `${who}-${tab}-video-descriptions-${day}.txt`;
}
