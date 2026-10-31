# Ternary House YouTube Qualifier — v1.3.0

**Status: STABLE.** Released 2026-10-31 from `feature/v1.3.0` under the
founder's authorization for implementation and release. Supersedes v1.2.0
(archived). The release ZIP's SHA-256 is published with the GitHub release.

## 1. What changed

```
Videos tab:   TH  Avg Views  Engagement  Copy 12 URLs  Copy Channel Details  Copy all video URLs  Download all video descriptions  ⟳
Shorts, Live, Podcasts tabs and playlist / podcast episode pages:
              TH  Copy all video URLs  Download all video descriptions
```

1. **Copy 12 URLs** — one canonical URL per line, no numbering, nothing else.
   Same 12 videos, same newest-to-oldest order, same eligibility, Premiere
   handling and safeguards.
2. **Copy all video URLs** — numbering removed; the `Total URLs` / `Sort`
   header kept. Now also on the **Shorts** tab (native
   `https://www.youtube.com/shorts/<ID>`), the **Live** tab (live, upcoming and
   completed streams) and **podcast / playlist episode lists**
   (`/playlist?list=…`, `Sort: Playlist order`). The channel **Podcasts** tab
   lists podcasts (playlists), so the button says *Open a podcast to export
   its episodes* rather than copying playlist links.
3. Both copy buttons put clickable links (`text/html`) on the clipboard next
   to the plain text. If the rich write is unavailable the ordinary plain-text
   copy runs instead.
4. **Download all video descriptions** (new) — see section 2.

"All" means every unique valid video card loaded on the page at the click. No
cap, no scrolling, no crawling.

## 2. Download all video descriptions

- Same inventory as Copy all video URLs, captured at the click (IDs, order,
  card titles, channel, tab, sort). Later scrolling, navigation or channel
  switching does not change it.
- The service worker fetches `videos.list?part=snippet` in batches of 50 with
  the saved API key, maps responses by exact video ID, keeps page order, and
  retries network errors / HTTP 429 / 5xx at most twice (1 s, 2 s). Quota and
  key errors stop further requests and are never retried.
- One UTF-8 `.txt`, `CHANNEL-TAB-video-descriptions-YYYY-MM-DD.txt`, saved
  with `chrome.downloads`. Header, `# MISSING` (title, URL, ID, reason), then
  one record per video (Title, URL, Video ID, Published (UTC), Retrieval
  status, Description length, `DESCRIPTION:` and the description verbatim),
  separated by 125 dashes with one blank line either side.
- Outcomes are distinguished: retrieved; retrieved with an empty description;
  missing (not returned — private, deleted or unavailable); failed API request
  (with the HTTP/API reason); other error. Every loaded video gets a record.
- No API key, or a quota/auth failure before any description was retrieved:
  no file, explicit message. A partial failure still downloads, with the
  failures under `# MISSING`.
- Background: one job at a time (a second click shows *Already running*). Job
  state is kept in `chrome.storage.local` (never the key or descriptions). If
  Chrome stops the service worker, the next wake reruns the job from the
  saved snapshot; a job from a closed Chrome session is marked *Interrupted*.
  Success is shown only after Chrome reports the download complete.
- The API key stays in protected extension storage. It is never in the file,
  the job state, a content-script message or a log.

## 3. Unchanged

Avg Views, Engagement (formulas, sample rules, trimming, caching), the 12-video
selection and eligibility rules, Copy Channel Details and its browser-evidence
JSON (`capture_format_version` 1.0), Evidence Maker v1.4 / CEP 1.3 integration,
API-key storage and isolation. Verified by diff against v1.2.0:
`lib/calculations.js`, `lib/analysis.js`, `lib/security.js`,
`content/channel-details.js`, `options/` and `icons/` are byte-identical; in
`lib/youtube-api.js` only the existing error mapper gained `export`; every
metric, selection, classifier and routing function in `content/` is
byte-identical.

**Permissions:** `storage`, `downloads` (new: saves the file after you leave
the page) and the single host `https://www.googleapis.com/youtube/v3/*`.

## 4. Verification performed (by the developer; no founder test round)

| Check | Result |
| --- | --- |
| `npm test` — 7 suites (calculations 44, youtube-api 31, clipboard 22, url-export 44, video-selection 71, channel-details 35, descriptions 18) | 265 passed, 0 failed |
| Mutation check of the new safeguards (numbering, ID mapping, verbatim text, dropped records, quota stop, retry bound, duplicate jobs, premature success, silent resume, Shorts IDs, empty export) | 11 of 11 caught |
| Real Chromium with the real extension on SIMULATED pages and a mocked YouTube Data API (`tests/browser/extension-harness.mjs`) | 66 passed, 0 failed — repository and unpacked release ZIP |

Pre-existing expectations changed only where v1.3.0 changes the contract:
numbered URL lines became plain lines (url-export, video-selection,
channel-details suites, harness) and the permission assertion now pins
`storage` + `downloads`.

**Not verified:** live YouTube pages (the build environment cannot reach
youtube.com), and a real Chrome service-worker shutdown mid-job (covered only
by the job-manager unit tests).

## 5. Known limitations

- Card markup for Shorts, Live and playlist pages follows YouTube's known
  structure but was exercised on simulated pages. If YouTube changes it, the
  buttons report *No loaded videos* / *not ready* rather than wrong output.
- Podcast episodes are exported from the podcast's own episode list (playlist
  page). The channel Podcasts tab exposes only podcasts, not episodes.
- Very large inventories are bounded by what the page has loaded and by API
  quota (1 unit per 50 videos).

## 6. Installing / updating

Update in place (same folder → same extension ID → saved API key kept), or
load the ZIP's `ternaryhouse-youtube-qualifier/` folder with *Load unpacked*
on a new computer and enter the API key in Settings. The ZIP contains only the
loadable extension and README.
