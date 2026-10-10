/**
 * Ternary House YouTube Qualifier — "Copy Channel Details".
 *
 * Builds ONE strict-JSON browser-evidence block for the Creator Evidence
 * Maker: the channel's identity as shown on the page, and the same 12
 * published videos that Copy 12 URLs selects, each with its canonical watch
 * URL and the factual card metadata read from that same card.
 *
 * This is SOURCE EVIDENCE, not a Creator Evidence Packet. It is never labelled
 * READY; the Evidence Maker remains the validation step. Missing optional
 * fields are null and listed in `capture_limitations`; nothing is inferred
 * (no country, language, audience or niche) and nothing is fabricated.
 *
 * The 12 videos come from the shared selector in content/video-selection.js
 * through the shared export operation in content/url-export.js; this file only
 * reads the channel header and formats. A CLASSIC script, loaded after
 * url-export.js and before content.js. DOM access is read-only.
 */

(() => {
  'use strict';

  const { STATE, canonicalWatchUrl, isValidVideoId, visibleText } = self.THQVideoSelection;
  const { EXPORT_COUNT } = self.THQUrlExport;

  const CAPTURE_TYPE = 'TERNARY_HOUSE_BROWSER_EVIDENCE_INPUT';
  const CAPTURE_FORMAT_VERSION = '1.0';
  const SOURCE_REF = 'D1';
  const TOOL_NAME = 'Ternary House YouTube Qualifier';
  const SELECTION_METHOD = '12_MOST_RECENT_CONSECUTIVE_ELIGIBLE_PUBLISHED_VIDEOS';
  const YOUTUBE_ORIGIN = 'https://www.youtube.com/';

  const DETAILS_TEXT = Object.freeze({
    IDLE: 'Copy Channel Details',
    WORKING: 'Copying...',
    COPIED: 'Copied channel details',
    WRONG_SORT: 'Switch to Latest',
    READY: 'Ready — click to copy',
    COPY_FAILED: 'Copy failed',
    REVIEW_STATUS: 'Review video status',
    REVIEW_ORDER: 'Review video order',
    CHANNEL_UNCLEAR: 'Channel identity unclear',
  });
  const detailsFoundText = (n) => `Found ${n} of ${EXPORT_COUNT} — load/retry`;

  /* ------------------------------------------------------------------ *
   * Reading the channel header (read-only DOM access)
   * ------------------------------------------------------------------ */

  /** Modern view-model header first, then the legacy C4 header. */
  const HEADER_SELECTORS = [
    'ytd-browse[page-subtype="channels"] yt-page-header-renderer',
    'ytd-browse[page-subtype="channels"] yt-page-header-view-model',
    'ytd-browse[page-subtype="channels"] #page-header',
    'ytd-browse[page-subtype="channels"] ytd-c4-tabbed-header-renderer',
    'ytd-browse[page-subtype="channels"] #channel-header',
  ];
  const DESCRIPTION_SELECTOR = 'yt-description-preview-view-model';

  function findChannelHeader(doc) {
    for (const selector of HEADER_SELECTORS) {
      const node = doc.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const tagOf = (node) => String(node.tagName || node.nodeName || '').toUpperCase();
  const attr = (node, name) => (node && typeof node.getAttribute === 'function' ? node.getAttribute(name) : null);
  const isHidden = (node) => typeof node.hasAttribute === 'function' && node.hasAttribute('hidden');
  const isOwnUi = (node) => /(?:^|\s)thq-host(?:\s|$)/.test(attr(node, 'class') || '');
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

  const HANDLE_RE = /^@[\p{L}\p{M}\p{N}._-]{3,30}$/u;
  const SUBSCRIBERS_RE = /^[\d.,]+\s*[KMB]?\s+subscribers?$/i;
  const VIDEO_COUNT_RE = /^[\d.,]+\s*[KMB]?\s+videos?$/i;
  const MORE_SUFFIX_RE = /\s*(?:…|\.\.\.)\s*more$/i;
  /** The "...more" expander, whatever element carries it. */
  const MORE_CONTROL_RE = /^(?:…|\.\.\.)?\s*more$/i;

  /**
   * The header's short text parts (handle, subscriber and video counts),
   * skipping the name, the description, hidden nodes and this extension's
   * own bar.
   */
  function headerParts(root, skip) {
    const parts = [];
    (function walk(node) {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) {
          for (const piece of String(child.nodeValue).split(/\s*[•·‧|]\s*/)) {
            const text = norm(piece);
            if (text) parts.push(text);
          }
        } else if (child.nodeType === 1) {
          if (isHidden(child) || SKIP_TAGS.has(tagOf(child)) || isOwnUi(child)) continue;
          if (skip.includes(child)) continue;
          walk(child);
        }
      }
    }(root));
    return parts;
  }

  /**
   * Description text as displayed, with line breaks kept. The "...more"
   * expander is not part of it. (The preview itself may sit inside a
   * clickable element, so buttons in general are NOT skipped.)
   */
  function descriptionText(node) {
    let text = '';
    (function walk(n) {
      for (const child of n.childNodes || []) {
        if (child.nodeType === 3) {
          text += /^\s*$/.test(child.nodeValue) ? ' ' : child.nodeValue;
        } else if (child.nodeType === 1) {
          if (tagOf(child) === 'BR') { text += '\n'; continue; }
          if (isHidden(child) || SKIP_TAGS.has(tagOf(child))) continue;
          if (MORE_CONTROL_RE.test(visibleText(child))) continue;
          walk(child);
        }
      }
    }(node));
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t ]+/g, ' ').trim());
    return lines.join('\n').trim().replace(MORE_SUFFIX_RE, '').trim();
  }

  /**
   * What the channel header shows. Every field is null when not found.
   * Country, joined date and lifetime views live in YouTube's About panel,
   * which is never opened, so they are not read here.
   */
  function readChannelHeader(root) {
    const empty = { found: false, name: null, handle: null, subscriberCountText: null, videoCountText: null, descriptionText: null };
    if (!root || typeof root.querySelector !== 'function') return empty;

    const h1 = root.querySelector('h1');
    const legacyName = root.querySelector('#channel-name #text');
    let name = h1 ? visibleText(h1) : '';
    if (!name && legacyName) name = visibleText(legacyName);

    const description = root.querySelector(DESCRIPTION_SELECTOR);
    const parts = headerParts(root, [h1, legacyName, description].filter(Boolean));
    const descText = description ? descriptionText(description) : '';

    return {
      found: true,
      name: name || null,
      handle: parts.find((p) => HANDLE_RE.test(p)) || null,
      subscriberCountText: parts.find((p) => SUBSCRIBERS_RE.test(p)) || null,
      videoCountText: parts.find((p) => VIDEO_COUNT_RE.test(p)) || null,
      descriptionText: descText || null,
    };
  }

  /* ------------------------------------------------------------------ *
   * Identity (pure)
   * ------------------------------------------------------------------ */

  /** "(3) Creator Name - YouTube" -> "Creator Name"; null for anything else. */
  function channelNameFromTitle(documentTitle) {
    const m = /^(?:\(\d+\+?\)\s*)?(.+?)\s+-\s+YouTube$/.exec(norm(documentTitle));
    return m ? m[1] : null;
  }

  const comparable = (s) => norm(s).toLowerCase();
  function namesAgree(a, b) {
    const x = comparable(a);
    const y = comparable(b);
    return x === y || x.includes(y) || y.includes(x);
  }

  function decodeRouteBase(base) {
    try { return decodeURIComponent(base); } catch { return base; }
  }

  function channelUrlFor(handle, routeBase) {
    if (handle) return `${YOUTUBE_ORIGIN}@${encodeURIComponent(handle.slice(1))}`;
    return routeBase ? `${YOUTUBE_ORIGIN}${routeBase}` : null;
  }

  /**
   * Combine the header, the page route and the tab title into one identity.
   * Disagreement between them (a stale header after SPA navigation, say) is a
   * problem that blocks the export rather than a field that is quietly picked.
   *
   * input: { header: readChannelHeader(), route: { base, tab }, documentTitle }
   */
  function resolveChannelIdentity({ header, route, documentTitle }) {
    const h = header || {};
    const problems = [];
    const base = route && route.base ? route.base : null;

    const titleName = channelNameFromTitle(documentTitle);
    let name = h.name || null;
    let nameSource = name ? 'PAGE_HEADER' : null;
    if (name && titleName && !namesAgree(name, titleName)) problems.push('CHANNEL_NAME_MISMATCH');
    if (!name && titleName) {
      name = titleName;
      nameSource = 'DOCUMENT_TITLE';
    }
    if (!name) problems.push('CHANNEL_NAME_UNAVAILABLE');

    const routeHandle = base && base.startsWith('@') ? decodeRouteBase(base) : null;
    let handle = h.handle || null;
    let handleSource = handle ? 'PAGE_HEADER' : null;
    if (handle && routeHandle && handle.toLowerCase() !== routeHandle.toLowerCase()) {
      problems.push('CHANNEL_HANDLE_MISMATCH');
    }
    if (!handle && routeHandle) {
      handle = routeHandle;
      handleSource = 'URL_ROUTE';
    }

    const url = channelUrlFor(handle, base);
    if (!url) problems.push('CHANNEL_URL_UNAVAILABLE');

    const description = h.descriptionText || null;
    return {
      ok: problems.length === 0,
      problems,
      channel: {
        channel_name: name,
        channel_name_source: nameSource,
        channel_handle: handle,
        channel_handle_source: handleSource,
        channel_url: url,
        description_text: description,
        // The header shows a preview; completeness is never claimed.
        description_extent: description ? 'PARTIAL' : 'UNAVAILABLE',
        description_source: description ? 'CHANNEL_HEADER_PREVIEW' : null,
      },
      moreInfo: {
        country_or_region: null,
        joined_text: null,
        subscriber_count_text: h.subscriberCountText || null,
        video_count_text: h.videoCountText || null,
        lifetime_views_text: null,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * The evidence block (pure)
   * ------------------------------------------------------------------ */

  /** Local ISO-8601 with offset, e.g. 2026-10-10T11:30:00+06:00. */
  function isoWithOffset(ms, offsetMinutes) {
    const pad = (n) => String(Math.abs(Math.trunc(n))).padStart(2, '0');
    const local = new Date(ms + offsetMinutes * 60000);
    const sign = offsetMinutes < 0 ? '-' : '+';
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
      + `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
      + `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`;
  }

  function captureLimitations(identity, videos) {
    const c = identity.channel;
    const m = identity.moreInfo;
    const notes = [];
    if (c.channel_name_source === 'DOCUMENT_TITLE') {
      notes.push('channel_name comes from the browser tab title; the channel header name was not found.');
    }
    if (c.channel_handle_source === 'URL_ROUTE') {
      notes.push('channel_handle comes from the page URL, not the page header; its letter case may differ from the displayed handle.');
    } else if (!c.channel_handle) {
      notes.push('channel_handle is null: no handle is shown in the page header and the page URL is not a handle URL.');
    }
    notes.push(c.description_text
      ? 'description_text is the channel header preview and may be truncated; the full About description was not opened.'
      : 'description_text is null: no description preview was found in the channel header.');
    notes.push('channel_more_info: country_or_region, joined_text and lifetime_views_text are null because they appear only in the About panel, which this capture does not open.');
    const missingCounts = [
      m.subscriber_count_text ? null : 'subscriber_count_text',
      m.video_count_text ? null : 'video_count_text',
    ].filter(Boolean);
    if (missingCounts.length) notes.push(`channel_more_info: ${missingCounts.join(' and ')} not found in the channel header.`);
    notes.push('published_text is YouTube\'s relative age as displayed at captured_at, not an exact date.');
    notes.push('thumbnail_text is null: thumbnail lettering is part of the image, not page text, and is not read (no OCR).');
    if (videos.some((v) => v.titleTruncatedInUi === null)) {
      notes.push('title_truncated_in_ui is null where clipping cannot be determined from page text.');
    }
    const noRuntime = videos.filter((v) => !v.durationText).map((v) => v.position);
    if (noRuntime.length) notes.push(`duration_text is not shown on the card for position(s) ${noRuntime.join(', ')}.`);
    return notes;
  }

  /**
   * The JSON block, or null unless given exactly 12 unique, published,
   * titled videos. A partial block is never produced.
   *
   * input: { identity: resolveChannelIdentity(), selection: selectEligibleVideos(),
   *          capturedAtMs, utcOffsetMinutes, toolVersion }
   */
  function buildChannelEvidence({ identity, selection, capturedAtMs, utcOffsetMinutes, toolVersion }) {
    if (!identity || !identity.ok || !selection) return null;
    const picked = selection.videos || [];
    if (picked.length !== EXPORT_COUNT) return null;
    if (!picked.every((v) => isValidVideoId(v.videoId) && v.state === STATE.PUBLISHED && typeof v.title === 'string' && v.title)) return null;
    if (new Set(picked.map((v) => v.videoId)).size !== EXPORT_COUNT) return null;
    if (!Number.isFinite(capturedAtMs) || !Number.isFinite(utcOffsetMinutes)) return null;

    const videos = picked.map((v, i) => ({ ...v, position: i + 1 }));
    const doc = {
      capture_type: CAPTURE_TYPE,
      capture_format_version: CAPTURE_FORMAT_VERSION,
      is_creator_evidence_packet: false,
      evidence_maker_validation_required: true,
      captured_at: isoWithOffset(capturedAtMs, utcOffsetMinutes),
      captured_at_meaning: 'Time of this browser capture. Not an upload or publish time.',
      source: {
        type: 'browser_dom_capture',
        source_ref: SOURCE_REF,
        tab: 'VIDEOS',
        sort: 'LATEST',
        eligibility_note: 'Only published/completed normal Videos-tab uploads were selected. Scheduled Premieres, live or upcoming broadcasts and Shorts were skipped and do not count toward 12.',
        capture_method_note: 'Read from the already-loaded channel Videos page. No video was opened or played and no YouTube API request was made.',
        tool: TOOL_NAME,
        tool_version: toolVersion || null,
      },
      channel: identity.channel,
      channel_more_info: identity.moreInfo,
      sample: {
        selection_method: SELECTION_METHOD,
        required_count: EXPORT_COUNT,
        actual_count: videos.length,
        ordering: 'NEWEST_TO_OLDEST',
        videos: videos.map((v) => ({
          position: v.position,
          video_id: v.videoId,
          video_url: canonicalWatchUrl(v.videoId),
          title: v.title,
          title_source: v.titleSource,
          title_truncated_in_ui: v.titleTruncatedInUi ?? null,
          published_text: v.publishedText || null,
          duration_text: v.durationText || null,
          thumbnail_text: null,
          publication_state: v.state,
          publication_state_basis: v.stateBasis,
          grid_position: v.gridPosition,
          source_ref: SOURCE_REF,
        })),
        excluded_not_in_sample: (selection.excluded || []).map((x) => ({
          grid_position: x.gridPosition,
          video_id: x.videoId,
          video_url: canonicalWatchUrl(x.videoId),
          publication_state: x.state,
          status_text: x.evidence || null,
        })),
      },
      capture_limitations: captureLimitations(identity, videos),
    };
    return JSON.stringify(doc, null, 2);
  }

  /**
   * The `format` for the shared export operation (createUrlExporter). It runs
   * after the 12 are collected, reads the header synchronously and either
   * returns the block or refuses with CHANNEL_UNCLEAR.
   *
   * deps: readPage() -> { header, route, documentTitle }, now(), utcOffsetMinutes(ms), toolVersion
   */
  function createDetailsFormat(deps) {
    return (selection) => {
      const identity = resolveChannelIdentity(deps.readPage());
      if (!identity.ok) return { status: 'CHANNEL_UNCLEAR', problems: identity.problems };
      const capturedAtMs = deps.now();
      const text = buildChannelEvidence({
        identity,
        selection,
        capturedAtMs,
        utcOffsetMinutes: deps.utcOffsetMinutes(capturedAtMs),
        toolVersion: deps.toolVersion,
      });
      // Unreachable while the selector only picks titled, published cards;
      // if that ever breaks, refuse rather than copy a partial block.
      if (!text) return { status: 'REVIEW_STATUS', count: selection.ids.length };
      return { text };
    };
  }

  function detailsButtonText(result) {
    switch (result && result.status) {
      case 'COPIED': return DETAILS_TEXT.COPIED;
      case 'WRONG_SORT': return DETAILS_TEXT.WRONG_SORT;
      case 'INSUFFICIENT': return detailsFoundText(result.count || 0);
      case 'REVIEW_STATUS': return DETAILS_TEXT.REVIEW_STATUS;
      case 'REVIEW_ORDER': return DETAILS_TEXT.REVIEW_ORDER;
      case 'CHANNEL_UNCLEAR': return DETAILS_TEXT.CHANNEL_UNCLEAR;
      case 'READY': return DETAILS_TEXT.READY;
      case 'COPY_FAILED': return DETAILS_TEXT.COPY_FAILED;
      case 'ABORTED': return DETAILS_TEXT.IDLE;
      default: return null;
    }
  }

  self.THQChannelDetails = {
    CAPTURE_TYPE,
    CAPTURE_FORMAT_VERSION,
    SELECTION_METHOD,
    DETAILS_TEXT,
    detailsFoundText,
    findChannelHeader,
    readChannelHeader,
    channelNameFromTitle,
    resolveChannelIdentity,
    isoWithOffset,
    buildChannelEvidence,
    createDetailsFormat,
    detailsButtonText,
  };
})();
