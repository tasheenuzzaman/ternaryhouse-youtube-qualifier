# Ternary House YouTube Qualifier — Copy Channel Details + Copy all video URLs + Published-Video Selection

**Engineering implementation brief v1.2 — proposed candidate; not production authorization**  
**Source inspected:** `ternaryhouse-youtube-qualifier-v1.1.0-stable.zip`  
**Proposed release:** v1.2.0 candidate  
**Owner for implementation:** Claude Code / assigned developer. **Acceptance/production authorization:** Founder.  
**Scope:** Add `Copy Channel Details` and `Copy all video URLs` as two distinct actions; repair the existing `Copy 12 URLs` unpublished-Premiere handling. Do not alter metric methodology or the locked downstream classifiers.

## 1. Objective and operator experience

The current browser extension exposes `Avg Views`, `Engagement`, `Copy 12 URLs`, and refresh. Add **`Copy Channel Details`** immediately to the right of `Copy 12 URLs`, then add **`Copy all video URLs`** immediately after `Copy Channel Details`, before refresh, inside the **existing extension-owned Shadow DOM bar**, not YouTube's native Latest/Popular/Oldest chips. On narrow windows, controls must wrap or otherwise remain accessible without covering the YouTube sort chips or channel header.

Desired bar:

`TH | Avg Views | Engagement | Copy 12 URLs | Copy Channel Details | Copy all video URLs | ⟳`

A click on **Copy Channel Details** should prepare and copy **one self-contained, strictly parseable JSON text block** containing the channel identity, its direct channel URL, all **12 eligible published video identities**, their **canonical individual watch URLs**, and available factual metadata. The operator should paste that **single block** into the Creator Evidence Maker chat **without taking channel/video screenshots and without separately copying the 12 URLs for Evidence Maker**. This screenshot-free downstream workflow remains a candidate until the Evidence Maker specification is updated and tested.

Keep **Copy 12 URLs** as a separate existing action whose exact **12 numbered URL lines** are useful for Gemini's explicit-URL input. Do not add metadata to that URL-only output. Both exporters must use the **same eligible-video selection** and agree on IDs 1–12.

**Independent fifth-button contract:** `Copy all video URLs` collects *every valid, unique watch-video link from the currently loaded/retained cards in the creator's Videos-tab grid*, in the grid's current visual order. It works on **Latest, Popular, or Oldest** without asking for or switching to Latest. It is intentionally not the eligible-published-12 selector; do not accidentally reuse that selector's cap or scheduled-Premiere filter for the general export. No automatic scrolling or background catalogue discovery is authorized. Full behavior and edge cases are defined in §5A.

Do not create a CEP directly within the extension in this change. The browser capture is **source evidence**, not a signed-off `READY` CEP. The Evidence Maker remains the normal validation/packet-production step until a separately approved architecture change.

## 2. Verified implementation baseline

I inspected the uploaded **v1.1.0 stable ZIP**. It contains:

- `content/content.js`: controller lifecycle, Latest sort guard `checkLatestOrdering()`, channel route/identity detection, metric collector `collectVideoIds()`, Shadow DOM toolbar, the current export button, shared DOM lock, existing clipboard adapter.
- `content/url-export.js`: current `readGridEntries()`, `selectExportIds()`, `createUrlExporter()`, `createDomLock()`, `watchIdFromHref()`, `formatExportBlock()`.
- `content/render.js`: existing clipboard helper and UI.
- `background/service-worker.js`, `lib/analysis.js`, `lib/calculations.js`, `lib/youtube-api.js`, `lib/security.js`: metric/API/security pipeline. **Do not modify their business rules** to implement this feature.
- `manifest.json`, `tests/url-export.test.mjs`, other three existing test suites.

`npm test` on the provided ZIP passed: **44 calculation + 31 YouTube/API/security + 20 clipboard + 44 URL-export = 139 tests, 0 failures.** Preserve all 139 existing tests (update URL-export tests only when its newly required eligibility behavior makes old expectations obsolete, and explain those updates).

### Confirmed defect in v1.1.0 URL selection

