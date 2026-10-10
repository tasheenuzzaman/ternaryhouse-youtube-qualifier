# Ternary House YouTube Qualifier — v1.0.0

**Status: STABLE / VALIDATED INTERNAL RELEASE**
**Frozen: 2026-09-14**
**Platform: Chrome / Chromium, Manifest V3, unpacked (internal — not Web Store)**

This document records the exact behaviour frozen as V1. It is the reference for
what the tool does and, just as importantly, **which rules came from the coach
and which are internal Ternary House tool safeguards.**

---

## 1. What this tool does

Calculates recent long-form **Avg Views** and **Engagement** evidence for a
YouTube creator, from the creator's own Videos tab, using exact statistics from
the official YouTube Data API v3.

It produces **evidence**, not verdicts. It never outputs QUALIFIED / REJECTED /
OUTREACH, never computes a composite creator score, and never infers audience
geography, age, authenticity, sponsorability, pricing or brand fit.

---

## 2. Provenance key

Throughout this document:

| Mark | Meaning |
| --- | --- |
| **[COACH]** | Explicitly confirmed by the coach. Do not change without a new clarification. |
| **[COACH-INFORMED]** | Derived from coach guidance that was directional rather than a precise formula; the tool implements it conservatively. |
| **[TOOL]** | Internal Ternary House tool safeguard. No coach rule exists. Safe to revisit without a coach clarification. |

---

## 3. Sample universe (both metrics)

- **[COACH]** YouTube **long-form Videos surface only**. Shorts are excluded.
- **[COACH]** Last **3 calendar months**, computed as a real calendar-month
  subtraction from the clock at calculation time (31 May − 3 months = 28 Feb,
  or 29 Feb in a leap year), not a fixed 90 days.
- **[COACH]** Maximum **12 most recent** eligible videos. Whichever yields fewer
  wins: the latest 12, or everything inside the window.
- **[TOOL]** "Long-form" is defined by **content surface**, not runtime. An ID
  qualifies because it was harvested as a `/watch?v=` link from the channel's
  own Videos → Latest grid.
- **[TOOL]** Runtime (including the ≤60s signal) is **diagnostic evidence
  only** and never excludes a video.
- **[TOOL]** Excluded by surface checks: currently live or upcoming broadcasts;
  broadcasts with no `actualEndTime` (not finished); items not from the Videos
  surface; non-public or unprocessed uploads; videos whose `channelId` differs
  from the set's dominant channel; incomplete records.
- **[TOOL]** **Completed Premieres appearing on the Videos surface count as
  normal uploads.** YouTube retains `liveStreamingDetails` on a video for life,
  so its presence alone is never grounds for exclusion.
- **[TOOL]** The tool refuses to calculate unless the Videos tab is sorted
  **Latest**. It will not silently average a Popular or Oldest ordering.
- **[TOOL]** Recency is always re-derived from API `publishedAt` timestamps, so
  a pinned or reordered grid item cannot corrupt the chronological sample.

---

## 4. Avg Views — frozen behaviour

| Eligible videos | Behaviour | Provenance |
| --- | --- | --- |
| **6–12** | Remove exactly **one highest** view observation and **one lowest** view observation; arithmetic mean of the remainder. | **[COACH]** |
| **4–5** | Untrimmed contextual mean, small-sample warning and `*` asterisk. No automatic removal of extremes. *"Small sample — manual outlier review recommended."* | **[COACH-INFORMED]** — coach's small-sample guidance is judgement-based |
| **1–3** | No confident average. *"Insufficient recent sample — inspect older context."* | **[COACH-INFORMED]** — coach looks back into months 4–5 at this size |
| **0** | No eligible long-form videos in the window. | **[TOOL]** |

- **[COACH]** Duplicate extremes remove only **one** occurrence each. An
  all-equal sample still removes two distinct observations.
- **[TOOL]** Videos whose view count is hidden are excluded from the average,
  reported separately, and never treated as zero.
- **[TOOL]** Older-than-window videos may be displayed under **Older context**
  but never enter the calculation.
- **[TOOL]** The exact integer is copyable (button shows `67.8K`, clipboard
  receives `67814`).
