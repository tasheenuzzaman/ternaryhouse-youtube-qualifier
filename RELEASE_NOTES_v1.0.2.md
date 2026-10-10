# Ternary House YouTube Qualifier — v1.0.2

**Status: STABLE / VALIDATED INTERNAL RELEASE**
**Date: 2026-09-17**
**Supersedes: v1.0.1 (and v1.0.0), both of which remain frozen historical releases**

| Release | Archive SHA-256 | Note |
| --- | --- | --- |
| v1.0.0 | `e8452ef53b450721547de6f48ded61fdca6a4c71a7aa5e7385c43c90e2c8739b` | frozen — **copy controls non-functional** |
| v1.0.1 | `91fd8f717b91a2abed103aea3c23d98c2394781cd8e7aaedfe31a3481910f296` | frozen — UTC window fix; **copy controls still non-functional** |
| v1.0.2 | this release | **first release with validated functional clipboard controls** |

Earlier methodology remains authoritative: read
[RELEASE_NOTES_v1.0.0.md](RELEASE_NOTES_v1.0.0.md) for the frozen V1 rules and
which are **[COACH]** vs **[TOOL]**, and
[RELEASE_NOTES_v1.0.1.md](RELEASE_NOTES_v1.0.1.md) for the UTC recency window.

---

## 1. What this release fixes

**The compact copy icons never worked, in any prior release.**

`copyText()` was defined inside `content/render.js` but omitted from its
`self.THQRender` export list, while `content/content.js` called the bare
identifier. Every copy click threw
`ReferenceError: copyText is not defined`.

Because `Controller.copy()` was `async` and nothing awaited or caught its
rejection, the error appeared only as an unhandled rejection in the page
console — and it threw on the first line, before any confirmation could be
shown. The operator saw nothing happen at all.

Both compact icons and both panel Copy buttons were affected.

A second defect compounded it: the confirmation toast was `position: absolute`
inside a flex row with no offsets, so it painted at the row's origin, behind the
brand label and the first pill. Even a working copy would have looked silent.

**Both v1.0.0 and v1.0.1 shipped with this defect.** It was confirmed by
extracting the v1.0.0 archive and re-checking the export list.

## 2. Locked clipboard semantics

The compact copy icon always copies **the value or state the operator can see
on that control**. No raw numbers, no hidden calculation values, no internal
enum names, no panel text.

There is now one canonical chain, so display and clipboard cannot drift:

```
compactAvgViewsText(avgViews) -> element.textContent
                              -> compactCopyValue(textContent, metric)
                              -> clipboard
```

The copy is read from the live rendered text at click time.

### Avg Views — displayed value/state copied verbatim

| Displayed | Clipboard |
| --- | --- |
| `6M` | `6M` |
| `6.2K` | `6.2K` |
| `35K` | `35K` |
| `1.4M` | `1.4M` |
| `6.2K*` | `6.2K*` |
| `insufficient` | `insufficient` |
| `none` | `none` |

Nothing is stripped, ever — the `*` small-sample marker included.

**Avg Views never displays `N/A`.** A null average renders as `insufficient` or
`none`.

### Engagement — same, with `%` removed from numeric percentages only

| Displayed | Clipboard |
| --- | --- |
| `2.01%` | `2.01` |
| `3.66%` | `3.66` |
| `0.48%` | `0.48` |
| `4.00%*` | `4.00*` |
| `insufficient` | `insufficient` |
| `N/A` | `N/A` |

The `*` survives. The only character deliberately removed anywhere is a `%`
that terminates a number, and only for Engagement.

**Engagement never displays `none`.**

`insufficient` and `none` are lowercase, exactly as the control renders them.
They are not capitalised for the clipboard or for the confirmation message.

### Transient states

`…` (calculating) and `!` (error) expose **no** copy icon and copy nothing.
Every other state is copyable.

## 3. Interaction and feedback

- A copy click calls `preventDefault`, `stopPropagation` and
  `stopImmediatePropagation`, so it never toggles the metric evidence panel,
  never triggers the parent pill, and never navigates.
- Exactly one clipboard operation per click.
- Visible confirmation: `Copied 6M`, `Copied 6.2K*`, `Copied 4.00*`,
  `Copied insufficient`.
- Failure is surfaced, never silent: `navigator.clipboard.writeText` falls back
  to a hidden-textarea `execCommand` copy; if both fail the call resolves
  `false` and the control shows `Copy failed` in red.
- Copy tooltips name the exact value that will be copied.
- **No new permissions** were required.

## 4. Panel Copy buttons

Semantics unchanged — the exact integer (`67814`) and the engagement rate to
two decimals (`3.25`). They were broken only by the missing export and now work.

## 5. What did NOT change

Avg Views methodology, Engagement methodology, sample rules and bands,
trimming thresholds, the UTC 3-calendar-month window, the eligibility
classifier, Premiere handling, API behaviour, key storage and security
architecture, permissions, SPA/navigation behaviour, and caching are all
identical to v1.0.1.

`CONFIG` is unchanged: `WINDOW_MONTHS 3`, `MAX_SAMPLE 12`,
`MIN_NORMAL_SAMPLE 6`, `MIN_SMALL_SAMPLE 4`, `ER_MIN_TRIMMED_SAMPLE 5`,
`ER_MANUAL_REVIEW_SAMPLE 4`, `ER_SCREEN_MIN_PCT 2`,
`AVG_VIEW_BANDS 50000/35000`, `ER_METHOD trimmed_mean_of_video_ers`.

Permissions remain `storage` plus the single host permission
`https://www.googleapis.com/youtube/v3/*`.

## 6. Validation

**95 automated tests, 0 failures**, under UTC, Asia/Dhaka and
America/Los_Angeles:

| Suite | Tests |
| --- | --- |
| `calculations.test.mjs` | 44 |
| `youtube-api.test.mjs` | 31 |
| `clipboard.test.mjs` | 20 |

The clipboard suite enumerates every real compact display state for both
metrics and asserts its clipboard output, asterisk preservation, `%`-only
removal, copyability of textual states, and that copy equals display. It also
covers the interaction contract: a copy click never reaches the parent metric
button (tested against a real bubble chain, with a control case proving the
chain works), exactly one clipboard operation per click, success feedback,
clipboard-failure handling, and a regression guard asserting `copyText` is
actually exported — so this specific defect cannot recur silently.

Every mapping in section 2 was additionally confirmed in a real browser, driving
the production structure with real DOM events.

## 7. Upgrading

Reload the unpacked extension (`chrome://extensions` → ↻) and hard-refresh any
open YouTube tab. The saved API key is unaffected. No recalculation differences
are expected — this release changes only the copy controls.
