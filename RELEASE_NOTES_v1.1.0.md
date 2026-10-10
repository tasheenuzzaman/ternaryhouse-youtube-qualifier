# Ternary House YouTube Qualifier — v1.1.0

**Status: STABLE / VALIDATED INTERNAL RELEASE**
**Date: 2026-10-02**
**Supersedes: v1.0.2 (v1.0.0, v1.0.1 and v1.0.2 remain frozen historical releases)**

| Release | Archive SHA-256 |
| --- | --- |
| v1.0.0 | `e8452ef53b450721547de6f48ded61fdca6a4c71a7aa5e7385c43c90e2c8739b` |
| v1.0.1 | `91fd8f717b91a2abed103aea3c23d98c2394781cd8e7aaedfe31a3481910f296` |
| v1.0.2 | `4a0f5d643555338afb812efede592f61383a08ab14356f0da85d818df9ce7230` |
| v1.1.0 | this release |

v1.1.0 adds one operator action, **Copy 12 URLs**. **Avg Views and Engagement
methodology is unchanged.** For the metric rules see
[RELEASE_NOTES_v1.0.0.md](RELEASE_NOTES_v1.0.0.md) (methodology and which rules
are **[COACH]** vs **[TOOL]**), [RELEASE_NOTES_v1.0.1.md](RELEASE_NOTES_v1.0.1.md)
(UTC recency window) and [RELEASE_NOTES_v1.0.2.md](RELEASE_NOTES_v1.0.2.md)
(compact copy semantics).

---

## 1. What's new: Copy 12 URLs

A new button in the Ternary House bar, between **Engagement** and **Refresh**:

```
TH  [ Avg Views ]  [ Engagement ]  [ Copy 12 URLs ]  [ ⟳ ]
```

On a channel's **Videos → Latest** tab it copies the watch URLs of the **12
newest unique normal Videos-tab uploads**, newest first, in exactly this form:

```
1. https://www.youtube.com/watch?v=VIDEO_ID_1
2. https://www.youtube.com/watch?v=VIDEO_ID_2
...
12. https://www.youtube.com/watch?v=VIDEO_ID_12
```

Twelve lines, one URL each, numbered `1.` to `12.`. No heading, titles, dates,
channel name, bullets, Markdown, blank lines or trailing text. Links are
canonicalised: timestamps, playlist, feature, share and tracking parameters and
hashes are dropped.

### It is a separate pipeline from the metrics

| | Avg Views / Engagement | Copy 12 URLs |
| --- | --- | --- |
| Sample | eligible videos in the last 3 UTC calendar months, max 12 | the 12 newest normal Videos-tab uploads, any age |
| Source | page IDs **+ YouTube Data API** | the page only |
| API key | required | **not required** |
| Service worker / API request | yes | **none** |
| Trimming, sample bands | yes | none |

A creator with 3 recent uploads gets `insufficient` from the metrics and still
gets their 12 newest URLs from the export. That difference is intended; the
export never feeds the metric sample and the metric collector is unchanged.

### Rules

- **Latest required.** On Popular or Oldest the button shows **Switch to
  Latest**, nothing is copied, and the sort is not changed.
- **Shorts are excluded structurally** — any grid item containing a `/shorts/`
  link. Only `/watch` links qualify.
- **Runtime is never used.** A 0:58 `/watch?v=` upload on the Videos tab is a
  normal upload and is exported.
- **Fewer than 12 obtainable** → **Found N of 12**; the clipboard is left
  untouched and nothing is padded or fabricated. This can mean the channel has
  fewer uploads or that the page had not loaded more.
- **Order is never shifted.** If a card's link has not rendered yet, the export
  waits for it instead of skipping it.
- **Bounded loading.** If fewer than 12 cards are on the page, the export loads
  more in at most 4 short steps, observing the page rather than sleeping, and
  restores the operator's scroll position afterwards.

### Button states

| Shows | Meaning |
| --- | --- |
| **Copy 12 URLs** | ready |
| **Copying...** | working |
| **Copied 12 URLs** | done |
| **Switch to Latest** | refused on Popular/Oldest |
| **Found N of 12** | refused: only N obtainable |
| **Ready — click to copy** | collected, but the browser refused the copy (see below) |
| **Copy failed** | the browser refused the clipboard |

### The "Ready — click to copy" fallback

Chrome only lets a page write to the clipboard for about 5 seconds after a
click. When the 12 cards are already on the page — the normal case — the copy
happens instantly on the click. If the export had to wait for cards to load and
the browser then refuses the write, the button shows **Ready — click to copy**
and the next click copies.

