/**
 * Clipboard / copy-control tests.
 *
 * Two layers:
 *   1. the pure display -> clipboard mapping in lib/calculations.js;
 *   2. the real shipped content/render.js, evaluated in a minimal stub
 *      environment so the actual event plumbing and clipboard fallback are
 *      exercised rather than a reimplementation of them.
 *
 *   node tests/clipboard.test.mjs
 *   deno run --allow-read tests/clipboard.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { engagementCompactLabel, formatCompactNumber } from '../lib/calculations.js';

let passed = 0;
const failures = [];
// Tests are queued and AWAITED in order before the summary is printed.
// v1.0.2's harness called fn() without awaiting it and then exited
// synchronously, so assertions after the first `await` in an async test
// never ran. See CHANGELOG 1.1.0.
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
function group(t) { queue.push({ group: t }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function equal(a, e, l = 'value') {
  if (a !== e) throw new Error(`${l}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}

/* ------------------------------------------------------------------ *
 * Load the REAL render.js into a stub environment
 * ------------------------------------------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));
const renderSource = readFileSync(join(here, '..', 'content', 'render.js'), 'utf8');

/** Minimal element good enough for the copy-control plumbing. */
function makeNode() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    // select()/remove() exist on every real <textarea>; the production
    // execCommand fallback calls both.
    setAttribute() {}, appendChild() {}, removeAttribute() {}, select() {}, remove() {},
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click(event) { for (const fn of listeners.click || []) fn(event); },
  };
}

/**
 * Dispatch a click through a real bubble chain: the target's listeners run,
 * then each ancestor's, unless propagation was stopped. This is what makes the
 * "does not trigger the parent metric button" assertion meaningful.
 */
function dispatchClick(target, ancestors) {
  const event = makeEvent();
  const chain = [target, ...ancestors];
  for (const node of chain) {
    for (const fn of node.listeners.click || []) {
      fn(event);
      if (event.stopped.immediate) return event;
    }
    if (event.stopped.propagation) return event;
  }
  return event;
}

function makeEvent() {
  const calls = { preventDefault: 0, stopPropagation: 0, stopImmediatePropagation: 0 };
  const stopped = { propagation: false, immediate: false };
  return {
    calls,
    stopped,
    defaultPrevented: false,
    preventDefault() { calls.preventDefault += 1; this.defaultPrevented = true; },
    stopPropagation() { calls.stopPropagation += 1; stopped.propagation = true; },
    stopImmediatePropagation() { calls.stopImmediatePropagation += 1; stopped.immediate = true; stopped.propagation = true; },
  };
}

/** Evaluate render.js with the globals it touches, returning its exports. */
function loadRender({ clipboard, execCommandResult } = {}) {
  const selfStub = {};
  const created = [];
  const documentStub = {
    createElement() { const n = makeNode(); created.push(n); return n; },
    body: { appendChild() {} },
    execCommand() {
      documentStub.execCommandCalls = (documentStub.execCommandCalls || 0) + 1;
      if (execCommandResult instanceof Error) throw execCommandResult;
      return execCommandResult === undefined ? true : execCommandResult;
    },
  };
  const navigatorStub = { clipboard };
  // eslint-disable-next-line no-new-func
  new Function('self', 'document', 'navigator', renderSource)(selfStub, documentStub, navigatorStub);
  return { api: selfStub.THQRender, documentStub, navigatorStub };
}

/* =================================================================== *
 * 1. Pure mapping: what the control displays -> what is copied
 * =================================================================== */

group('ACTUAL COMPACT DISPLAY STATES -> CLIPBOARD');

// Loaded once; these helpers are the production ones.
const R = loadRender({ clipboard: { async writeText() {} } }).api;
const avgText = (status, display) => R.compactAvgViewsText({ status, display });
const copyOf = (text, metric) => R.compactCopyValue(text, metric);

test('A. the Avg Views control renders exactly four real states', () => {
  equal(avgText('OK', '6M'), '6M', 'OK');
  equal(avgText('SMALL_SAMPLE', '6.2K'), '6.2K*', 'small sample keeps the marker');
  equal(avgText('INSUFFICIENT', 'N/A'), 'insufficient', 'insufficient (lowercase)');
  equal(avgText('NO_ELIGIBLE', 'N/A'), 'none', 'none (lowercase)');
  // Avg Views cannot display "N/A": a null average renders as one of the two
  // textual states above, never as the raw display field.
  assert(avgText('INSUFFICIENT', 'N/A') !== 'N/A', 'N/A is unreachable for Avg Views');
  assert(avgText('NO_ELIGIBLE', 'N/A') !== 'N/A', 'N/A is unreachable for Avg Views');
});

