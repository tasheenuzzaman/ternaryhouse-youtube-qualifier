/**
 * Ternary House YouTube Qualifier — shared rendering layer.
 *
 * A CLASSIC script (not an ES module) so it can be loaded two ways:
 *   1. as the first content script, sharing the isolated-world scope with
 *      content.js — this is what runs on real YouTube pages;
 *   2. via a plain <script> tag on an extension page, which is how
 *      tests/manual-fixtures.html exercises the very same rendering code.
 *
 * It owns the Shadow DOM styles and every audit-panel DOM builder. It holds no
 * state, performs no network access, and knows nothing about YouTube's DOM.
 */

(() => {
  'use strict';

  /* ---------------- formatting helpers (display only) ---------------- */

const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : 'N/A');
const fmtPct = (n, d = 2) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : 'N/A');
/**
 * ISO timestamp -> "2025-07-14", rendered in UTC.
 *
 * UTC so that every date shown in the audit view agrees with the UTC calendar
 * rule the recency window uses: a video is in window exactly when its
 * displayed date is on or after the displayed cutoff date, on every machine.
 */
const fmtDate = (iso) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'N/A';
  const d = new Date(t);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/* ================================================================== *
 * Clipboard
 * ================================================================== */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts where the async clipboard API is unavailable.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ================================================================== *
 * UI
 * ================================================================== */

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: "Roboto", "Segoe UI", system-ui, -apple-system, sans-serif; }

.wrap {
  --thq-fg: #0f0f0f;
  --thq-muted: #606060;
  --thq-bg: #ffffff;
  --thq-chip: #f2f2f2;
  --thq-border: #d4d4d4;
  --thq-accent: #1f5fbf;
  --thq-warn: #8a5300;
  --thq-bad: #a32020;
  color: var(--thq-fg);
  display: block;
  max-width: 760px;
}
@media (prefers-color-scheme: dark) {
  .wrap {
    --thq-fg: #f1f1f1;
    --thq-muted: #aaaaaa;
    --thq-bg: #181818;
    --thq-chip: #272727;
    --thq-border: #3f3f3f;
    --thq-accent: #7aa7ee;
    --thq-warn: #e0b062;
    --thq-bad: #ff8a80;
  }
}
:host-context(html[dark]) .wrap,
:host-context(ytd-app[dark]) .wrap {
  --thq-fg: #f1f1f1;
  --thq-muted: #aaaaaa;
  --thq-bg: #181818;
  --thq-chip: #272727;
  --thq-border: #3f3f3f;
  --thq-accent: #7aa7ee;
  --thq-warn: #e0b062;
  --thq-bad: #ff8a80;
}

.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

.pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--thq-chip); color: var(--thq-fg);
  border: 1px solid var(--thq-border); border-radius: 18px;
  padding: 6px 12px; font-size: 13px; line-height: 18px;
  cursor: pointer; white-space: nowrap;
}
.pill:hover { border-color: var(--thq-accent); }
.pill:focus-visible { outline: 2px solid var(--thq-accent); outline-offset: 2px; }
.pill[disabled] { opacity: .6; cursor: default; }
.pill .lbl { font-weight: 500; }
.pill .val { font-weight: 700; font-variant-numeric: tabular-nums; }
.pill .val.empty { display: none; }
.pill .copy {
  display: none; font-size: 12px; opacity: .75;
  padding: 0 2px; border-radius: 4px;
}
.pill .copy.on { display: inline; }
.pill .copy:hover { opacity: 1; background: rgba(127,127,127,.25); }

.icon {
  background: transparent; border: 1px solid var(--thq-border);
  border-radius: 50%; width: 28px; height: 28px;
  color: var(--thq-muted); cursor: pointer; font-size: 14px; line-height: 1;
}
.icon:hover { color: var(--thq-fg); border-color: var(--thq-accent); }

.brand { font-size: 11px; color: var(--thq-muted); letter-spacing: .3px; }

