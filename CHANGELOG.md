# Changelog

All notable changes to Ternary House YouTube Qualifier.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
This is an internal tool; versions are not published to the Chrome Web Store.

**Current stable: 1.1.0.** 1.2.0 is a CANDIDATE under acceptance testing (not
authorized for production). 1.0.0, 1.0.1 and 1.0.2 remain frozen and archived
as historical releases.

---

## [1.2.0-candidate] — 2026-10-10 — CANDIDATE, NOT AUTHORIZED FOR PRODUCTION

Implements `TERNARY_HOUSE_YOUTUBE_QUALIFIER_CHANNEL_DETAILS_AND_ALL_URLS_IMPLEMENTATION_BRIEF_v1.2.md`.
Full notes: [RELEASE_NOTES_v1.2.0.md](RELEASE_NOTES_v1.2.0.md). **Not yet
validated on live YouTube** (the build environment could not reach it).

### Fixed

- **Copy 12 URLs no longer exports unpublished scheduled Premieres** or
  live/upcoming broadcasts. They are skipped and do not count toward 12;
  completed Premieres and normal uploads (including 0:58 ones) stay. Output
  format unchanged. A card whose status cannot be established fails closed
  (`Review video status`) instead of being treated as published.

### Added

- **Copy Channel Details** — one strict-JSON browser-evidence block
  (`TERNARY_HOUSE_BROWSER_EVIDENCE_INPUT`, format 1.0, `source_ref` D1): page
  channel identity, header description preview and counts, and the same 12
  videos as Copy 12 URLs with per-card title, title source, age, runtime text
  and publication basis. Not a CEP; never labelled READY.
- **Copy all video URLs** — every unique watch URL in the loaded Videos-grid
  cards, any sort, in on-page order, uncapped, no scrolling; `Total URLs` /
  `Sort` header plus numbered lines.
- `content/video-selection.js` — shared card reader and publication-aware
  12-video selector used by both Latest exports; the general inventory reader.
- `content/channel-details.js` — channel-header reader, identity cross-checks,
  JSON builder.
- `Review video order` refusal when displayed ages show the Latest grid is not
  in date order (pinned or reordered card).
- Toast `Skipped N upcoming/live videos (not published)`; refusal tooltips
  name the grid position and video ID.

### Changed

- `createUrlExporter()` takes an optional `format`, so Copy 12 URLs and Copy
  Channel Details are one operation over one selector; an undecided card is
  waited for (without scrolling) like an unrendered one.
- Refusal labels stay 6 s (was 2.5 s) so the tooltip can be read.
- Manifest: two content-script files added; version `1.2.0`,
  `version_name: 1.2.0-candidate`. Permissions unchanged.

### Unchanged — verified by diff

Everything in `lib/`, `background/`, `options/`, `content/render.js`,
`content/content.css`; `collectVideoIds()`, `harvestVideoIds()`,
`TARGET_CANDIDATES` (30), `checkLatestOrdering()`, `readSortChips()`, the
`ANALYZE` request, permissions, key handling and storage isolation.

### Tests

139 -> **222**: new `video-selection.test.mjs` (54) and
`channel-details.test.mjs` (29), with a small dependency-free test DOM
(`tests/helpers/mini-dom.mjs`) and SIMULATED YouTube markup
(`tests/fixtures/youtube-markup.mjs`). In `url-export.test.mjs` the loader
also evaluates `video-selection.js`, and the `video()` helper and test F's
entries now declare `state: 'PUBLISHED_COMPLETED'`; no assertion changed.
Mutation-tested (22 defects, 21 caught, 1 equivalent). Optional real-Chromium
harness `tests/browser/extension-harness.mjs` (41 checks, simulated pages).

### Known limitations

Publication state is read from YouTube's English UI text; other UI languages
fail closed. Live markers, deep-scroll virtualization and the downstream
Evidence Maker change are not yet validated. See the release notes, §9–§10.

---

## [1.1.0] — 2026-10-02 — STABLE / VALIDATED INTERNAL RELEASE

Adds one operator action, **Copy 12 URLs**. v1.0.0, v1.0.1 and v1.0.2 remain
frozen. No Avg Views, Engagement, eligibility, UTC-window, API, key-storage,
security or permission change.

### Added

- **Copy 12 URLs** in the Ternary House bar, between Engagement and Refresh.
  Copies the canonical watch URLs of the 12 newest normal uploads on the
  channel's Videos -> Latest grid, numbered `1.`-`12.`, newest first, one per
  line, nothing else.
