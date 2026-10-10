# Ternary House YouTube Qualifier

An internal Chrome extension that turns a creator's YouTube **Videos** tab into
two numbers you can paste straight into the creator-qualification spreadsheet:
recent **Avg Views** and recent **Engagement** evidence.

Open a channel's Videos tab, click one control, copy, move on.

**Version 1.2.0 — CANDIDATE, under acceptance testing; NOT authorized for
production.** Adds **Copy Channel Details** (section 14b) and **Copy all video
URLs** (section 14c), and stops **Copy 12 URLs** from exporting scheduled
Premieres (section 14a). Avg Views and Engagement are unchanged. Not yet
validated on live YouTube — see [RELEASE_NOTES_v1.2.0.md](RELEASE_NOTES_v1.2.0.md).
**v1.1.0 remains the stable release** ([RELEASE_NOTES_v1.1.0.md](RELEASE_NOTES_v1.1.0.md));
1.0.0, 1.0.1 and 1.0.2 remain archived. Full history in
[CHANGELOG.md](CHANGELOG.md).

---

## 1. What it does

- Reads the video IDs shown on a channel's long-form **Videos** tab.
- Fetches exact public statistics for those videos **once**, from the official
  YouTube Data API v3.
- From that single payload it computes **both** metrics:
  - recent **Avg Views** (Ternary House trimmed method), and
  - recent **Engagement**: each video's ER, and the creator rate as their
    trimmed mean.
- Shows a full audit view so any number can be checked by hand.
- Makes each displayed value one click to copy.
- **Copy 12 URLs** puts the watch URLs of the 12 newest *published* normal
  Videos-tab uploads on the clipboard. It reads the page only — no API call,
  no key.
- **Copy Channel Details** copies one JSON evidence block — the channel as
  shown on the page plus the same 12 videos with their titles, ages and
  runtimes — for the Creator Evidence Maker.
- **Copy all video URLs** copies every video URL currently loaded in the
  Videos grid, in on-page order, on any sort.

## 2. What it deliberately does NOT do

- It does **not** decide QUALIFIED / REJECTED / OUTREACH. It produces evidence;
  the qualification decision stays with the Ternary House process.
- No composite creator score.
- No Shorts, Instagram, or TikTok.
- No audience geography, age, authenticity, fake-follower, sponsorability,
  pricing, or brand-fit inference.
- No Google Sheets integration, no CRM, no outreach automation.
- No analytics, telemetry, accounts, remote code, or external database.

## 3. Avg Views methodology

**Sample universe** — eligible long-form videos published in the **last three
calendar months**, newest first, capped at **12**. Whichever produces fewer
videos wins: the latest 12, or everything inside the window.

"Long-form" means **it came from the channel's Videos tab**, not "it is longer
than N seconds" and not "its API metadata looks a certain way". Runtime and live
metadata are recorded as supporting evidence and never remove a video from the
sample. A video is excluded only when it fails a *surface* test: it did not come
from the Videos grid, it is currently live or upcoming, it is a broadcast that
has not finished, it is not public or not processed, it belongs to another
channel, or the record is incomplete.

The window uses **UTC calendar dates and the cutoff date is inclusive.** The
cutoff is a real calendar-month subtraction (31 May minus 3 months is
28 February, or 29 February in a leap year), not a hard-coded 90 days. It is
derived from today's **UTC** date and normalised to `00:00:00.000Z`, so every
video published anywhere on the cutoff date is in window, and neither your
timezone nor the time of day can change the result. All dates shown in the audit
view are rendered in UTC for the same reason, so a video is in window exactly
when its displayed date is on or after the displayed cutoff date.

**Calculation, by sample size:**

| Eligible videos | Behaviour |
| --- | --- |
| 6 – 12 | Remove exactly **one** highest observation and **one** lowest observation, then take the arithmetic mean of the rest. |
| 4 – 5 | **Small sample.** Shows the untrimmed mean as context and labels it *"Small sample — manual outlier review recommended."* Extremes are **not** auto-removed. |
| 1 – 3 | **Insufficient.** No qualification average is produced. Shows *"Insufficient recent sample — inspect older context"* plus the available videos and an **Older context** section. |
| 0 | No eligible long-form videos in the window. |

Duplicate extremes remove only **one** occurrence. An all-equal sample still
removes one high and one low observation.

**Screening context** (shown as text, never as a verdict): ~50K+ is the
preferred/core working range; ~35K–49K is potentially workable/conditional;
below ~35K deserves review. There is no pass/fail threshold in the code.

## 4. Engagement methodology

Per video:

```
ER = (likes + comments) / views × 100
```

Subscribers are not part of the formula. Same sample universe as Avg Views —
last 3 months, max 12, long-form only, fetched in the same request.

