/**
 * Ternary House YouTube Qualifier — "Copy 12 URLs" export.
 *
 * Copies the canonical watch URLs of the 12 newest normal uploads on a
 * channel's Videos -> Latest grid, numbered 1-12, newest first.
 *
 * This is a SEPARATE pipeline from the Avg Views / Engagement metrics. It does
 * not use the 3-month window, sample rules, trimming, the service worker, the
 * YouTube Data API, or an API key. It reads what the page already shows and
 * writes to the clipboard. The metric candidate collector is not used or
 * changed by anything in this file.
 *
 * A CLASSIC script (not an ES module), loaded after content/render.js and
 * before content/content.js, sharing their isolated-world scope, the same
 * pattern render.js uses. Everything here is deterministic and testable: the
 * only DOM access is the read-only readGridEntries(), and all side effects
 * (scrolling, clipboard, sort detection) are injected by the caller.
 */

(() => {
  'use strict';

  const EXPORT_COUNT = 12;
  const WATCH_BASE = 'https://www.youtube.com/watch?v=';
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);

  /** Same item selector the metric harvester uses, so both read one surface. */
  const ITEM_SELECTOR = 'ytd-rich-item-renderer, ytd-grid-video-renderer';
  /** Upper bound on grid items inspected per read. Never a crawl. */
  const MAX_ITEMS_READ = 60;

  /** Every label the action button can show. */
  const EXPORT_TEXT = Object.freeze({
    IDLE: 'Copy 12 URLs',
    WORKING: 'Copying...',
    COPIED: 'Copied 12 URLs',
    WRONG_SORT: 'Switch to Latest',
    COPY_FAILED: 'Copy failed',
    READY: 'Ready — click to copy',
  });

  const foundText = (n) => `Found ${n} of ${EXPORT_COUNT}`;

  /* ------------------------------------------------------------------ *
   * Identity and formatting
   * ------------------------------------------------------------------ */

  function isValidVideoId(id) {
    return typeof id === 'string' && VIDEO_ID_RE.test(id);
  }

  /** The only URL shape ever exported. Null for anything that is not an ID. */
  function canonicalWatchUrl(id) {
    return isValidVideoId(id) ? `${WATCH_BASE}${id}` : null;
  }

  /**
   * Extract a video ID from a normal /watch link. Any timestamp, playlist,
   * feature, share or tracking parameter, and any hash, is discarded because
   * only `v` is read. /shorts/, /live/ and every non-/watch path yield null.
   */
  function watchIdFromHref(href) {
    if (typeof href !== 'string' || !href) return null;
    let url;
    try {
      url = new URL(href, 'https://www.youtube.com');
    } catch {
      return null;
    }
    if (!YOUTUBE_HOSTS.has(url.hostname) || url.pathname !== '/watch') return null;
    const id = url.searchParams.get('v');
    return isValidVideoId(id) ? id : null;
  }

  /**
   * The paste-ready clipboard block, or null unless given exactly 12 unique
   * valid IDs. A partial or padded list is never produced.
   *
   *   1. https://www.youtube.com/watch?v=AAAAAAAAAAA
   *   ...
   *   12. https://www.youtube.com/watch?v=LLLLLLLLLLL
   *
   * No heading, titles, dates, bullets, Markdown, blank lines or trailing
   * newline.
   */
  function formatExportBlock(ids) {
    if (!Array.isArray(ids) || ids.length !== EXPORT_COUNT) return null;
    if (!ids.every(isValidVideoId)) return null;
    if (new Set(ids).size !== EXPORT_COUNT) return null;
    return ids.map((id, i) => `${i + 1}. ${WATCH_BASE}${id}`).join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Reading the grid (read-only DOM access)
   * ------------------------------------------------------------------ */

  /**
   * One entry per grid item, in visible order: `{ shorts, href }`.
   *
   * Mirrors the structural rules of the metric harvester exactly: the same
   * item selector, an item containing a /shorts/ link is a Short, and the
   * video link is the item's first /watch?v= anchor. Unlike the metric
   * harvester, an item whose link has not rendered yet is REPORTED (href null)
   * rather than silently dropped, because for this export a skipped item would
   * shift every later URL up one position.
   */
  function readGridEntries(grid, maxItems = MAX_ITEMS_READ) {
    if (!grid || typeof grid.querySelectorAll !== 'function') return [];
    const entries = [];
    const items = grid.querySelectorAll(ITEM_SELECTOR);

    if (items.length) {
      for (const item of items) {
        const shorts = Boolean(item.querySelector('a[href^="/shorts/"]'));
        const anchor = item.querySelector('a[href*="/watch?v="]');
        entries.push({ shorts, href: anchor ? anchor.getAttribute('href') : null });
        if (entries.length >= maxItems) break;
      }
      return entries;
    }

    // Same fallback as the metric harvester when no item renderers exist.
    for (const anchor of grid.querySelectorAll('a[href*="/watch?v="]')) {
      if (anchor.closest && anchor.closest('ytd-reel-item-renderer, ytm-shorts-lockup-view-model')) continue;
      entries.push({ shorts: false, href: anchor.getAttribute('href') });
      if (entries.length >= maxItems) break;
    }
    return entries;
  }

  /**
   * The first `count` unique normal-video IDs, newest first.
   *
   * Shorts are excluded structurally. Runtime is never considered: a 0:58
   * /watch?v= upload on the Videos tab is a normal upload. Collection STOPS at
   * the first item that has not rendered its link yet (`pending: true`), so a
   * later video can never be promoted into an earlier slot.
   */
  function selectExportIds(entries, count = EXPORT_COUNT) {
    const ids = [];
    const seen = new Set();
    let pending = false;
    for (const entry of entries || []) {
      if (ids.length >= count) break;
      if (!entry || entry.shorts) continue;
      if (!entry.href) {
        pending = true;
        break;
      }
      const id = watchIdFromHref(entry.href);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return { ids, pending };
  }

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
   * The export operation
   * ------------------------------------------------------------------ */

  /**
   * One exporter per Controller, so it is created and destroyed with the
   * channel page it belongs to.
   *
   * deps:
   *   isLatest()       -> boolean   the existing Latest-sort detector
   *   scopeKey()       -> string    identity of the current creator surface
   *   isAlive()        -> boolean   the owning Controller is still mounted
   *   readEntries()    -> entries   readGridEntries() over the live grid
   *   loadMore({scroll}) -> Promise one bounded step: scroll for more items, or
   *                                 (scroll: false) just wait for a pending
   *                                 item to finish rendering
   *   saveScroll()     -> token
   *   restoreScroll(t)
   *   copy(text)       -> Promise<boolean>   the existing clipboard helper
   *   lock                          createDomLock(), shared with metrics
   *   maxLoadSteps     default 4
   *   readyTtlMs       default 60000
   *   now()            default Date.now
   */
  function createUrlExporter(deps) {
    const maxLoadSteps = deps.maxLoadSteps ?? 4;
    const readyTtlMs = deps.readyTtlMs ?? 60000;
    const now = deps.now || (() => Date.now());

    let running = false;
    // A prepared block exists ONLY after a copy attempt failed following
    // asynchronous work (see `collectAndCopy`). It is single-use, expires, and
    // is re-validated against the live page before it can ever be copied.
    let prepared = null;

    const sameScope = (scope) => deps.isAlive() && deps.scopeKey() === scope;

    async function safeCopy(text) {
      try {
        return Boolean(await deps.copy(text));
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
      const live = selectExportIds(deps.readEntries(), EXPORT_COUNT).ids;
      if (live.length !== EXPORT_COUNT) return false;
      return live.every((id, i) => id === p.ids[i]);
    }

    /** Collect under the DOM lock; restore scroll in `finally`. */
    async function collect(scope) {
      let { ids, pending } = selectExportIds(deps.readEntries(), EXPORT_COUNT);
      let scrollToken = null;
      let loaded = false;
      try {
        for (let step = 0; ids.length < EXPORT_COUNT && step < maxLoadSteps; step += 1) {
          if (scrollToken === null) scrollToken = deps.saveScroll();
          loaded = true;
          const before = ids.length;
          try {
            // A pending item is already on the page and only needs to finish
            // rendering: wait for it without scrolling (which would make
            // YouTube append unrelated items). Otherwise scroll for more.
            await deps.loadMore({ scroll: !pending });
          } catch {
            break;
          }
          if (!sameScope(scope)) return { aborted: true };
          if (!deps.isLatest()) return { wrongSort: true };
          ({ ids, pending } = selectExportIds(deps.readEntries(), EXPORT_COUNT));
          // Nothing pending and nothing new: the grid has no more to give.
          // While an item is still rendering, keep waiting (bounded).
          if (!pending && ids.length === before) break;
        }
      } finally {
        // Never scroll a page that is no longer this creator's.
        if (scrollToken !== null && sameScope(scope)) deps.restoreScroll(scrollToken);
      }
      return { ids, loaded };
    }

    async function collectAndCopy() {
      const scope = deps.scopeKey();
      const lockWasBusy = deps.lock.holder !== null;
      const collected = await deps.lock.run('export', () => collect(scope));

      if (collected.aborted || !sameScope(scope)) return { status: 'ABORTED' };
      if (collected.wrongSort) return { status: 'WRONG_SORT' };

      const text = formatExportBlock(collected.ids);
      if (!text) return { status: 'INSUFFICIENT', count: collected.ids.length };

      if (await safeCopy(text)) return { status: 'COPIED', count: EXPORT_COUNT };

      // The copy ran after asynchronous waiting. If the browser refused it
      // because the click's user activation had expired, a second click (with
      // fresh activation) can copy the same, re-validated block.
      if (collected.loaded || lockWasBusy) {
        prepared = { scope, ids: collected.ids.slice(), text, at: now() };
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
            return (await safeCopy(p.text))
              ? { status: 'COPIED', count: EXPORT_COUNT }
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
      case 'READY': return EXPORT_TEXT.READY;
      case 'COPY_FAILED': return EXPORT_TEXT.COPY_FAILED;
      case 'ABORTED': return EXPORT_TEXT.IDLE;
      default: return null;
    }
  }

  self.THQUrlExport = {
    EXPORT_COUNT,
    EXPORT_TEXT,
    foundText,
    isValidVideoId,
    canonicalWatchUrl,
    watchIdFromHref,
    formatExportBlock,
    readGridEntries,
    selectExportIds,
    createDomLock,
    createUrlExporter,
    exportButtonText,
  };
})();
