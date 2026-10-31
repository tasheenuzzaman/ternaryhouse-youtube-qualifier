/**
 * Ternary House YouTube Qualifier — URL and evidence exports.
 *
 *   Copy 12 URLs          the canonical watch URLs of the 12 newest PUBLISHED
 *                         normal uploads on a channel's Videos -> Latest grid,
 *                         numbered 1-12, newest first.
 *   Copy Channel Details  the same 12, through the same selector and the same
 *                         export operation, formatted as a JSON evidence block
 *                         by content/channel-details.js.
 *   Copy all video URLs   every unique watch URL currently loaded in the
 *                         Videos grid, any sort, in card order, uncapped.
 *
 * These are SEPARATE pipelines from the Avg Views / Engagement metrics. They
 * do not use the 3-month window, sample rules, trimming, the service worker,
 * the YouTube Data API, or an API key. They read what the page already shows
 * and write to the clipboard. The metric candidate collector is not used or
 * changed by anything in this file.
 *
 * A CLASSIC script (not an ES module), loaded after content/video-selection.js
 * and before content/content.js, sharing their isolated-world scope. Card
 * reading and the publication-aware 12-video selection live in
 * video-selection.js; this file re-exports them so existing callers keep one
 * import. All side effects (scrolling, clipboard, sort detection) are injected
 * by the caller.
 */