`content/url-export.js` currently reads a video's normal `/watch?v=` anchor, excludes structural `/shorts/` links, and takes the first 12 unique watch IDs. Its grid entries are presently `{shorts, href}`; `selectExportIds()` has **no upcoming-Premiere/current-live eligibility detection**. Therefore an **unpublished scheduled Premiere** can be incorrectly exported because it already has a valid watch URL.

**Observed FinTaxPro example, 2026-10-10:** user screenshots show two cards scheduled for upcoming premieres (Oct 11 and Oct 12) with **`Notify me`** and future **`Premieres ...`** information. Those cards must be excluded; two older, actually published eligible videos must be pulled up to complete the 12. The Evidence Maker was correct to reject the original positional URL list after the video sample changed.

## 3. One shared eligibility/selection contract for both copiers

The latest 12 eligible videos means exactly:

- Current creator **Videos** tab, explicitly on **Latest** (never Popular/Oldest).
- **12 most recent consecutive *published, completed, normal Videos-surface* uploads**, newest to oldest. No cherry-picking, skipping an off-topic video, or three-month cutoff.
- Exclude Shorts by structural surface/URL, not duration. Keep a **0:58 normal Videos-tab `/watch` video** if it meets other eligibility rules.
- Exclude **scheduled and not-yet-published Premieres**.
- Exclude **upcoming and currently live broadcasts**; completed published Premieres are **included**. Do not exclude all cards mentioning the word "Premiere".
- Exclude other demonstrably unpublished/inaccessible or unfinished items in the normal Videos grid.
- Retain only 12 unique canonical 11-character video IDs; each selected item's title/date/duration/url must come from the **same matched card/identity**.
- A skipped scheduled Premiere does not count toward 12. Continue down Latest, using bounded loading, until 12 eligible videos are collected or eligibility/inventory is genuinely indeterminate.

Implement a **shared low-level card-reader/eligible-video selector** used by both `Copy 12 URLs` and `Copy Channel Details`, preferably an isolated `content/video-selection.js` and pure unit-testable helpers. If necessary, extend `url-export.js` with backward-compatible entry fields/status and migrate both exporters to the same selector. Do not create two unrelated eligibility algorithms; that would allow mismatching positions.

### Safe state detection

Inspect **actual YouTube DOM card markup** (both modern view-model cards and legacy `ytd-*` renderers) before coding. Use card-scoped indicators in priority order, when reliable:

- **Scheduled/unpublished:** an upcoming-event indicator, a card-scoped `Notify me` action, explicit future Premiere timestamp/text, or equivalent stable structured card metadata.
- **Live/in-progress:** a card-scoped LIVE/current-stream indicator or other reliable actual-state metadata.
- **Published/completed:** card-scoped actual published-age/date or completed-Premiere text and other reliable published-video indicators, with no contradictory upcoming/live signal.
- **Indeterminate:** insufficient or conflicting status or a partially mounted card. **Do not silently call it published merely because the watch URL exists.** Return a clear `Review video status` / equivalent failure rather than copying the wrong sample.

Never use phrases embedded in the **title or thumbnail artwork** as proof of scheduled status; do not exclude a finished Premiere because of historical title wording. Avoid sitewide `Notify me` detection—check only the specific video card. Calendar strings and local time require careful handling; prefer explicit UI status/structured metadata over speculative date parsing. If page status genuinely cannot be established without API, fail visibly rather than silently assume.

If the DOM cannot reliably distinguish states on real pages, report that **DOM-only detection is a blocker** and propose an optional separately authorized YouTube Data API eligibility check (which might require a key/quota). **Do not quietly add API calls or broaden permissions.**

### Important metric separation

The **Avg Views/Engagement** pipeline already calls the YouTube Data API, has its own upcoming/live/completed-broadcast classifier and uses a maximum-12 sample within **the last 3 UTC calendar months**, with separate trimming/valid-observation rules. **Do not change any of that.** Export selection and metric selection have different time windows and must remain separate.

