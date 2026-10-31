/**
 * Ternary House YouTube Qualifier — content script.
 *
 * Responsibilities, and nothing else:
 *   1. decide whether this page is a usable channel "Videos" surface;
 *   2. discover the recent long-form video ids in page order;
 *   3. ask the service worker for one analysis;
 *   4. render the two compact controls and their audit panels;
 *   5. host the three page-only exports — "Copy 12 URLs", "Copy Channel
 *      Details" and "Copy all video URLs" (content/video-selection.js,
 *      content/url-export.js, content/channel-details.js) — which read the
 *      page and need no API, key or service-worker call.
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
   * Surfaces where the loaded-card exports run. The Videos tab also carries
   * the metrics and the 12-video exports; the others get the two inventory
   * buttons only. `slug` names the tab in the descriptions file name.
   */
  const INVENTORY_TABS = Object.freeze({
    videos: { label: 'Videos', slug: 'videos' },
    shorts: { label: 'Shorts', slug: 'shorts' },
    streams: { label: 'Live', slug: 'live' },
    podcasts: { label: 'Podcasts', slug: 'podcasts' },
    playlist: { label: 'Podcast episodes / playlist', slug: 'playlist' },
  });

  /** A supported channel tab, or a playlist page (podcast episode lists). */
  function parsePageRoute(href) {
    const channel = parseChannelRoute(href);
    if (channel) return INVENTORY_TABS[channel.tab] ? { ...channel, kind: 'channel' } : null;
    let url;
    try { url = new URL(href); } catch { return null; }
    if (url.hostname !== 'www.youtube.com' || url.pathname !== '/playlist') return null;
    const list = url.searchParams.get('list');
    if (!list || !/^[A-Za-z0-9_-]{2,64}$/.test(list)) return null;
    return { kind: 'playlist', base: `playlist?list=${list}`, tab: 'playlist', listId: list, sortParam: null };
  }

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

  /**
   * The active chip and its text, for labelling the general URL export only.
   * Same chips and selection rule as readSortChips(), which the Latest guard
   * keeps using unchanged.
   */
  function readSortChipState() {
    for (const selector of SORT_CHIP_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length > 1) {
        const selectedIndex = nodes.findIndex((node) => (
          node.getAttribute('aria-selected') === 'true'
          || node.hasAttribute('selected')
          || Boolean(node.querySelector('[aria-selected="true"]'))
        ));
        const selected = selectedIndex >= 0 ? nodes[selectedIndex] : null;
        return { count: nodes.length, selectedIndex, selectedText: selected ? selected.textContent : '' };
      }
    }
    return null;
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

  const PLAYLIST_GRID_SELECTOR = 'ytd-browse[page-subtype="playlist"] ytd-playlist-video-list-renderer';

  function firstVisible(selector) {
    for (const node of document.querySelectorAll(selector)) {
      if (!node.closest('[hidden]')) return node;
    }
    return null;
  }

  /** The grid the inventory exports read: the visible one for this surface. */
  function findInventoryGrid(route) {
    if (route && route.kind === 'playlist') return firstVisible(PLAYLIST_GRID_SELECTOR);
    for (const selector of GRID_SELECTORS) {
      const node = firstVisible(selector);
      if (node) return node;
    }
    return null;
  }

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
    STYLES, applyStyles, el, copyText: copyToClipboard, copyRich, bindCopyControl, copyFeedback,
    compactAvgViewsText, compactCopyValue, LOADING_TEXT, ERROR_TEXT,
    renderAvgViewsPanel: drawAvgViewsPanel,
    renderEngagementPanel: drawEngagementPanel,
    renderErrorPanel: drawErrorPanel,
  } = self.THQRender;

  /* ================================================================== *
   * Page-only exports — content/video-selection.js, content/url-export.js
   * and content/channel-details.js, loaded before this file.
   *
   * Separate pipelines from the metrics. They never call collectVideoIds(),
   * never change TARGET_CANDIDATES, and never send ANALYZE.
   * ================================================================== */

  const { sortLabelFromChips, visibleText } = self.THQVideoSelection;
  const {
    EXPORT_TEXT, ALL_URLS_TEXT, readGridEntries, readLoadedVideoUrls, createDomLock,
    createUrlExporter, createAllUrlsExporter, exportButtonText, allUrlsButtonText,
    createDescriptionsExporter, descriptionsButtonText, descriptionsJobText, DESCRIPTIONS_TEXT,
  } = self.THQUrlExport;
  const {
    DETAILS_TEXT, findChannelHeader, readChannelHeader, createDetailsFormat, detailsButtonText,
    resolveChannelIdentity,
  } = self.THQChannelDetails;

  /** Clipboard: plain text always; clickable links too when html is given. */
  const copyExport = (text, html) => (html ? copyRich(text, html) : copyToClipboard(text));

  const DESCRIPTIONS_POLL_MS = 1000;
  const DESCRIPTIONS_RESULT_MS = 15000;

  /** Owner channel and title of a playlist page, as far as the page shows them. */
  function readPlaylistContext(route) {
    const root = document.querySelector('ytd-browse[page-subtype="playlist"]');
    const out = {
      playlistId: route.listId,
      playlistUrl: `https://www.youtube.com/playlist?list=${route.listId}`,
      playlistTitle: null, channelName: null, channelUrl: null, channelHandle: null,
    };
    if (root) {
      const outsideList = (node) => !node.closest('ytd-playlist-video-list-renderer');
      const h1 = Array.from(root.querySelectorAll('h1')).find(outsideList);
      out.playlistTitle = h1 ? visibleText(h1) || null : null;
      const owner = Array.from(root.querySelectorAll('a[href^="/@"], a[href^="/channel/"]')).find((a) => outsideList(a) && visibleText(a));
      if (owner) {
        const path = owner.getAttribute('href').split(/[?#]/)[0];
        out.channelName = visibleText(owner).replace(/^by\s+/i, '') || null;
        out.channelUrl = `https://www.youtube.com${path}`;
        const handle = /^\/(@[^/]+)/.exec(path);
        if (handle) { try { out.channelHandle = decodeURIComponent(handle[1]); } catch { out.channelHandle = handle[1]; } }
      }
    }
    if (!out.playlistTitle) {
      const m = /^(?:\(\d+\+?\)\s*)?(.+?)\s+-\s+YouTube$/.exec(document.title.trim());
      out.playlistTitle = m ? m[1] : null;
    }
    return out;
  }

  const EXPORT_STEP_TIMEOUT_MS = 2500;
  const EXPORT_SETTLE_MS = 250;
  const EXPORT_LABEL_RESET_MS = 2500;
  const EXPORT_NOTICE_RESET_MS = 6000;
  const EXPORT_READY_TTL_MS = 60000;

  /** The installed build, recorded in the evidence block. Null if unavailable. */
  function extensionVersion() {
    try {
      const manifest = chrome.runtime.getManifest();
      return manifest.version_name || manifest.version || null;
    } catch {
      return null;
    }
  }

  /** Operator-facing explanation of an export refusal, shown as a tooltip. */
  function exportResultDetail(result) {
    switch (result && result.status) {
      case 'REVIEW_STATUS': {
        const b = result.blocked;
        if (!b) return 'A selected video card could not be read completely. Nothing was copied.';
        const seen = b.evidence ? ` It shows: "${b.evidence}".` : '';
        return `Grid card ${b.gridPosition} (${b.videoId}): its published/scheduled/live status could not be confirmed (${b.basis}).${seen} Nothing was copied — check that card, then retry.`;
      }
      case 'REVIEW_ORDER': {
        const a = result.anomaly;
        return `Grid card ${a.gridPosition} (${a.videoId}) shows "${a.publishedText}" below an older "${a.after}". The grid is not in date order, so the newest 12 cannot be taken from it. Nothing was copied.`;
      }
      case 'INSUFFICIENT':
        return `Only ${result.count || 0} published videos could be read. Scroll the grid and retry; if the grid has ended, the channel may have fewer. Nothing was copied.`;
      case 'CHANNEL_UNCLEAR':
        return `The channel header did not match this page (${(result.problems || []).join(', ')}). Reload the page and retry. Nothing was copied.`;
      case 'NOT_READY':
        return `Grid card(s) ${result.unresolved.map((u) => u.position).join(', ')} have not finished rendering. Wait a moment and retry. Nothing was copied.`;
      case 'NONE':
        return result.nonVideo
          ? 'The loaded cards are not individual videos (on the Podcasts tab they are podcast playlists). Open a podcast, then use this button on its episode list.'
          : 'No video cards are loaded on this page.';
      case 'START_FAILED':
      case 'JOB_BUSY':
        return result.error ? result.error.message : null;
      case 'COPIED':
        if (result.inventory) {
          const inv = result.inventory;
          const extra = [
            inv.duplicates ? `${inv.duplicates} duplicate card(s) ignored` : null,
            inv.shorts ? `${inv.shorts} Shorts card(s) ignored` : null,
            inv.nonVideo ? `${inv.nonVideo} non-video card(s) ignored` : null,
          ].filter(Boolean).join('; ');
          return `${result.count} unique video URLs from ${inv.cardCount} loaded grid card(s). Sort: ${result.sort}.${extra ? ` ${extra}.` : ''} Only cards loaded on the page are included.`;
        }
        return null;
      default:
        return null;
    }
  }

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
    constructor(route, identity, grid, barMount, mode = 'full') {
      this.route = route;
      this.mode = mode;
      this.identity = identity;
      this.grid = grid;
      this.token = Symbol('page');
      this.result = null;
      this.error = null;
      this.busy = false;
      this.openPanel = null;

      // Page-scrolling work (metric candidate top-up, URL top-up) takes turns.
      this.domLock = createDomLock();

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
      this.checkDescriptionJob();
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

    /** Copy all video URLs and Download all video descriptions: one inventory. */
    buildInventoryActions() {
      const surface = this.mode === 'full' ? 'Videos grid' : 'page';
      const noneLabel = (fallback) => (r) => (r && r.status === 'NONE' && this.route.tab === 'podcasts'
        ? 'Open a podcast to export its episodes' : fallback(r));
      this.allAction = this.makeAction({
        idleText: ALL_URLS_TEXT.IDLE,
        workingText: ALL_URLS_TEXT.IDLE,
        title: `Copy every video URL currently loaded on this ${surface}, in on-page order (any sort; no scrolling)`,
        exporter: createAllUrlsExporter({
          isAlive: () => this.alive,
          onVideosRoute: () => this.exportScopeKey() !== 'off-route',
          isBusy: () => this.domLock.holder !== null,
          readInventory: () => this.readInventory(),
          readSort: () => this.sortLabel(),
          copy: copyExport,
        }),
        textFor: noneLabel(allUrlsButtonText),
      });
      this.descAction = this.makeAction({
        idleText: DESCRIPTIONS_TEXT.IDLE,
        workingText: 'Starting…',
        title: 'Download the descriptions of every video currently loaded on this page as a UTF-8 .txt file (YouTube Data API; continues in the background)',
        exporter: createDescriptionsExporter({
          isAlive: () => this.alive,
          onVideosRoute: () => this.exportScopeKey() !== 'off-route',
          isBusy: () => this.domLock.holder !== null,
          readInventory: () => this.readInventory(),
          readContext: () => this.descriptionContext(),
          start: (snapshot) => sendMessage('DESCRIPTIONS_START', snapshot),
        }),
        textFor: noneLabel(descriptionsButtonText),
        onResult: (result) => {
          if (result.status === 'STARTED' || result.status === 'JOB_BUSY') this.watchDescriptions();
        },
      });
    }

    readInventory() {
      return readLoadedVideoUrls(findInventoryGrid(this.route), { allowShorts: this.route.tab === 'shorts' });
    }

    sortLabel() {
      return this.route.kind === 'playlist' ? 'Playlist order' : sortLabelFromChips(readSortChipState());
    }

    /** What the descriptions file says about where its videos came from. */
    descriptionContext() {
      const tab = INVENTORY_TABS[this.route.tab] || INVENTORY_TABS.videos;
      const ctx = { tab: tab.slug, tabLabel: tab.label, sort: this.sortLabel() };
      if (this.route.kind === 'playlist') return { ...ctx, ...readPlaylistContext(this.route) };
      const identity = resolveChannelIdentity({
        header: readChannelHeader(findChannelHeader(document)),
        route: parseChannelRoute(location.href),
        documentTitle: document.title,
      });
      return {
        ...ctx,
        channelName: identity.channel.channel_name,
        channelUrl: identity.channel.channel_url,
        channelHandle: identity.channel.channel_handle,
      };
    }

    /** Show a running (or just finished) background job on this page's button. */
    async checkDescriptionJob() {
      const response = await sendMessage('DESCRIPTIONS_STATUS', {});
      const job = response && response.ok ? response.job : null;
      if (job && (job.state === 'running' || job.state === 'downloading') && this.alive) this.watchDescriptions();
    }

    watchDescriptions() {
      const action = this.descAction;
      clearTimeout(this._descPoll);
      const tick = async () => {
        if (!this.alive) return;
        const response = await sendMessage('DESCRIPTIONS_STATUS', {});
        if (!this.alive) return;
        const job = response && response.ok ? response.job : null;
        clearTimeout(action.timer);
        if (!job) { this.setActionLabel(action, action.idleText); return; }
        const label = descriptionsJobText(job);
        if (label) this.setActionLabel(action, label, this.descriptionsDetail(job));
        if (job.state === 'running' || job.state === 'downloading') {
          this._descPoll = setTimeout(tick, DESCRIPTIONS_POLL_MS);
        } else {
          action.timer = setTimeout(() => this.setActionLabel(action, action.idleText), DESCRIPTIONS_RESULT_MS);
        }
      };
      tick();
    }

    descriptionsDetail(job) {
      const c = job.counts;
      if (job.state === 'done' && c) {
        return `Saved ${job.filename}: ${c.retrieved} with descriptions, ${c.empty} empty, ${c.missing} missing/failed (listed under # MISSING).`;
      }
      if (job.error) return `${job.error.message}${job.error.detail ? ` (${job.error.detail})` : ''}`;
      if (job.state === 'running') return `Fetching descriptions for ${job.total} videos captured at click time. You can leave this page.`;
      return null;
    }

    buildControls() {
      this.buildInventoryActions();
      if (this.mode === 'inventory') {
        this.toast = el('span', { class: 'toast' });
        this.actions = [this.allAction, this.descAction];
        for (const action of this.actions) {
          action.btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.onActionClick(action);
          });
        }
        this.bar = el('div', { class: 'bar' }, [
          el('span', { class: 'brand', text: 'TH' }),
          this.allAction.btn,
          this.descAction.btn,
          this.toast,
        ]);
        this.panel = el('div', { class: 'panel' });
        this.barHost.thqWrap.appendChild(this.bar);
        this.panelHost.thqWrap.appendChild(this.panel);
        return;
      }

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

      // ACTIONS, not metrics: no data-metric, no tab or selection semantics,
      // never open the audit panel. They live in the Ternary House bar, never
      // in YouTube's own Latest / Popular / Oldest chip row. Copy 12 URLs and
      // Copy Channel Details share one selector; Copy all video URLs is the
      // separate, sort-agnostic inventory of loaded cards.
      this.urlsAction = this.makeAction({
        idleText: EXPORT_TEXT.IDLE,
        workingText: EXPORT_TEXT.WORKING,
        title: 'Copy the URLs of the 12 newest published Videos-tab uploads (Latest only)',
        exporter: this.createLatestExporter('export'),
        textFor: exportButtonText,
      });
      this.detailsAction = this.makeAction({
        idleText: DETAILS_TEXT.IDLE,
        workingText: DETAILS_TEXT.WORKING,
        title: 'Copy the channel details and the same 12 published videos as one JSON evidence block (Latest only)',
        exporter: this.createLatestExporter('details', createDetailsFormat({
          readPage: () => ({
            header: readChannelHeader(findChannelHeader(document)),
            route: parseChannelRoute(location.href),
            documentTitle: document.title,
          }),
          now: () => Date.now(),
          utcOffsetMinutes: (ms) => -new Date(ms).getTimezoneOffset(),
          toolVersion: extensionVersion(),
        })),
        textFor: detailsButtonText,
      });
      this.actions = [this.urlsAction, this.detailsAction, this.allAction, this.descAction];

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
      for (const action of this.actions) {
        action.btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.onActionClick(action);
        });
      }
      this.refreshBtn.addEventListener('click', () => {
        this.invalidateExports();
        this.run(true);
      });

      this.bar = el('div', { class: 'bar' }, [
        el('span', { class: 'brand', text: 'TH' }),
        this.viewsBtn,
        this.engBtn,
        this.urlsAction.btn,
        this.detailsAction.btn,
        this.allAction.btn,
        this.descAction.btn,
        this.refreshBtn,
        this.toast,
      ]);

      this.panel = el('div', { class: 'panel' });
      this.barHost.thqWrap.appendChild(this.bar);
      this.panelHost.thqWrap.appendChild(this.panel);
    }

    destroy() {
      this.token = Symbol('dead');
      clearTimeout(this._descPoll);
      for (const action of this.actions || []) {
        if (action.exporter.invalidate) action.exporter.invalidate();
        clearTimeout(action.timer);
      }
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

    showNote(text, failed = false) {
      this.toast.textContent = text;
      this.toast.classList.toggle('fail', failed);
      this.toast.classList.add('on');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.toast.classList.remove('on'), EXPORT_NOTICE_RESET_MS);
    }

    /* ------------- Copy 12 URLs / Channel Details / all URLs ------------- */

    makeAction({ idleText, workingText, title, exporter, textFor, onResult }) {
      const label = el('span', { class: 'lbl', text: idleText });
      const btn = el('button', { class: 'pill thq-export', type: 'button', title }, [label]);
      return { btn, label, idleText, workingText, idleTitle: title, exporter, textFor, onResult, timer: null };
    }

    /** Copy 12 URLs and Copy Channel Details: same deps, different output. */
    createLatestExporter(name, format) {
      return createUrlExporter({
        name,
        format,
        isLatest: () => checkLatestOrdering(this.route).latest,
        scopeKey: () => this.exportScopeKey(),
        isAlive: () => this.alive,
        readEntries: () => readGridEntries(findGrid()),
        loadMore: (options) => loadMoreGridItems(options),
        saveScroll: () => window.scrollY,
        restoreScroll: (y) => window.scrollTo({ top: y, behavior: 'auto' }),
        copy: copyExport,
        lock: this.domLock,
        readyTtlMs: EXPORT_READY_TTL_MS,
      });
    }

    /** The creator surface a prepared export belongs to. */
    exportScopeKey() {
      const route = parsePageRoute(location.href);
      if (!route || route.base !== this.route.base || route.tab !== this.route.tab) return 'off-route';
      return `${route.base}/${route.tab}|${this.identity.channelKey}`;
    }

    /**
     * The exporter is invoked synchronously from the click, so an export that
     * needs no loading (always the case for Copy all video URLs) starts its
     * clipboard write inside the click's user activation.
     */
    async onActionClick(action) {
      if (action.exporter.running) return;
      clearTimeout(action.timer);
      this.setActionLabel(action, action.workingText);
      action.btn.setAttribute('disabled', '');
      let result;
      try {
        result = await action.exporter.click();
      } finally {
        action.btn.removeAttribute('disabled');
      }
      if (!this.alive) return;
      this.showActionResult(action, result);
      if (action.onResult && result) action.onResult(result);
    }

    showActionResult(action, result) {
      const text = action.textFor(result);
      if (text === null) return;
      this.setActionLabel(action, text, exportResultDetail(result));
      clearTimeout(action.timer);
      if (result.status === 'COPIED' && result.excludedCount) {
        const n = result.excludedCount;
        this.showNote(`Skipped ${n} upcoming/live video${n === 1 ? '' : 's'} (not published)`);
      }
      if (result.status === 'READY') {
        // The label follows the prepared block's lifetime.
        action.timer = setTimeout(() => this.invalidateAction(action), EXPORT_READY_TTL_MS);
        return;
      }
      const resetMs = result.status === 'COPIED' ? EXPORT_LABEL_RESET_MS : EXPORT_NOTICE_RESET_MS;
      action.timer = setTimeout(() => this.setActionLabel(action, action.idleText), resetMs);
    }

    /** Discard one button's prepared block (expiry) and reset its label. */
    invalidateAction(action) {
      if (!action.exporter.invalidate) return;
      const hadPrepared = action.exporter.hasPrepared;
      action.exporter.invalidate();
      if (hadPrepared) {
        clearTimeout(action.timer);
        this.setActionLabel(action, action.idleText);
      }
    }

    /** Discard every prepared block (refresh). */
    invalidateExports() {
      for (const action of this.actions || []) this.invalidateAction(action);
    }

    setActionLabel(action, text, tooltip) {
      action.label.textContent = text;
      action.btn.title = tooltip || action.idleTitle;
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

    const mode = isVideosRoute(route) ? 'full' : 'inventory';
    const grid = mode === 'full' ? findGrid() : findInventoryGrid(route);
    const mount = route.kind === 'playlist'
      ? (grid && grid.parentNode ? { node: grid, mode: 'before' } : null)
      : findMountPoint();

    if (!grid || !mount) {
      if (Date.now() < mountDeadline) mountTimer = setTimeout(() => tryMount(route), MOUNT_POLL_MS);
      return;
    }

    teardown();
    const identity = detectChannelIdentity(route);
    current = new Controller(route, identity, grid, mount, mode);
    probeStorageIsolation();
  }

  let lastHref = null;

  function syncPage() {
    const href = location.href;
    const route = parsePageRoute(href);

    if (!route) {
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
