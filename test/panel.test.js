/**
 * Tests for finding the right panel.
 *
 * The finder works from geometry alone, so these build small trees of boxes
 * and ask what it would hide. The case that matters most is the last one: a
 * climb that goes one level too far hides the editor, canvas and all.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PANEL = require(path.join(__dirname, '..', 'src', 'panel.js'));

const VW = 1600;
const VH = 1000;
const win = { innerWidth: VW, innerHeight: VH };

/** A node with a box, a parent, and enough of the DOM for the finder. */
function box(tagName, rect, parent) {
  const r = { left: rect[0], top: rect[1], width: rect[2], height: rect[3] };
  r.right = r.left + r.width;
  r.bottom = r.top + r.height;
  const attrs = new Map();
  const style = new Map();
  return {
    tagName, nodeType: 1, parentElement: parent || null,
    getBoundingClientRect: () => r,
    hasAttribute: (k) => attrs.has(k),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    style: { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k) },
    styleOf: (k) => style.get(k),
  };
}

const docHitting = (hit) => ({ elementFromPoint: () => hit });

/** Figma's layout as a tree: editor > [canvas area, right column > section > input]. */
function editor() {
  const html = box('HTML', [0, 0, VW, VH]);
  const body = box('BODY', [0, 0, VW, VH], html);
  const app = box('DIV', [0, 0, VW, VH], body);
  const canvas = box('CANVAS', [0, 0, VW, VH], app);
  const outer = box('DIV', [VW - 280, 0, 280, VH], app);
  const inner = box('DIV', [VW - 280, 56, 280, VH - 56], outer);
  const section = box('DIV', [VW - 280, 400, 280, 120], inner);
  const input = box('INPUT', [VW - 260, 480, 240, 28], section);
  return { app, canvas, outer, inner, section, input };
}

test('a hit inside the panel climbs to the outermost column', () => {
  const t = editor();
  assert.equal(PANEL.find(docHitting(t.input), win), t.outer);
});

test('the climb stops before the editor that holds the canvas', () => {
  const t = editor();
  const found = PANEL.find(docHitting(t.section), win);
  assert.notEqual(found, t.app, 'hiding the editor would take the canvas with it');
});

test('a hit on the canvas finds nothing, so nothing is hidden', () => {
  // This is what happens with Hide UI on, or once the panel is already gone.
  const t = editor();
  assert.equal(PANEL.find(docHitting(t.canvas), win), null);
});

test('a short popover at the right edge is not a panel', () => {
  const t = editor();
  const menu = box('DIV', [VW - 240, 300, 240, 260], t.app);
  assert.equal(PANEL.find(docHitting(menu), win), null);
});

test('a column that is not against the right edge is not a panel', () => {
  const t = editor();
  const left = box('DIV', [0, 0, 280, VH], t.app);
  assert.equal(PANEL.find(docHitting(left), win), null);
});

/** An element with a real enough style declaration for widen and narrow. */
function styled(parent, inline) {
  const props = new Map(Object.entries(inline || {}).map(([k, v]) => [k, [v, '']]));
  const attrs = new Map();
  return {
    parentElement: parent || null,
    hasAttribute: (k) => attrs.has(k),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    style: {
      getPropertyValue: (k) => (props.get(k) || [''])[0],
      getPropertyPriority: (k) => (props.get(k) || ['', ''])[1],
      setProperty: (k, v, p) => props.set(k, [v, p || '']),
      removeProperty: (k) => props.delete(k),
    },
  };
}

function page() {
  const html = styled(null);
  const body = styled(html, { overflow: 'auto' });
  const app = styled(body);
  const view = styled(app);
  const panel = styled(view);
  return { doc: { documentElement: html, body }, html, body, app, panel };
}

test('widen makes the app one panel wider and clips the overflow', () => {
  const p = page();
  assert.ok(PANEL.widen(p.doc, p.panel, 241));
  assert.equal(p.app.style.getPropertyValue('width'), 'calc(100% + 241px)');
  assert.equal(p.app.style.getPropertyPriority('width'), 'important');
  assert.equal(p.body.style.getPropertyValue('overflow'), 'clip');
  assert.equal(p.html.style.getPropertyValue('overflow'), 'hidden');
  assert.equal(PANEL.widen(p.doc, p.panel, 241), false, 'the same width twice is a no-op');
  PANEL.narrow();
});

test('narrow puts back exactly what was there', () => {
  const p = page();
  PANEL.widen(p.doc, p.panel, 241);
  assert.ok(PANEL.narrow());
  assert.equal(p.app.style.getPropertyValue('width'), '');
  assert.equal(p.body.style.getPropertyValue('overflow'), 'auto', "the page's own value comes back");
  assert.equal(p.html.style.getPropertyValue('overflow'), '');
  assert.equal(p.app.hasAttribute(PANEL.ATTR), false);
  assert.equal(PANEL.narrow(), false, 'nothing left to undo');
});

test('a panel outside <body> is never widened', () => {
  const p = page();
  const stray = styled(styled(null));
  assert.equal(PANEL.widen(p.doc, stray, 241), false);
  assert.equal(PANEL.widen(p.doc, p.panel, 0), false, 'a zero width means no panel');
  assert.equal(PANEL.narrow(), false);
});

test('Figma Slides as measured: empty wrappers do not end the climb', () => {
  // The chain under the right edge in a live Slides file, 2026-11-11, at a
  // 1001x997 viewport. Two kinds of wrapper have no area: `display: contents`
  // (all zeros) and a zero-height div between the panel's layers.
  const w = { innerWidth: 1001, innerHeight: 997 };
  const html = box('HTML', [0, 0, 1001, 997]);
  const body = box('BODY', [0, 0, 1001, 997], html);
  const page = box('DIV', [0, 0, 1001, 997], body);          // fullscreen_view--page
  const empty = box('DIV', [0, 997, 1001, 0], page);
  const contents = box('DIV', [0, 0, 0, 0], empty);           // accessible_area--displayContent
  const drill = box('DIV', [760, 0, 241, 997], contents);     // properties_panel--drillDownContainer
  const flat = box('DIV', [760, 0, 241, 0], drill);
  const position = box('DIV', [760, 0, 241, 997], flat);      // properties_panel--panelPosition
  const panel = box('DIV', [761, 81, 240, 873], position);    // properties_panel--propertiesPanel
  const cached = box('DIV', [0, 0, 0, 0], panel);             // cachedSubtree displayContents
  const section = box('DIV', [761, 459, 240, 81], cached);    // slides_panel--panel
  const row = box('DIV', [761, 459, 232, 40], section);
  assert.equal(PANEL.find(docHitting(row), w), drill);
});