Screening guidance: ~2%+ is the acceptable minimum zone; below ~2% is a red flag
worth reviewing. One low video does not disqualify a creator, and the UI says so.

## 5. Creator-level engagement rate

**Coach-confirmed method.** Compute every eligible sampled video's own ER, then:

1. remove exactly **one highest** individual ER observation;
2. remove exactly **one lowest** individual ER observation;
3. take the arithmetic mean of the remaining individual percentages.

That trimmed mean is the creator's engagement rate, shown to two decimal places
on the compact control:

```
[ Engagement: 3.25% ]
```

Duplicate extremes lose only **one** occurrence, matching the average-views
rule. The view-weighted aggregate `(sum likes + sum comments) / sum views` is
**not** the production method and is no longer calculated anywhere.

The `>=2%` counts are kept in the detail panel as **secondary screening
evidence** only — videos at or above the threshold, videos below it, and the ER
range. They are no longer the compact headline.

### Engagement sample bands (coach-confirmed)

These are counted in **valid ER observations** — videos with usable views, likes
and comments — which can be fewer than the video sample if statistics are hidden.

| Valid ERs | Behaviour | Button |
| --- | --- | --- |
| 0 | Nothing to report | `N/A` |
| 1–3 | No creator-level rate at all — **tool safeguard, see below** | `insufficient` |
| **4** | **Untrimmed contextual mean only. Nothing excluded automatically** — the coach treats four as a manual outlier assessment, so the tool does not invent a numeric outlier threshold | `4.00%*` |
| **5** | **Trimmed**: one highest and one lowest ER removed, remaining 3 averaged | `3.00%` |
| 6–12 | Trimmed: one highest and one lowest ER removed | `3.25%` |

**The 1–3 state is a conservative Ternary House tool safeguard, not a
coach-defined engagement rule.** The coach has defined the calculation for four
observations (manual assessment) and for five or more (trimmed mean). He has not
defined a method for one to three, so rather than present a creator-level rate
derived from one or two videos the tool declines to produce one. It reads:

> Insufficient recent engagement sample — review posting consistency and
> individual recent videos.

Unlike the Avg Views equivalent, it deliberately does **not** send the reviewer
to older videos: engagement data older than the 3-month window is not part of
the normal qualification workflow. The individual recent ERs are still listed in
the panel. If the coach later defines a rule for one to three observations, it
is a single branch in `computeEngagement()`.

The 4-video case shows every individual ER, labels no row as excluded, and
carries the note *"4-video sample — manual outlier assessment required. No ER
automatically excluded."* The asterisk marks it as contextual rather than a
qualification figure.

> **Note the deliberate asymmetry.** Engagement trims from **5**; Avg Views
> still trims from **6**. A creator with exactly 5 eligible videos will show
> `Avg Views 40K*` (small sample) alongside `Engagement 3.00%` (trimmed,
> confident). That is correct, not a bug — the coach set different thresholds
> for the two metrics.

The configured method and both bands live in one place, `CONFIG` in
[`lib/calculations.js`](lib/calculations.js): `ER_METHOD`,
`ER_MIN_TRIMMED_SAMPLE` (5) and `ER_MANUAL_REVIEW_SAMPLE` (4).

## 6. Small-sample and missing-data behaviour

The tool fails safely rather than producing a confident wrong number.

- Hidden view count → the video is excluded from the average and reported; it is
  never read as 0.
- Hidden like count → that video's ER is **unavailable**; likes are never
  assumed to be 0.
- Comment count absent from the API (comments disabled or not reported) → that
  video's ER is **unavailable**. A comment count the API explicitly reports as
  `0` is a valid 0.
- Zero views → no division; the ER is reported as unavailable.
- Aggregations use only videos with complete data, and the valid sample count is
  always displayed.

## 7. Data source

The official **YouTube Data API v3** `videos.list` endpoint, over HTTPS, called
only from the extension's background service worker.

Up to 50 video IDs per request, so one creator normally costs **one** API request
and **1 quota unit**. Repeat clicks on the same channel within 5 minutes are
served from an in-memory cache and cost nothing.

No Innertube, no third-party analytics API, no scraping proxy, no randomised
delays, no evasion behaviour. The only network destination is
`https://www.googleapis.com/youtube/v3/*`.

## 8. Permissions

| Permission | Why it is required |
| --- | --- |
| `storage` | Save your YouTube API key locally and read it in the service worker, and restrict that storage to trusted contexts. Nothing else is stored. |
| `host_permissions: https://www.googleapis.com/youtube/v3/*` | The only network destination. Without it the API call is blocked. |
| `content_scripts` on `https://www.youtube.com/*` | Read the video links already rendered on the channel's Videos tab and draw the two controls. Runs in the top frame only. |