.panel {
  padding: 12px 14px;
  background: var(--thq-bg); border: 1px solid var(--thq-border);
  border-radius: 10px; font-size: 12px; line-height: 1.5;
  max-height: 60vh; overflow: auto;
}
.panel h3 { margin: 0 0 2px; font-size: 13px; letter-spacing: .4px; text-transform: uppercase; }
.panel h4 { margin: 12px 0 4px; font-size: 12px; color: var(--thq-muted); text-transform: uppercase; letter-spacing: .4px; }
.panel .close { float: right; }

.kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; margin: 6px 0; }
.kv dt { color: var(--thq-muted); }
.kv dd { margin: 0; font-variant-numeric: tabular-nums; }

table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--thq-border); vertical-align: top; }
th { color: var(--thq-muted); font-weight: 500; white-space: nowrap; }
td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.title { max-width: 260px; }
.st { font-size: 10px; letter-spacing: .3px; white-space: nowrap; }
.st-inc { color: var(--thq-accent); }
.st-hi, .st-lo { color: var(--thq-warn); }
.st-na { color: var(--thq-bad); }

.note { margin: 6px 0; color: var(--thq-warn); }
.err { margin: 6px 0; color: var(--thq-bad); font-weight: 500; }
.muted { color: var(--thq-muted); }

.copybtn {
  background: transparent; border: 1px solid var(--thq-border); color: var(--thq-fg);
  border-radius: 6px; padding: 1px 6px; font-size: 11px; cursor: pointer; margin-left: 6px;
}
.copybtn:hover { border-color: var(--thq-accent); }