- A separate pipeline from the metrics (`content/url-export.js`): no 3-month
  window, no sample rules, no trimming, no service worker, no YouTube Data API,
  no API key. It reads the page and writes the clipboard.
- Fails closed on Popular/Oldest (`Switch to Latest`; nothing copied, sort not
  changed). Fewer than 12 obtainable -> `Found N of 12`, clipboard untouched.
- Shorts are excluded structurally (`/shorts/` items); runtime is never
  considered, so a 0:58 `/watch?v=` upload on the Videos tab is exported.
- Bounded lazy loading that observes the DOM instead of sleeping, restores the
  operator's scroll position in `finally`, and never reorders: an item whose
  link has not rendered yet is waited for, never skipped.
- A two-click fallback, `Ready — click to copy`, used only when a copy is
  refused after asynchronous waiting. Live testing in Chrome 154 showed the
  clipboard write is refused once the click's user activation has expired
  (~5 s). The prepared block is single-use, expires after 60 s, is scoped to
  the current creator route, and is re-validated against the live grid before
  it can be copied: all 12 must be re-resolved from the live grid and match
  position for position. A matching prefix (e.g. only the first 5 currently
  exposed) is refused, and the stale block is never written.
- A small FIFO DOM lock so metric candidate collection and URL top-up never
  scroll the page at the same time; always released in `finally`.

### Unchanged — verified byte-identical to v1.0.2

`collectVideoIds()`, `harvestVideoIds()`, `TARGET_CANDIDATES` (30),
`checkLatestOrdering()`, `readSortChips()`, `findGrid()`, `extractVideoId()`,
`parseChannelRoute()`, `detectChannelIdentity()`, `syncPage()`, and every file
in `lib/`, `background/` and `options/`, plus `content/render.js` and
`content/content.css`. The metric path's only change is that its existing
candidate collection now takes the DOM lock.

### Fixed — test suite

- **v1.0.2's clipboard test harness did not await async tests.** `test()`
  called `fn()` without awaiting it and the file exited synchronously, so in 6
  of the 20 clipboard tests every assertion after the first `await` never ran.
  Proven with a deliberately impossible assertion that still "passed". The
  harness now queues and awaits each test. No assertion was changed.
- Once awaited, one of those tests failed because the test's `<textarea>` stub
  lacked `select()`/`remove()`, which the production fallback calls. Stub
  completed. **Production code was correct**: all 20 pass against the frozen
  v1.0.2 code with the corrected harness.

### Tests

95 -> **139**. New `tests/url-export.test.mjs` (44 tests) runs against the real
`content/url-export.js` and was mutation-tested: deliberately breaking
de-duplication, ordering, the Latest guard, scroll restore, lock release,
prepared-block scoping/expiry/single-use, newline format, the top-up bound,
Shorts exclusion, canonicalisation, or weakening the prepared-block check to
a partial prefix, an off-by-one, or an order-insensitive comparison each makes
the suite fail.

### Validated

Live in everyday Chrome with a real API key: Futurepedia (12 eligible, high and
low excluded, 10 averaged, 123,076 -> `123.1K`, engagement `1.62%`, audit panel,
12-URL export) and Torin (3 eligible -> Avg Views `insufficient`, Engagement
`N/A`, while the export independently produced 12 historical URLs — the export
does not touch the metric sample). Compact copies of `insufficient` and `N/A`
and the Popular guard re-confirmed.

### Known limitation

A scheduled (upcoming) Premiere on the Videos tab is exported like any other
card. Investigated on the live DOM: a scheduled item uses the same badge class
(`ytBadgeShapeThumbnailDefault`) and the same item/lockup attributes as a
published upload; only localized text differs. No structural signal exists, so
no exclusion was implemented.

---

## [1.0.2] — 2026-09-17 — BUGFIX

Fixes the compact header copy controls, which had never worked. **v1.0.0 and
v1.0.1 remain frozen historical releases**; this is a separate build. No
methodology, threshold, eligibility, UTC window, security, or permission change.

### Fixed

- **The clipboard controls were non-functional in v1.0.0 and v1.0.1.**
  `copyText()` lived inside `content/render.js` but was never added to the
  `self.THQRender` export list, while `content/content.js` called the bare
  identifier. Every copy click therefore threw
  `ReferenceError: copyText is not defined`. Because `Controller.copy()` was
  `async` and its rejection was never awaited, the error surfaced only as an
  unhandled rejection in the page console, and it threw before any feedback
  could be set — so clicking a copy icon did nothing at all. This affected both
  compact icons and both panel Copy buttons.