Not requested, and not needed: `tabs`, `activeTab`, `scripting`, `webRequest`,
`cookies`, `history`, `<all_urls>`, or any other host.

## 8a. How the API key is isolated

Three independent boundaries, in order of strength:

1. **The key never leaves the service worker.** Only
   `background/service-worker.js` reads it, and only `lib/youtube-api.js`
   attaches it to a request URL. The content script never receives it, never
   names it, and makes no network requests at all.

2. **Extension storage is restricted to trusted contexts.**
   `chrome.storage.local` is exposed to content scripts **by default**
   (`TRUSTED_AND_UNTRUSTED_CONTEXTS`). On every service-worker start — and on
   install and browser startup — the extension calls:

   ```js
   chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
   ```

   That limits the area to extension pages and the service worker, while the
   data stays persistent across browser restarts. The key is deliberately **not**
   moved to `chrome.storage.session`, which would lose it on every restart.

   `StorageArea.setAccessLevel()` applies to `storage.local` as well as
   `session`, `sync` and `managed`, and is documented as Chrome 102+. The call
   is feature-detected: if a Chrome build does not implement it, the extension
   reports `Not supported by this Chrome build` instead of pretending otherwise.

3. **Chrome's isolated world.** Page JavaScript on youtube.com cannot reach
   extension storage or the content script's variables under any configuration.

**Self-verification.** The Settings page shows a live **Key isolation** status.
The service worker reports whether the restriction was applied; the content
script independently probes from inside a YouTube page by attempting to read a
**non-secret sentinel key** (`__thq_access_probe__`, never the API key). Only
when the restriction is applied *and* the page-side probe comes back blocked
does the status read:

```
Content scripts blocked (verified)
```

If the restriction is applied but the page can still read storage, the status
reports that contradiction as **insecure** rather than trusting the API call's
return value.

Beyond that, the key is never written into a YouTube page or the DOM, never
logged (there is not a single `console.*` call in the shipped code), never
included in an error message (API failures are re-thrown as typed errors
carrying only a reason code, because the request URL itself contains the key),
and never committed to source control.

## 9. API key setup

**Do not paste your key into a chat, a document, or source control.** It goes
into the extension's own Settings page and stays on that computer.

1. Open <https://console.cloud.google.com/> and sign in.
2. Create a project (for example `ternary-house-yt-qualifier`), or select one.
3. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
4. **APIs & Services → Credentials → Create credentials → API key**.
5. Click **Edit API key** and apply restrictions:
   - **API restrictions** → *Restrict key* → select **YouTube Data API v3**.
     This is the important one.
   - **Application restrictions** → leave as **None**. A Chrome extension's
     requests come from the service worker without a web referrer, so an HTTP
     referrer restriction will reject them.
6. Copy the key.
7. In Chrome, click the extension's toolbar icon (or **chrome://extensions →
   Ternary House YouTube Qualifier → Details → Extension options**), paste the
   key, click **Save**, then **Test API key**.

**Each computer is configured separately.** Using a different API key on each
machine is recommended for independent revocation and management — you can
revoke or rotate one machine's key without disturbing the other.

**Quota note:** API keys in the **same Google Cloud project share that
project's YouTube Data API quota** (10,000 units/day by default). Separate keys
in one project do *not* give you separate quota. If you genuinely need
independent quota pools, create a **separate Google Cloud project** per machine
and issue each project its own key.

In practice quota is not a constraint here: one creator costs about **1 unit**,
so a single project comfortably covers thousands of checks a day.

## 10. Install on macOS Chrome

1. Keep the `ternaryhouse-youtube-qualifier` folder somewhere permanent — Chrome
   loads it from disk every launch, so do not put it in Trash or a temp folder.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `ternaryhouse-youtube-qualifier` folder itself (the one containing
   `manifest.json`) and click **Select**.
6. Pin the extension: click the puzzle-piece icon in the toolbar, then the pin
   next to *Ternary House YouTube Qualifier*.
7. Complete the API key setup in section 9.

## 11. Install on Windows 11 Chrome

Identical source, identical steps — there is no platform-specific code and
nothing to build.

1. Copy the whole `ternaryhouse-youtube-qualifier` folder to the Windows machine
   (for example `C:\Users\<you>\Documents\ternaryhouse-youtube-qualifier`).
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the folder containing `manifest.json` and click **Select Folder**.
6. Pin it, then enter that machine's own API key in Settings.

## 12. Reloading after an update

1. Replace the folder's contents with the new version.
2. Open `chrome://extensions` and click the **↻ reload** icon on the extension's
   card.
3. **Reload any YouTube tab that was already open** — a content script from the
   previous version cannot talk to the reloaded extension. If you forget, the
   panel will tell you: *"Extension was reloaded — refresh this page."*

