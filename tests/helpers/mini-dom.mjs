/**
 * A minimal, dependency-free DOM for the reader tests.
 *
 * Enough of the DOM for the production readers in content/video-selection.js
 * and content/channel-details.js to run unmodified under plain Node:
 * parse well-formed fixture HTML, walk childNodes, read attributes and text,
 * and match the simple CSS selectors those readers use (tag, #id, .class,
 * [attr], [attr="v"], [attr^="v"], [attr*="v"], [attr$="v"], descendant and
 * child combinators, comma lists).
 *
 * It is test infrastructure, not a browser. tests/browser/ runs the same
 * readers over the same fixture HTML in real Chromium and compares results,
 * so a difference between this and a real DOM would show up there.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function decode(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

class TextNode {
  constructor(value) {
    this.nodeType = 3;
    this.nodeName = '#text';
    this.nodeValue = value;
    this.parentNode = null;
  }

  get textContent() { return this.nodeValue; }
}

class ElementNode {
  constructor(tag, attrs = new Map()) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.nodeName = this.tagName;
    this.attrs = attrs;
    this.childNodes = [];
    this.parentNode = null;
  }

  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }

  hasAttribute(name) { return this.attrs.has(name); }

  setAttribute(name, value) { this.attrs.set(name, String(value)); }

  removeAttribute(name) { this.attrs.delete(name); }

  get id() { return this.getAttribute('id') || ''; }

  get className() { return this.getAttribute('class') || ''; }

  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  *descendants() {
    for (const child of this.childNodes) {
      if (child.nodeType !== 1) continue;
      yield child;
      yield* child.descendants();
    }
  }

  matches(selector) { return parseSelectorList(selector).some((complex) => matchComplex(this, complex)); }

  querySelectorAll(selector) {
    const list = parseSelectorList(selector);
    const out = [];
    for (const el of this.descendants()) if (list.some((complex) => matchComplex(el, complex))) out.push(el);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  closest(selector) {
    for (let el = this; el && el.nodeType === 1; el = el.parentNode) if (el.matches(selector)) return el;
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

const TOKEN_RE = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
const ATTR_RE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function parseHTML(html) {
  const root = new ElementNode('#root');
  const stack = [root];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.appendChild(new TextNode(decode(m[5])));
    } else if (m[2]) {
      const attrs = new Map();
      let a;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(m[3] || ''))) attrs.set(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
      const el = new ElementNode(m[2], attrs);
      top.appendChild(el);
      if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el);
    } else if (m[1]) {
      const tag = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
    }
  }
  return root;
}

/** Parse a fragment and return its first element. */
export function fragment(html) {
  return parseHTML(html).children[0] || null;
}

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

const cache = new Map();

function parseCompound(text) {
  const c = { tag: null, ids: [], classes: [], attrs: [] };
  let rest = text;
  const tag = /^([a-zA-Z][\w-]*|\*)/.exec(rest);
  if (tag) {
    if (tag[1] !== '*') c.tag = tag[1].toUpperCase();
    rest = rest.slice(tag[0].length);
  }
  while (rest) {
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) c.ids.push(m[1]);
    else if ((m = /^\.([\w-]+)/.exec(rest))) c.classes.push(m[1]);
    else if ((m = /^\[([\w-]+)(?:([~^$*|]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/.exec(rest))) {
      c.attrs.push({ name: m[1], op: m[2] || null, value: m[3] ?? m[4] ?? m[5] ?? null });
    } else throw new Error(`mini-dom: unsupported selector part "${rest}" in "${text}"`);
    rest = rest.slice(m[0].length);
  }
  return c;
}

function parseSelectorList(selector) {
  if (cache.has(selector)) return cache.get(selector);
  const list = selector.split(',').map((part) => {
    const tokens = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    const steps = [];
    let combinator = ' ';
    for (const token of tokens) {
      if (token === '>') { combinator = '>'; continue; }
      steps.push({ compound: parseCompound(token), combinator });
      combinator = ' ';
    }
    return steps;
  });
  cache.set(selector, list);
  return list;
}

function matchCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  for (const id of c.ids) if (el.getAttribute('id') !== id) return false;
  const classes = (el.getAttribute('class') || '').split(/\s+/);
  for (const cls of c.classes) if (!classes.includes(cls)) return false;
  for (const { name, op, value } of c.attrs) {
    const v = el.getAttribute(name);
    if (v === null) return false;
    if (!op) continue;
    if (op === '=' && v !== value) return false;
    if (op === '^=' && !v.startsWith(value)) return false;
    if (op === '$=' && !v.endsWith(value)) return false;
    if (op === '*=' && !v.includes(value)) return false;
    if (op === '~=' && !v.split(/\s+/).includes(value)) return false;
    if (op === '|=' && v !== value && !v.startsWith(`${value}-`)) return false;
  }
  return true;
}

function matchComplex(el, steps, index = steps.length - 1) {
  if (!matchCompound(el, steps[index].compound)) return false;
  if (index === 0) return true;
  const { combinator } = steps[index];
  for (let p = el.parentNode; p && p.nodeType === 1 && p.tagName !== '#ROOT'; p = p.parentNode) {
    if (matchComplex(p, steps, index - 1)) return true;
    if (combinator === '>') return false;
  }
  return false;
}
