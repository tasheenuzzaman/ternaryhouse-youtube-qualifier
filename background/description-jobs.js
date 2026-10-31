/**
 * Ternary House YouTube Qualifier — description download jobs.
 *
 * One job at a time. The job (its captured inventory and progress, never the
 * API key or the descriptions) lives in chrome.storage.local, so it survives
 * the service worker being stopped:
 *
 *   - Stopped mid-fetch (MV3 idle termination): the next wake — any message,
 *     including the page's progress poll — finds the job still marked running
 *     and runs it again from its saved snapshot. Fetching is idempotent and
 *     costs one quota unit per 50 videos.
 *   - Stopped while the file was downloading: the saved download id is looked
 *     up instead of downloading twice.
 *   - Chrome closed: on the next browser session the job is marked
 *     INTERRUPTED. Nothing is downloaded silently later.
 *
 * Success is reported only after chrome.downloads says the file is complete.
 */

import {
  normalizeSnapshot, fetchDescriptions, buildDescriptionsText, descriptionsFilename, countRecords, STATUS,
} from '../lib/descriptions.js';

export const JOB_KEY = 'descriptionJob';
const SESSION_KEY = 'descriptionJobSession';
const KEEPALIVE_MS = 20000;
const ACTIVE = new Set(['running', 'downloading']);

/** The public view: never the snapshot, never the key. */
function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    state: job.state,
    total: job.total,
    processed: job.processed,
    counts: job.counts || null,
    filename: job.filename || null,
    error: job.error || null,
    finishedAt: job.finishedAt || null,
  };
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * deps: chrome (the extension API, injectable for tests), readApiKey(),
 *       fetchImpl, sleep, now()
 */