Do not change `collectVideoIds()` / `TARGET_CANDIDATES=30` / existing metric DOM collection or `ANALYZE` request inputs. Do not change `lib/calculations.js`, `lib/analysis.js`, `lib/youtube-api.js`, service worker, caching, API-key flow or security model merely to fix the exporter.

## 4. `Copy Channel Details`: exact captured information

The new clipboard must be one **strict parseable JSON** source-evidence block (no Markdown links, no rich-text artifacts), designed to be pasted into Evidence Maker. It should contain the following categories. Do not label it `READY` or pretend it is a Creator Evidence Packet:

- `capture_type`: `TERNARY_HOUSE_BROWSER_EVIDENCE_INPUT`.
- `capture_format_version`: independent version such as `1.0` (NOT CEP schema version).
- `captured_at`: actual current capture timestamp, explicitly not an upload timestamp.
- `source`: `browser_dom_capture`; `source_ref`: `D1`; route `VIDEOS`; sorting `LATEST`; eligibility note indicating only published/completed selected; no browsing/video playback.
- `channel`: `channel_name`, `channel_handle` (actual, case-preserving), **clean canonical `channel_url`** like `https://www.youtube.com/@PaulJLipsky`, `description_text` (full description when page-backed; else exactly the available portion or `null`), `description_extent` (`FULL`/`PARTIAL`/`UNAVAILABLE`). Do not fabricate a handle when the channel has only a `/channel/UC...` route.
- `channel_more_info` (optional, *only when honestly page-backed*): `country_or_region`, `joined_text`, `subscriber_count_text`, `video_count_text`, `lifetime_views_text`; **use null for unavailable fields**. These are factual capture fields, **not niche fit/eligibility proof**. Do not infer country, language, sex or audience from them.
- `sample`: selection method `12_MOST_RECENT_CONSECUTIVE_ELIGIBLE_PUBLISHED_VIDEOS`; count 12, order newest to oldest; an array of exactly 12 videos.
- Every `video` object: `position`, `video_id`, **canonical `video_url`**, official `title` string faithfully extracted from that same video card, `title_source`, `title_truncated_in_ui` when truly detectable (`null` if not), `published_text` (`null` if absent), `duration_text` (`null` if absent), optional thumbnail-overlay text only if **actual DOM text** (`null` otherwise), `source_ref: D1`, and a factual confirmed published-state basis. Preserve Unicode, punctuation, quotes and internal newlines in parseable JSON.
- `capture_limitations`: brief noncritical missing-field notes. Status ambiguity, conflicting channel identity, uncertain Latest order, inconsistent URL/title alignment, or fewer than 12 established eligible videos should prevent a successful complete export, not just appear as a limitation.

**Do not spend time extracting user handles, subscribers, country, joined date, lifetime views or full About text if they are not immediately accessible in the current loaded page.** Optional fields must not block the primary one-click extraction. If the public "...more / More info" panel can be opened, read, and closed programmatically **safely and reliably**, without leaving the channel, losing the selected video state, activating unrelated UI, or requiring new permissions/network calls, Claude may implement it **after testing**. Otherwise, simply capture available text and use `null`; report this as a limitation rather than pretending full About metadata was collected. Avoid reading hidden page-global data or injecting code in the page's main execution world unless independently justified and approved.

Thumbnail lettering painted into an image is not DOM text. **Do not do OCR, hallucinate it, or require it.** If YouTube's UI clips a title but a trustworthy official title attribute provides the full wording, preserve the source type (`DOM_TITLE_ATTRIBUTE` vs `VISIBLE_TEXT`) and do not misrepresent that as screenshot-visible text.

**Keep optional channel metrics out of the downstream niche-classification inference.** Evidence Maker should copy only doctrine-authorized fields into the CEP; subscriber count, cumulative views, country and channel age do not establish CORE/ADJACENT/OUTSIDE.

### Example — conceptual truncated JSON (not a real capture)