- **[COACH]** Screening context bands — ~50K+ preferred/core, ~35K–49K
  conditional, below ~35K deserves review — are displayed as **text context
  only**. There is no pass/fail comparison anywhere in the code.

---

## 5. Engagement — frozen behaviour

**[COACH]** Per video:

```
ER = (likes + comments) / views × 100
```

**[COACH]** Subscribers/followers are **not** part of the formula.
**[COACH]** Same recent long-form universe: last 3 months, maximum 12.

Creator-level rate, by **valid ER observations** (videos with usable views,
likes and comments — which can be fewer than the video sample):

| Valid ERs | Behaviour | Button | Provenance |
| --- | --- | --- | --- |
| **5–12** | Remove exactly **one highest ER** and **one lowest ER**; arithmetic mean of the remainder. | `3.25%` | **[COACH]** — *"with 5 videos I'd remove the highest and lowest as well"* |
| **exactly 4** | **No automatic trimming.** Untrimmed contextual mean with `*`. *"4-video sample — manual outlier assessment required. No ER automatically excluded."* | `4.00%*` | **[COACH]** — *"with 4 videos, it's more of a manual assessment"* |
| **1–3** | No confident creator-wide ER. *"Insufficient recent engagement sample — review posting consistency and individual recent videos."* | `insufficient` | **[TOOL]** — see §5.1 |
| **0** | Nothing to report. | `N/A` | **[TOOL]** |

- **[COACH]** Duplicate highest/lowest ER values remove only **one**
  observation each.
- **[COACH]** The compact button shows the **exact creator engagement
  percentage** to two decimal places where available.
- **[COACH]** The `≥2%` count, the `<2%` count and the ER range are retained as
  **secondary screening evidence** in the detail panel only. They are no longer
  the compact headline.
- **[COACH]** A single video below ~2% does not disqualify a creator; the panel
  says so explicitly.
- **[COACH]** The **view-weighted aggregate** `(Σ likes + Σ comments) / Σ views`
  is **not** the production method and is no longer calculated anywhere.

### 5.1 The 1–3 state is an internal safeguard

**[TOOL]** The coach has defined the engagement calculation for **four**
observations (manual assessment) and for **five or more** (trimmed mean). He has
**not** defined a method for one to three. Rather than present a creator-level
rate derived from one or two videos, the tool declines to produce one.

Unlike the Avg Views equivalent, it deliberately does **not** direct the
reviewer to older videos — engagement data older than the 3-month window is not
part of the normal qualification workflow. The individual recent ERs are still
listed in the panel.

If the coach later defines a rule for 1–3, it is a single branch in
`computeEngagement()`.

### 5.2 Deliberate threshold asymmetry

**[COACH]** Engagement trims from **5**; Avg Views trims from **6**. A creator
with exactly 5 eligible videos will show `Avg Views 40K*` (small sample)
alongside `Engagement 3.00%` (trimmed, confident). **This is correct, not a
bug** — the coach set the two thresholds separately.

### 5.3 Missing-data safety

**[TOOL]** Hidden likes, unavailable comments, and zero or invalid views are
**never** silently converted into a valid zero engagement:

- hidden like count → that video's ER is **unavailable**;
- comment count absent from the API → **unavailable** (a comment count the API
  explicitly reports as `0` is a valid 0);
- zero or missing views → no division, ER **unavailable**;
- unavailable observations **never** enter the trimmed mean, and never
  influence which observations are trimmed as highest or lowest.

The valid-observation count is always displayed.

---

## 6. Security and architecture — frozen

- **Manifest V3.** Permissions: `storage` only. Host permissions:
  `https://www.googleapis.com/youtube/v3/*` only. Content script scoped to
  `https://www.youtube.com/*`, top frame only.
- **Official YouTube Data API v3 only.** No Innertube, no undocumented
  endpoint, no third-party analytics API, no scraping proxy, no evasion
  behaviour, no randomised delays.
- **The service worker is the sole API caller and the sole key reader.** The
  content script never receives the key and makes no network requests.
- **API key stored in `chrome.storage.local`** (persistent across browser
  restarts), **restricted to `TRUSTED_CONTEXTS`** via
  `StorageArea.setAccessLevel()`, re-applied on every service-worker start, on
  install and on browser startup.