(() => {
  'use strict';

  const {
    WATCH_BASE, SORT_LABELS, isValidVideoId, canonicalWatchUrl, watchIdFromHref,
    readVideoCards, readLoadedVideoUrls, selectEligibleVideos,
  } = self.THQVideoSelection;

  const EXPORT_COUNT = 12;

  /** Every label the Copy 12 URLs button can show. */
  const EXPORT_TEXT = Object.freeze({
    IDLE: 'Copy 12 URLs',
    WORKING: 'Copying...',
    COPIED: 'Copied 12 URLs',
    WRONG_SORT: 'Switch to Latest',
    COPY_FAILED: 'Copy failed',
    READY: 'Ready — click to copy',
    REVIEW_STATUS: 'Review video status',
    REVIEW_ORDER: 'Review video order',
  });

  const foundText = (n) => `Found ${n} of ${EXPORT_COUNT}`;

  /* ------------------------------------------------------------------ *
   * Formatting
   * ------------------------------------------------------------------ */

  /**
   * The paste-ready clipboard block, or null unless given exactly 12 unique
   * valid IDs. A partial or padded list is never produced.
   *
   *   https://www.youtube.com/watch?v=AAAAAAAAAAA
   *   ...
   *   https://www.youtube.com/watch?v=LLLLLLLLLLL
   *
   * One URL per line (v1.3.0: no numbering). No heading, titles, dates,
   * bullets, Markdown, blank lines, trailing spaces or trailing newline.
   */
  function formatExportBlock(ids) {
    if (!Array.isArray(ids) || ids.length !== EXPORT_COUNT) return null;
    if (!ids.every(isValidVideoId)) return null;
    if (new Set(ids).size !== EXPORT_COUNT) return null;
    return ids.map((id) => `${WATCH_BASE}${id}`).join('\n');
  }

  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /**
   * The text/html companion of a plain-text block: the same lines, one block
   * element each, with every URL line a link. The visible text equals the
   * plain text, so pasting either gives the same content.
   */
  function linksHtml(text) {
    if (typeof text !== 'string' || !text) return null;
    const lines = text.split('\n').map((line) => {
      if (!line) return '<div><br></div>';
      if (/^https:\/\/www\.youtube\.com\/(?:watch\?v=|shorts\/)[A-Za-z0-9_-]{11}$/.test(line)) {
        return `<div><a href="${escapeHtml(line)}">${escapeHtml(line)}</a></div>`;
      }
      return `<div>${escapeHtml(line)}</div>`;
    });
    return lines.join('');
  }

  /** Back-compat names: the 12-video selector is the shared publication-aware one. */
  const readGridEntries = readVideoCards;
  const selectExportIds = selectEligibleVideos;

  /* ------------------------------------------------------------------ *
   * Mutual exclusion for page-scrolling work
   * ------------------------------------------------------------------ */

  /**
   * A tiny FIFO lock. Metric candidate collection and URL top-up both scroll
   * the page, so they take turns rather than fighting over scroll position.
   * The lock is released in `finally`, whatever the work does, so a failed
   * operation can never leave the other one blocked.
   */
  function createDomLock() {
    let tail = Promise.resolve();
    let holder = null;
    return {
      get holder() { return holder; },
      run(name, work) {
        const turn = tail;
        let release;
        tail = new Promise((resolve) => { release = resolve; });
        return turn.then(async () => {
          holder = name;
          try {
            return await work();
          } finally {
            holder = null;
            release();
          }
        });
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * The Latest-only 12-video export operation
   * ------------------------------------------------------------------ */

  /** Default output: the 12-line URL block, plus clickable links. */
  const urlBlockFormat = (selection) => {
    const text = formatExportBlock(selection.ids);
    return { text, html: linksHtml(text) };
  };

  /**
   * One exporter per button per Controller, so it is created and destroyed
   * with the channel page it belongs to. Copy 12 URLs and Copy Channel Details
   * each get one; they differ only in `format`.
   *
   * deps:
   *   isLatest()       -> boolean   the existing Latest-sort detector
   *   scopeKey()       -> string    identity of the current creator surface
   *   isAlive()        -> boolean   the owning Controller is still mounted
   *   readEntries()    -> entries   readGridEntries() over the live grid
   *   loadMore({scroll}) -> Promise one bounded step: scroll for more items, or
   *                                 (scroll: false) just wait for a pending or
   *                                 undecided item to finish rendering
   *   saveScroll()     -> token
   *   restoreScroll(t)
   *   copy(text, html) -> Promise<boolean>   the clipboard helper (html optional)
   *   lock                          createDomLock(), shared with metrics
   *   format(selection) -> { text } | { status, ... }   default: 12-line block
   *   name             lock holder name, default 'export'
   *   maxLoadSteps     default 4
   *   readyTtlMs       default 60000
   *   now()            default Date.now
   */
  function createUrlExporter(deps) {
    const maxLoadSteps = deps.maxLoadSteps ?? 4;
    const readyTtlMs = deps.readyTtlMs ?? 60000;
    const now = deps.now || (() => Date.now());
    const format = deps.format || urlBlockFormat;
    const lockName = deps.name || 'export';
    const select = () => selectEligibleVideos(deps.readEntries(), EXPORT_COUNT);

    let running = false;
    // A prepared block exists ONLY after a copy attempt failed following
    // asynchronous work (see `collectAndCopy`). It is single-use, expires, and
    // is re-validated against the live page before it can ever be copied.
    let prepared = null;

    const sameScope = (scope) => deps.isAlive() && deps.scopeKey() === scope;

    async function safeCopy(text, html) {
      try {
        return Boolean(await deps.copy(text, html));
      } catch {
        return false;
      }
    }

    function preparedStillValid(p) {
      if (now() - p.at > readyTtlMs) return false;
      if (!sameScope(p.scope)) return false;
      if (!deps.isLatest()) return false;
      // All 12 must be re-resolved from the live grid and match position for
      // position. A matching PREFIX is not enough: if the grid currently
      // exposes only the first N, the other 12 - N slots are unverified, so
      // the prepared block is refused and never copied.
      const live = select();
      if (live.ids.length !== EXPORT_COUNT || live.orderAnomaly) return false;
      return live.ids.every((id, i) => id === p.ids[i]);
    }

    /** Collect under the DOM lock; restore scroll in `finally`. */
    async function collect(scope) {
      let selection = select();
      let scrollToken = null;
      let loaded = false;
      try {
        for (let step = 0; selection.ids.length < EXPORT_COUNT && step < maxLoadSteps; step += 1) {
          if (scrollToken === null) scrollToken = deps.saveScroll();
          loaded = true;
          const before = selection.ids.length;
          // A pending or undecided item is already on the page and only needs
          // to finish rendering: wait for it without scrolling (which would
          // make YouTube append unrelated items). Otherwise scroll for more.
          const waiting = selection.pending || Boolean(selection.blocked);
          try {
            await deps.loadMore({ scroll: !waiting });
          } catch {
            break;
          }
          if (!sameScope(scope)) return { aborted: true };
          if (!deps.isLatest()) return { wrongSort: true };
          selection = select();
          // Nothing pending or undecided and nothing new: the grid has no
          // more to give. While an item is still rendering, keep waiting
          // (bounded).
          if (!selection.pending && !selection.blocked && selection.ids.length === before) break;
        }
      } finally {
        // Never scroll a page that is no longer this creator's.
        if (scrollToken !== null && sameScope(scope)) deps.restoreScroll(scrollToken);
      }
      return { selection, loaded };
    }

    async function collectAndCopy() {
      const scope = deps.scopeKey();
      const lockWasBusy = deps.lock.holder !== null;
      const collected = await deps.lock.run(lockName, () => collect(scope));

      if (collected.aborted || !sameScope(scope)) return { status: 'ABORTED' };
      if (collected.wrongSort) return { status: 'WRONG_SORT' };

      const { selection } = collected;
      const excludedCount = selection.excluded.length;
      if (selection.ids.length < EXPORT_COUNT) {
        if (selection.blocked) {
          return { status: 'REVIEW_STATUS', count: selection.ids.length, blocked: selection.blocked, excludedCount };
        }
        return { status: 'INSUFFICIENT', count: selection.ids.length, excludedCount };
      }
      if (selection.orderAnomaly) return { status: 'REVIEW_ORDER', anomaly: selection.orderAnomaly, excludedCount };

      const formatted = format(selection) || {};
      if (formatted.status) return { ...formatted, excludedCount };
      const { text, html } = formatted;
      if (!text) return { status: 'INSUFFICIENT', count: selection.ids.length, excludedCount };

      if (await safeCopy(text, html)) return { status: 'COPIED', count: EXPORT_COUNT, excludedCount };

      // The copy ran after asynchronous waiting. If the browser refused it
      // because the click's user activation had expired, a second click (with
      // fresh activation) can copy the same, re-validated block.
      if (collected.loaded || lockWasBusy) {
        prepared = { scope, ids: selection.ids.slice(), text, html, excludedCount, at: now() };
        return { status: 'READY' };
      }
      return { status: 'COPY_FAILED' };
    }

    async function click() {
      if (running) return { status: 'IGNORED' };
      running = true;
      try {
        if (prepared) {
          const p = prepared;
          prepared = null; // single-use, whatever happens next
          if (preparedStillValid(p)) {
            return (await safeCopy(p.text, p.html))
              ? { status: 'COPIED', count: EXPORT_COUNT, excludedCount: p.excludedCount }
              : { status: 'COPY_FAILED' };
          }
        }
        // Fail closed BEFORE touching scroll position or the clipboard.
        if (!deps.isLatest()) return { status: 'WRONG_SORT' };
        return await collectAndCopy();
      } catch {
        return { status: 'COPY_FAILED' };
      } finally {
        running = false;
      }
    }

    return {
      click,
      invalidate() { prepared = null; },
      get running() { return running; },
      get hasPrepared() { return prepared !== null; },
    };
  }

  /** Button label for an export result. Null means "leave the label alone". */
  function exportButtonText(result) {
    switch (result && result.status) {
      case 'COPIED': return EXPORT_TEXT.COPIED;
      case 'WRONG_SORT': return EXPORT_TEXT.WRONG_SORT;
      case 'INSUFFICIENT': return foundText(result.count || 0);
      case 'REVIEW_STATUS': return EXPORT_TEXT.REVIEW_STATUS;
      case 'REVIEW_ORDER': return EXPORT_TEXT.REVIEW_ORDER;
      case 'READY': return EXPORT_TEXT.READY;
      case 'COPY_FAILED': return EXPORT_TEXT.COPY_FAILED;
      case 'ABORTED': return EXPORT_TEXT.IDLE;
      default: return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * Copy all video URLs — the general loaded-grid inventory
   * ------------------------------------------------------------------ */

  const ALL_URLS_TEXT = Object.freeze({
    IDLE: 'Copy all video URLs',
    NONE: 'No loaded video URLs',
    NO_GRID: 'Video grid not found',
    OFF_ROUTE: 'Open the Videos tab',
    BUSY: 'Busy — retry',
    COPY_FAILED: 'Copy failed',
  });

  const copiedUrlsText = (n) => `Copied ${n} URL${n === 1 ? '' : 's'}`;
  const notReadyText = (n) => `${n} card${n === 1 ? '' : 's'} not ready — retry`;

  /** Sort labels the general block may carry; anything else is Unknown. */
  const INVENTORY_SORTS = [...SORT_LABELS, 'Playlist order'];

  const entryUrl = (e) => (e.kind === 'shorts' ? `https://www.youtube.com/shorts/${e.id}` : `${WATCH_BASE}${e.id}`);

  /**
   * The general inventory block, or null for an empty or malformed list:
   *
   *   Total URLs: 347
   *   Sort: Oldest
   *
   *   https://www.youtube.com/watch?v=AAAAAAAAAAA
   *   ...
   *   https://www.youtube.com/shorts/ZZZZZZZZZZZ
   *
   * `items` are IDs (watch URLs) or { id, kind } entries (a Short keeps its
   * native /shorts/ URL). One URL per line, no numbering (v1.3.0). The count
   * is the number of URL lines. Plain text, no trailing newline.
   */
  function formatAllUrlsBlock(items, sortLabel) {
    if (!Array.isArray(items) || !items.length) return null;
    const entries = items.map((it) => (typeof it === 'string' ? { id: it, kind: 'watch' } : it));
    if (!entries.every((e) => e && isValidVideoId(e.id))) return null;
    if (new Set(entries.map((e) => e.id)).size !== entries.length) return null;
    const sort = INVENTORY_SORTS.includes(sortLabel) ? sortLabel : 'Unknown';
    return [
      `Total URLs: ${entries.length}`,
      `Sort: ${sort}`,
      '',
      ...entries.map(entryUrl),
    ].join('\n');
  }

  /**
   * Copy all video URLs. One synchronous read of the live grid per click,
   * then the clipboard write is started in the same click, so there is no
   * prepared block that could outlive a sort, creator or grid change.
   * No scrolling, no loading, no cap, no sort guard.
   *
   * deps:
   *   isAlive()        -> boolean
   *   onVideosRoute()  -> boolean   still on the creator tab / playlist it was mounted on
   *   isBusy()         -> boolean   another export or metric is scrolling
   *   readInventory()  -> readLoadedVideoUrls(grid)
   *   readSort()       -> 'Latest' | 'Popular' | 'Oldest' | 'Unknown'
   *   copy(text, html) -> Promise<boolean>
   */
  function createAllUrlsExporter(deps) {
    let running = false;

    async function click() {
      if (running) return { status: 'IGNORED' };
      running = true;
      try {
        if (!deps.isAlive()) return { status: 'ABORTED' };
        if (!deps.onVideosRoute()) return { status: 'OFF_ROUTE' };
        if (deps.isBusy()) return { status: 'BUSY' };

        const sort = deps.readSort();
        const inventory = deps.readInventory();
        if (!inventory || !inventory.gridFound) return { status: 'NO_GRID' };
        if (inventory.unresolved.length) {
          return { status: 'NOT_READY', count: inventory.unresolved.length, unresolved: inventory.unresolved };
        }
        const text = formatAllUrlsBlock(inventory.entries && inventory.entries.length ? inventory.entries : inventory.ids, sort);
        if (!text) return { status: 'NONE', nonVideo: inventory.nonVideo };

        let ok = false;
        try {
          ok = Boolean(await deps.copy(text, linksHtml(text)));
        } catch {
          ok = false;
        }
        return ok
          ? { status: 'COPIED', count: inventory.ids.length, sort: INVENTORY_SORTS.includes(sort) ? sort : 'Unknown', inventory }
          : { status: 'COPY_FAILED' };
      } catch {
        return { status: 'COPY_FAILED' };
      } finally {
        running = false;
      }
    }

    return {
      click,
      get running() { return running; },
    };
  }

  function allUrlsButtonText(result) {
    switch (result && result.status) {
      case 'COPIED': return copiedUrlsText(result.count || 0);
      case 'NONE': return ALL_URLS_TEXT.NONE;
      case 'NO_GRID': return ALL_URLS_TEXT.NO_GRID;
      case 'OFF_ROUTE': return ALL_URLS_TEXT.OFF_ROUTE;
      case 'BUSY': return ALL_URLS_TEXT.BUSY;
      case 'NOT_READY': return notReadyText(result.count || 0);
      case 'COPY_FAILED': return ALL_URLS_TEXT.COPY_FAILED;
      case 'ABORTED': return ALL_URLS_TEXT.IDLE;
      default: return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * Download all video descriptions — the trigger
   * ------------------------------------------------------------------ */

  /**
   * Snapshots the SAME inventory Copy all video URLs reads, at click time,
   * and hands it to the service worker, which fetches and downloads in the
   * background. The page can be left immediately afterwards.
   *
   * deps: isAlive, onVideosRoute, isBusy, readInventory, readContext() -> page
   *       context (channel, tab, sort, playlist), start(snapshot) -> Promise<response>
   */
  function createDescriptionsExporter(deps) {
    let running = false;

    async function click() {
      if (running) return { status: 'IGNORED' };
      running = true;
      try {
        if (!deps.isAlive()) return { status: 'ABORTED' };
        if (!deps.onVideosRoute()) return { status: 'OFF_ROUTE' };
        if (deps.isBusy()) return { status: 'BUSY_PAGE' };
        const inventory = deps.readInventory();
        if (!inventory || !inventory.gridFound) return { status: 'NO_GRID' };
        if (inventory.unresolved.length) {
          return { status: 'NOT_READY', count: inventory.unresolved.length, unresolved: inventory.unresolved };
        }
        if (!inventory.entries.length) return { status: 'NONE', nonVideo: inventory.nonVideo };
        const snapshot = { ...deps.readContext(), capturedAt: Date.now(), items: inventory.entries.map((e) => ({ ...e })) };
        const response = await deps.start(snapshot);
        if (response && response.ok) return { status: 'STARTED', job: response.job };
        const error = (response && response.error) || { code: 'UNEXPECTED', message: 'The extension did not answer.' };
        return { status: error.code === 'BUSY' ? 'JOB_BUSY' : 'START_FAILED', error, job: response && response.job };
      } catch {
        return { status: 'START_FAILED', error: { code: 'UNEXPECTED', message: 'The extension did not answer.' } };
      } finally {
        running = false;
      }
    }

    return { click, get running() { return running; } };
  }

  const DESCRIPTIONS_TEXT = Object.freeze({ IDLE: 'Download all video descriptions' });

  /** Label for a background job's public state. Null = leave the label alone. */
  function descriptionsJobText(job) {
    if (!job) return null;
    const c = job.counts;
    switch (job.state) {
      case 'running': return `Descriptions ${job.processed || 0}/${job.total}…`;
      case 'downloading': return 'Saving file…';
      case 'done': return c && c.missing ? `Downloaded ${c.total} (${c.missing} missing)` : `Downloaded ${c ? c.total : job.total}`;
      case 'interrupted': return 'Interrupted — click to retry';
      case 'failed':
        if (job.error && job.error.code === 'NO_API_KEY') return 'API key required';
        if (job.error && job.error.code === 'QUOTA_EXCEEDED') return 'API quota exceeded';
        return 'Download failed';
      default: return null;
    }
  }

  function descriptionsButtonText(result) {
    switch (result && result.status) {
      case 'STARTED': return descriptionsJobText(result.job) || 'Starting…';
      case 'JOB_BUSY': return result.job ? `Already running ${result.job.processed}/${result.job.total}` : 'Already running';
      case 'START_FAILED':
        if (result.error && result.error.code === 'NO_API_KEY') return 'API key required';
        return 'Could not start';
      case 'NONE': return 'No loaded videos';
      case 'NO_GRID': return ALL_URLS_TEXT.NO_GRID;
      case 'OFF_ROUTE': return ALL_URLS_TEXT.OFF_ROUTE;
      case 'BUSY_PAGE': return ALL_URLS_TEXT.BUSY;
      case 'NOT_READY': return notReadyText(result.count || 0);
      case 'ABORTED': return DESCRIPTIONS_TEXT.IDLE;
      default: return null;
    }
  }

  self.THQUrlExport = {
    EXPORT_COUNT,
    EXPORT_TEXT,
    ALL_URLS_TEXT,
    foundText,
    isValidVideoId,
    canonicalWatchUrl,
    watchIdFromHref,
    formatExportBlock,
    formatAllUrlsBlock,
    linksHtml,
    readGridEntries,
    readLoadedVideoUrls,
    selectExportIds,
    createDomLock,
    createUrlExporter,
    createAllUrlsExporter,
    createDescriptionsExporter,
    exportButtonText,
    allUrlsButtonText,
    descriptionsButtonText,
    descriptionsJobText,
    DESCRIPTIONS_TEXT,
  };
})();
