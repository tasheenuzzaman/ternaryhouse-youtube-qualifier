/**
 * Ternary House YouTube Qualifier — content script.
 *
 * Responsibilities, and nothing else:
 *   1. decide whether this page is a usable channel "Videos" surface;
 *   2. discover the recent long-form video ids in page order;
 *   3. ask the service worker for one analysis;
 *   4. render the two compact controls and their audit panels;
 *   5. host the "Copy 12 URLs" action (content/url-export.js), which reads
 *      the visible grid and needs no API, key or service-worker call.
 *
 * It never sees the YouTube API key and never makes a network request.
 */

(() => {
  'use strict';

  const HOST_CLASS = 'thq-host';
  /** Enough candidates to confidently cover the newest 12 after filtering. */
  const TARGET_CANDIDATES = 30;
  const MAX_SCROLL_ATTEMPTS = 2;
  const MOUNT_POLL_MS = 250;
  const MOUNT_TIMEOUT_MS = 8000;

  /* ================================================================== *
   * Page / route detection
   * ================================================================== */

  function parseChannelRoute(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    if (url.hostname !== 'www.youtube.com') return null;

    const segs = url.pathname.split('/').filter(Boolean);
    if (!segs.length) return null;

    let base = null;
    let tab = null;
    if (segs[0].startsWith('@')) {
      base = segs[0];
      tab = segs[1] || 'featured';
    } else if (['channel', 'c', 'user'].includes(segs[0]) && segs[1]) {
      base = `${segs[0]}/${segs[1]}`;
      tab = segs[2] || 'featured';
    } else {
      return null;
    }

    return { base, tab, sortParam: url.searchParams.get('sort') };
  }

  const isVideosRoute = (route) => Boolean(route) && route.tab === 'videos';

  /**
   * The Latest / Popular / Oldest chips, in the current view-model markup with
   * a fallback to the legacy renderer. Verified against live YouTube: the
   * chips are button[role="tab"] inside chip-bar-view-model, and the active
   * one carries aria-selected="true". Position is used rather than the label
   * so the check is locale-independent.
   */
  const SORT_CHIP_SELECTORS = [
    'ytd-browse[page-subtype="channels"] chip-bar-view-model [role="tablist"] button[role="tab"]',
    'ytd-browse[page-subtype="channels"] ytd-feed-filter-chip-bar-renderer yt-chip-cloud-chip-renderer',
  ];

  function readSortChips() {
    for (const selector of SORT_CHIP_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length > 1) {
        const selectedIndex = nodes.findIndex((node) => (
          node.getAttribute('aria-selected') === 'true'
          || node.hasAttribute('selected')
          || Boolean(node.querySelector('[aria-selected="true"]'))
        ));
        return { count: nodes.length, selectedIndex };
      }
    }
    return null;
  }

  /**
   * Confirm the grid is showing newest-first. Only a confident negative
   * produces an error.
   *
   * YouTube does NOT rewrite the URL when the sort chip changes, so the chip
   * state is the authoritative signal; the sort parameter is only a secondary
   * check for links that carry one explicitly.
   */
  function checkLatestOrdering(route) {
    if (route.sortParam && route.sortParam !== 'dd') {
      return { latest: false, message: 'Switch the Videos tab to Latest.' };
    }

    const chips = readSortChips();
    if (chips && chips.selectedIndex > 0) {
      return { latest: false, message: 'Switch the Videos tab to Latest.' };
    }

    return { latest: true, message: null };
  }

  function detectChannelIdentity(route) {
    let channelId = null;

    const metaId = document.querySelector('meta[itemprop="identifier"][content^="UC"]');
    if (metaId) channelId = metaId.getAttribute('content');

    if (!channelId) {
      const canonical = document.querySelector('link[rel="canonical"]');
      const m = canonical && /\/channel\/(UC[A-Za-z0-9_-]{20,})/.exec(canonical.href || '');
      if (m) channelId = m[1];
    }

    if (!channelId && route.base.startsWith('channel/')) {
      channelId = route.base.slice('channel/'.length);
    }

    return { channelId: channelId || null, channelKey: channelId || route.base };
  }

  /* ================================================================== *
   * Video id discovery
   * ================================================================== */

  const GRID_SELECTORS = [
    'ytd-browse[page-subtype="channels"] ytd-rich-grid-renderer',
    'ytd-browse[page-subtype="channels"] ytd-section-list-renderer #contents',
  ];

  function findGrid() {
    for (const selector of GRID_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function extractVideoId(href) {
    if (!href) return null;
    const m = /[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)/.exec(href);
    return m ? m[1] : null;
  }

  /**
   * Shorts render as /shorts/ID anchors, so restricting the harvest to
   * /watch?v= anchors inside the Videos grid excludes them structurally —
   * no duration heuristic involved at this stage.
   */
  function harvestVideoIds(grid, limit) {
    const ids = [];
    const seen = new Set();

    const push = (href) => {
      const id = extractVideoId(href);
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    };

    const items = grid.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');

    if (items.length) {
      for (const item of items) {
        if (item.querySelector('a[href^="/shorts/"]')) continue;
        const anchor = item.querySelector('a[href*="/watch?v="]');
        if (anchor) push(anchor.getAttribute('href'));
        if (ids.length >= limit) break;
      }
    } else {
      for (const anchor of grid.querySelectorAll('a[href*="/watch?v="]')) {
        if (anchor.closest('ytd-reel-item-renderer, ytm-shorts-lockup-view-model')) continue;
        push(anchor.getAttribute('href'));
        if (ids.length >= limit) break;
      }
    }

    return ids;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Restrained top-up: only used when the rendered grid holds fewer
   * candidates than we need, and never more than two bounded nudges.
   * The user's scroll position is restored.
   */
  async function collectVideoIds(grid) {
    let ids = harvestVideoIds(grid, TARGET_CANDIDATES);
    if (ids.length >= TARGET_CANDIDATES) return ids;

    const originalScrollY = window.scrollY;
    for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt += 1) {
      const before = ids.length;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
      await sleep(800);
      ids = harvestVideoIds(grid, TARGET_CANDIDATES);
      if (ids.length >= TARGET_CANDIDATES || ids.length === before) break;
    }
    window.scrollTo({ top: originalScrollY, behavior: 'auto' });
    return ids;
  }

  /* ================================================================== *
   * Messaging
   * ================================================================== */

  function sendMessage(type, payload) {
    return new Promise((resolve) => {
      const lost = {
        ok: false,
        error: { code: 'EXTENSION_CONTEXT_LOST', message: 'Extension was reloaded — refresh this page.' },
      };
      try {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          if (chrome.runtime.lastError || !response) { resolve(lost); return; }
          resolve(response);
        });
      } catch {
        resolve(lost);
      }
    });
  }

  /* ================================================================== *
   * Storage-isolation self-check
   * ================================================================== */

  /**
   * Confirm from the page side that this content script really cannot read
   * extension storage. It probes a deliberately non-secret sentinel key and
   * never touches the API key, so the check is safe even if the restriction
   * is not in force. Runs at most once per page load.
   */
  const ACCESS_PROBE_KEY = '__thq_access_probe__';
  let storageProbeStarted = false;

  async function probeStorageIsolation() {
    if (storageProbeStarted) return;
    storageProbeStarted = true;

    let outcome = 'blocked';
    try {
      if (chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
        await chrome.storage.local.get(ACCESS_PROBE_KEY);
        outcome = chrome.runtime.lastError ? 'blocked' : 'allowed';
      }
    } catch {
      outcome = 'blocked';
    }
    sendMessage('STORAGE_PROBE', { outcome });
  }

  /* ================================================================== *
   * Shared rendering layer
   *
   * Styles, DOM helpers and every audit-panel builder live in
   * content/render.js, which the manifest loads immediately before this file
   * (same isolated-world scope). tests/manual-fixtures.html loads the exact
   * same file, so the fixture page renders through production code rather
   * than a copy of it.
   * ================================================================== */

  const {
    STYLES, applyStyles, el, copyText: copyToClipboard, bindCopyControl, copyFeedback,
    compactAvgViewsText, compactCopyValue, LOADING_TEXT, ERROR_TEXT,
    renderAvgViewsPanel: drawAvgViewsPanel,
    renderEngagementPanel: drawEngagementPanel,
    renderErrorPanel: drawErrorPanel,
  } = self.THQRender;

  /* ================================================================== *
   * "Copy 12 URLs" export — content/url-export.js, loaded before this file.
   *
   * A separate pipeline from the metrics. It never calls collectVideoIds(),
   * never changes TARGET_CANDIDATES, and never sends ANALYZE.
   * ================================================================== */

  const {
    EXPORT_TEXT, readGridEntries, createDomLock, createUrlExporter, exportButtonText,
  } = self.THQUrlExport;

  const EXPORT_STEP_TIMEOUT_MS = 2500;
  const EXPORT_SETTLE_MS = 250;
  const EXPORT_LABEL_RESET_MS = 2500;
  const EXPORT_READY_TTL_MS = 60000;

  /**
   * One bounded lazy-load step for the URL export. With `scroll`, scroll to
   * the end of the page so YouTube appends the next batch; without it, just
   * wait for an item already on the page to finish rendering. Resolves once
   * the grid has been quiet briefly after changing, or after a hard timeout.
   * Observes the DOM instead of sleeping a fixed time, and only for the
   * duration of the step. The caller restores the operator's scroll position.
   */
  function loadMoreGridItems({ scroll = true } = {}) {
    const grid = findGrid();
    if (!grid) return Promise.resolve(false);
    return new Promise((resolve) => {
      let changed = false;
      let done = false;
      let settleTimer = null;
      let hardTimer = null;
      const observer = new MutationObserver(() => {
        changed = true;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, EXPORT_SETTLE_MS);
      });
      function finish() {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(settleTimer);
        clearTimeout(hardTimer);
        resolve(changed);
      }
      observer.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
      hardTimer = setTimeout(finish, EXPORT_STEP_TIMEOUT_MS);
      if (scroll) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    });
  }


  /* ================================================================== *
   * Controller — one instance per mounted page
   * ================================================================== */

  let current = null;

  class Controller {
    constructor(route, identity, grid, barMount) {
      this.route = route;
      this.identity = identity;
      this.grid = grid;
      this.token = Symbol('page');
      this.result = null;
      this.error = null;
      this.busy = false;
      this.openPanel = null;

      // Page-scrolling work (metric candidate top-up, URL top-up) takes turns.
      this.domLock = createDomLock();
      this.exporter = this.createExporter();

      // The compact bar belongs in the channel header, but the audit panel
      // must NOT expand there: the header's action row does not grow, so a
      // panel inside it would cover YouTube's tab bar and sort chips. The
      // panel therefore gets its own host directly above the video grid,
      // where it pushes content down instead of overlaying navigation.
      this.barHost = this.makeHost('thq-bar-host');
      this.panelHost = this.makeHost('thq-panel-host');
      this.panelHost.hidden = true;

      this.buildControls();

      if (barMount.mode === 'append') barMount.node.appendChild(this.barHost);
      else barMount.node.parentNode.insertBefore(this.barHost, barMount.node);

      grid.parentNode.insertBefore(this.panelHost, grid);
    }

    makeHost(variantClass) {
      const host = el('div', { class: `${HOST_CLASS} ${variantClass}` });
      host.dataset.thqChannel = this.identity.channelKey;
      const shadow = host.attachShadow({ mode: 'open' });
      applyStyles(shadow);
      const wrap = el('div', { class: 'wrap' });
      shadow.appendChild(wrap);
      host.thqWrap = wrap;
      return host;
    }

    buildControls() {
      this.viewsVal = el('span', { class: 'val empty' });
      this.viewsCopy = el('span', { class: 'copy', title: 'Copy the displayed value', role: 'button' });
      this.viewsCopy.textContent = '⧉';
      this.viewsBtn = el('button', { class: 'pill', type: 'button', 'data-metric': 'views' }, [
        el('span', { class: 'lbl', text: 'Avg Views' }),
        this.viewsVal,
        this.viewsCopy,
      ]);

      this.engVal = el('span', { class: 'val empty' });
      this.engCopy = el('span', { class: 'copy', title: 'Copy the displayed value', role: 'button' });
      this.engCopy.textContent = '⧉';
      this.engBtn = el('button', { class: 'pill', type: 'button', 'data-metric': 'engagement' }, [
        el('span', { class: 'lbl', text: 'Engagement' }),
        this.engVal,
        this.engCopy,
      ]);

      // An ACTION, not a metric: no data-metric, no tab or selection
      // semantics, never opens the audit panel. It lives in the Ternary House
      // bar, never in YouTube's own Latest / Popular / Oldest chip row.
      this.exportLabel = el('span', { class: 'lbl', text: EXPORT_TEXT.IDLE });
      this.exportBtn = el('button', {
        class: 'pill thq-export',
        type: 'button',
        title: 'Copy the URLs of the 12 newest Videos-tab uploads',
      }, [this.exportLabel]);

      this.refreshBtn = el('button', { class: 'icon', type: 'button', title: 'Recalculate this channel' });
      this.refreshBtn.textContent = '⟳';

      this.toast = el('span', { class: 'toast' });

      this.viewsBtn.addEventListener('click', (e) => this.onPillClick(e, 'views'));
      this.engBtn.addEventListener('click', (e) => this.onPillClick(e, 'engagement'));
      // The clipboard is derived from the text the control is actually
      // showing, read at click time. Display and clipboard therefore cannot
      // drift apart: "6M" -> "6M", "6.2K*" -> "6.2K*", "2.01%" -> "2.01",
      // "4.00%*" -> "4.00*", "insufficient" -> "insufficient".
      bindCopyControl(
        this.viewsCopy,
        () => compactCopyValue(this.viewsVal.textContent, 'views'),
        (text) => this.copyValue(text),
      );
      bindCopyControl(
        this.engCopy,
        () => compactCopyValue(this.engVal.textContent, 'engagement'),
        (text) => this.copyValue(text),
      );
      this.exportBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onExportClick();
      });
      this.refreshBtn.addEventListener('click', () => {
        this.invalidateExport();
        this.run(true);
      });

      this.bar = el('div', { class: 'bar' }, [
        el('span', { class: 'brand', text: 'TH' }),
        this.viewsBtn,
        this.engBtn,
        this.exportBtn,
        this.refreshBtn,
        this.toast,
      ]);

      this.panel = el('div', { class: 'panel' });
      this.barHost.thqWrap.appendChild(this.bar);
      this.panelHost.thqWrap.appendChild(this.panel);
    }

    destroy() {
      this.token = Symbol('dead');
      if (this.exporter) this.exporter.invalidate();
      clearTimeout(this._exportLabelTimer);
      for (const host of [this.barHost, this.panelHost]) {
        if (host && host.parentNode) host.parentNode.removeChild(host);
      }
    }

    get alive() {
      return current === this && this.barHost.isConnected;
    }

    /**
     * The single clipboard path for every copy affordance. Never throws and
     * never fails silently: the operator always gets a visible result.
     */
    async copyValue(text) {
      if (text === null || text === undefined || text === '') {
        this.showCopyResult({ ok: false, text: null, reason: 'NOTHING_TO_COPY' });
        return false;
      }
      const value = String(text);
      let ok = false;
      try {
        ok = await copyToClipboard(value);
      } catch {
        ok = false;
      }
      this.showCopyResult({ ok, text: value, reason: ok ? null : 'CLIPBOARD_FAILED' });
      return ok;
    }

    showCopyResult(result) {
      const feedback = copyFeedback(result);
      this.toast.textContent = feedback.text;
      this.toast.classList.toggle('fail', feedback.failed);
      this.toast.classList.add('on');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.toast.classList.remove('on'), 1800);
    }

    /* ---------------- "Copy 12 URLs" ---------------- */

    createExporter() {
      return createUrlExporter({
        isLatest: () => checkLatestOrdering(this.route).latest,
        scopeKey: () => this.exportScopeKey(),
        isAlive: () => this.alive,
        readEntries: () => readGridEntries(findGrid()),
        loadMore: (options) => loadMoreGridItems(options),
        saveScroll: () => window.scrollY,
        restoreScroll: (y) => window.scrollTo({ top: y, behavior: 'auto' }),
        copy: (text) => copyToClipboard(text),
        lock: this.domLock,
        readyTtlMs: EXPORT_READY_TTL_MS,
      });
    }

    /** The creator surface a prepared export belongs to. */
    exportScopeKey() {
      const route = parseChannelRoute(location.href);
      if (!isVideosRoute(route) || route.base !== this.route.base) return 'off-route';
      return `${route.base}/${route.tab}|${this.identity.channelKey}`;
    }

    async onExportClick() {
      if (this.exporter.running) return;
      clearTimeout(this._exportLabelTimer);
      this.setExportLabel(EXPORT_TEXT.WORKING);
      this.exportBtn.setAttribute('disabled', '');
      let result;
      try {
        result = await this.exporter.click();
      } finally {
        this.exportBtn.removeAttribute('disabled');
      }
      if (!this.alive) return;
      this.showExportResult(result);
    }

    showExportResult(result) {
      const text = exportButtonText(result);
      if (text === null) return;
      this.setExportLabel(text);
      clearTimeout(this._exportLabelTimer);
      if (result.status === 'READY') {
        // The label follows the prepared block's lifetime.
        this._exportLabelTimer = setTimeout(() => this.invalidateExport(), EXPORT_READY_TTL_MS);
        return;
      }
      this._exportLabelTimer = setTimeout(() => this.setExportLabel(EXPORT_TEXT.IDLE), EXPORT_LABEL_RESET_MS);
    }

    invalidateExport() {
      if (!this.exporter) return;
      const hadPrepared = this.exporter.hasPrepared;
      this.exporter.invalidate();
      if (hadPrepared) {
        clearTimeout(this._exportLabelTimer);
        this.setExportLabel(EXPORT_TEXT.IDLE);
      }
    }

    setExportLabel(text) {
      if (this.exportLabel) this.exportLabel.textContent = text;
    }

    onPillClick(event, metric) {
      if (event.target.classList.contains('copy')) return;
      if (this.busy) return;
      if (!this.result && !this.error) {
        this.run(false, metric);
        return;
      }
      if (this.openPanel === metric) this.hidePanel();
      else this.showPanel(metric);
    }

    setLoading() {
      this.busy = true;
      this.viewsVal.textContent = LOADING_TEXT;
      this.engVal.textContent = LOADING_TEXT;
      this.viewsVal.classList.remove('empty');
      this.engVal.classList.remove('empty');
      this.viewsCopy.classList.remove('on');
      this.engCopy.classList.remove('on');
      this.viewsBtn.setAttribute('disabled', '');
      this.engBtn.setAttribute('disabled', '');
    }

    clearLoading() {
      this.busy = false;
      this.viewsBtn.removeAttribute('disabled');
      this.engBtn.removeAttribute('disabled');
    }

    /** One retrieval powers both controls. */
    async run(force, focusMetric) {
      const token = this.token;
      this.result = null;
      this.error = null;
      this.setLoading();

      const ordering = checkLatestOrdering(this.route);
      if (!ordering.latest) {
        if (token !== this.token) return;
        this.failWith({ code: 'NOT_LATEST', message: ordering.message }, focusMetric);
        return;
      }

      let videoIds = [];
      try {
        // Same collector, same 30-candidate pool. The lock only stops it
        // scrolling at the same time as a URL-export top-up.
        videoIds = await this.domLock.run('metrics', () => collectVideoIds(this.grid));
      } catch {
        videoIds = [];
      }
      if (token !== this.token) return;

      if (!videoIds.length) {
        this.failWith(
          { code: 'NO_VIDEO_IDS', message: 'Could not confidently identify recent videos. Make sure the Videos tab has loaded.' },
          focusMetric,
        );
        return;
      }

      const response = await sendMessage('ANALYZE', {
        channelKey: this.identity.channelKey,
        channelIdHint: this.identity.channelId,
        videoIds,
        // Surface is the primary format signal. These ids came from the
        // channel's Videos -> Latest grid and nowhere else.
        sourceSurface: 'videos_grid',
        force: Boolean(force),
      });
      if (token !== this.token) return;

      this.clearLoading();

      if (!response.ok) {
        this.failWith(response.error, focusMetric);
        return;
      }

      this.result = response.result;
      this.renderValues();
      this.showPanel(focusMetric || this.openPanel || 'views');
    }

    failWith(error, focusMetric) {
      this.clearLoading();
      this.error = error;
      this.viewsVal.textContent = ERROR_TEXT;
      this.engVal.textContent = ERROR_TEXT;
      this.viewsCopy.classList.remove('on');
      this.engCopy.classList.remove('on');
      this.showPanel(focusMetric || 'views');
    }

    renderValues() {
      const r = this.result;
      const avg = r.avgViews;

      this.viewsBtn.removeAttribute('title');

      this.viewsVal.textContent = compactAvgViewsText(avg);
      if (avg.status === 'SMALL_SAMPLE') {
        this.viewsBtn.title = 'Small sample — manual outlier review recommended';
      } else if (avg.status === 'INSUFFICIENT') {
        this.viewsBtn.title = 'Insufficient recent sample — inspect older context';
      } else if (avg.status !== 'OK') {
        this.viewsBtn.title = 'No eligible long-form videos in the last 3 months';
      }
      this.viewsVal.classList.remove('empty');

      this.engVal.textContent = r.engagement.compact;
      this.engVal.classList.remove('empty');

      // Every real display state is copyable, numeric or not. The tooltip
      // names exactly what will land on the clipboard.
      this.setCopyAffordance(this.viewsCopy, compactCopyValue(this.viewsVal.textContent, 'views'));
      this.setCopyAffordance(this.engCopy, compactCopyValue(this.engVal.textContent, 'engagement'));
    }

    setCopyAffordance(node, value) {
      if (value) {
        node.classList.add('on');
        node.title = `Copy ${value}`;
      } else {
        node.classList.remove('on');
        node.title = 'Copy the displayed value';
      }
    }

    hidePanel() {
      this.openPanel = null;
      this.panelHost.hidden = true;
      this.panel.textContent = '';
    }

    showPanel(metric) {
      this.openPanel = metric;
      this.panel.textContent = '';
      this.panelHost.hidden = false;

      const close = el('button', { class: 'icon close', type: 'button', title: 'Close details' });
      close.textContent = '✕';
      close.addEventListener('click', () => this.hidePanel());
      this.panel.appendChild(close);

      if (this.error) {
        drawErrorPanel(this.panel, this.error, this.renderContext());
        return;
      }

      if (!this.result) return;
      if (metric === 'engagement') this.renderEngagementPanel();
      else this.renderAvgViewsPanel();
    }


    renderAvgViewsPanel() {
      drawAvgViewsPanel(this.panel, this.result, this.renderContext());
    }

    renderEngagementPanel() {
      drawEngagementPanel(this.panel, this.result, this.renderContext());
    }

    renderContext() {
      return {
        onCopy: (text) => this.copyValue(text),
        onOpenSettings: () => sendMessage('OPEN_OPTIONS', {}),
      };
    }
  }

  /* ================================================================== *
   * Mounting and SPA navigation
   * ================================================================== */

  const HEADER_SELECTORS = [
    'ytd-browse[page-subtype="channels"] yt-flexible-actions-view-model',
    'ytd-browse[page-subtype="channels"] .page-header-view-model-wiz__page-header-headline-info',
    'ytd-browse[page-subtype="channels"] #channel-header #inner-header-container #buttons',
    'ytd-browse[page-subtype="channels"] #channel-header-container #buttons',
  ];

  function findMountPoint() {
    for (const selector of HEADER_SELECTORS) {
      const node = document.querySelector(selector);
      if (node) return { node, mode: 'append' };
    }
    const chipBar = document.querySelector('ytd-browse[page-subtype="channels"] chip-bar-view-model')
      || document.querySelector('ytd-browse[page-subtype="channels"] ytd-feed-filter-chip-bar-renderer');
    if (chipBar && chipBar.parentNode) return { node: chipBar, mode: 'before' };
    const grid = findGrid();
    if (grid && grid.parentNode) return { node: grid, mode: 'before' };
    return null;
  }

  function removeStrayHosts() {
    for (const stray of document.querySelectorAll(`.${HOST_CLASS}`)) stray.remove();
  }

  function teardown() {
    if (current) current.destroy();
    current = null;
    removeStrayHosts();
  }

  let mountTimer = null;
  let mountDeadline = 0;

  function stopMounting() {
    if (mountTimer) { clearTimeout(mountTimer); mountTimer = null; }
  }

  function tryMount(route) {
    stopMounting();
    if (location.href.indexOf(route.base) === -1) return;

    const grid = findGrid();
    const mount = findMountPoint();

    if (!grid || !mount) {
      if (Date.now() < mountDeadline) mountTimer = setTimeout(() => tryMount(route), MOUNT_POLL_MS);
      return;
    }

    teardown();
    const identity = detectChannelIdentity(route);
    current = new Controller(route, identity, grid, mount);
    probeStorageIsolation();
  }

  let lastHref = null;

  function syncPage() {
    const href = location.href;
    const route = parseChannelRoute(href);

    if (!isVideosRoute(route)) {
      stopMounting();
      teardown();
      lastHref = href;
      return;
    }

    // Same surface and the UI is still attached: nothing to do.
    if (href === lastHref && current && current.alive) return;

    lastHref = href;
    stopMounting();
    teardown();
    mountDeadline = Date.now() + MOUNT_TIMEOUT_MS;
    tryMount(route);
  }

  let syncTimer = null;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncPage, 150);
  }

  // Targeted YouTube navigation events first.
  document.addEventListener('yt-navigate-finish', scheduleSync);
  document.addEventListener('yt-page-data-updated', scheduleSync);
  window.addEventListener('popstate', scheduleSync);

  // Restrained fallback: observe only the <title> node, which YouTube
  // rewrites on every SPA navigation. No page-wide observer.
  const titleNode = document.querySelector('head > title');
  if (titleNode) {
    new MutationObserver(scheduleSync).observe(titleNode, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  scheduleSync();
})();