```json
{
  "capture_type": "TERNARY_HOUSE_BROWSER_EVIDENCE_INPUT",
  "capture_format_version": "1.0",
  "captured_at": "2026-10-10T11:30:00+06:00",
  "source": { "type": "browser_dom_capture", "source_ref": "D1", "tab": "VIDEOS", "sort": "LATEST" },
  "channel": {
    "channel_name": "Example Creator",
    "channel_handle": "@example",
    "channel_url": "https://www.youtube.com/@example",
    "description_text": "Available source-backed description",
    "description_extent": "PARTIAL"
  },
  "channel_more_info": {
    "country_or_region": null,
    "joined_text": null,
    "subscriber_count_text": null,
    "video_count_text": null,
    "lifetime_views_text": null
  },
  "sample": {
    "required_count": 12,
    "actual_count": 12,
    "ordering": "NEWEST_TO_OLDEST",
    "videos": [
      {
        "position": 1,
        "video_id": "AAAAAAAAAAA",
        "video_url": "https://www.youtube.com/watch?v=AAAAAAAAAAA",
        "title": "Actual extracted title",
        "title_source": "DOM_TITLE_ATTRIBUTE",
        "title_truncated_in_ui": null,
        "published_text": "1 day ago",
        "duration_text": "10:15",
        "thumbnail_text": null,
        "publication_state": "PUBLISHED_COMPLETED",
        "publication_state_basis": "VERIFIED_CARD_PUBLISHED_METADATA",
        "source_ref": "D1"
      }
    ]
  }
}
```

**Example has one object to illustrate shape; actual successful output must have all 12.** Use capture timestamp from the actual clock, not this example time.

## 5. One-click export + existing URL button

- `Copy Channel Details` should copy **one self-contained block** including video URLs. No separate URL-button click is required to create Evidence Maker's input; the same channel URL need not be pasted again. `Copy 12 URLs` remains convenient for Gemini's required explicit 12-URL prompt.
- Both buttons call the same publication-aware selection routine, with the same count/order/IDs and no inclusion of upcoming premieres. Do not change the **visible output format** of `Copy 12 URLs`: exactly 12 numbered lines, as v1.1.0 already specifies.
- Sort guard: Latest only. Popular/Oldest → `Switch to Latest`, no clipboard change.
- Scroll: use the existing bounded lazy-loading approach and shared `createDomLock()`, do not interfere with concurrent metric collection, restore scroll on completion.
- Clipboard: reuse the existing `THQRender.copyText` adapter. Be mindful that asynchronous lazy-loading may expire the click's transient user activation. Reuse validated `Ready — click to copy` two-click fallback, with channel-scope, sort, eligible-video IDs, and TTL revalidation before second click. Never copy stale data from another SPA channel.
- If only 10 published eligible videos can be **reliably proven to exist**, do not create a 12-video block. If 10 were merely DOM-loaded and more may exist, say `Found 10 of 12 — load/retry` rather than concluding the channel truly has only 10. If an ambiguous scheduled-status item prevents safe selection, clearly ask the operator to review it.
- No new server, telemetry, analytics, unnecessary Chrome permission, or user data collection.

## 5A. `Copy all video URLs`: independent general-purpose export contract (NEW in v1.2)

### Operator action and scope

- Button text, capitalization, and relative position: **`Copy all video URLs`**, immediately to the right of **`Copy Channel Details`**, before refresh.
- Works only on the currently visited creator's **Videos tab**, e.g. `/@PaulJLipsky/videos`. Does not run on YouTube search results, Home, Shorts, playlists, or another creator's page. It works on **any currently selected Videos-tab sort**: Latest, Popular, or Oldest.
- The operator chooses the sort and **manually scrolls as far as desired** to load more videos, then clicks once. The button scans the **currently loaded, retained video cards of that Videos-tab grid**, including cards that are off-screen but still loaded in the document. Do not restrict collection to cards currently within the screen viewport. **Do not auto-scroll, click to load more, open videos, fetch channel data, or call the YouTube API.**
- This is a bounded-by-the-DOM collection of *available cards*, **not a complete channel inventory**. A channel that shows `1.1K videos` does not authorize output of `1,100` URLs if only 350 are loaded. If the page discards previously loaded cards during deep scrolling (virtualization), either capture only what is provably retained and disclose the limitation or separately design/test a passive, channel/sort-scoped session cache. Never silently claim full scrolled history or invent missing entries. Do not add a passive cache without testing invalidation on sort changes/channel navigation and making its behavior explicit.
- Read the video grid DOM in its **current display/card order**. No chronological reconstruction or popularity re-ranking; if Oldest is selected, the first loaded Oldest card is `1`; if Popular is selected, the first loaded Popular card is `1`. The clipboard order must match the source page's card order, not URL lexical order, timestamps, or IDs.
- Do **not** apply `MAX_ITEMS_READ=60`, `EXPORT_COUNT=12`, `maxLoadSteps=4`, the three-month metric window, `isLatest`, or the CEP-only publication-eligibility selector to this general exporter. With 1,000 loaded cards, attempt 1,000 in a single efficient DOM pass; no arbitrary silent truncation. Do not impose an unannounced URL cap.

