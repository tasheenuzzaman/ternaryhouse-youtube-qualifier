# Ternary House YouTube Qualifier — v1.2.0 CANDIDATE

**Status: CANDIDATE — for founder acceptance testing only. NOT authorized for
production.** v1.1.0 remains the stable release. No stable ZIP has been
produced, and the installed production extension, Evidence Maker, ChatGPT and
Gemini classifiers and Ohi's runbook are unchanged.

**Specification:** `TERNARY_HOUSE_YOUTUBE_QUALIFIER_CHANNEL_DETAILS_AND_ALL_URLS_IMPLEMENTATION_BRIEF_v1.2.md`

**Live-validation status: NOT YET VALIDATED ON LIVE YOUTUBE.** The build
environment could not reach youtube.com. Every DOM check below ran on
*simulated* markup. Section 9 lists the live checks that must pass before
production authorization.

---

## 1. What changed

```
TH  [ Avg Views ]  [ Engagement ]  [ Copy 12 URLs ]  [ Copy Channel Details ]  [ Copy all video URLs ]  [ ⟳ ]
```

1. **Copy 12 URLs — scheduled-Premiere fix.** Unpublished scheduled Premieres
   and live/upcoming broadcasts are now skipped and do not count toward 12;
   older published videos are pulled up to complete the 12. Completed
   Premieres and normal uploads (including 0:58 ones) stay in. The clipboard
   output is unchanged: exactly 12 numbered canonical URLs.
2. **Copy Channel Details (new).** One strict-JSON browser-evidence block: the
   channel's identity as shown on the page, and the **same 12 videos, in the
   same order** as Copy 12 URLs, each with its canonical URL and the factual
   metadata of that same card. Source evidence only — not a Creator Evidence
   Packet, never labelled READY.
3. **Copy all video URLs (new).** Every unique watch URL in the cards
   currently loaded in the Videos grid, in on-page order, on Latest, Popular or
   Oldest, with no cap, no scrolling and no loading. Scheduled Premiere cards
   with a valid watch link are included, by design.

## 2. Architecture

| | Copy 12 URLs | Copy Channel Details | Copy all video URLs |
| --- | --- | --- | --- |
| Card reader | `readVideoCards()` | same | `readLoadedVideoUrls()` |
| Selection | `selectEligibleVideos()` (shared) | **same function, same call** | none — every loaded card |
| Export operation | `createUrlExporter()` | same, different `format` | `createAllUrlsExporter()` |
| Sort | Latest only | Latest only | any; recorded as a label |
| Publication filter | published only | published only | **none** (scheduled included) |
| Cap / loading | 12; bounded top-up (≤4 steps) | same | none; no scrolling |
| Prepared second click | yes (revalidated) | yes (revalidated) | none — fresh snapshot per click |

Files:

- `content/video-selection.js` (new) — URL primitives, card reader,
  publication-state classifier, the shared 12-video selector, order check,
  general inventory reader, sort label. Pure or read-only DOM.
- `content/url-export.js` — both export operations, formatters, DOM lock,
  labels. Re-exports the primitives for existing callers.
- `content/channel-details.js` (new) — channel-header reader, identity
  cross-checks, JSON builder.
- `content/content.js` — three action buttons in the existing Shadow DOM bar.

Copy 12 URLs and Copy Channel Details are two instances of one export
operation over one selector; they cannot disagree on IDs or order for the same
page state.

## 3. How publication state is read (DOM markers)

v1.1.0's live investigation found that a scheduled card uses the same badge
class and item attributes as a published one; only text differs. So the state
is read from the **card's own non-title text**, element by element:

| State | Card text that establishes it | Effect |
| --- | --- | --- |
| `PUBLISHED_COMPLETED` | `N <unit> ago`, `Premiered N <unit> ago`, `Streamed N <unit> ago` — with no contradicting signal | eligible |
| `SCHEDULED_UPCOMING` | `Premieres …`, `Scheduled for …`, `Upcoming`, `Premiere` badge, `N waiting`, a card-scoped **Notify me** button (text or accessible name) | skipped, not counted |
| `LIVE_NOW` | `LIVE`, `Live now`, `N watching`, `Premiering now` | skipped, not counted |
| `INDETERMINATE` | none of the above, both published and upcoming/live signals, two different ages, links to two different videos, no readable title, or title attribute and visible title disagreeing | **fail closed** — `Review video status`, nothing copied |

