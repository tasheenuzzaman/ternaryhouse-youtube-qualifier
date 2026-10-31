/**
 * Ternary House YouTube Qualifier — service worker (trusted context).
 *
 * This is the only place the YouTube API key is read and the only place that
 * talks to the network. The content script never receives the key and never
 * needs it.
 */

import { fetchVideoStatistics, testApiKey, YouTubeApiError } from '../lib/youtube-api.js';
import { analyzeVideos } from '../lib/analysis.js';
import { createDescriptionJobs } from './description-jobs.js';
import {
  API_KEY_STORAGE_KEY,
  ACCESS_LEVEL_TRUSTED,
  describeStorageIsolation,
} from '../lib/security.js';

/** Short session cache. Long enough to make repeat clicks free, short enough
 *  that a creator's metrics can never go materially stale. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 12;

/** In-memory only. Dies with the service worker, which is the desired lifetime. */
const cache = new Map();

/* ------------------------------------------------------------------ *
 * Storage access hardening
 * ------------------------------------------------------------------ */

/**
 * chrome.storage.local is exposed to content scripts BY DEFAULT. Restricting
 * it to TRUSTED_CONTEXTS means only extension pages and this service worker
 * can read it, while the data itself stays persistent across browser restarts
 * (unlike storage.session, which would lose the key on every restart).
 *
 * Re-applied on every service-worker start, on install and on browser startup,
 * so the restriction is in force whether or not Chrome persists the setting.
 */
const storageIsolation = { lockdown: 'unknown', error: null, probe: null };

async function lockDownLocalStorage() {
  const area = chrome.storage && chrome.storage.local;
  if (!area || typeof area.setAccessLevel !== 'function') {
    storageIsolation.lockdown = 'unsupported';
    return storageIsolation;
  }
  try {
    await area.setAccessLevel({ accessLevel: ACCESS_LEVEL_TRUSTED });
    storageIsolation.lockdown = 'applied';
    storageIsolation.error = null;
  } catch (err) {
    storageIsolation.lockdown = 'failed';
    // A message only; it never contains stored values.
    storageIsolation.error = err && err.message ? String(err.message).slice(0, 200) : 'unknown error';
  }
  return storageIsolation;
}

// Runs on every service-worker wake, which includes the first wake after a
// browser restart, before any handler below can touch the key.
const lockdownReady = lockDownLocalStorage();

chrome.runtime.onInstalled.addListener(() => { lockDownLocalStorage(); });
chrome.runtime.onStartup.addListener(() => { lockDownLocalStorage(); });

async function readApiKey() {
  await lockdownReady;
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const key = stored[API_KEY_STORAGE_KEY];
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { storedAt: Date.now(), value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

/**
 * The cache key binds the result to the exact creator surface AND the exact
 * set of discovered ids, so a different creator can never read a hit.
 */
function buildCacheKey(channelKey, videoIds) {
  return `${channelKey}::${videoIds.join(',')}`;
}

/* ------------------------------------------------------------------ *
 * Handlers
 * ------------------------------------------------------------------ */

async function handleAnalyze(payload) {
  const videoIds = Array.isArray(payload.videoIds) ? payload.videoIds.filter(Boolean) : [];
  const channelKey = payload.channelKey || 'unknown-channel';

  if (!videoIds.length) {
    return {
      ok: false,
      error: { code: 'NO_VIDEO_IDS', message: 'Could not confidently identify recent videos on this page.' },
    };
  }

  const cacheKey = buildCacheKey(channelKey, videoIds);
  if (!payload.force) {
    const hit = cacheGet(cacheKey);
    if (hit) return { ok: true, result: { ...hit, cached: true } };
  }

  const apiKey = await readApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: { code: 'NO_API_KEY', message: 'YouTube API key required — open extension settings.' },
    };
  }

  try {
    const { videos, requestCount, missingIds } = await fetchVideoStatistics(apiKey, videoIds);

    if (!videos.length) {
      return {
        ok: false,
        error: { code: 'NO_DATA', message: 'The API returned no data for the videos on this page.' },
      };
    }

    const result = analyzeVideos(videos, {
      now: new Date(),
      expectedChannelId: payload.channelIdHint || null,
      sourceSurface: payload.sourceSurface || undefined,
      meta: { requestCount, missingIds },
    });
    result.cached = false;

    cacheSet(cacheKey, result);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return { ok: false, error: { code: err.code, message: err.message, detail: err.detail } };
    }
    // Never forward a raw error: request URLs carry the key.
    return {
      ok: false,
      error: { code: 'UNEXPECTED', message: 'Unexpected failure while calculating — try Refresh.' },
    };
  }
}

async function handleKeyStatus() {
  const key = await readApiKey();
  return { ok: true, configured: Boolean(key) };
}

async function handleTestKey(payload) {
  const key = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
  const candidate = key || (await readApiKey());
  if (!candidate) {
    return { ok: false, error: { code: 'NO_API_KEY', message: 'No API key to test.' } };
  }
  try {
    await testApiKey(candidate);
    return { ok: true };
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return { ok: false, error: { code: err.code, message: err.message, detail: err.detail } };
    }
    return { ok: false, error: { code: 'UNEXPECTED', message: 'Key test failed unexpectedly.' } };
  }
}

/**
 * The content script reports whether it can still reach storage.local. It
 * probes a non-secret sentinel key and never the API key itself.
 */
async function handleStorageProbe(payload) {
  const outcome = payload.outcome === 'allowed' || payload.outcome === 'blocked' ? payload.outcome : null;
  if (outcome) storageIsolation.probe = outcome;
  return { ok: true };
}

async function handleSecurityStatus() {
  await lockdownReady;
  return {
    ok: true,
    status: describeStorageIsolation(storageIsolation),
    raw: { lockdown: storageIsolation.lockdown, probe: storageIsolation.probe, error: storageIsolation.error },
  };
}

/* ------------------------------------------------------------------ *
 * Download all video descriptions (background/description-jobs.js)
 * ------------------------------------------------------------------ */

const descriptionJobs = createDescriptionJobs({ chrome, readApiKey });
// Every wake: continue a job this browser session started, or mark one from
// a closed browser session as interrupted.
lockdownReady.then(() => descriptionJobs.resume()).catch(() => {});

const HANDLERS = {
  DESCRIPTIONS_START: (payload) => descriptionJobs.start(payload),
  DESCRIPTIONS_STATUS: () => descriptionJobs.status(),
  ANALYZE: handleAnalyze,
  KEY_STATUS: handleKeyStatus,
  TEST_KEY: handleTestKey,
  STORAGE_PROBE: handleStorageProbe,
  SECURITY_STATUS: handleSecurityStatus,
  CLEAR_CACHE: async () => { cache.clear(); return { ok: true }; },
  OPEN_OPTIONS: async () => { chrome.runtime.openOptionsPage(); return { ok: true }; },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = message && HANDLERS[message.type];
  if (!handler) return false;

  handler(message.payload || {})
    .then(sendResponse)
    .catch(() => sendResponse({
      ok: false,
      error: { code: 'UNEXPECTED', message: 'Unexpected extension error.' },
    }));

  return true; // async response
});

/** Clicking the toolbar icon opens Settings — the core workflow stays inline. */
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

/** A changed key must never be masked by results computed with the old one. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[API_KEY_STORAGE_KEY]) cache.clear();
});
