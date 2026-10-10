/**
 * DEVELOPER-ONLY manual fixture.
 *
 * Renders synthetic samples through the PRODUCTION calculation and rendering
 * path so the browser output can be eyeballed:
 *
 *   fabricated videos.list items
 *     -> normalizeVideo()        (lib/youtube-api.js, production)
 *     -> analyzeVideos()         (lib/analysis.js,    production)
 *     -> renderAvgViewsPanel()   (content/render.js,  production)
 *
 * Nothing here reimplements business logic, and nothing here is loaded by the
 * extension itself — this file is referenced only by manual-fixtures.html.
 */

import { normalizeVideo } from '../lib/youtube-api.js';
import { analyzeVideos } from '../lib/analysis.js';

const { STYLES, applyStyles, el, renderAvgViewsPanel, renderEngagementPanel } = self.THQRender;

const DAY = 86400000;

/**
 * A fabricated videos.list item. Obviously synthetic on sight.
 * `erPct` drives likes/comments so the engagement panel shows a realistic
 * spread and the high/low ER trimming is visible.
 */
function fixtureItem(index, { daysAgo, viewCount, erPct = 6 }) {
  const interactions = Math.round(viewCount * (erPct / 100));
  const commentCount = Math.round(interactions * 0.12);
  const likeCount = interactions - commentCount;
  return {
    id: `FIXTUREVID${index}`,
    snippet: {
      title: `TEST FIXTURE VIDEO ${index}`,
      publishedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
      channelId: 'UCfixture00000000000000',
      channelTitle: 'TEST FIXTURE CHANNEL',
      liveBroadcastContent: 'none',
    },
    contentDetails: { duration: 'PT8M20S' },
    statistics: {
      viewCount: String(viewCount),
      likeCount: String(likeCount),
      commentCount: String(commentCount),
    },
    status: { privacyStatus: 'public', uploadStatus: 'processed' },
  };
}

/** Mount a panel using the production shadow-DOM setup. */
function mountPanel(container, result, which = 'avg') {
  const host = el('div', { class: 'thq-host thq-panel-host' });
  host.style.cssText = 'display:block;';
  const shadow = host.attachShadow({ mode: 'open' });
  applyStyles(shadow);
  const wrap = el('div', { class: 'wrap' });
  shadow.appendChild(wrap);

  const panel = el('div', { class: 'panel' });
  wrap.appendChild(panel);

  const draw = which === 'engagement' ? renderEngagementPanel : renderAvgViewsPanel;
  draw(panel, result, {
    onCopy: (text) => {
      // eslint-disable-next-line no-alert
      window.alert(`FIXTURE: would copy "${text}"`);
    },
    onOpenSettings: () => {},
  });

  container.appendChild(host);
}

/** Also show what the compact control itself would read. */
function mountCompact(container, result) {
  const host = el('div', { class: 'thq-host' });
  host.style.cssText = 'display:block;margin:0 0 10px;';
  const shadow = host.attachShadow({ mode: 'open' });
  applyStyles(shadow);
  const wrap = el('div', { class: 'wrap' });
  shadow.appendChild(wrap);

  const a = result.avgViews;
  const label = a.status === 'OK' ? a.display
    : a.status === 'SMALL_SAMPLE' ? `${a.display}*`
      : a.status === 'INSUFFICIENT' ? 'insufficient' : 'none';

  wrap.appendChild(el('div', { class: 'bar' }, [
    el('span', { class: 'brand', text: 'TH' }),
    el('button', { class: 'pill', type: 'button' }, [
      el('span', { class: 'lbl', text: 'Avg Views' }),
      el('span', { class: 'val', text: label }),
    ]),
    el('button', { class: 'pill', type: 'button' }, [
      el('span', { class: 'lbl', text: 'Engagement' }),
      el('span', { class: 'val', text: result.engagement.compact }),
    ]),
  ]));
  container.appendChild(host);
}

function render(containerId, items) {
  const container = document.getElementById(containerId);
  const result = analyzeVideos(items.map(normalizeVideo), { now: new Date() });
  mountCompact(container, result);
  mountPanel(container, result, 'avg');
  mountPanel(container, result, 'engagement');
  return result;
}

// --- Case under validation: exactly 3 eligible recent videos ---------------
render('case-3', [
  fixtureItem(1, { daysAgo: 5, viewCount: 41200, erPct: 3.05 }),
  fixtureItem(2, { daysAgo: 19, viewCount: 12750, erPct: 1.40 }),
  fixtureItem(3, { daysAgo: 46, viewCount: 88300, erPct: 4.80 }),
]);

// --- Coach edge case: exactly 4 valid ER observations ---------------------
render('case-4', [
  { erPct: 2.00 }, { erPct: 3.00 }, { erPct: 4.00 }, { erPct: 7.00 },
].map((v, i) => fixtureItem(i + 1, { daysAgo: (i * 9) + 3, viewCount: 40000, ...v })));

// --- Coach edge case: exactly 5 valid ER observations ---------------------
render('case-5', [
  { erPct: 1.00 }, { erPct: 2.00 }, { erPct: 3.00 }, { erPct: 4.00 }, { erPct: 9.00 },
].map((v, i) => fixtureItem(i + 1, { daysAgo: (i * 9) + 3, viewCount: 40000, ...v })));

// --- Reference: a healthy 12-video sample ---------------------------------
const REFERENCE = [
  { viewCount: 41200, erPct: 1.10 },
  { viewCount: 12750, erPct: 4.20 },
  { viewCount: 88300, erPct: 9.80 },
  { viewCount: 52100, erPct: 2.36 },
  { viewCount: 33900, erPct: 3.05 },
  { viewCount: 61800, erPct: 2.80 },
  { viewCount: 27400, erPct: 1.95 },
  { viewCount: 45600, erPct: 4.60 },
  { viewCount: 39100, erPct: 3.30 },
  { viewCount: 58200, erPct: 2.10 },
  { viewCount: 30500, erPct: 5.40 },
  { viewCount: 47700, erPct: 2.75 },
];
render('case-12', REFERENCE.map((v, i) => fixtureItem(i + 1, { daysAgo: (i * 7) + 3, ...v })));

void STYLES;