Your saved API key survives a reload.

## 13. Using it on a creator

1. Go to the creator's channel and open the **Videos** tab
   (`youtube.com/@handle/videos`).
2. Leave the sort on **Latest**. If it is on Popular or Oldest the extension
   refuses to calculate and tells you to switch — it will not quietly average the
   wrong videos.
3. Click **Avg Views** *or* **Engagement**. Either one triggers a single
   retrieval that fills **both**:

   ```
   [ Avg Views: 67.8K ]   [ Engagement: 3.25% ]
   ```

4. The audit panel for whichever control you clicked opens above the video
   grid, pushing the grid down rather than covering YouTube's tab bar or sort
   chips. Click the other control to switch panels, click the same one again
   (or **✕**) to close.
5. **↻** recalculates from scratch, bypassing the cache.
6. **Copy 12 URLs** copies the 12 newest published video URLs (section 14a),
   **Copy Channel Details** the JSON evidence block (14b), and **Copy all
   video URLs** every loaded video URL (14c). They are independent of the two
   metrics and work without an API key.

Navigating to the next creator resets everything automatically — no reload, and
no chance of seeing the previous creator's numbers.

## 14. Copying values

- **⧉ inside the Avg Views control** copies **exactly what the control shows**:
  `67.8K` → `67.8K`, `6.2K*` → `6.2K*`, `insufficient` → `insufficient`,
  `none` → `none`. (Corrected: earlier README text said the exact integer was
  copied; since v1.0.2 the compact icon copies the displayed value.)
- **⧉ inside the Engagement control** copies what it shows with only the `%`
  removed from a number: `3.25%` → `3.25`, `4.00%*` → `4.00*`;
  `insufficient` and `N/A` are copied as shown.
- Inside the audit panels: **Copy 67,814** copies the **exact integer**
  (`67814`), and **Copy 3.25%** copies the bare engagement number (`3.25`).

A short confirmation such as **Copied 67.8K** appears next to the controls; a
refused copy shows **Copy failed**. No notifications, no dialogs.

## 14a. Copy 12 URLs

On a channel's **Videos → Latest** tab, **Copy 12 URLs** copies the watch URLs
of the 12 newest **published** normal uploads, newest first, in exactly this
form:

```
1. https://www.youtube.com/watch?v=VIDEO_ID_1
2. https://www.youtube.com/watch?v=VIDEO_ID_2
...
12. https://www.youtube.com/watch?v=VIDEO_ID_12
```

- It is **not** the metric sample. It ignores the 3-month window and every
  sample rule: a creator with 5 recent uploads still gets their newest 12.
- Shorts are excluded by surface (`/shorts/` items). Runtime is never used, so
  a 58-second `/watch?v=` upload on the Videos tab is included.
- **Scheduled Premieres and live/upcoming broadcasts are skipped** and do not
  count toward 12; older published videos fill the 12. Completed Premieres are
  included. Each card's status is read from its own text (never its title):
  `3 days ago` / `Premiered …` / `Streamed …` = published (when YouTube shows
  an abbreviated `2h ago`, the full form in that text's accessible label is
  used, and the JSON records `published_text_source`); `Premieres …`,
  `Scheduled for …`, `Upcoming`, `N waiting`, **Notify me** = upcoming;
  `LIVE`, `N watching` = live. A short note *Skipped N upcoming/live videos*
  appears when any were skipped.
- **Unclear status fails closed.** A card that shows no status, or conflicting
  ones, is never assumed published: the button shows **Review video status**
  and nothing is copied. Copy Channel Details uses exactly the same selection,
  so the two always agree on videos 1–12.
- Links are canonicalised — timestamps, playlists and tracking parameters are
  dropped.
- No API request, no API key, nothing sent anywhere. It reads the page and
  writes the clipboard.

| Button shows | Meaning |
| --- | --- |
| **Copied 12 URLs** | Done. Paste. |
| **Switch to Latest** | The grid is on Popular or Oldest. Nothing was copied and the sort was not changed. |
| **Found N of 12** | Only N published videos could be read. Nothing was copied. This can mean the channel has fewer uploads *or* the page had not loaded more — scroll once and retry. |
| **Review video status** | A card above the 12th has no clear published/upcoming/live status. Hover the button for its grid position and video ID, check the card, retry. Nothing was copied. |
| **Review video order** | The cards' ages are not newest-to-oldest (a pinned or reordered card). Nothing was copied. |
| **Ready — click to copy** | The URLs were collected, but the browser refused the copy because the click was too long ago (Chrome allows ~5 s). Click once more to copy. The prepared list is discarded after 60 s, on Refresh, on changing sort, or on leaving the channel. |
| **Copy failed** | The browser refused the clipboard. Click again. |