Rules that keep this honest:

- **Never the title.** The card's `h3` heading and `#video-title(-link)` are
  excluded from status reading. A title saying "LIVE" or "Premieres tomorrow"
  changes nothing.
- **Never hidden elements** (`hidden` attribute), and never this extension's own UI.
- **Never sitewide.** Only the card's own subtree is read.
- **Never runtime.** A 0:58 normal upload is a normal upload.
- **Never "published because it has a watch URL".** No status → no copy.

Where these markers come from: the English status strings follow the
operator's FinTaxPro screenshots recorded in the brief (`Notify me`,
`Premieres …`) and YouTube's long-standing grid wording. Card containers and
watch-link selectors are the ones v1.1.0 verified live. The new markers have
**not** been observed on a live 2026 page by this build.

**Order check.** Latest must read newest → oldest. If a card's displayed age is
clearly younger than one above it (a pinned or reordered card), both Latest
exports refuse with `Review video order` rather than claim DOM order is
chronology.

## 4. Copy 12 URLs

Output unchanged. New refusal labels:

| Shows | Meaning |
| --- | --- |
| **Review video status** | A card above the 12th could not be classified. Hover for the grid position and video ID. Nothing copied. |
| **Review video order** | The grid's displayed ages are out of order. Nothing copied. |

A toast reports `Skipped N upcoming/live videos (not published)` when any were
skipped. Refusal labels stay visible for 6 s (was 2.5 s) so the tooltip can be
read.

## 5. Copy Channel Details

Example (generated by the shipped code from SIMULATED markup):
[`docs/v1.2.0-candidate-examples/copy-channel-details.SIMULATED.json`](docs/v1.2.0-candidate-examples/copy-channel-details.SIMULATED.json).
Shape:

```json
{
  "capture_type": "TERNARY_HOUSE_BROWSER_EVIDENCE_INPUT",
  "capture_format_version": "1.0",
  "is_creator_evidence_packet": false,
  "evidence_maker_validation_required": true,
  "captured_at": "2026-10-10T11:30:00+06:00",
  "source": { "type": "browser_dom_capture", "source_ref": "D1", "tab": "VIDEOS", "sort": "LATEST", "...": "..." },
  "channel": { "channel_name": "...", "channel_handle": "@...", "channel_url": "https://www.youtube.com/@...",
               "description_text": "...", "description_extent": "PARTIAL", "...": "..." },
  "channel_more_info": { "country_or_region": null, "joined_text": null,
                         "subscriber_count_text": "84.2K subscribers", "video_count_text": "312 videos",
                         "lifetime_views_text": null },
  "sample": {
    "selection_method": "12_MOST_RECENT_CONSECUTIVE_ELIGIBLE_PUBLISHED_VIDEOS",
    "required_count": 12, "actual_count": 12, "ordering": "NEWEST_TO_OLDEST",
    "videos": [ { "position": 1, "video_id": "...", "video_url": "https://www.youtube.com/watch?v=...",
                  "title": "...", "title_source": "DOM_TITLE_ATTRIBUTE", "title_truncated_in_ui": null,
                  "published_text": "2 days ago", "duration_text": "10:15", "thumbnail_text": null,
                  "publication_state": "PUBLISHED_COMPLETED", "publication_state_basis": "CARD_PUBLISHED_AGE_TEXT",
                  "grid_position": 2, "source_ref": "D1" } ],
    "excluded_not_in_sample": [ { "grid_position": 1, "video_id": "...", "publication_state": "SCHEDULED_UPCOMING",
                                  "status_text": "Premieres 10/11/26, 8:00 PM" } ]
  },
  "capture_limitations": [ "..." ]
}
```

Provenance and honesty rules:

- **Channel identity** comes from the page header and is cross-checked against
  the URL handle and the tab title. A mismatch (for example a header not yet
  updated after SPA navigation) refuses with `Channel identity unclear`. No
  handle is invented for a `/channel/UC…` page without one.
- **Description** is the header preview: `description_extent` is `PARTIAL`
  (never `FULL`) or `UNAVAILABLE`. The About panel is **not** opened, so
  country, joined date and lifetime views are always `null`. Subscriber and
  video counts are copied as displayed when the header shows them.