test('B. the Engagement control renders exactly four real states', () => {
  equal(engagementCompactLabel({ status: 'OK', creatorEr: 2.01 }), '2.01%', 'numeric');
  equal(engagementCompactLabel({ status: 'SMALL_SAMPLE', creatorEr: 4 }), '4.00%*', 'small sample');
  equal(engagementCompactLabel({ status: 'INSUFFICIENT' }), 'insufficient', 'insufficient (lowercase)');
  equal(engagementCompactLabel({ status: 'NO_DATA' }), 'N/A', 'N/A');
  // Engagement has no "none" state.
  for (const st of ['OK', 'SMALL_SAMPLE', 'INSUFFICIENT', 'NO_DATA']) {
    assert(engagementCompactLabel({ status: st, creatorEr: 1 }) !== 'none', `${st} is never "none"`);
  }
});

test('C. Avg Views copies the displayed value/state verbatim', () => {
  equal(copyOf('6M', 'views'), '6M', '6M');
  equal(copyOf('6.2K', 'views'), '6.2K', '6.2K');
  equal(copyOf('35K', 'views'), '35K', '35K');
  equal(copyOf('1.4M', 'views'), '1.4M', '1.4M');
  equal(copyOf('187.1K', 'views'), '187.1K', '187.1K');
  equal(copyOf('999', 'views'), '999', 'plain integer');
  equal(copyOf('6.2K*', 'views'), '6.2K*', 'the asterisk SURVIVES');
  equal(copyOf('insufficient', 'views'), 'insufficient', 'textual state copied exactly');
  equal(copyOf('none', 'views'), 'none', 'textual state copied exactly');
});

test('D. Engagement copies the displayed value/state, removing only "%"', () => {
  equal(copyOf('2.01%', 'engagement'), '2.01', '2.01%');
  equal(copyOf('3.66%', 'engagement'), '3.66', '3.66%');
  equal(copyOf('0.48%', 'engagement'), '0.48', '0.48%');
  equal(copyOf('12.00%', 'engagement'), '12.00', 'trailing zeros preserved');
  equal(copyOf('4.00%*', 'engagement'), '4.00*', 'the asterisk SURVIVES, only % removed');
  equal(copyOf('insufficient', 'engagement'), 'insufficient', 'textual state copied exactly');
  equal(copyOf('N/A', 'engagement'), 'N/A', 'textual state copied exactly');
});

test('E. only "%" is ever removed, and only from a numeric percentage', () => {
  // The asterisk, letters, dots and slashes all survive untouched.
  equal(copyOf('6.2K*', 'views'), '6.2K*', 'views: nothing removed');
  equal(copyOf('N/A', 'engagement'), 'N/A', 'slash survives');
  equal(copyOf('4.00%*', 'engagement'), '4.00*', 'only the % goes');
  // A "%" not terminating a number is left alone.
  equal(copyOf('%odd', 'engagement'), '%odd', 'non-numeric % untouched');
  // Avg Views never strips anything, even if a % somehow appeared.
  equal(copyOf('2.01%', 'views'), '2.01%', 'views never strips %');
});

test('F. every real state is copyable; only the transient glyphs are not', () => {
  const avgStates = ['6M', '6.2K*', 'insufficient', 'none'];
  const engStates = ['2.01%', '4.00%*', 'insufficient', 'N/A'];
  for (const st of avgStates) assert(copyOf(st, 'views') !== null, `avg "${st}" is copyable`);
  for (const st of engStates) assert(copyOf(st, 'engagement') !== null, `eng "${st}" is copyable`);

  // Loading and error glyphs never show a copy icon, and yield nothing.
  for (const metric of ['views', 'engagement']) {
    equal(copyOf(R.LOADING_TEXT, metric), null, `loading glyph (${metric})`);
    equal(copyOf(R.ERROR_TEXT, metric), null, `error glyph (${metric})`);
    equal(copyOf('', metric), null, `empty (${metric})`);
    equal(copyOf('   ', metric), null, `blank (${metric})`);
    equal(copyOf(null, metric), null, `null (${metric})`);
  }
});

test('G. display and clipboard cannot drift: copy is taken from the rendered text', () => {
  // Whatever the renderer produces is what gets copied — no second derivation.
  for (const [status, display, expectedDisplay] of [
    ['OK', formatCompactNumber(6000000), '6M'],
    ['OK', formatCompactNumber(67814), '67.8K'],
    ['SMALL_SAMPLE', formatCompactNumber(6200), '6.2K*'],
    ['INSUFFICIENT', 'N/A', 'insufficient'],
    ['NO_ELIGIBLE', 'N/A', 'none'],
  ]) {
    const rendered = avgText(status, display);
    equal(rendered, expectedDisplay, `rendered for ${status}`);
    equal(copyOf(rendered, 'views'), rendered, `copy equals display for ${status}`);
  }
});