**Language:** status is read from YouTube's **English** UI text. In any other
YouTube language every card is "unclear" and the button shows **Review video
status** — switch YouTube to English.

## 14b. Copy Channel Details

On **Videos → Latest**, copies one strict-JSON block for the Creator Evidence
Maker: `capture_type: TERNARY_HOUSE_BROWSER_EVIDENCE_INPUT`, the capture time,
the channel name, handle and clean channel URL as shown on the page, the header
description preview, subscriber/video counts when shown, and **the same 12
videos as Copy 12 URLs, in the same order**, each with its canonical URL,
title (and whether it came from the card's title attribute or visible text),
displayed age, runtime text and the evidence for its published status.
Skipped scheduled/live cards are listed separately under
`excluded_not_in_sample`.

- It is **source evidence, not a Creator Evidence Packet** — never labelled
  READY. The Evidence Maker still validates it (and needs a spec update before
  Ohi relies on it; see the release notes).
- Nothing is invented. The About panel is not opened, so country, joined date
  and lifetime views are `null`; the description is the header preview
  (`PARTIAL`). Thumbnail lettering is not read (no OCR). Every missing field is
  listed in `capture_limitations`.
- If the header does not match the page (for example right after switching
  creators), it refuses with **Channel identity unclear**.

Other labels as Copy 12 URLs, except **Found N of 12 — load/retry** and
**Copied channel details**.

## 14c. Copy all video URLs

Works on the Videos tab on **any sort** (Latest, Popular or Oldest). Scroll as
far as you want first; the button never scrolls or loads anything. It copies
every unique video URL in the cards currently loaded in the grid, in on-page
order:

```
Total URLs: 347
Sort: Oldest

1. https://www.youtube.com/watch?v=VIDEO_ID_1
...
347. https://www.youtube.com/watch?v=VIDEO_ID_347
```

- `Total URLs` always equals the number of numbered lines. `Sort` is the active
  chip, or `Unknown`. For a tool that wants URLs only, delete the first three
  lines.
- **It is what is loaded, not the whole channel.** A channel showing
  "1.1K videos" gives only the cards you scrolled into the page.
- Unlike Copy 12 URLs, it **includes** scheduled Premiere cards that have a
  watch link — it lists what the page shows, not what is published.
- Shorts, playlists, duplicates and non-video links are left out; a video
  appears once, at its first position.

| Button shows | Meaning |
| --- | --- |
| **Copied N URLs** | Done. Hover for the number of cards read. |
| **No loaded video URLs** | No video cards in the grid. Clipboard untouched. |
| **N cards not ready — retry** | Some cards are still rendering. Wait a moment. Clipboard untouched. |
| **Busy — retry** | Another export or the metrics are loading the page. |
| **Copy failed** | The browser refused the clipboard. Click again. |

## 15. Troubleshooting

| What you see | What it means |
| --- | --- |
| No controls appear | You are not on a channel's **Videos** tab, or YouTube's header is still loading (the extension retries for 8 seconds). Reload the page. |
| *Open a YouTube channel's Videos tab* | The current page is not a channel Videos surface. |
| *Switch the Videos tab to Latest* | The grid is sorted by Popular or Oldest. Click **Latest**. |
| *YouTube API key required — open extension settings* | No key saved on this computer. See section 9. |
| *YouTube API key is not valid* | Wrong key, or the key was deleted in Google Cloud. |
| *YouTube API rejected the request (key restriction or API not enabled)* | Most often an **Application restriction** on the key, or YouTube Data API v3 not enabled on the project. See section 9 step 5. |
| *YouTube API quota exceeded for today* | The **project's** 10,000 daily units are used up. It resets at midnight Pacific. A different key in the same project will not help — use a key from a different Google Cloud project, or wait. |
| *No eligible long-form videos found in the last 3 months* | The channel has not published qualifying long-form video recently. Check **Older context** in the panel. |
| Eligible videos: 0 with everything excluded for one reason | Read the *"Excluded before calculation"* line. If a large count shares a single reason, treat it as a classifier bug and report it — a channel whose entire Videos tab is disqualified by one rule is almost always wrong. |
| *Insufficient recent sample* | Fewer than 4 eligible recent videos. Judgement call — inspect the older context. |
| *Could not confidently identify recent videos* | The grid had not rendered. Scroll the page once and click again. |
| *Extension was reloaded — refresh this page* | You reloaded the extension while this tab was open. Refresh the tab. |
| **Copy 12 URLs** shows *Found N of 12* on a big channel | The grid had not finished loading. Scroll down a little, scroll back, and retry. |
| **Copy 12 URLs** / **Copy Channel Details** shows *Review video status* | One card's published/scheduled/live status is unclear. Hover for which card. If *every* channel does this, check YouTube's UI language is English. |
| **Copy Channel Details** shows *Channel identity unclear* | The channel header does not match the page URL or tab title. Reload the page. |
| Numbers differ from YouTube's own display | Expected. YouTube rounds (`187K`); the API gives exact counts, and this tool trims the high and low. |

## 15a. Pinned or featured videos

YouTube's pin/feature controls affect the channel's **Home** tab. The
**Videos → Latest** grid was checked against live channels and rendered in
strict reverse-chronological order with no reordered item.

More importantly, **this cannot affect the result either way**. The page's
render order is used for exactly one thing: deciding which candidate video IDs
to fetch. Recency is then re-derived from the API's authoritative `publishedAt`
timestamps — `selectRecentSample()` sorts by timestamp, applies the 3-month
window, and caps at 12. So even if YouTube did surface a pinned older video at
the top of the grid, it could not displace a newer video, could not enter the
sample out of chronological position, and could not bias the average. It would
only consume one of the ~30 candidate slots, where 12 are needed.

There is a test for exactly this: an old "pinned" item placed first in the input
still sorts to its true chronological position, and an out-of-window video is
still excluded. No special-case logic was added, because none is required.

## 16. Known limitations

- **YouTube DOM dependency.** Video-ID discovery and the placement of the
  controls depend on YouTube's current channel-page markup. YouTube changes this
  periodically. The selectors are isolated in `findGrid()`, `harvestVideoIds()`
  and `HEADER_SELECTORS` in [`content/content.js`](content/content.js) so a
  future fix is a small, contained edit. If the ideal header slot disappears the
  controls fall back to sitting directly above the video grid rather than
  breaking. The sort-chip check supports both the current `chip-bar-view-model`
  markup and the legacy `ytd-feed-filter-chip-bar-renderer`, and identifies the
  active chip by position rather than by the word "Latest", so it does not break
  in a non-English UI.
- **API key storage.** The key lives in `chrome.storage.local`, which persists
  across browser restarts, and that area is restricted to trusted contexts (see
  section 8a). Anyone with access to your Chrome profile on disk can still read
  the key — restrict it in Google Cloud and use one key per machine. If a Chrome
  build does not implement `setAccessLevel()` for `storage.local`, the Settings
  page says so explicitly rather than implying protection that is not there.
- **Completed Premieres count as normal uploads.** YouTube keeps
  `liveStreamingDetails` on a video for life, so a finished Premiere still
  carries it years later. The classifier therefore never excludes a video for
  merely having that field; it excludes a broadcast only when it has not
  finished (no `actualEndTime`) or is flagged live/upcoming. A completed
  broadcast sitting on the Videos tab is counted and noted in the audit panel.
  The trade-off: if a creator's Videos tab also carries genuine past-livestream
  archives, those will be counted too — the API does not reliably distinguish a
  finished Premiere from a finished stream. The audit panel always reports the
  count, so it is visible rather than silent.
- **Runtime is evidence, not a rule.** Long-form is defined by *content
  surface*: an ID only enters the sample if it was harvested as a `/watch?v=`
  link from the channel's own Videos grid (Shorts render as `/shorts/` links and
  never enter the harvest) and passes the server-side surface checks. Runtime
  never excludes anything. A genuine 40-second upload on the Videos tab is a
  normal long-form video and is counted; the audit panel notes it under
  *"Runtime notes (included, not excluded)"* so a human can review it. Because
  runtime no longer rejects anything, live and upcoming broadcasts are caught
  solely by `liveBroadcastContent` and `liveStreamingDetails`, which is
  covered by a dedicated test.