.toast {
  font-size: 11px; white-space: nowrap;
  color: var(--thq-accent); opacity: 0; transition: opacity .15s;
}
.toast.on { opacity: 1; }
.toast.fail { color: var(--thq-bad); }
`;

/**
 * One constructable stylesheet shared by both shadow roots, so the compact
 * bar and the audit panel stay visually identical without duplicating CSS.
 */
let sharedSheet = null;
function applyStyles(shadow) {
  if (sharedSheet === null && typeof CSSStyleSheet === 'function') {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      sharedSheet = sheet;
    } catch {
      sharedSheet = false;
    }
  }
  if (sharedSheet) shadow.adoptedStyleSheets = [sharedSheet];
  else shadow.appendChild(el('style', { text: STYLES }));
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const kv = (label, value) => [el('dt', { text: label }), el('dd', { text: value })];

  /* ---------------------- audit panel builders ---------------------- */

  function panelFooter(r) {
    const bits = [
      `Sampled ${r.window.sampleCount} of ${r.window.inWindowCount} eligible in-window video(s)`,
      `${r.discovery.fetchedCount} candidate(s) checked`,
      r.discovery.requestCount ? `${r.discovery.requestCount} API request(s)` : null,
      r.cached ? 'cached result' : null,
    ].filter(Boolean);
    return el('p', { class: 'muted', text: bits.join(' · ') });
  }

  function renderAvgViewsPanel(p, r, ctx) {
    const a = r.avgViews;

    p.appendChild(el('h3', { text: 'Avg Views' }));

    const dl = el('dl', { class: 'kv' });
    const rows = [
      ['Window', `Last ${r.window.months} calendar months (UTC; since ${fmtDate(r.window.cutoff)} inclusive)`],
      ['Eligible videos', String(a.eligibleCount)],
      ['Videos averaged', String(a.averagedCount)],
    ];
    if (a.excludedHigh) rows.push(['Highest excluded', fmtInt(a.excludedHigh.viewCount)]);
    if (a.excludedLow) rows.push(['Lowest excluded', fmtInt(a.excludedLow.viewCount)]);
    rows.push(['Average', a.exactFormatted]);
    rows.push(['Display', a.display]);
    rows.push(['Method', a.method === 'trimmed_high_low'
      ? 'Trimmed: one highest and one lowest observation removed'
      : a.method === 'untrimmed_mean' ? 'Untrimmed mean (small sample)' : 'None']);
    for (const [k, v] of rows) dl.append(...kv(k, v));
    p.appendChild(dl);

    if (a.exact !== null) {
      const copyRow = el('div');
      const btn = el('button', { class: 'copybtn', type: 'button', text: `Copy ${a.exactFormatted}` });
      btn.addEventListener('click', () => ctx.onCopy(String(a.exact)));
      copyRow.appendChild(btn);
      p.appendChild(copyRow);
    }

    if (a.note) p.appendChild(el('p', { class: 'note', text: a.note }));

    if (a.status === 'OK' && r.avgViews.band) {
      const bandText = {
        core: 'Screening context: within the preferred/core working range (~50K+). Context only, not a verdict.',
        conditional: 'Screening context: potentially workable / conditional range (~35K–49K). Context only, not a verdict.',
        review: 'Screening context: below ~35K — weaker current economics, deserves review. Context only, not a verdict.',
      }[r.avgViews.band];
      p.appendChild(el('p', { class: 'muted', text: bandText }));
    }

    for (const w of r.warnings) p.appendChild(el('p', { class: 'note', text: w }));

    if (r.discovery.ineligibleCount) {
      const text = r.discovery.ineligibleBreakdown.map((b) => `${b.count} × ${b.label}`).join('; ');
      p.appendChild(el('p', { class: 'muted', text: `Excluded before calculation: ${text}` }));
    }

    // Diagnostics never exclude anything; reported as supporting evidence.
    const flags = r.discovery.diagnosticBreakdown || [];
    if (flags.length) {
      const text = flags.map((f) => `${f.count} × ${f.label}`).join('; ');
      p.appendChild(el('p', { class: 'muted', text: `Notes (included, not excluded): ${text}` }));
    }

    p.appendChild(el('h4', { text: 'Videos' }));
    p.appendChild(buildViewsTable(a.rows));

    if (r.older.length && (a.status === 'INSUFFICIENT' || a.status === 'SMALL_SAMPLE' || a.status === 'NO_ELIGIBLE')) {
      p.appendChild(el('h4', { text: 'Older context (outside the window — not in the calculation)' }));
      p.appendChild(buildViewsTable(
        r.older.map((o) => ({ ...o, status: 'OLDER CONTEXT' })),
      ));
    }

    p.appendChild(panelFooter(r));
  }

  function buildViewsTable(rows) {
    const table = el('table');
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Title' }),
        el('th', { text: 'Published' }),
        el('th', { text: 'Views' }),
        el('th', { text: 'Status' }),
      ]),
    ]);
    const tbody = el('tbody');
    for (const row of rows) {
      const cls = row.status === 'EXCLUDED HIGH' ? 'st st-hi'
        : row.status === 'EXCLUDED LOW' ? 'st st-lo'
          : row.status === 'VIEWS UNAVAILABLE' ? 'st st-na'
            : row.status === 'INCLUDED' ? 'st st-inc' : 'st muted';
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'title', text: row.title || '(untitled)' }),
        el('td', { text: fmtDate(row.publishedAt) }),
        el('td', { class: 'num', text: row.viewCount === null ? 'N/A' : fmtInt(row.viewCount) }),
        el('td', {}, [el('span', { class: cls, text: row.status })]),
      ]));
    }
    table.appendChild(thead);
    table.appendChild(tbody);
    return table;
  }

  function renderEngagementPanel(p, r, ctx) {
    const s = r.engagement.summary;

    p.appendChild(el('h3', { text: 'Engagement' }));
    p.appendChild(el('p', {
      class: 'muted',
      text: 'Per video: (likes + comments) \u00F7 views \u00D7 100. Subscribers are not part of the formula.',
    }));

    p.appendChild(el('h4', { text: 'Videos' }));

    const table = el('table');
    table.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Title' }),
        el('th', { text: 'Published' }),
        el('th', { text: 'Views' }),
        el('th', { text: 'Likes' }),
        el('th', { text: 'Comments' }),
        el('th', { text: 'ER' }),
        el('th', { text: 'Status' }),
      ]),
    ]));
    const tbody = el('tbody');
    for (const row of r.engagement.rows) {
      const erCell = row.available
        ? el('td', { class: 'num', text: fmtPct(row.er) })
        : el('td', { class: 'num' }, [el('span', { class: 'st st-na', text: 'N/A' })]);

      const cls = row.status === 'EXCLUDED HIGHEST ER' ? 'st st-hi'
        : row.status === 'EXCLUDED LOWEST ER' ? 'st st-lo'
          : row.status === 'UNAVAILABLE' ? 'st st-na'
            : row.status === 'INCLUDED' ? 'st st-inc' : 'st muted';

      const tr = el('tr', {}, [
        el('td', { class: 'title', text: row.title || '(untitled)' }),
        el('td', { text: fmtDate(row.publishedAt) }),
        el('td', { class: 'num', text: row.viewCount === null ? 'N/A' : fmtInt(row.viewCount) }),
        el('td', { class: 'num', text: row.likeCount === null ? 'hidden' : fmtInt(row.likeCount) }),
        el('td', { class: 'num', text: row.commentCount === null ? 'n/r' : fmtInt(row.commentCount) }),
        erCell,
        el('td', {}, [el('span', { class: cls, text: row.status })]),
      ]);
      if (!row.available && row.reason) tr.title = row.reason;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    p.appendChild(table);

    /* ---- creator-level figure (the production method) ---- */
    p.appendChild(el('h4', { text: 'Creator engagement rate' }));

    const list = el('dl', { class: 'kv' });
    list.append(...kv('Videos in sample', String(s.sampleCount)));
    list.append(...kv('Valid engagement videos', String(s.validCount)));
    if (s.unavailableCount) list.append(...kv('Unavailable', String(s.unavailableCount)));
    list.append(...kv('Videos in average', String(s.includedCount)));
    if (s.excludedHigh) list.append(...kv('Highest ER excluded', fmtPct(s.excludedHigh.er)));
    if (s.excludedLow) list.append(...kv('Lowest ER excluded', fmtPct(s.excludedLow.er)));
    list.append(...kv('Engagement rate', s.creatorEr === null ? 'N/A' : fmtPct(s.creatorEr)));
    list.append(...kv('Method', s.appliedMethod === 'trimmed_high_low'
      ? 'Trimmed: one highest and one lowest ER removed'
      : s.appliedMethod === 'untrimmed_mean' ? 'Untrimmed mean of video ERs (small sample)' : 'None'));
    p.appendChild(list);

    if (Number.isFinite(s.creatorEr)) {
      const copyRow = el('div');
      const btn = el('button', { class: 'copybtn', type: 'button', text: `Copy ${s.creatorEr.toFixed(2)}%` });
      btn.addEventListener('click', () => ctx.onCopy(s.creatorEr.toFixed(2)));
      copyRow.appendChild(btn);
      p.appendChild(copyRow);
    }

    if (s.note) p.appendChild(el('p', { class: 'note', text: s.note }));

    /* ---- secondary screening evidence ---- */
    p.appendChild(el('h4', { text: 'Screening evidence (secondary)' }));
    const screen = el('dl', { class: 'kv' });
    screen.append(...kv(`Videos \u2265${s.threshold}%`, String(s.atOrAboveThreshold)));
    screen.append(...kv(`Videos <${s.threshold}%`, String(s.belowThreshold)));
    screen.append(...kv('ER range', s.validCount ? `${fmtPct(s.erMin)} \u2013 ${fmtPct(s.erMax)}` : 'N/A'));
    p.appendChild(screen);

    p.appendChild(el('p', {
      class: 'muted',
      text: 'A single video below the threshold does not disqualify a creator; read engagement alongside creator scale and the recent pattern.',
    }));

    for (const w of r.warnings) p.appendChild(el('p', { class: 'note', text: w }));
    p.appendChild(panelFooter(r));
  }

  /** The error panel, shared so the fixture can exercise it too. */
  function renderErrorPanel(p, error, ctx) {
    p.appendChild(el('h3', { text: 'Cannot calculate' }));
    p.appendChild(el('p', { class: 'err', text: error.message }));
    if (error.detail) {
      p.appendChild(el('p', { class: 'muted', text: `Detail: ${error.detail}` }));
    }
    if (error.code === 'NO_API_KEY' || error.code === 'API_KEY_INVALID' || error.code === 'API_KEY_REJECTED') {
      const openBtn = el('button', { class: 'copybtn', type: 'button', text: 'Open settings' });
      openBtn.addEventListener('click', () => ctx.onOpenSettings && ctx.onOpenSettings());
      p.appendChild(el('p', { class: 'muted' }, [
        'Enter a YouTube Data API v3 key in the extension settings, then click Refresh here.',
        openBtn,
      ]));
    }
  }

  /**
   * Wire a copy affordance that lives INSIDE a larger clickable control.
   *
   * The compact copy icons are nested in the metric <button>, so the click
   * must be fully contained: no default action, no bubbling to the pill's
   * own handler, and no other listener on the icon itself. `doCopy` is
   * invoked exactly once per click.
   */
  function bindCopyControl(node, getText, doCopy) {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      doCopy(getText());
    });
  }

  /**
   * THE canonical compact text for the Avg Views control. The control renders
   * exactly this, and the clipboard copies exactly what the control renders,
   * so the two cannot drift apart.
   *
   * Real states: a compact number ("6M", "67.8K"), the same with the
   * small-sample marker ("6.2K*"), "insufficient", or "none".
   * Avg Views never shows "N/A" — a null average is reported as
   * "insufficient" or "none" instead.
   */
  function compactAvgViewsText(avgViews) {
    if (!avgViews) return 'none';
    if (avgViews.status === 'OK') return avgViews.display;
    if (avgViews.status === 'SMALL_SAMPLE') return `${avgViews.display}*`;
    if (avgViews.status === 'INSUFFICIENT') return 'insufficient';
    return 'none';
  }

  /** Transient control text, shown while working or after a failure. */
  const LOADING_TEXT = '\u2026';
  const ERROR_TEXT = '!';

  /**
   * What the compact copy icon puts on the clipboard, derived from the text
   * the operator can actually see on that control.
   *
   *   Avg Views  : the displayed value/state verbatim, "*" included.
   *   Engagement : the same, except that the "%" of a numeric percentage is
   *                removed so the value pastes into a percentage column.
   *                "4.00%*" -> "4.00*"  — the marker survives.
   *
   * Non-numeric states ("insufficient", "none", "N/A") are legitimate operator
   * information and ARE copyable. Only the transient loading and error glyphs,
   * which never show a copy icon, return null.
   */
  function compactCopyValue(renderedText, metric) {
    if (typeof renderedText !== 'string') return null;
    const text = renderedText.trim();
    if (!text || text === LOADING_TEXT || text === ERROR_TEXT) return null;
    // Strip only a "%" that terminates a number, never any other character.
    return metric === 'engagement' ? text.replace(/(\d)%/g, '$1') : text;
  }

  /**
   * The confirmation shown after a copy attempt. Pure, so the exact operator
   * feedback is verifiable without a browser.
   */
  function copyFeedback(result) {
    const { ok, text, reason } = result || {};
    if (ok) return { text: `Copied ${text}`, failed: false };
    if (reason === 'NOTHING_TO_COPY') return { text: 'Nothing to copy', failed: true };
    return { text: 'Copy failed', failed: true };
  }

  self.THQRender = {
    STYLES, applyStyles, el, kv, fmtInt, fmtPct, fmtDate,
    panelFooter, buildViewsTable,
    renderAvgViewsPanel, renderEngagementPanel, renderErrorPanel,
    // copyText was defined here but never exported, so every caller in
    // content.js hit a ReferenceError. See CHANGELOG 1.0.2.
    copyText, bindCopyControl, copyFeedback,
    compactAvgViewsText, compactCopyValue, LOADING_TEXT, ERROR_TEXT,
  };
})();