test('H. feedback names the real state, including textual ones', () => {
  equal(R.copyFeedback({ ok: true, text: '6M' }).text, 'Copied 6M', 'numeric');
  equal(R.copyFeedback({ ok: true, text: '6.2K*' }).text, 'Copied 6.2K*', 'asterisk');
  equal(R.copyFeedback({ ok: true, text: '2.01' }).text, 'Copied 2.01', 'percentage');
  equal(R.copyFeedback({ ok: true, text: '4.00*' }).text, 'Copied 4.00*', 'percentage + asterisk');
  equal(R.copyFeedback({ ok: true, text: 'insufficient' }).text, 'Copied insufficient', 'textual state');
  equal(R.copyFeedback({ ok: true, text: 'N/A' }).text, 'Copied N/A', 'textual state');
});

group('COPY CONTROL PLUMBING (real content/render.js)');

test('A. render.js exports the clipboard helpers content.js depends on', () => {
  const { api } = loadRender({ clipboard: { async writeText() {} } });
  // The v1.0.0/v1.0.1 defect: copyText existed but was not exported, so every
  // caller in content.js threw ReferenceError on click.
  equal(typeof api.copyText, 'function', 'copyText exported');
  equal(typeof api.bindCopyControl, 'function', 'bindCopyControl exported');
});

test('B. a copy click never reaches the parent metric button (real bubble chain)', () => {
  const { api } = loadRender({ clipboard: { async writeText() {} } });

  // The icon really is nested inside the metric <button> in production.
  const pill = makeNode();
  let panelToggles = 0;
  pill.addEventListener('click', () => { panelToggles += 1; });

  const icon = makeNode();
  let copies = 0;
  api.bindCopyControl(icon, () => '6M', () => { copies += 1; });

  // Sanity: without the binder a click on a child DOES reach the pill.
  const bare = makeNode();
  dispatchClick(bare, [pill]);
  equal(panelToggles, 1, 'control: an unguarded child click does reach the pill');

  panelToggles = 0;
  const event = dispatchClick(icon, [pill]);

  equal(copies, 1, 'the copy ran');
  equal(panelToggles, 0, 'the metric panel was NOT toggled');
  equal(event.defaultPrevented, true, 'default action prevented');
  equal(event.calls.stopPropagation, 1, 'stopPropagation called');
  equal(event.calls.stopImmediatePropagation, 1, 'stopImmediatePropagation called');
});

test('B2. the success state is produced with the copied value', () => {
  const { api } = loadRender({ clipboard: { async writeText() {} } });
  equal(api.copyFeedback({ ok: true, text: '6M' }).text, 'Copied 6M', 'avg views');
  equal(api.copyFeedback({ ok: true, text: '2.01' }).text, 'Copied 2.01', 'engagement');
  equal(api.copyFeedback({ ok: true, text: '6M' }).failed, false, 'not marked failed');
});

test('B3. failure states are surfaced, never silent', () => {
  const { api } = loadRender({ clipboard: { async writeText() {} } });
  const nothing = api.copyFeedback({ ok: false, text: null, reason: 'NOTHING_TO_COPY' });
  equal(nothing.text, 'Nothing to copy', 'nothing-to-copy message');
  equal(nothing.failed, true, 'flagged as failed');

  const failed = api.copyFeedback({ ok: false, text: '6M', reason: 'CLIPBOARD_FAILED' });
  equal(failed.text, 'Copy failed', 'clipboard-failure message');
  equal(failed.failed, true, 'flagged as failed');

  equal(api.copyFeedback(undefined).text, 'Copy failed', 'defensive default');
});

test('B4. end to end: click -> single clipboard write -> success feedback', async () => {
  const writes = [];
  const { api } = loadRender({ clipboard: { async writeText(t) { writes.push(t); } } });

  const pill = makeNode();
  let panelToggles = 0;
  pill.addEventListener('click', () => { panelToggles += 1; });

  const icon = makeNode();
  let feedback = null;
  // Mirrors Controller.copyValue: one clipboard call, then one feedback.
  const doCopy = async (text) => {
    const ok = await api.copyText(String(text));
    feedback = api.copyFeedback({ ok, text: String(text), reason: ok ? null : 'CLIPBOARD_FAILED' });
  };
  api.bindCopyControl(icon, () => '2.01', doCopy);

  dispatchClick(icon, [pill]);
  await new Promise((r) => setTimeout(r, 0));

  equal(writes.length, 1, 'exactly one clipboard write');
  equal(writes[0], '2.01', 'wrote the displayed value without its percent sign');
  equal(feedback.text, 'Copied 2.01', 'success feedback shown');
  equal(panelToggles, 0, 'panel never toggled');
});