- **Members-only and age-restricted videos** may return incomplete statistics.
  They are reported as unavailable rather than guessed.
- **Engagement and Avg Views use different small-sample thresholds** — 5 and 6
  respectively — because the coach confirmed them separately. See the note in
  section 5; a 5-video channel showing `40K*` next to a clean `3.00%` is
  expected behaviour.
- **Validation status (1.2.0 candidate).** Automated tests, mutation tests and
  a real-Chromium run on *simulated* YouTube pages pass. It has **not** been
  validated on live YouTube; the live checks are listed in
  RELEASE_NOTES_v1.2.0.md §9 and must pass before production use.
- **Validation status (1.1.0).** The installed extension has been validated
  live in everyday Chrome with a real API key: full-sample and sparse creators,
  the trimmed average, engagement, audit panels, compact copy states, the
  Popular/Oldest guard and Copy 12 URLs. Copy 12 URLs was additionally driven
  end to end in Chrome 154 with trusted clicks (exact output, Latest guard,
  Ready fallback, scroll restore, SPA creator switching, no-API-key use). The
  Settings page's **Key isolation** row is what confirms the storage
  restriction on each machine — check it once per install. Re-run section 17
  after any YouTube layout change.
- **Publication status is read from English UI text (1.2.0 candidate).** A
  scheduled card uses the same structure as a published one, so the two
  Latest exports read each card's own status text. In a non-English YouTube UI
  they fail closed (*Review video status*) rather than guess. These markers are
  not yet validated on live pages — see RELEASE_NOTES_v1.2.0.md §9.