### Selection and formatting

- Traverse only genuine cards in the current creator's Videos grid: the renderer structures already used by `url-export.js` (`ytd-rich-item-renderer`, `ytd-grid-video-renderer`) plus verified equivalent modern YouTube card renderers if necessary. **Do not** scrape global `a[href*=watch]` outside the grid or duplicate links from a single card's thumbnail/title overlays.
- Extract only valid direct `/watch?v=<11-character VIDEO_ID>` values on approved YouTube hostnames. Canonicalize to `https://www.youtube.com/watch?v=VIDEO_ID`, stripping playlists, share/tracking parameters, timestamps, and hashes. Ignore `/shorts/`, playlists, redirects, search-result links, channel links, and non-video links.
- De-duplicate by video ID, retaining the **first occurrence** and its position. If duplicate cards appear, do not increment the output count twice. For an unresolved incomplete/ambiguous watch card that might be a video, do not silently pretend the export is complete: clearly indicate skipped/ambiguous entries or refuse to copy when the ambiguity materially compromises order or correctness. A card not representing a video can be skipped.
- **Scheduled Premieres:** unlike the strict 12 eligible-*published*-video export, this general loaded-link inventory includes a scheduled/unpublished Premiere **if it appears as a Videos-grid card with a valid watch URL**. The button reports available URLs, not whether subtitles already exist. Do not accidentally conflate its inventory with a CEP-eligible video sample. A separate `Copy 12 URLs` and `Copy Channel Details` continue to exclude unpublished scheduled Premieres and active/upcoming livestreams.
- When the selected sort can reliably be read from YouTube's active sort chip, record it as `Latest`, `Popular`, or `Oldest`. If it cannot be read, record `Unknown` rather than guessing. Lack of sort recognition **must not block** this general copy action; it must still preserve DOM card order.
- On success, the clipboard must contain **plain text** (not Markdown links/JSON/rich text), with a **true count** and numbered watch URLs, as follows. No URLs other than actual captured cards may appear:

```text
Total URLs: 347
Sort: Oldest

1. https://www.youtube.com/watch?v=AAAAAAAAAAA
2. https://www.youtube.com/watch?v=BBBBBBBBBBB
3. https://www.youtube.com/watch?v=CCCCCCCCCCC
...
347. https://www.youtube.com/watch?v=ZZZZZZZZZZZ
```

`347` and the IDs above are illustrative. The actual count must equal the number of unique URLs present in the copied numbered lines. For downstream tools that expect *only* URLs, the developer may additionally document a reliable way to strip the two header lines, **but the default format is exactly the count/sort header plus numbered URLs requested here**.
- On successful copy, give a compact accurate status such as `Copied 347 URLs`, not `Copied all 1.1K videos` or an unsupported claim about the total catalogue. If zero URLs found, give `No loaded video URLs` and do **not** overwrite the clipboard.
- Use the existing clipboard adapter and handle write errors. Since this exporter is a synchronous, single-snapshot DOM read, attempt clipboard copying within the click gesture; avoid unnecessarily awaiting operations that would lose user activation. If browser restrictions require a second click, explicitly show a prepared state and revalidate page/sort/channel/snapshot before copying.
- The actual list should be collected only from one coherent source snapshot. On YouTube SPA navigation, channel identity change, sort change during execution, grid regeneration, or browser tab route changes, abandon the stale result rather than copy mixed-creator/mixed-sort URLs. A prepared clipboard block must never survive changes in creator route, sort, video-list identity, or a reasonable short TTL.