The prepared list is safe to reuse only when it is provably still current. It
is single-use, expires after 60 seconds, belongs to the current creator page,
and is discarded by Refresh, by leaving Latest, or by navigating away. Before it
is copied, **all 12 IDs must be re-read from the live grid and match position
for position**; a matching prefix (for example, only the first 5 currently on
the page) is refused and the stale list is never written.

### Isolation

Copy 12 URLs has no network access, no `chrome.*` or storage access, no
service-worker message, no API request, no API key, no telemetry and no new
permission. It reads the current page and writes the clipboard. Page-scrolling
work from the metrics and from the export takes turns through a small lock that
is always released, so neither can block the other.

## 2. What did not change

Avg Views and Engagement calculations, sample rules and bands, trimming, the
UTC 3-calendar-month window, the eligibility classifier, Premiere handling for
metrics, the YouTube Data API path, the service worker, key storage and
isolation, permissions (`storage` plus the single host permission
`https://www.googleapis.com/youtube/v3/*`), SPA behaviour and the compact and
panel copy semantics are identical to v1.0.2.

The metric candidate collector (`collectVideoIds()`, `harvestVideoIds()`,
`TARGET_CANDIDATES = 30`) is byte-identical to v1.0.2. Its only change is that
its existing collection call now takes the shared page-scrolling lock.

## 3. Test-suite correction carried in this release

v1.0.2's clipboard test harness did not await async tests, so in 6 of its 20
tests the assertions after the first `await` never ran. The harness now awaits
every test; no assertion was changed. With it corrected, all 20 pass against the
frozen v1.0.2 production code — the shipped clipboard behaviour was correct.

## 4. Validation

**Automated:** 139 tests, 0 failures, under UTC, Asia/Dhaka and
America/Los_Angeles.

| Suite | Tests |
| --- | --- |
| `calculations.test.mjs` | 44 |
| `youtube-api.test.mjs` | 31 |
| `clipboard.test.mjs` | 20 |
| `url-export.test.mjs` (new) | 44 |

The URL-export suite runs against the real `content/url-export.js` and was
mutation-tested: deliberately breaking de-duplication, ordering, the Latest
guard, scroll restore, lock release, the prepared-list checks (scope, expiry,
single use, partial-prefix, order), newline format, the loading bound, Shorts
exclusion or canonicalisation each makes it fail.

**Live, installed extension, everyday Chrome with a real API key:**

- **Futurepedia** — 12 eligible, high and low excluded, 10 averaged, exact
  123,076 → `123.1K`; Engagement `1.62%`; audit panel; Copy 12 URLs produced
  exactly 12 numbered canonical URLs.
- **Torin** — 3 eligible in the window → Avg Views `insufficient`, Engagement
  `N/A`; completed Premieres still counted as normal uploads; Copy 12 URLs
  independently produced 12 historical URLs, showing the export does not
  contaminate the metric sample.
- Compact copies of `insufficient` and `N/A` copied exactly.
- On Popular: Copy 12 URLs showed `Switch to Latest`; the metrics kept their
  existing guard.

**Live, Copy 12 URLs driven with trusted clicks in Chrome 154:** exact output
matching the visible Latest order (Dan Martell, including a 0:58 upload at
position 3); Popular/Oldest refusal with the clipboard untouched; the Ready
fallback end to end; `Found 1 of 12` on a one-video channel; scroll restored
from a non-zero position; no overlap with a populated Live tab; SPA switching
between creators with exactly one bar and no carry-over; working without an API
key.

## 5. Known limitations

- **Scheduled Premieres in Copy 12 URLs.** A pre-recorded Premiere scheduled on
  the Videos tab would be exported like a published video. On the live page a
  scheduled card uses the same badge class and item attributes as a published
  one; only localized text differs, so there is no reliable structural signal
  and no text guessing was added. During investigation none was found on the
  Videos tab of 36 channels (about 1,000 cards), so this is expected to be
  uncommon — but when it happens, drop the first line and take one more video.
  Scheduled live streams are not affected; they sit on the Live tab.
- **YouTube markup.** The export, like the metric collector, depends on
  YouTube's grid and sort-chip markup. If that changes, the export fails
  visibly (`Found N of 12` or `Switch to Latest`) rather than copying a wrong
  list.
- **Bar channel attribute after SPA navigation.** Unchanged from earlier
  releases and harmless to results: YouTube does not update
  `<meta itemprop="identifier">` on in-app navigation, so the bar's internal
  `data-thq-channel` attribute can keep the previous channel's ID.
- **Line endings.** The export uses LF. Validated on macOS; not separately
  checked on Windows.

## 6. Upgrading

Replace the folder, open `chrome://extensions`, click ↻ on the extension, and
hard-refresh any open YouTube tab. The saved API key is unaffected.
