/**
 * Ternary House YouTube Qualifier — shared Videos-grid card reader.
 *
 * One place that knows how to read a creator's Videos-tab grid cards, used by
 * every export:
 *
 *   - Copy 12 URLs and Copy Channel Details share ONE publication-aware
 *     selector, selectEligibleVideos(), so they cannot disagree on which 12
 *     videos, in which order.
 *   - Copy all video URLs uses readLoadedVideoUrls(), a deliberately different
 *     inventory of every loaded watch link. It shares the URL primitives and
 *     the card selector, never the 12-video eligibility rules.
 *
 * Publication state is read from the card itself, never from the title:
 *
 *   PUBLISHED_COMPLETED  the card shows a published age ("3 days ago",
 *                        "Premiered 3 days ago", "Streamed 2 years ago") and
 *                        nothing contradicting it. Live YouTube (Oct 2026)
 *                        displays an abbreviated age ("2h ago") on a
 *                        role="text" span whose aria-label holds the full
 *                        form ("2 hours ago"); that label is read as the
 *                        span's accessible text. An abbreviated age with no
 *                        readable full form is never assumed published.
 *   SCHEDULED_UPCOMING   "Premieres ...", "Scheduled for ...", "Upcoming",
 *                        "N waiting" or a card-scoped "Notify me" control.
 *   LIVE_NOW             "LIVE", "Live now", "N watching", "Premiering now".
 *   INDETERMINATE        anything else: no status text, conflicting signals,
 *                        links that disagree, no readable title. Callers fail
 *                        closed on it; it is never treated as published.
 *
 * The status words are YouTube's English UI strings, as shown in the operator
 * screenshots the v1.2 brief records. v1.1.0's live investigation found no
 * structural attribute that separates a scheduled card from a published one,
 * so the text is the signal. In any other UI language nothing matches and the
 * exports fail visibly ("Review video status") instead of guessing.
 *
 * A CLASSIC script (not an ES module), loaded before content/url-export.js.
 * The only DOM access is read-only; everything else is pure and testable.
 */

