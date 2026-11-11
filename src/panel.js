/**
 * The right panel: finding it, and putting it away.
 *
 * Figma offers one way to get the canvas back, and it takes everything:
 * Hide UI (Cmd+\) removes both panels and the toolbar at once. In a deck the
 * right panel is mostly a background colour and a template name, and the left
 * one is the slide list you navigate by, so the useful trade is the right
 * panel alone. Figma has no command for that, which means there is no chord
 * to press on its behalf. This file finds the panel and moves it off screen.
 *
 * It finds the panel by where it sits, not by what it is called. Figma's class
 * names are regenerated with most builds, but "a column against the right
 * edge, most of the window tall, a few hundred pixels wide" has described the
 * properties panel through every redesign. Once found, it is not hidden but
 * pushed past the window's edge; see widen() for why. The search asks the browser what
 * is under a point near the right edge, halfway down, and climbs from there
 * to the outermost ancestor that still has that shape. If the thing under the
 * point is the canvas, nothing on the way up is panel-shaped and the answer is
 * null, which is the right way to fail: the panel stays.
 *
 * What goes with it: the Share and Present buttons, the zoom menu and the
 * avatars live at the top of the same column, so they leave with it, and so
 * does the help button in the corner. The chord brings them back.
 */

'use strict';

const MM_PANEL_ATTR = 'data-muscle-memory-panel';

/**
 * The toggle chord. Cmd+Opt+0 on a Mac, Ctrl+Alt+0 elsewhere.
 *
 * Borrowed from Xcode, where Cmd+Opt+0 shows and hides the inspector, which is
 * the same panel under another name. Figma binds Cmd+0 (zoom to 100%), but no
 * Opt variant of it appears in its shortcut panel, and Chrome binds neither.
 * A digit, because a digit sits on the same key on every layout this has to
 * work with, where a backslash on a German Mac needs Opt+Shift+7.
 */
const MM_PANEL_CHORD = 'Mod+Alt+0';

/** True when a box has the shape of a docked right-hand panel. */
function mmPanelShaped(r, vw, vh) {
  if (!r) return false;
  return r.right >= vw - 4 &&
    r.width >= 160 &&
    r.width <= Math.min(560, vw * 0.4) &&
    r.height >= vh * 0.6;
}

/**
 * The element to hide, or null when there is no panel on screen.
 *
 * Climbs from the hit-tested element to the outermost ancestor that is still
 * panel-shaped, and stops at the first one after that which is not: the next
 * level up is the whole editor, and hiding that would take the canvas too.
 * Leaves below the panel (a label, an input) are not panel-shaped either, so
 * the climb skips those until it reaches the column.
 */
function mmFindPanel(doc, win) {
  if (!doc || !doc.elementFromPoint) return null;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const hit = doc.elementFromPoint(vw - 24, Math.round(vh / 2));
  let best = null;
  for (let node = hit; node && node.nodeType === 1; node = node.parentElement) {
    const tag = node.tagName;
    if (tag === 'HTML' || tag === 'BODY') break;
    const r = node.getBoundingClientRect();
    // A box with no area says nothing about the layout. Figma wraps the
    // panel in `display: contents` and zero-height wrappers, and stopping at
    // the first of those would hide an inner layer and leave the column.
    if (!r || r.width === 0 || r.height === 0) continue;
    if (mmPanelShaped(r, vw, vh)) best = node;
    else if (best) break;
  }
  return best;
}

/**
 * Push the panel off screen by making the app wider than the window.
 *
 * Hiding the panel is not enough. Figma keeps the panel's width in its own
 * state and subtracts it from the app's width to size the canvas, so a
 * hidden panel leaves a canvas-sized hole beside it. What Figma does measure
 * honestly is the app itself. So the app's top element is made exactly one
 * panel wider than the window, and the overflow is clipped: Figma lays out
 * canvas plus panel across the wider app, and the window shows the canvas
 * edge to edge while the panel sits just past it.
 *
 * Inline styles through the CSSOM rather than a <style> element, because a
 * page's Content-Security-Policy can refuse an inserted stylesheet but never
 * a property set on an element. Each value it overwrites is kept, so narrow()
 * puts back exactly what was there.
 */
const mmSaved = new Map();

function mmSet(el, prop, value) {
  const key = el;
  if (!mmSaved.has(key)) mmSaved.set(key, {});
  const saved = mmSaved.get(key);
  if (!(prop in saved)) {
    saved[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
  }
  el.style.setProperty(prop, value, 'important');
}

/** The ancestor of `el` that is a direct child of <body>, or null. */
function mmTopOf(doc, el) {
  let node = el;
  while (node && node.parentElement && node.parentElement !== doc.body) node = node.parentElement;
  return node && node.parentElement === doc.body ? node : null;
}

function mmWiden(doc, panel, width) {
  const top = mmTopOf(doc, panel);
  if (!top || !(width > 0)) return false;
  for (const el of mmSaved.keys()) {
    if (el !== top && el !== doc.body && el !== doc.documentElement) mmRestore(el);
  }
  const value = 'calc(100% + ' + Math.round(width) + 'px)';
  if (top.hasAttribute(MM_PANEL_ATTR) && top.style.getPropertyValue('width') === value) return false;
  mmSet(doc.documentElement, 'overflow', 'hidden');
  // clip, not hidden: a hidden box can still be scrolled by script or by
  // focus moving into the panel, which would slide the whole app sideways.
  mmSet(doc.body, 'overflow', 'clip');
  mmSet(top, 'width', value);
  mmSet(top, 'max-width', 'none');
  top.setAttribute(MM_PANEL_ATTR, '');
  return true;
}

function mmRestore(el) {
  const saved = mmSaved.get(el);
  if (!saved) return;
  for (const prop of Object.keys(saved)) {
    const [value, priority] = saved[prop];
    if (value) el.style.setProperty(prop, value, priority);
    else el.style.removeProperty(prop);
  }
  if (el.removeAttribute) el.removeAttribute(MM_PANEL_ATTR);
  mmSaved.delete(el);
}

/** Undo widen(). Returns true when there was anything to undo. */
function mmNarrow() {
  if (!mmSaved.size) return false;
  for (const el of [...mmSaved.keys()]) mmRestore(el);
  return true;
}

const MM_PANEL = {
  ATTR: MM_PANEL_ATTR,
  CHORD: MM_PANEL_CHORD,
  shaped: mmPanelShaped,
  find: mmFindPanel,
  topOf: mmTopOf,
  widen: mmWiden,
  narrow: mmNarrow,
};

if (typeof globalThis !== 'undefined') globalThis.MM_PANEL = MM_PANEL;
if (typeof module !== 'undefined' && module.exports) module.exports = MM_PANEL;