export function createDescriptionJobs(deps) {
  const api = deps.chrome;
  const now = deps.now || (() => Date.now());
  let runner = null;

  const load = async () => (await api.storage.local.get(JOB_KEY))[JOB_KEY] || null;
  const save = (job) => api.storage.local.set({ [JOB_KEY]: { ...job, updatedAt: now() } });
  const sessionJobId = async () => (await api.storage.session.get(SESSION_KEY))[SESSION_KEY] || null;

  async function finish(job, patch) {
    const done = { ...job, ...patch, finishedAt: now() };
    await save(done);
    return done;
  }

  function downloadState(id) {
    return new Promise((resolve) => {
      api.downloads.search({ id }, (items) => resolve(items && items[0] ? items[0] : null));
    });
  }

  /** Resolves 'complete' or 'interrupted:<reason>' once the download settles. */
  function waitForDownload(id) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        api.downloads.onChanged.removeListener(onChanged);
        resolve(value);
      };
      const onChanged = (delta) => {
        if (delta.id !== id || !delta.state) return;
        if (delta.state.current === 'complete') settle('complete');
        else if (delta.state.current === 'interrupted') settle(`interrupted:${(delta.error && delta.error.current) || 'unknown'}`);
      };
      api.downloads.onChanged.addListener(onChanged);
      downloadState(id).then((item) => {
        if (!item) settle('interrupted:not found');
        else if (item.state === 'complete') settle('complete');
        else if (item.state === 'interrupted') settle(`interrupted:${item.error || 'unknown'}`);
      });
    });
  }

  function startDownload(filename, text) {
    return new Promise((resolve, reject) => {
      api.downloads.download({
        url: `data:text/plain;charset=utf-8;base64,${utf8Base64(text)}`,
        filename,
        conflictAction: 'uniquify',
        saveAs: false,
      }, (id) => {
        const err = api.runtime.lastError;
        if (err || typeof id !== 'number') reject(new Error((err && err.message) || 'download was not started'));
        else resolve(id);
      });
    });
  }

  async function settleDownload(job) {
    const outcome = await waitForDownload(job.downloadId);
    if (outcome === 'complete') return finish(job, { state: 'done' });
    return finish(job, {
      state: 'failed',
      error: { code: 'DOWNLOAD_FAILED', message: `The file was not saved (${outcome.slice('interrupted:'.length)}).` },
    });
  }

  async function run(jobId) {
    const keepalive = setInterval(() => { try { api.runtime.getPlatformInfo(() => {}); } catch { /* ignore */ } }, KEEPALIVE_MS);
    try {
      let job = await load();
      if (!job || job.id !== jobId || !ACTIVE.has(job.state)) return;
      if (job.state === 'downloading' && typeof job.downloadId === 'number') {
        await settleDownload(job);
        return;
      }

      const apiKey = await deps.readApiKey();
      if (!apiKey) {
        await finish(job, { state: 'failed', error: { code: 'NO_API_KEY', message: 'YouTube API key required — open extension settings.' } });
        return;
      }

      const { records, fatal } = await fetchDescriptions(apiKey, job.snapshot.items, {
        fetchImpl: deps.fetchImpl,
        sleep: deps.sleep,
        onProgress: async (processed) => {
          const latest = await load();
          if (!latest || latest.id !== jobId) return;
          job = { ...latest, processed };
          await save(job);
        },
      });

      const counts = countRecords(records);
      const anyDescription = counts.retrieved + counts.empty > 0;
      const allRequestsFailed = records.every((r) => r.status === STATUS.REQUEST_FAILED || r.status === STATUS.ERROR);
      if (!anyDescription && (fatal || allRequestsFailed)) {
        const first = fatal || { code: 'API_ERROR', message: records[0].reason };
        await finish(job, { state: 'failed', counts, error: { code: first.code || 'API_ERROR', message: first.message, detail: first.detail || null } });
        return;
      }

      const filename = descriptionsFilename(job.snapshot);
      const text = buildDescriptionsText(job.snapshot, records);
      job = { ...job, state: 'downloading', counts, filename, processed: job.total };
      await save(job);
      let downloadId;
      try {
        downloadId = await startDownload(filename, text);
      } catch (err) {
        await finish(job, { state: 'failed', error: { code: 'DOWNLOAD_FAILED', message: `Chrome did not start the download (${err.message}).` } });
        return;
      }
      job = { ...job, downloadId };
      await save(job);
      await settleDownload(job);
    } catch {
      const job = await load();
      if (job && job.id === jobId && ACTIVE.has(job.state)) {
        await finish(job, { state: 'failed', error: { code: 'UNEXPECTED', message: 'Unexpected error while preparing the descriptions.' } });
      }
    } finally {
      clearInterval(keepalive);
    }
  }

  function kick(jobId) {
    if (runner) return runner;
    runner = run(jobId).finally(() => { runner = null; });
    return runner;
  }

  /** Called on every service-worker wake and every status poll. */
  async function resume() {
    const job = await load();
    if (!job || !ACTIVE.has(job.state) || runner) return job;
    if ((await sessionJobId()) !== job.id) {
      // Started in an earlier browser session: Chrome was closed mid-job.
      return finish(job, { state: 'interrupted', error: { code: 'INTERRUPTED', message: 'Chrome was closed before the download finished. Start it again.' } });
    }
    kick(job.id);
    return job;
  }

  async function start(rawSnapshot) {
    await resume();
    const current = await load();
    if (current && ACTIVE.has(current.state)) {
      return { ok: false, error: { code: 'BUSY', message: 'A description download is already running.' }, job: publicJob(current) };
    }
    const snapshot = normalizeSnapshot(rawSnapshot, now());
    if (!snapshot) return { ok: false, error: { code: 'NO_VIDEOS', message: 'No loaded videos to fetch.' } };
    if (!(await deps.readApiKey())) {
      return { ok: false, error: { code: 'NO_API_KEY', message: 'YouTube API key required — open extension settings.' } };
    }
    const job = {
      id: `job-${now()}-${Math.random().toString(36).slice(2, 8)}`,
      state: 'running',
      snapshot,
      total: snapshot.items.length,
      processed: 0,
      createdAt: now(),
    };
    await save(job);
    await api.storage.session.set({ [SESSION_KEY]: job.id });
    kick(job.id);
    return { ok: true, job: publicJob(job) };
  }

  async function status() {
    return { ok: true, job: publicJob(await resume()) };
  }

  return { start, status, resume, get running() { return runner; } };
}