- **Titles** prefer the card's `title` attribute (`DOM_TITLE_ATTRIBUTE`) over
  clipped visible text (`VISIBLE_TEXT`); `title_truncated_in_ui` is `true` only
  when the visible text is an ellipsis-clipped prefix, else `null`.
- **thumbnail_text** is always `null`: thumbnail lettering is image content; no OCR.
- Strict JSON (`JSON.stringify`), Unicode as characters; quotes, backslashes
  and newlines round-trip exactly (tested with Bengali, Hindi and emoji).

Labels: `Copied channel details`, `Switch to Latest`, `Found N of 12 — load/retry`,
`Review video status`, `Review video order`, `Channel identity unclear`,
`Ready — click to copy`, `Copy failed`.

## 6. Copy all video URLs

```text
Total URLs: 347
Sort: Oldest

1. https://www.youtube.com/watch?v=...
...
347. https://www.youtube.com/watch?v=...
```

Example: [`docs/v1.2.0-candidate-examples/copy-all-video-urls.SIMULATED.txt`](docs/v1.2.0-candidate-examples/copy-all-video-urls.SIMULATED.txt).
To feed a tool that wants URLs only, delete the first three lines.

- Reads only `ytd-rich-item-renderer` / `ytd-grid-video-renderer` cards in the
  Videos grid, including off-screen ones still in the page. No global link
  scraping; one card counts once however many links it has.
- Canonical `https://www.youtube.com/watch?v=ID`; Shorts, playlists, channel
  links, foreign hosts and invalid IDs ignored; duplicates kept at first position.
- `Sort:` is the active chip's label, or `Unknown`. It never blocks the copy.
- One synchronous snapshot per click; the clipboard write starts inside the
  click. No prepared block exists, so nothing can go stale.
- Labels: `Copied N URLs`, `No loaded video URLs`, `N cards not ready — retry`
  (a card still rendering, or a card linking two different videos — nothing
  copied), `Video grid not found`, `Busy — retry` (another export or the
  metrics are scrolling), `Copy failed`. The success tooltip gives the card
  count and ignored duplicates/Shorts.

**Not a channel inventory.** The count is what is loaded in the page. Whether
YouTube discards earlier cards during very deep scrolling (virtualization) has
**not** been measured; see section 9.

## 7. What did not change

Verified by diff against v1.1.0: no change to `lib/`, `background/`,
`options/`, `content/render.js`, `content/content.css`; `collectVideoIds()`,
`harvestVideoIds()`, `TARGET_CANDIDATES = 30`, `checkLatestOrdering()`,
`readSortChips()`, the `ANALYZE` request and the metric path are byte-identical.
Permissions are unchanged (`storage` + `https://www.googleapis.com/youtube/v3/*`).
No new network request, API call, telemetry, storage or service-worker message.
The manifest adds two content-script files and the version `1.2.0` /
`version_name: 1.2.0-candidate`.

## 8. Validation performed

**Automated (`npm test`), 0 failures under UTC, Asia/Dhaka and America/Los_Angeles:**

| Suite | Tests |
| --- | --- |
| `calculations.test.mjs` | 44 (unchanged) |
| `youtube-api.test.mjs` | 31 (unchanged) |
| `clipboard.test.mjs` | 20 (unchanged) |
| `url-export.test.mjs` | 44 (loader + fixture shape updated; no assertion changed) |
| `video-selection.test.mjs` (new) | 54 |
| `channel-details.test.mjs` (new) | 29 |
| **Total** | **222** |