(() => {
  'use strict';

  const WATCH_BASE = 'https://www.youtube.com/watch?v=';
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);

  /** Same item selector the metric harvester uses, so every reader sees one surface. */
  const ITEM_SELECTOR = 'ytd-rich-item-renderer, ytd-grid-video-renderer';
  /** Upper bound on grid items inspected by the 12-video selector. Never a crawl. */
  const MAX_ITEMS_READ = 60;

  const STATE = Object.freeze({
    PUBLISHED: 'PUBLISHED_COMPLETED',
    SCHEDULED: 'SCHEDULED_UPCOMING',
    LIVE: 'LIVE_NOW',
    INDETERMINATE: 'INDETERMINATE',
  });

  const SORT_LABELS = Object.freeze(['Latest', 'Popular', 'Oldest']);

  /* ------------------------------------------------------------------ *
   * Identity
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

  /* ------------------------------------------------------------------ *
   * Card status text (pure)
   * ------------------------------------------------------------------ */

  /** For matching: every Unicode space (NBSP, narrow NBSP, ...) becomes one space. */
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  /** For reporting: only markup whitespace is collapsed; NBSP / narrow NBSP are kept. */
  const tidy = (s) => String(s == null ? '' : s).replace(/[ \t\n\r\f]+/g, ' ').trim();

  /** Card text parts are split on YouTube's metadata delimiters. */
  const DELIMITER_RE = /\s*[•·‧|]\s*/;

  const PUBLISHED_RE = /^(?:(streamed|premiered)\s+)?(\d+|an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i;
  const SCHEDULED_RES = [
    /^premieres\b/i,
    /^scheduled for\b/i,
    /^upcoming$/i,
    /^premiere$/i,
    /^notify me$/i,
    /^[\d.,]+\s*[KMB]?\s+waiting$/i,
  ];
  const LIVE_RES = [
    /^[\d.,]+\s*[KMB]?\s+watching(?:\s+now)?$/i,
    /^premiering now$/i,
    /^live now$/i,
    /^live$/i,
  ];
  /** Something that reads as a relative age but is not a recognised full form ("2h ago"). */
  const AGE_LIKE_RE = /\bago$/i;
  /** A runtime badge such as "0:58", "10:15" or "1:02:03". Captured, never judged. */
  const RUNTIME_BADGE_RE = /^\d{1,2}(?::\d{2}){1,2}$/;

  /**
   * Split segments into parts. `key` is normalised for matching; `text`
   * keeps the original characters for reporting.
   */
  function splitParts(segments) {
    const parts = [];
    for (const seg of segments || []) {
      for (const piece of tidy(seg && seg.text).split(DELIMITER_RE)) {
        const text = tidy(piece);
        if (text) parts.push({ text, key: norm(text), zone: seg.zone || 'meta', source: seg.source || 'text' });
      }
    }
    return parts;
  }

  /**
   * Decide a card's publication state from its non-title text parts.
   *
   * input: { segments: [{text, zone, source}], hasTitle, titleConflict, idConflict }
   *        source: 'text' (displayed) or 'label' (the element's aria-label)
   * Runtime never affects the outcome.
   */
  function classifyCard(input) {
    const card = input || {};
    if (card.idConflict) return { state: STATE.INDETERMINATE, basis: 'CARD_LINKS_DISAGREE', evidence: null };
    if (!card.hasTitle) return { state: STATE.INDETERMINATE, basis: 'CARD_TITLE_NOT_FOUND', evidence: null };
    if (card.titleConflict) return { state: STATE.INDETERMINATE, basis: 'CARD_TITLE_DISAGREES', evidence: null };

    const published = [];
    const ageLike = [];
    const scheduled = [];
    const live = [];
    // Signals are ranked by pattern order so the evidence reported is the
    // most specific one ("Premieres 10/11/26, 8:00 PM" over a bare badge).
    const rank = (res, part) => res.findIndex((re) => re.test(part.key));
    for (const part of splitParts(card.segments)) {
      const pub = PUBLISHED_RE.exec(part.key);
      if (pub) published.push({ ...part, kind: (pub[1] || '').toLowerCase(), age: ageSeconds(part.key) });
      else if (rank(LIVE_RES, part) >= 0) live.push(part);
      else if (rank(SCHEDULED_RES, part) >= 0) scheduled.push(part);
      else if (AGE_LIKE_RE.test(part.key)) ageLike.push(part);
    }
    live.sort((a, b) => rank(LIVE_RES, a) - rank(LIVE_RES, b));
    scheduled.sort((a, b) => rank(SCHEDULED_RES, a) - rank(SCHEDULED_RES, b));

    // The same age shown twice, or as "2h ago" with the label "2 hours ago",
    // is one age. Two different ages, or any age next to an upcoming/live
    // signal, is a contradiction.
    const distinctAges = new Set(published.map((p) => p.age));
    const anyAge = published.length || ageLike.length;
    if ((anyAge && (scheduled.length || live.length)) || distinctAges.size > 1) {
      const evidence = [...new Set([...published, ...ageLike, ...live, ...scheduled].map((p) => p.text))].join(' | ');
      return { state: STATE.INDETERMINATE, basis: 'CARD_STATUS_CONFLICT', evidence };
    }
    if (live.length) return { state: STATE.LIVE, basis: 'CARD_LIVE_INDICATOR', evidence: live[0].text };
    if (scheduled.length) return { state: STATE.SCHEDULED, basis: 'CARD_UPCOMING_INDICATOR', evidence: scheduled[0].text };
    if (published.length) {
      // Report what the card displays when it is a full form; otherwise the
      // span's accessible label, and say so.
      const best = published.find((p) => p.source === 'text') || published[0];
      const kind = published.map((p) => p.kind).find(Boolean) || '';
      const basis = kind === 'premiered' ? 'CARD_COMPLETED_PREMIERE_TEXT'
        : kind === 'streamed' ? 'CARD_COMPLETED_STREAM_TEXT'
          : 'CARD_PUBLISHED_AGE_TEXT';
      return {
        state: STATE.PUBLISHED,
        basis,
        evidence: best.text,
        publishedText: best.text,
        publishedTextSource: best.source === 'label' ? 'ACCESSIBLE_LABEL' : 'VISIBLE_TEXT',
      };
    }
    if (ageLike.length) {
      return { state: STATE.INDETERMINATE, basis: 'CARD_AGE_UNRECOGNIZED', evidence: ageLike[0].text };
    }
    return { state: STATE.INDETERMINATE, basis: 'CARD_STATUS_NOT_FOUND', evidence: null };
  }

  /** First runtime badge in the thumbnail, else anywhere outside the title. */
  function runtimeBadgeText(segments) {
    const parts = splitParts(segments);
    const hit = parts.find((p) => p.zone === 'thumb' && p.source === 'text' && RUNTIME_BADGE_RE.test(p.key))
      || parts.find((p) => p.source === 'text' && RUNTIME_BADGE_RE.test(p.key));
    return hit ? hit.text : null;
  }

  /* ------------------------------------------------------------------ *
   * Order sanity (pure)
   * ------------------------------------------------------------------ */

  const UNIT_SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
  /** Relative ages are coarse buckets; only a clearly younger later card is an anomaly. */
  const ORDER_TOLERANCE = 0.8;

  function ageSeconds(publishedText) {
    const m = PUBLISHED_RE.exec(norm(publishedText));
    if (!m) return null;
    const n = /^an?$/i.test(m[2]) ? 1 : Number(m[2]);
    return Number.isFinite(n) ? n * UNIT_SECONDS[m[3].toLowerCase()] : null;
  }

  /**
   * Latest is newest -> oldest, so displayed ages never shrink down the list.
   * A card clearly younger than one above it (a pinned or reordered item)
   * means DOM order is not chronology; the caller must not claim it is.
   */
  function findOrderAnomaly(videos) {
    let oldest = null;
    for (const v of videos || []) {
      const age = ageSeconds(v && v.publishedText);
      if (age === null) continue;
      if (oldest && age < oldest.age * ORDER_TOLERANCE) {
        return { videoId: v.videoId, gridPosition: v.gridPosition, publishedText: v.publishedText, after: oldest.publishedText };
      }
      if (!oldest || age > oldest.age) oldest = { age, publishedText: v.publishedText };
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * The shared 12-video selector (pure)
   * ------------------------------------------------------------------ */

  /**
   * The first `count` unique published normal videos, newest first, in grid
   * order. Used by BOTH Copy 12 URLs and Copy Channel Details.
   *
   *   - Shorts are excluded structurally; runtime is never considered.
   *   - Scheduled Premieres and live/upcoming broadcasts are skipped and do
   *     not count toward 12 (`excluded`).
   *   - Collection STOPS at an item whose link has not rendered (`pending`)
   *     or whose status cannot be established (`blocked`), so a later video
   *     can never be promoted past an undecided one.
   */
  function selectEligibleVideos(entries, count = 12) {
    const videos = [];
    const excluded = [];
    const seen = new Set();
    let pending = false;
    let blocked = null;
    let gridPosition = 0;
    for (const entry of entries || []) {
      if (videos.length >= count) break;
      gridPosition += 1;
      if (!entry || entry.shorts) continue;
      if (!entry.href) {
        pending = true;
        break;
      }
      const id = watchIdFromHref(entry.href);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (entry.state === STATE.SCHEDULED || entry.state === STATE.LIVE) {
        excluded.push({ gridPosition, videoId: id, state: entry.state, evidence: entry.stateEvidence || null });
        continue;
      }
      if (entry.state !== STATE.PUBLISHED) {
        blocked = {
          gridPosition,
          videoId: id,
          state: STATE.INDETERMINATE,
          basis: entry.stateBasis || 'CARD_STATUS_NOT_READ',
          evidence: entry.stateEvidence || null,
        };
        break;
      }
      videos.push({ ...entry, videoId: id, gridPosition });
    }
    return {
      ids: videos.map((v) => v.videoId),
      videos,
      excluded,
      pending,
      blocked,
      orderAnomaly: findOrderAnomaly(videos),
    };
  }

  /* ------------------------------------------------------------------ *
   * Reading one card (read-only DOM access)
   * ------------------------------------------------------------------ */

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
  const THUMB_TAGS = new Set(['YTD-THUMBNAIL', 'YT-THUMBNAIL-VIEW-MODEL']);

  const tagOf = (node) => String(node.tagName || node.nodeName || '').toUpperCase();
  const attr = (node, name) => (node && typeof node.getAttribute === 'function' ? node.getAttribute(name) : null);
  const isHidden = (node) => typeof node.hasAttribute === 'function' && node.hasAttribute('hidden');

  /** Title elements. Their text is never status evidence. */
  function isTitleNode(node) {
    const id = attr(node, 'id');
    return tagOf(node) === 'H3' || id === 'video-title' || id === 'video-title-link';
  }

  /** The thumbnail: the card's non-title watch link(s), or a thumbnail renderer. */
  function isThumbNode(node) {
    if (THUMB_TAGS.has(tagOf(node))) return true;
    return tagOf(node) === 'A' && watchIdFromHref(attr(node, 'href')) !== null;
  }

  function ownText(node) {
    let text = '';
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) text += ` ${child.nodeValue}`;
    }
    return tidy(text);
  }

  /** All rendered text of a node, skipping `hidden` subtrees. */
  function visibleText(node) {
    let text = '';
    (function walk(n) {
      for (const child of n.childNodes || []) {
        if (child.nodeType === 3) text += child.nodeValue;
        else if (child.nodeType === 1 && !isHidden(child) && !SKIP_TAGS.has(tagOf(child))) walk(child);
      }
    }(node));
    return norm(text);
  }

  /**
   * The card's text, element by element, outside the title. Each segment is
   * tagged with its zone ('thumb' overlay or 'meta') and source. A displayed
   * text span (role="text") that carries an aria-label also contributes that
   * label, as a second reading of the same span; a card-scoped button's
   * accessible name is included as a 'control' segment. No other attribute
   * is read.
   */
  function cardSegments(item) {
    const out = [];
    const rootText = ownText(item);
    if (rootText) out.push({ text: rootText, zone: 'meta', source: 'text' });
    (function walk(node, zone) {
      for (const child of node.childNodes || []) {
        if (child.nodeType !== 1) continue;
        if (isHidden(child) || SKIP_TAGS.has(tagOf(child)) || isTitleNode(child)) continue;
        const childZone = zone === 'thumb' || isThumbNode(child) ? 'thumb' : zone;
        const text = ownText(child);
        if (text) out.push({ text, zone: childZone, source: 'text' });
        if (text && attr(child, 'role') === 'text') {
          const label = tidy(attr(child, 'aria-label'));
          if (label) out.push({ text: label, zone: childZone, source: 'label' });
        }
        if (tagOf(child) === 'BUTTON' || attr(child, 'role') === 'button') {
          const label = tidy(attr(child, 'aria-label'));
          if (label) out.push({ text: label, zone: 'control', source: 'label' });
        }
        walk(child, childZone);
      }
    }(item, 'meta'));
    return out;
  }

  const ELLIPSIS_RE = /\s*(?:…|\.\.\.)$/;

  /**
   * The card's title, from the same card as its link. A trustworthy `title`
   * attribute is preferred over clipped visible text, and its source is
   * recorded. Visible text that is not the attribute (or a clipped prefix of
   * it) is a conflict, never silently resolved.
   */
  function readCardTitle(item, videoId) {
    const heading = item.querySelector('h3');
    const link = (heading && heading.querySelector('a[href*="/watch?v="]'))
      || item.querySelector('a#video-title-link, a#video-title');
    const titleText = item.querySelector('#video-title');
    const visibleNode = link || titleText || heading;

    let attrTitle = null;
    for (const node of [link, heading, titleText, item.querySelector('#video-title-link')]) {
      const value = attr(node, 'title');
      if (value && value.trim()) { attrTitle = value.trim(); break; }
    }
    const visible = visibleNode ? visibleText(visibleNode) : '';

    const linkId = link ? watchIdFromHref(attr(link, 'href')) : null;
    const linkConflict = Boolean(link) && linkId !== videoId;

    if (!attrTitle && !visible) return { hasTitle: false, conflict: linkConflict };

    let conflict = linkConflict;
    let truncated = null;
    if (attrTitle && visible) {
      const full = norm(attrTitle);
      if (visible !== full) {
        const clipped = ELLIPSIS_RE.test(visible) ? visible.replace(ELLIPSIS_RE, '') : null;
        if (clipped && full.startsWith(clipped) && full.length > clipped.length) truncated = true;
        else conflict = true;
      }
    }
    return {
      hasTitle: true,
      conflict,
      title: attrTitle || visible,
      titleSource: attrTitle ? 'DOM_TITLE_ATTRIBUTE' : 'VISIBLE_TEXT',
      titleTruncatedInUi: truncated,
    };
  }

  /** Every valid watch ID linked from a card, in document order. */
  function cardWatchIds(item) {
    const ids = [];
    for (const anchor of item.querySelectorAll('a[href]')) {
      const id = watchIdFromHref(attr(anchor, 'href'));
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  /** Metadata and publication state of a card already known to link `videoId`. */
  function readCardDetails(item, videoId) {
    const idConflict = cardWatchIds(item).some((id) => id !== videoId);
    const title = readCardTitle(item, videoId);
    const segments = cardSegments(item);
    const status = classifyCard({
      segments,
      hasTitle: title.hasTitle,
      titleConflict: title.conflict,
      idConflict,
    });
    return {
      videoId,
      title: title.hasTitle ? title.title : null,
      titleSource: title.hasTitle ? title.titleSource : null,
      titleTruncatedInUi: title.hasTitle ? title.titleTruncatedInUi : null,
      publishedText: status.publishedText || null,
      publishedTextSource: status.publishedTextSource || null,
      durationText: runtimeBadgeText(segments),
      state: status.state,
      stateBasis: status.basis,
      stateEvidence: status.evidence,
    };
  }

  /**
   * One entry per grid item, in visible order.
   *
   * The structural fields `{ shorts, href }` follow v1.1.0 exactly: the same
   * item selector as the metric harvester, an item containing a /shorts/ link
   * is a Short, and the video link is the item's first /watch?v= anchor. An
   * item whose link has not rendered is REPORTED (href null), not dropped.
   * Every normal item additionally carries its metadata and publication
   * state; a card that cannot be read is INDETERMINATE, never published.
   */
  function readVideoCards(grid, maxItems = MAX_ITEMS_READ) {
    if (!grid || typeof grid.querySelectorAll !== 'function') return [];
    const entries = [];
    const items = grid.querySelectorAll(ITEM_SELECTOR);

    if (items.length) {
      for (const item of items) {
        const shorts = Boolean(item.querySelector('a[href^="/shorts/"]'));
        const anchor = item.querySelector('a[href*="/watch?v="]');
        const entry = { shorts, href: anchor ? anchor.getAttribute('href') : null };
        const videoId = watchIdFromHref(entry.href);
        if (!shorts && videoId) {
          try {
            Object.assign(entry, readCardDetails(item, videoId));
          } catch {
            Object.assign(entry, { videoId, state: STATE.INDETERMINATE, stateBasis: 'CARD_UNREADABLE', stateEvidence: null });
          }
        }
        entries.push(entry);
        if (entries.length >= maxItems) break;
      }
      return entries;
    }

    // Same fallback as the metric harvester when no item renderers exist.
    // Without a card there is no status to read, so these never count as
    // published: the selector stops at the first one.
    for (const anchor of grid.querySelectorAll('a[href*="/watch?v="]')) {
      if (anchor.closest && anchor.closest('ytd-reel-item-renderer, ytm-shorts-lockup-view-model')) continue;
      entries.push({
        shorts: false,
        href: anchor.getAttribute('href'),
        state: STATE.INDETERMINATE,
        stateBasis: 'NO_CARD_RENDERER',
        stateEvidence: null,
      });
      if (entries.length >= maxItems) break;
    }
    return entries;
  }

  /* ------------------------------------------------------------------ *
   * The general loaded-URL inventory (read-only DOM access)
   * ------------------------------------------------------------------ */

  /**
   * Every unique watch URL in the cards currently present in the grid, in
   * card order, in one pass and with no cap. Independent of sort, of the
   * 12-video rules and of publication state: a scheduled Premiere card with
   * a valid watch link is included.
   *
   *   unresolved  cards that may be videos but cannot be read: no link
   *               rendered yet, or links to two different videos.
   *   nonVideo    cards whose links are all non-video (playlist, channel...).
   */
  function readLoadedVideoUrls(grid) {
    const result = {
      gridFound: false, cardCount: 0, ids: [], shorts: 0, nonVideo: 0, duplicates: 0, unresolved: [],
    };
    if (!grid || typeof grid.querySelectorAll !== 'function') return result;
    result.gridFound = true;
    const seen = new Set();
    let position = 0;
    for (const item of grid.querySelectorAll(ITEM_SELECTOR)) {
      position += 1;
      if (item.querySelector('a[href^="/shorts/"]')) {
        result.shorts += 1;
        continue;
      }
      let anyHref = false;
      const ids = [];
      for (const anchor of item.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href');
        if (href) anyHref = true;
        const id = watchIdFromHref(href);
        if (id && !ids.includes(id)) ids.push(id);
      }
      if (ids.length === 1) {
        if (seen.has(ids[0])) result.duplicates += 1;
        else {
          seen.add(ids[0]);
          result.ids.push(ids[0]);
        }
      } else if (ids.length > 1) {
        result.unresolved.push({ position, reason: 'CONFLICTING_LINKS' });
      } else if (!anyHref) {
        result.unresolved.push({ position, reason: 'NOT_RENDERED' });
      } else {
        result.nonVideo += 1;
      }
    }
    result.cardCount = position;
    return result;
  }

  /**
   * The active Videos-tab sort as a label. The chip's own text decides when it
   * is one of the three English labels; otherwise the chip's position is used
   * only when exactly three chips exist (the layout the Latest guard already
   * relies on). Anything else is 'Unknown', never a guess.
   *
   * chips: { count, selectedIndex, selectedText } | null
   */
  function sortLabelFromChips(chips) {
    if (!chips || !Number.isInteger(chips.selectedIndex) || chips.selectedIndex < 0) return 'Unknown';
    const text = norm(chips.selectedText).toLowerCase();
    const byText = SORT_LABELS.find((label) => label.toLowerCase() === text);
    if (byText) return byText;
    if (chips.count === SORT_LABELS.length) return SORT_LABELS[chips.selectedIndex] || 'Unknown';
    return 'Unknown';
  }

  self.THQVideoSelection = {
    STATE,
    SORT_LABELS,
    ITEM_SELECTOR,
    MAX_ITEMS_READ,
    WATCH_BASE,
    isValidVideoId,
    canonicalWatchUrl,
    watchIdFromHref,
    classifyCard,
    runtimeBadgeText,
    ageSeconds,
    findOrderAnomaly,
    selectEligibleVideos,
    cardSegments,
    readCardTitle,
    readCardDetails,
    readVideoCards,
    readLoadedVideoUrls,
    sortLabelFromChips,
    visibleText,
  };
})();