test('C. exactly one copy is performed per click', () => {
  const { api } = loadRender({ clipboard: { async writeText() {} } });
  const node = makeNode();
  const copied = [];
  api.bindCopyControl(node, () => '2.01', (text) => copied.push(text));

  node.click(makeEvent());
  equal(copied.length, 1, 'one copy per click');
  equal(copied[0], '2.01', 'the displayed value, percent sign removed');

  node.click(makeEvent());
  node.click(makeEvent());
  equal(copied.length, 3, 'still exactly one per click');
});

test('D. the value is read at click time, not at bind time', () => {
  const { api } = loadRender({ clipboard: { async writeText() {} } });
  const node = makeNode();
  let current = null;
  const copied = [];
  api.bindCopyControl(node, () => current, (t) => copied.push(t));

  node.click(makeEvent());
  equal(copied[0], null, 'nothing to copy before a result exists');

  current = '6M';
  node.click(makeEvent());
  equal(copied[1], '6M', 'the freshly rendered value is copied');
});

test('E. copyText writes once through the async clipboard API and reports success', async () => {
  let calls = 0;
  let received = null;
  const { api, documentStub } = loadRender({
    clipboard: { async writeText(t) { calls += 1; received = t; } },
  });
  const ok = await api.copyText('6M');
  equal(ok, true, 'reports success');
  equal(calls, 1, 'exactly one clipboard write');
  equal(received, '6M', 'exact text written');
  equal(documentStub.execCommandCalls, undefined, 'fallback not used when the API works');
});

test('F. a rejecting clipboard API falls back rather than failing silently', async () => {
  const { api, documentStub } = loadRender({
    clipboard: { async writeText() { throw new Error('denied'); } },
    execCommandResult: true,
  });
  const ok = await api.copyText('2.01');
  equal(ok, true, 'fallback succeeded');
  equal(documentStub.execCommandCalls, 1, 'fallback used exactly once');
});

test('G. when both paths fail, copyText resolves false instead of throwing', async () => {
  const { api } = loadRender({
    clipboard: { async writeText() { throw new Error('denied'); } },
    execCommandResult: false,
  });
  const ok = await api.copyText('6M');
  equal(ok, false, 'failure is reported, not thrown');
});

test('H. a missing clipboard API is handled, not thrown', async () => {
  const { api } = loadRender({ clipboard: undefined, execCommandResult: true });
  const ok = await api.copyText('6M');
  equal(typeof ok, 'boolean', 'resolves to a boolean');
});

test('I. a throwing fallback still resolves false', async () => {
  const { api } = loadRender({
    clipboard: { async writeText() { throw new Error('denied'); } },
    execCommandResult: new Error('execCommand blocked'),
  });
  const ok = await api.copyText('6M');
  equal(ok, false, 'no exception escapes');
});

group('v1.3.0 RICH CLIPBOARD (copyRich)');

test('Q1. plain text + text/html in one clipboard write when supported', async () => {
  const writes = [];
  globalThis.ClipboardItem = class { constructor(map) { this.map = map; } };
  globalThis.Blob = globalThis.Blob || class {};
  const { api } = loadRender({ clipboard: { async write(items) { writes.push(items); }, async writeText() { throw new Error('should not be used'); } } });
  equal(await api.copyRich('https://www.youtube.com/watch?v=AAAAAAAAAAA', '<div><a href="x">x</a></div>'), true, 'ok');
  equal(writes.length, 1, 'one write');
  equal(Object.keys(writes[0][0].map).join(','), 'text/plain,text/html', 'both types');
  delete globalThis.ClipboardItem;
});

test('Q2. rich write refused or unavailable: falls back to the ordinary plain-text copy', async () => {
  globalThis.ClipboardItem = class { constructor(map) { this.map = map; } };
  const plain = [];
  const refused = loadRender({ clipboard: { async write() { throw new Error('denied'); }, async writeText(t) { plain.push(t); } } }).api;
  equal(await refused.copyRich('T', '<b>T</b>'), true, 'plain fallback succeeded');
  equal(plain.join(), 'T', 'plain text written');
  delete globalThis.ClipboardItem;
  const noApi = loadRender({ clipboard: { async writeText(t) { plain.push(t); } } }).api;
  equal(await noApi.copyRich('U', '<b>U</b>'), true, 'no ClipboardItem: plain');
  equal(await noApi.copyRich('V', null), true, 'no html: plain');
  equal(plain.join(), 'T,U,V', 'all plain');
});

/* ------------------------------------------------------------------ */

for (const item of queue) {
  if (item.group) { console.log(`\n${item.group}`); continue; }
  try {
    await item.fn();
    passed += 1;
    console.log(`  ok   ${item.name}`);
  } catch (err) {
    failures.push({ name: item.name, message: err && err.message });
    console.log(`  FAIL ${item.name}\n       ${err && err.message}`);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
const exit = (code) => {
  if (typeof process !== 'undefined' && process.exit) process.exit(code);
  else if (typeof Deno !== 'undefined') Deno.exit(code);
};
exit(failures.length ? 1 : 0);