Changes to the pre-existing `url-export.test.mjs`, all required by the new
fail-closed rule and none changing an assertion: the loader also evaluates
`content/video-selection.js` (which now owns the URL primitives); the `video()`
fixture helper and test F's inline entries declare `state:
'PUBLISHED_COMPLETED'`, the field the production reader always supplies.
Without it those entries are, correctly, never treated as published.

**Mutation testing:** 22 deliberate defects (scheduled counted, fail-open on
unknown status, title or hidden text read, conflicts ignored, order check off,
60-card cap, no de-duplication, lexical re-sort, a Latest guard on the general
export, identity mismatches ignored, `FULL` description, thumbnail text
fabricated, …). 21 are caught; the survivor is equivalent (a second guard in
the same function refuses it).

**Real Chromium, real extension, SIMULATED pages**
(`node tests/browser/extension-harness.mjs`, optional, needs Playwright): 41
checks passing — bar order and single mount, both Latest exports agreeing
position by position with two scheduled Premieres at the top, JSON fields,
general export on Latest/Popular/Oldest with no scrolling, Popular refusal
with the clipboard untouched, bounded top-up with scroll restore, SPA switch
to another creator, 1,000 loaded cards (16 ms DOM pass), identical reader
output in the test DOM and Chromium, bar wrapping at 1280/800/420 px without
overlapping the sort chips (fixture CSS, not YouTube's), missing-API-key
metrics message, and no request outside the fixture origin.

## 9. Required live checks before production (not yet done)

Use a **separate Chrome profile** with the candidate loaded unpacked, so the
installed v1.1.0 is untouched.

1. **FinTaxPro** `youtube.com/@FinTaxPro/videos` while its Premieres are still
   upcoming: Copy 12 URLs skips them (toast says so); Copy Channel Details lists
   them only under `excluded_not_in_sample`; IDs 1–12 identical in both; Copy
   all video URLs includes them. If the Premieres have already happened, record
   that and do not count this check as passed.
2. A channel with **completed Premieres** (e.g. `@TorinHofmann`): no
   `Review video status`, Premieres included.
3. An **ordinary channel**: both Latest exports succeed; titles, ages and
   durations in the JSON match the cards.
4. A channel that is **live right now** with the stream on the Videos tab, if
   one can be found: it is skipped.
5. **Popular/Oldest:** Latest exports show `Switch to Latest`, clipboard
   unchanged; Copy all video URLs works and its `Sort:` line is right.
6. **Deep scroll / virtualization:** on Paul J. Lipsky (or any channel with
   1,000+ videos) scroll several years deep, click Copy all video URLs, and
   check that `Total URLs` matches the number of cards from the top to where
   you stopped and that the first URL is still the newest video. If the
   earliest videos are missing, YouTube is discarding cards — report it; do
   not use the export as complete history.
7. **Header:** channel name, handle (capitalisation), subscriber/video counts
   and description preview in the JSON match the page; a `/channel/UC…`
   channel without a handle gives `channel_handle: null`.
8. **SPA:** creator A → creator B without reload: one bar; B's data only.
9. **Narrow window:** bar wraps, sort chips and channel header stay usable.
10. **Missing API key** (fresh profile): all three exports work; Avg Views
    shows the key message.
11. **UI language:** confirm the operator's YouTube UI is English. In any other
    language the two Latest exports will show `Review video status`.
12. **Metrics unchanged:** Avg Views / Engagement on Futurepedia and Torin match
    v1.1.0's values.
13. **Timing:** time one Copy Channel Details capture versus the current
    screenshot + separate-URL routine, and separately the time until Evidence
    Maker returns a usable validated packet.

## 10. Known limitations and open risks

- **English UI only for publication state.** Non-English YouTube UI fails
  closed on every card (`Review video status`). This is a deliberate
  regression from v1.1.0, which copied in any language but could include
  scheduled Premieres.
- **Unverified live markers.** If live YouTube words a status differently
  (e.g. an absolute date instead of `… ago`), the Latest exports fail closed,
  visibly. If a live card shows *only* a stale upcoming signal and no age,
  it would be skipped; the toast and `excluded_not_in_sample` make that
  auditable.
- **Members-only videos** are treated like any published video; whether they
  should be excluded as "inaccessible" is an open policy question.
- **Virtualization** of very long grids is unmeasured (section 9.6).
- **About panel not opened**: country, joined date, lifetime views and the
  full description are never captured.
- **Evidence Maker compatibility**: the current Evidence Maker (v1.3) expects
  screenshot provenance. A new Evidence Maker spec that accepts
  `browser_dom_capture` / `D1` must be written and validated before Ohi uses
  this button. ChatGPT classifier v1.4 and Gemini classifier v1.6 compatibility
  with the resulting CEP has not been reviewed.
- If DOM-only status reading proves unreliable live, the fallback is an
  optional, separately authorised YouTube Data API eligibility check (it would
  need the API key and quota); it is **not** implemented.

## 11. Installing the candidate for acceptance testing

Do not replace the installed v1.1.0. In a separate Chrome profile: open
`chrome://extensions`, enable Developer mode, **Load unpacked**, choose this
folder. It shows as **1.2.0-candidate**. Add an API key in that profile only if
testing the metrics.