- **Copy confirmation was invisible.** The toast was `position: absolute`
  inside a flex row with no offsets, so it painted at the row's origin behind
  the brand label and the first pill. It is now in normal flow.

### Changed

- **Compact Avg Views copies the visible value/state exactly**, including the
  `*` small-sample marker: `6M` → `6M`, `6.2K` → `6.2K`, `6.2K*` → `6.2K*`.
- **Compact Engagement copies the visible value/state with `%` removed only
  from a numeric percentage**: `2.01%` → `2.01`, `4.00%*` → `4.00*`. The `*`
  survives; nothing else is stripped.
- **Legitimate textual states are copyable**, with the copy icon available:
  Avg Views `insufficient` / `none`, Engagement `insufficient` / `N/A`. Only
  the transient loading (`…`) and error (`!`) glyphs expose no copy icon.
- **One canonical user-facing value.** The control renders a string and the
  clipboard is derived from that rendered string at click time, so display and
  clipboard cannot drift. The earlier payload-side reconstruction was removed —
  it could not carry the `*`.
- **Visible success and failure feedback**: `Copied 6M`, `Copied 6.2K*`,
  `Copied insufficient`, `Copy failed`. A clipboard failure is surfaced, never
  silent; `navigator.clipboard` falls back to a hidden-textarea copy and
  resolves `false` rather than throwing.
- **A copy click is fully contained** — `preventDefault`, `stopPropagation`
  and `stopImmediatePropagation` — so it never toggles the metric evidence
  panel or triggers the parent pill.
- Copy tooltips now name what will be copied (`Copy 6M`), replacing the stale
  "Copy exact average views".

### Unchanged

Panel Copy buttons keep their existing semantics (exact integer, ER to two
decimals); they were broken only by the missing export and now work.
`insufficient` and `none` remain lowercase exactly as rendered.

### Tests

- 75 → **95**. New `tests/clipboard.test.mjs` (20 tests) enumerates every real
  compact display state for both metrics and asserts its clipboard output,
  asterisk preservation, `%`-only removal, copyability of textual states, and
  that display and clipboard cannot drift. Interaction coverage: a copy click
  never reaches the parent metric button (against a real bubble chain with a
  control case), exactly one clipboard operation per click, success feedback,
  clipboard-failure handling, and a regression guard asserting `copyText` is
  actually exported.

---

## [1.0.1] — 2026-09-14 — BUGFIX

Fixes timezone and time-of-day instability in the 3-calendar-month recency
boundary. **v1.0.0 remains the frozen historical release**; this is a separate
build. No methodology, threshold, eligibility, security, or permission change.

### Fixed

- **The 3-month cutoff was an instant, not a date.** `subtractCalendarMonths()`
  copied the source timestamp and mutated only its date fields, so the cutoff
  kept the current time-of-day and was built from *local* calendar components.
  Two consequences, both observed in production:
  - **Time-of-day drift.** A video published on the cutoff date was included
    only if its publish time was at or after the current wall-clock time. The
    same creator silently changed value part-way through a working day. Found
    on Matt Maher: 8 eligible videos became 7 at 09:23 local, moving Avg Views
    ~6.2K → ~5.2K and Engagement 3.66% → 3.80%, while the panel still displayed
    `since 2026-06-14`.
  - **Timezone divergence.** Operators in different zones got different samples
    for the same creator at the same moment.

### Changed

- `subtractCalendarMonths()` → **`subtractCalendarMonthsUTC()`**: UTC calendar
  components, normalised to `00:00:00.000Z`. Month-end clamping and leap-year
  behaviour preserved, now computed with UTC components.
- Canonical rule: **the recent window uses UTC calendar dates and the cutoff
  date is inclusive.** Every video with `publishedAt >= cutoff` is in window.
- All dates rendered in the audit view (`fmtDate` in `content/render.js`, and
  the unused `formatDate` export in `lib/calculations.js`) now render in **UTC**,
  so a displayed date always agrees with the rule. **This can shift a displayed
  publish date by one day for operators far from UTC** — it is a display change
  only and never changes eligibility.
- Window label is now explicit about its basis:
  `Last 3 calendar months (UTC; since 2026-06-14 inclusive)`.

### Tests

- 70 → **75**. Added: exact UTC-midnight cutoff; inclusivity across the whole
  cutoff day (`00:00:00.000Z`, `03:23:05Z`, `23:59:59.999Z` in;
  `2026-06-13T23:59:59.999Z` out); time-of-day invariance across nine hours;
  timezone invariance; the real Matt Maher regression at every hour of
  2026-09-14; UTC rendering.