- **Content-script isolation live-verified** from inside a YouTube page using a
  non-secret sentinel key (`__thq_access_probe__`), never the API key. The
  Settings page reports `Content scripts blocked (verified)` only when the
  restriction is applied **and** confirmed from the page side; a contradiction
  is reported as insecure.
- **No telemetry, analytics, advertising, external database, user accounts, or
  hidden network requests.** No remote code, no `eval`, no `innerHTML`.
- **The key is never** written into a YouTube page or the DOM, logged (there is
  not one `console.*` call in shipped code), included in an error message
  (request URLs carry the key, so API failures are re-thrown as typed errors
  carrying only a reason code), or committed to source control.

---

## 7. Validation completed

**Automated:** 70 tests, 0 failures. Dependency-free; runs under Node or Deno.

**Live browser validation:**

- Avg Views — normal 6–12 trimmed path, 4–5 small-sample path, sorting guard,
  SPA navigation between channels, Premiere classification, exact arithmetic,
  clipboard behaviour.
- Engagement, validated on real creators:

  | Creator | Valid ERs | Result |
  | --- | --- | --- |
  | Daniel Jindoo | 12 | 1.45% |
  | Matt Maher | 8 | 3.66% |
  | Vil Vas | 12 (tiny-view extreme case) | 2.21% |
  | Torin | hidden likes | N/A |

- 4- and 5-observation engagement branches validated through production-code
  fixtures (`tests/manual-fixtures.html`), which render via the same
  `analyzeVideos()` and `renderEngagementPanel()` the extension uses.
- Duplicate extremes and unavailable-data cases covered by automated tests.
- DOM assumptions verified against live channel pages: grid selector, ID
  harvest, sort-chip detection, header mount point, Shadow DOM rendering, both
  dark-theme selectors, reverse-chronological grid ordering.

---

## 8. Installation

See **README.md** sections 9–12 for API key setup, loading unpacked on macOS
Chrome and on Windows 11 Chrome, and reloading after an update.

The same folder works unchanged on both platforms. There is no build step and
no Node/npm runtime dependency. Each computer is configured with its **own** API
key.

---

## 9. Developer fixture page

`tests/manual-fixtures.html` is a **developer-only** regression asset, retained
deliberately. It is not registered in the manifest, is never injected into any
YouTube page, makes no network calls, touches no `chrome.*` API, and carries a
red hazard banner plus `TEST FIXTURE VIDEO` titles so it cannot be mistaken for
a real creator result.

Open it at `chrome-extension://<EXTENSION_ID>/tests/manual-fixtures.html`.

Deleting `tests/manual-fixtures.html` and `tests/manual-fixtures.js` removes it
entirely; nothing else depends on them.

---

## 10. Out of scope for V1

Instagram, TikTok, Shorts calculations, fake-follower detection, AI comment
analysis, sponsor-history scraping, demographics, media-kit analysis, Modash,
Social Blade, automatic outreach, Google Sheets API integration, creator
pricing, CRM functionality, automatic creator qualification, dashboards.

---

## 11. Where to change methodology later

All thresholds live in `CONFIG` at the top of `lib/calculations.js`:

| Constant | Value | Governs |
| --- | --- | --- |
| `WINDOW_MONTHS` | 3 | Recency window |
| `MAX_SAMPLE` | 12 | Sample cap |
| `MIN_NORMAL_SAMPLE` | 6 | Avg Views trimming threshold |
| `MIN_SMALL_SAMPLE` | 4 | Avg Views small-sample floor |
| `ER_MIN_TRIMMED_SAMPLE` | 5 | Engagement trimming threshold |
| `ER_MANUAL_REVIEW_SAMPLE` | 4 | Engagement manual-assessment band |
| `ER_SCREEN_MIN_PCT` | 2 | Secondary screening floor |
| `AVG_VIEW_BANDS` | 50000 / 35000 | Screening context bands |
| `ER_METHOD` | `trimmed_mean_of_video_ers` | Creator-level ER method |

`lib/calculations.js` is pure — no DOM, no network, no `chrome.*` — which is
what makes the methodology testable and each of these a one-line change.
