# Ternary House YouTube Qualifier — v1.0.1

**Status: BUGFIX RELEASE**
**Date: 2026-09-14**
**Supersedes: v1.0.0 (which remains the frozen historical release)**

v1.0.0 is unchanged and still archived as
`ternaryhouse-youtube-qualifier-v1.0.0-stable.zip`
(SHA-256 `e8452ef53b450721547de6f48ded61fdca6a4c71a7aa5e7385c43c90e2c8739b`).
Its release notes remain valid for everything except the recency boundary,
which this release corrects. Read
[RELEASE_NOTES_v1.0.0.md](RELEASE_NOTES_v1.0.0.md) for the full frozen V1
methodology, including which rules are **[COACH]** and which are **[TOOL]**.

---

## 1. What this release fixes

**The 3-calendar-month recency boundary was unstable across timezones and
across the working day.**

The cutoff was computed by copying the current timestamp and mutating only its
date fields, using *local* calendar components. The time-of-day survived, so the
cutoff was an **instant**, not a date — while the UI displayed it as a date and
implied the whole day was included.

Two production symptoms:

1. **Time-of-day drift.** A video published on the cutoff date was included only
   if its publish time was at or after the current wall-clock time. A creator's
   numbers changed part-way through the day with no other input changing.

2. **Timezone divergence.** The cutoff instant shifted with the operator's
   timezone, so two staff could get different samples for the same creator at
   the same moment.

**Observed case — Matt Maher.** The video *"The US Government Just Banned
Anthropic's New AI Model"* (`N459K9wmxcc`) has a true publish time of
`2026-06-13T20:23:05-07:00` = **`2026-06-14T03:23:05Z`**. On 2026-09-14 the
displayed window read `since 2026-06-14`, yet the video dropped out of the
sample at 09:23 local, taking the channel from 8 eligible videos to 7 and
moving Avg Views ~6.2K → ~5.2K and Engagement 3.66% → 3.80%.

## 2. The canonical rule, as now implemented

> **The recent window uses UTC calendar dates. The cutoff date is inclusive.**

- Today's calendar date is taken in **UTC**.
- Three calendar months are subtracted using **UTC** calendar components, with
  month-end clamping (31 May − 3 months = 28 Feb, or 29 Feb in a leap year).
- The cutoff is **`00:00:00.000Z`** of that date.
- A video is in window when `publishedAt >= cutoff`.
- Operator timezone cannot change eligibility.
- Time of day within the same UTC calendar date cannot change eligibility.

With a current UTC date of 2026-09-14, the cutoff is exactly
`2026-06-14T00:00:00.000Z`:

| Published | In window |
| --- | --- |
| `2026-06-13T23:59:59.999Z` | no |
| `2026-06-14T00:00:00.000Z` | **yes** |
| `2026-06-14T03:23:05Z` (the Matt video) | **yes** |
| `2026-06-14T23:59:59.999Z` | **yes** |
| `2026-06-15T…` and later | **yes** |

## 3. Exactly what changed

| File | Change |
| --- | --- |
| `lib/calculations.js` | `subtractCalendarMonths()` → `subtractCalendarMonthsUTC()`: UTC components, normalised to UTC midnight. `formatDate()` renders in UTC. |
| `content/render.js` | `fmtDate()` renders in UTC. Window label now states its basis. |
| `tests/calculations.test.mjs` | Recency tests rewritten against UTC; 6 new boundary/invariance tests. |
| `tests/youtube-api.test.mjs` | Test `NOW` built with `Date.UTC` so the suite is timezone-independent. |
| `manifest.json`, `package.json` | Version 1.0.0 → 1.0.1. |
| `README.md`, `CHANGELOG.md` | Documentation. |

The audit panel's window line now reads:

```
Window   Last 3 calendar months (UTC; since 2026-06-14 inclusive)
```

## 4. Deliberate display change

**All dates in the audit view now render in UTC**, not local time. This keeps
the view honest: a video is in window exactly when its **displayed** date is on
or after the **displayed** cutoff date, on every machine.

For operators far from UTC a publish date may now display one day differently
from before. This is a **display change only** — it never changes eligibility,
and eligibility was already made timezone-independent by the cutoff fix.

## 5. What did NOT change

Avg Views methodology, Engagement methodology, trimming thresholds and sample
bands, the eligibility classifier, Premiere handling, API-key and security
architecture, permissions, SPA/navigation behaviour, caching, clipboard
behaviour, and the compact control formats are all identical to v1.0.0.

`CONFIG` is unchanged: `WINDOW_MONTHS 3`, `MAX_SAMPLE 12`,
`MIN_NORMAL_SAMPLE 6`, `MIN_SMALL_SAMPLE 4`, `ER_MIN_TRIMMED_SAMPLE 5`,
`ER_MANUAL_REVIEW_SAMPLE 4`, `ER_SCREEN_MIN_PCT 2`,
`AVG_VIEW_BANDS 50000/35000`, `ER_METHOD trimmed_mean_of_video_ers`.

## 6. Validation

**75 automated tests, 0 failures**, executed under five timezones including
both extremes:

| Timezone | Offset | Result |
| --- | --- | --- |
| UTC | +0 | 75/75 |
| Asia/Dhaka | +6 | 75/75 |
| America/Los_Angeles | −7 | 75/75 |
| Pacific/Kiritimati | +14 | 75/75 |
| Pacific/Pago_Pago | −11 | 75/75 |

A full `analyzeVideos()` pipeline digest — cutoff, in-window count, sample,
per-row INCLUDED/EXCLUDED status, trimmed average, engagement rate, older
context — was produced under UTC, Asia/Dhaka, America/Los_Angeles and
Pacific/Kiritimati and is **byte-for-byte identical** in all four.

## 7. Upgrading

Reload the unpacked extension (`chrome://extensions` → ↻) and hard-refresh any
open YouTube tab. The saved API key is unaffected.

Re-running a creator checked under v1.0.0 may legitimately show one additional
video near the boundary; that is the fix working. Matt Maher should return to
**8 eligible videos**.