- Test fixtures now build `NOW` with `Date.UTC` so the suite itself is
  timezone-independent.
- The whole suite is executed under `UTC`, `Asia/Dhaka`,
  `America/Los_Angeles`, `Pacific/Kiritimati` (UTC+14) and `Pacific/Pago_Pago`
  (UTC−11) — 75/75 in every zone.

---

## [1.0.0] — 2026-09-14 — STABLE / VALIDATED INTERNAL RELEASE

First frozen release. Validated against live YouTube channels and covered by 70
automated tests.

### Added

- Two compact inline controls (**Avg Views**, **Engagement**) injected into the
  channel header on `youtube.com/<channel>/videos`, rendered in a Shadow DOM.
- Single-retrieval architecture: one batched `videos.list` call powers both
  metrics (normally **one** HTTP request and **1** quota unit per creator).
- Full audit panels for both metrics, showing every sampled video and every
  inclusion/exclusion decision.
- Copy-to-clipboard for the exact average-views integer and the exact
  engagement percentage.
- Options page for the YouTube Data API v3 key, with a **Test API key** probe
  and a live **Key isolation** status row.
- Short in-memory session cache (5 minutes), keyed to channel plus discovered
  video-id set so a different creator can never read a stale hit.
- SPA navigation handling via `yt-navigate-finish` with a `<title>`-scoped
  observer fallback; no page-wide MutationObserver.
- Developer-only fixture page (`tests/manual-fixtures.html`) that renders
  synthetic samples through production calculation and rendering code.
- 70 dependency-free deterministic tests runnable under Node or Deno.

### Methodology

- **Avg Views** — long-form Videos surface only, last 3 calendar months, max 12
  most recent. 6–12 eligible: remove exactly one highest and one lowest view
  observation, average the remainder. 4–5: untrimmed contextual mean with a
  small-sample warning. 1–3: no confident average.
- **Engagement** — per video `(likes + comments) / views × 100`. Same sample
  universe. 5–12 valid observations: remove exactly one highest and one lowest
  ER, average the remainder. Exactly 4: no automatic trimming, untrimmed
  contextual mean, manual outlier assessment. 1–3: no confident creator-wide
  rate. 0: `N/A`.

### Security

- Manifest V3. Permissions limited to `storage` plus the single host permission
  `https://www.googleapis.com/youtube/v3/*`.
- The service worker is the sole reader of the API key and the sole network
  caller. The content script never receives it.
- `chrome.storage.local` restricted to `TRUSTED_CONTEXTS` via
  `setAccessLevel()`, re-applied on every service-worker start, on install and
  on browser startup. Key persistence across restarts is retained.
- Content-script isolation live-verified from inside a YouTube page using a
  non-secret sentinel key.
- No telemetry, analytics, remote code, `eval`, or `innerHTML`. No Innertube or
  other undocumented YouTube endpoint. No third-party analytics service.

### Fixed during development

- `formatCompactNumber(187100)` returned `187K` instead of `187.1K`.
- `parseIso8601Duration('P0D')` returned `0` instead of `null`; `P0D` is
  YouTube's in-progress-livestream placeholder.
- Sort-chip detection targeted removed legacy markup
  (`ytd-feed-filter-chip-bar-renderer`); current YouTube uses
  `chip-bar-view-model` with `button[role="tab"][aria-selected]`. YouTube does
  **not** change the URL when the sort changes, so the chip check is the guard
  that actually works.
- The audit panel overlaid YouTube's tab bar and sort chips; the compact bar and
  the panel now mount at two separate points.
- A stale `current.host` reference would have thrown on every SPA navigation.
- Runtime was an independent rejection rule; a genuine sub-60-second upload on
  the Videos tab was dropped. Runtime is now diagnostic evidence only.
- **Premiere misclassification** — presence of `liveStreamingDetails` was
  treated as livestream-archive inventory, which disqualified every upload on
  channels that premiere their videos (found on `@TorinHofmann`: 26 of 26
  excluded, `Eligible videos: 0`). A broadcast is now excluded only when it has
  not finished.

### Known limitations

- Video-ID discovery and control placement depend on YouTube's current DOM.
  Selectors are isolated so a future fix is a contained edit.
- The API does not reliably distinguish a completed Premiere from a completed
  livestream archive. Surface is primary, so a past-stream archive sitting on
  the Videos tab is counted; the audit panel always reports the count.
- Anyone with filesystem access to the Chrome profile can read the stored key.
  Restrict it in Google Cloud and use one key per machine.