- **Copy all video URLs is bounded by the page.** Whether YouTube discards
  earlier cards during very deep scrolling has not been measured yet.
- **Bar's channel attribute after SPA navigation.** YouTube does not update
  `<meta itemprop="identifier">` when you move between channels without a page
  reload, so the bar's internal `data-thq-channel` attribute can keep the
  previous channel's ID. Results are unaffected: the metric cache key includes
  the video IDs, the channel used for classification comes from API data, and
  Copy 12 URLs scopes itself by the live URL and the live grid.

## 17. Manual validation procedure

Do this once before relying on the tool, and again after any YouTube layout
change.

**Setup checks**

1. **Missing key.** Before saving a key, click **Avg Views** on any channel.
   Expect *"YouTube API key required — open extension settings"* and an
   **Open settings** button. No number should appear.
2. **Invalid key.** Save `AIzaNotARealKey` and click **Test API key**. Expect a
   specific failure, not a success. Then remove it and save the real key.
2b. **Key isolation.** On the Settings page, read the **Key isolation** row. After
   opening a YouTube channel Videos tab once and returning to Settings, it should
   read **"Content scripts blocked (verified)"** in green. Anything else — in
   particular *"Restriction did not take effect"* — means the storage
   restriction is not working on this Chrome build; report it before using the
   tool on real creators.

**Accuracy checks — repeat for 3 to 5 channels**

3. Pick a channel that posts regular long-form video. Open its **Videos** tab.
4. By hand, list every long-form upload from the last 3 months, newest first,
   stopping at 12. Note each one's exact view count (open the video and read the
   count under the title, or hover the view number).
5. Compute the expected average yourself: drop the single highest and the single
   lowest, average the rest.
6. Click **Avg Views**. Open the panel and compare row by row: the video list,
   the excluded high, the excluded low, the averaged count, and the final exact
   average must match your arithmetic.
7. Pick two videos and compute `(likes + comments) / views × 100` by hand.
   Compare with the per-video ER in the engagement panel.
8. Confirm the engagement panel shows exactly one **EXCLUDED HIGHEST ER** and
   one **EXCLUDED LOWEST ER** row, and that the creator engagement rate equals
   the mean of the remaining individual ERs you computed by hand.

**Edge-case checks**

9. **Low-volume channel.** Find a channel with only a few recent uploads.
   - 4–5 recent videos → expect the small-sample state and the manual-review
     label, with no trimming.
   - 1–3 recent videos → expect *"Insufficient recent sample"*, no average, and
     an **Older context** section.
10. **Shorts-heavy channel.** Confirm the sample count and the excluded-reason
    line in the panel; no Short should appear in the video table.
10b. **Premiere channel.** Use a creator who premieres uploads (for example
    `youtube.com/@TorinHofmann/videos`). Every video there is a completed
    Premiere. Expect a normal result, and a note reading *"N video(s) in the
    sample are completed broadcasts (Premiere or past live)"* — **not** an
    exclusion. Eligible videos must not be 0.
11. **Sort guard.** Switch the Videos tab to **Popular** and click a control.
    Expect *"Switch the Videos tab to Latest."* and no number.
12. **SPA navigation.** From creator A's Videos tab, navigate to creator B
    without reloading. Confirm: exactly one set of controls, values reset to
    empty, and creator B's numbers are correct — never creator A's.
13. **Cache and refresh.** Click a control twice within 5 minutes; the second
    click should be instant and the panel footer should say *cached result*.
    Click **↻** and confirm it recalculates.
13b. **Insufficient sample (1–3 videos).** Open the developer fixture page
    (section 17a). The 3-video case must show **no** average, the button reading
    *insufficient*, the note *"Insufficient recent sample — inspect older
    context."*, and all three rows as **CONTEXT ONLY** with no EXCLUDED HIGH or
    EXCLUDED LOW.
14. **Copying.** Click **⧉** on Avg Views and paste into a spreadsheet cell —
    expect the exact integer (e.g. `67814`), not `67.8K`. Repeat for the
    engagement control and the panel's Copy buttons.

**Exports (1.2.0 candidate)** — the full live checklist is in
RELEASE_NOTES_v1.2.0.md §9. In short:

15. On a channel with an upcoming Premiere on its Videos tab, **Copy 12 URLs**
    and **Copy Channel Details** both skip it and agree on videos 1–12;
    **Copy all video URLs** includes it.
16. On a channel with completed Premieres, they are included (no *Review video
    status*).
17. On Popular/Oldest, the two Latest exports refuse and the clipboard is
    unchanged; Copy all video URLs works and its `Sort:` line is correct.
18. Scroll deep on a long channel and confirm Copy all video URLs' `Total URLs`
    matches the cards from the top to where you stopped.

Record any mismatch with the channel URL, what you expected, and what the panel
showed.

## 17a. Developer fixture page (optional, deletable)

Some states are hard to produce on demand from a live channel — in particular a
creator with only 1–3 eligible recent videos. `tests/manual-fixtures.html`
renders synthetic samples through the **production** calculation and rendering
functions so those states can be checked visually.

Open it at:

```
chrome-extension://<YOUR_EXTENSION_ID>/tests/manual-fixtures.html
```

Copy `<YOUR_EXTENSION_ID>` from the extension's card on `chrome://extensions`.

The page is deliberately unmistakable: a red hazard banner, a striped
background, and video titles reading `TEST FIXTURE VIDEO 1/2/3`. It performs no
network access and never reads the API key. It is not registered in the
manifest, is not injected into any YouTube page, and nothing in the extension
imports it — delete `tests/manual-fixtures.html` and `tests/manual-fixtures.js`
to remove it entirely.

## 18. Running the calculation tests

No test framework and no npm install. With Node:

```bash
npm test
```

which runs all six suites with Node. Or with Deno:

```bash
for t in calculations youtube-api clipboard url-export video-selection channel-details; do deno run --allow-read tests/$t.test.mjs; done
```

232 tests in six suites (1.2.0 candidate). The calculation and API suites (75) cover the trimmed average (including duplicate and all-equal extremes),
small-sample and insufficient-sample states, hidden statistics, the per-video ER
formula, both aggregations and the fact that they differ, calendar-month cutoff
boundaries, duration parsing, long-form eligibility, completed-Premiere
handling, the trimmed creator engagement rate (including duplicate extremes, unavailable
observations, and every sample band from 0 to 12), and storage-isolation policy.
The clipboard suite (20) covers every compact copy state; the URL-export suite
(44) covers the 12-URL format, ordering, Shorts and sort rules, lazy loading,
the Ready fallback's safety and lock release. The selection suite (63) covers
publication-state reading on simulated modern and legacy card markup,
scheduled/live exclusion, fail-closed cases, the shared 12-video selection and
the general all-URLs export; the channel-details suite (30) covers the header
reader, identity checks, the JSON block and agreement between the two Latest
exports. All run against the real shipped content scripts and await every
test.

Optional, developer-only: `node tests/browser/extension-harness.mjs` loads the
real extension into Chromium (needs Playwright) and drives it on simulated
YouTube pages served locally — no network, not live YouTube.

## 19. Project layout

```
manifest.json                  Manifest V3
background/service-worker.js   Only holder of the API key; only network caller
content/render.js              Shadow DOM styles + every audit-panel builder.
                               Loaded first as a content script, and also by the
                               fixture page, so both render through one code path.
content/video-selection.js     Shared card reader: publication status, the one
                               12-video selector, the all-URLs inventory.
content/url-export.js          Export operations for Copy 12 URLs / Channel
                               Details (bounded top-up, Ready fallback) and
                               Copy all video URLs; formatting; DOM lock.
content/channel-details.js     Channel-header reader + JSON evidence block.
                               None of the three: no API, no key, no network.
content/content.js             DOM discovery + UI state (never sees the key)
                               Two shadow hosts: the compact bar in the channel
                               header, the audit panel above the video grid.
content/content.css            Positions the shadow host inside YouTube's layout
lib/calculations.js            Pure business rules — the methodology lives here
lib/youtube-api.js             API calls, normalization, long-form eligibility
lib/security.js                Storage-isolation policy (pure, unit-tested)
lib/analysis.js                Turns one fetch into both metrics
options/                       Settings page
tests/                         Dependency-free deterministic tests
tests/fixtures/                SIMULATED YouTube markup for the reader tests
tests/browser/                 Optional real-Chromium harness (Playwright)
docs/v1.2.0-candidate-examples Clipboard examples generated from simulated pages
tests/manual-fixtures.html     DEVELOPER-ONLY page for eyeballing rare states.
                               Delete it and manual-fixtures.js to remove.
tools/make-icons.py            Dev utility to regenerate the icons
```

`lib/calculations.js` is pure: no DOM, no network, no `chrome.*`. That is what
makes the methodology testable and what makes the pending aggregation decision a
one-line change.