### Relationship to existing and proposed controls

`Copy 12 URLs` (Latest-only, 12 eligible published) **must not** change its exact 12-numbered-line output. `Copy Channel Details` (Latest-only, same 12 eligible published) remains a self-contained source-evidence capture. `Avg Views` and `Engagement` remain Latest-only and use their own existing methodology. `Copy all video URLs` is the *only* new sort-agnostic, arbitrary-loaded-count export. Its different scope is intentional, so **do not share the strict 12-video selector** with it; share safe low-level URL normalization / grid-card reading helpers where possible.

### Important tradeoff to test

A user who scrolls from recent uploads to four-year-old ones expects every still-loaded intermediate item. Verify on a real long channel (such as the user-supplied Paul J. Lipsky example) whether the loaded card DOM retains the full traversed list. If YouTube virtualizes/discards earlier cards, **document the measured coverage accurately and propose passive scoped caching separately**, rather than silently returning only a small end-of-page slice as if it were all the loaded history. No self-initiated full channel crawl should be introduced.

## 6. Test plan — required before production authorization

**Automated baseline:** existing 139 tests must pass, plus new deterministic tests. Record any changes made to pre-existing test expectations and why. In particular:

1. Two scheduled Premiere cards at positions 2 and 4 + 12 other published candidates → **skip both scheduled**, select 12 published in newest-to-oldest order from deeper down the grid.
2. **Completed Premiere** with real completed published metadata remains eligible.
3. Active live/upcoming broadcast excluded.
4. A `0:58` normal Videos-tab `/watch` upload remains included; Shorts `/shorts/...` excluded.
5. A card has `/watch?v=` but unreadable/contradictory scheduled status → **fail closed**, not silently count it.
6. Multiple representations/anchors of the same video → dedupe by ID, keep metadata attached to the correct card.
7. Correct code handling of pinned/out-of-order cards if YouTube actually presents them on Videos→Latest; don't claim guaranteed chronology from a misleading DOM order.
8. Existing `Copy 12 URLs` output stays **exactly 12 numbered canonical links**; new details copier includes those same 12 IDs/URLs at the same positions.
9. Channel name, actual handle, channel URL; exact/full vs truncated description provenance; optional `More info` fields available and unavailable.
10. Full titles from trustworthy DOM attributes vs UI clipping; correct `null` handling for thumbnail text; no arbitrary OCR.
11. Strict JSON round-trip for quotes, backslashes, newline characters, Hindi/Bengali/other Unicode.
12. Fail safely on fewer than 12, ambiguous publication status, wrong sorting, lazy-load failure, clipboard refusal, page navigation, stale prepared lists, and metric/export concurrency.
13. Run every original calculation, YouTube/API/security, clipboard and URL export regression test; do not change metric semantics or API-key behavior.

**Additional tests for `Copy all video URLs` (mandatory):**

1. Latest, Popular, and Oldest each export the **same order as the rendered card grid** for their respective sort, with correct `Sort:` label if recognized; no sort guard blocks Popular or Oldest.
2. Manually appended 12, 60, 120, 1,100 cards: output all retained unique valid watch IDs in DOM order; regression confirms no accidental `MAX_ITEMS_READ=60`/12 cap or extra scrolling.
3. Duplicate watch anchors per card and duplicate cards do not double-count; invalid IDs, foreign hostnames, playlist and Shorts paths are ignored.
4. A scheduled Premiere with a valid watch URL is included by the **general** loaded-inventory export but excluded by **both** CEP 12-video export buttons; explicitly validate the distinction with the FinTaxPro fixture.
5. Sort changes before click change output order; a sort/channel change during click or before a prepared second-copy click cancels/revalidates rather than exporting stale results.
6. Screenshots/fixture for manual scrolling several years deep: verify the result count matches all **retained grid cards**, not just those in the viewport. If virtualized, record the limitation and do not falsely call export complete for prior detached cards.
7. Clipboard format parser: `Total URLs` number equals length of numbered lines, sequential numbering `1..N`, each URL canonical and unique; simulate a failed clipboard write without overwriting old clipboard.
8. Zero valid cards, ambiguous/partial cards, non-Videos route, stale SPA route, and missing grid handle errors explicitly.
9. No new permissions, API calls, background network requests, telemetry, or modification to metric calculations.

