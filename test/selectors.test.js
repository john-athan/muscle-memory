/**
 * Tests for the declutter matcher.
 *
 * The interesting cases are all failures rather than successes. Hiding a
 * banner is worth little; hiding the canvas because a match walked one level
 * too far up the tree would make the extension unusable in a way that looks
 * like Figma being broken. So most of what follows checks that the matcher
 * declines: on text that merely mentions the same words, on containers that
 * hold the application, on anything large enough to be the page itself.
 *
 * A hand-rolled stub stands in for the DOM. The functions under test touch
 * five properties between them, and a stub keeps the invariants readable and
 * the suite dependency-free.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

globalThis.window = { innerWidth: 1600, innerHeight: 900 };
const SELECTORS = require(path.join(__dirname, '..', 'src', 'selectors.js'));

/** A stand-in element. `size` is [width, height]; children nest downward. */
function node(tag, opts = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    id: opts.id || '',
    textContent: opts.text || '',
    parentElement: null,
    children: opts.children || [],
    attrs: {},
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    hasAttribute(k) { return k in this.attrs; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getBoundingClientRect() {
      const [w, h] = opts.size || [400, 60];
      return { width: w, height: h };
    },
    querySelector(sel) {
      if (sel !== 'canvas') return null;
      const walk = (n) => {
        for (const c of n.children) {
          if (c.tagName === 'CANVAS') return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    },
  };
  for (const child of el.children) child.parentElement = el;
  return el;
}

/** Chain a list of tags into ancestor -> descendant, returning the deepest. */
function chain(specs) {
  let parent = null;
  let deepest = null;
  for (const spec of specs) {
    const el = node(spec.tag, spec);
    el.parentElement = parent;
    if (parent) parent.children.push(el);
    parent = el;
    deepest = el;
  }
  return deepest;
}

/* ---------------------------------------------------------------- patterns */

test('each pattern matches the copy it was written for', () => {
  const by = Object.fromEntries(SELECTORS.PATTERNS.map((p) => [p.id, p]));
  assert.ok(by.desktopBanner.match.test('Open in desktop app'));
  assert.ok(by.desktopBanner.match.test('Open this file in the desktop app'));
  assert.ok(by.aiUpsell.match.test('Try Figma Make'));
  assert.ok(by.whatsNew.match.test('See what’s new'));
});

test('patterns ignore the ordinary sentences that share their words', () => {
  const by = Object.fromEntries(SELECTORS.PATTERNS.map((p) => [p.id, p]));
  // Layer names, comments and file names all pass through this matcher.
  assert.ok(!by.desktopBanner.match.test('Desktop app / Home / Header'));
  assert.ok(!by.aiUpsell.match.test('AI assistant illustration v3'));
  assert.ok(!by.whatsNew.match.test('New file'));
  assert.ok(!by.whatsNew.match.test("What's the new spacing here?"));
});

test('only the patterns that are switched on are returned', () => {
  assert.deepEqual(
    SELECTORS.active({ desktopBanner: true, aiUpsell: false, whatsNew: false }).map((p) => p.id),
    ['desktopBanner'],
  );
  assert.equal(SELECTORS.active({}).length, 0);
  assert.equal(SELECTORS.active(null).length, 0);
});

/* ------------------------------------------------------------ load-bearing */

test('document roots are never hidden', () => {
  for (const tag of ['html', 'body', 'main']) {
    assert.ok(SELECTORS.isLoadBearing(node(tag)), tag + ' must be refused');
  }
});

test('anything containing the canvas is never hidden', () => {
  const wrapper = node('div', { children: [node('div', { children: [node('canvas')] })] });
  assert.ok(SELECTORS.isLoadBearing(wrapper));
});

test('anything covering much of the screen is never hidden', () => {
  // 1600x900 viewport: a 1600x600 element is two thirds of it and is
  // therefore the application, whatever its text happened to say.
  assert.ok(SELECTORS.isLoadBearing(node('div', { size: [1600, 600] })));
  assert.ok(!SELECTORS.isLoadBearing(node('div', { size: [1600, 48] })), 'a banner is wide but short');
});

test('the app mount points are never hidden', () => {
  assert.ok(SELECTORS.isLoadBearing(node('div', { id: 'root' })));
  assert.ok(SELECTORS.isLoadBearing(node('div', { id: 'react-page' })));
});

/* -------------------------------------------------------------- containerFor */

test('the walk up stops before it reaches anything load-bearing', () => {
  const span = chain([
    { tag: 'body' },
    { tag: 'div', size: [1600, 48] },   // the banner
    { tag: 'span', size: [200, 20] },   // the text inside it
  ]);
  const container = SELECTORS.containerFor(span, 6);
  assert.equal(container.tagName, 'DIV', 'should hide the banner, not the body');
});

test('the walk up is capped even when every ancestor looks safe', () => {
  const deep = chain([
    { tag: 'div', size: [300, 40] }, { tag: 'div', size: [300, 40] },
    { tag: 'div', size: [300, 40] }, { tag: 'div', size: [300, 40] },
    { tag: 'div', size: [300, 40] }, { tag: 'div', size: [300, 40] },
    { tag: 'div', size: [300, 40] }, { tag: 'span', size: [100, 20] },
  ]);
  // Two hops means the result is still well inside the chain, not its root.
  const container = SELECTORS.containerFor(deep, 2);
  assert.equal(container, deep.parentElement);
});

test('a match with no safe ancestor hides nothing at all', () => {
  const span = node('span', { text: 'Open in desktop app' });
  span.parentElement = null;
  const body = node('body', { children: [span] });
  span.parentElement = body;
  // The span itself is safe, so it is the answer; the body never is.
  const container = SELECTORS.containerFor(span, 6);
  assert.equal(container.tagName, 'SPAN');
});

test('a matching element that is itself the app is refused outright', () => {
  const appRoot = node('div', { id: 'root', size: [1600, 900] });
  assert.equal(SELECTORS.containerFor(appRoot, 6), null);
});

/* -------------------------------------------------------------------- sweep */

test('sweep hides the banner around matching text and marks what it did', () => {
  const banner = node('div', { size: [1600, 48] });
  const label = node('span', { text: 'Open in desktop app', size: [200, 20] });
  label.parentElement = banner;
  banner.children.push(label);
  const body = node('body', { children: [banner] });
  banner.parentElement = body;

  const root = { querySelectorAll: () => [label] };
  const hidden = SELECTORS.sweep(root, SELECTORS.active({ desktopBanner: true }));

  assert.equal(hidden, 1);
  assert.equal(banner.style.props.display, 'none');
  assert.equal(banner.attrs['data-muscle-memory-hidden'], 'desktopBanner');
});

test('sweep ignores text too long to be a banner', () => {
  // A 400-character cap keeps the matcher off document bodies and comment
  // threads, where the same words turn up in ordinary writing.
  const long = node('div', { text: 'Open in desktop app ' + 'x'.repeat(500) });
  const root = { querySelectorAll: () => [long] };
  assert.equal(SELECTORS.sweep(root, SELECTORS.active({ desktopBanner: true })), 0);
});

test('sweep with nothing switched on touches nothing', () => {
  const el = node('div', { text: 'Open in desktop app' });
  const root = { querySelectorAll: () => [el] };
  assert.equal(SELECTORS.sweep(root, SELECTORS.active({})), 0);
  assert.equal(el.style.props.display, undefined);
});

test('sweep survives a root that cannot be queried', () => {
  assert.equal(SELECTORS.sweep(null, SELECTORS.PATTERNS), 0);
  assert.equal(SELECTORS.sweep({}, SELECTORS.PATTERNS), 0);
});