**Live testing:** Claude must inspect a real current Videos grid (don't invent selectors), including **FinTaxPro** `https://www.youtube.com/@FinTaxPro/videos` while its scheduled examples are still upcoming, plus a channel with **completed** Premieres and an ordinary channel. If FinTaxPro's scheduled events have occurred by live-test time, reproduce the exact state with a controlled DOM fixture rather than falsely claiming to have live-observed future scheduled status. Verify exclusion of scheduled positions and complete 12 selection. Cross-check both buttons positionally on the same page/snapshot. Also retest Popular/Oldest refusal, missing YouTube API key, screenshot-free capture, creator SPA switching, no duplicated bar and unchanged metric audit/methodology. If live access is unavailable, state explicitly which tests are only simulated.

**Performance verification:** measure (a) time to acquire a single complete source block versus current screenshots + separate URLs, and (b) total time until Evidence Maker returns a usable validated CEP. The export improving capture is not proof that AI packet preparation becomes fast.

## 7. Downstream compatibility — do not silently change locked systems yet

Current published **Creator Evidence Maker** instruction/spec v1.3 requires screenshot-provenance evidence, including visible-title extraction. Before switching Ohi to the new button, prepare and separately validate a minimal **new Evidence Maker spec/instruction version** that accepts `browser_dom_capture` and maps source `D1` into legitimate CEP provenance. It must preserve exact-12 rules and honest title-source differences.

Review the exact installed classifier specs **ChatGPT classifier v1.4, Gemini classifier v1.6** (as referenced in the previous brief) for compatibility with the produced schema-v1.2 CEP before any source/instruction change; confirm rather than assume. Do not revise doctrine/classifier logic merely because the extension captures different source data. Ohi's existing final operator runbook also needs a narrow update, but only after the complete screenshot-free pathway has passed validation and been authorized.

## 8. Release and reporting requirements

- Preserve the uploaded `ternaryhouse-youtube-qualifier-v1.1.0-stable.zip` and prior stable archives **byte-for-byte**. Work only in a cloned **v1.2.0 candidate** source tree.
- Do not package a `-stable.zip`, replace installed production extension, update installed ChatGPT/Gemini projects, or publish the new process without explicit founder approval.
- Before approval, report: files changed; exact modern/legacy YouTube DOM markers used for published vs scheduled vs current live; fallback for ambiguity; shared 12-eligible selector architecture **and independent general loaded-grid enumeration**; code diff confirmation that metrics untouched; demo 12-row and multi-hundred-row copy outputs; channel description/More info availability; verified sort-agnostic general export; real deep-scroll retained-card count and any virtualization limitation; test suite totals and individual failures; genuine live validation vs fixtures; API/permissions differences (ideally none); clipboard and SPA safety; timing; CEP compatibility changes still needed.

**Acceptance test:** for a channel with scheduled Premieres mixed into the Latest Videos grid, **`Copy 12 URLs` and `Copy Channel Details`** select the exact same 12 **published, eligible** normal uploads (not the scheduled cards). One click on `Copy Channel Details` provides the channel URL, names/titles/dates/durations and 12 canonical watch URLs as a single aligned source-evidence block, with no screenshots. Separately, on a channel scrolled several years deep, `Copy all video URLs` exports **all unique loaded/retained Videos-grid watch URLs in their displayed Latest/Popular/Oldest order**, including page-listed scheduled Premieres where present, with a correct count and without automatic scrolling. No regression to the qualifier's existing metrics. Release remains pending until all relevant tests pass and the revised Evidence Maker consumes the details evidence correctly.
