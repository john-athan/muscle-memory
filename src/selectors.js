/**
 * Declutter: hiding Figma's promotional furniture.
 *
 * This is the part of the extension with the shortest half-life, and it is
 * built defensively for two separate reasons.
 *
 * It matches on visible copy rather than on class names. Figma ships a new
 * build most weeks and the generated class names change with it, but the
 * sentence in a banner is written by a person and survives redesigns. A
 * pattern that stops matching hides nothing, which is the right way to fail.
 *
 * It refuses to hide anything load-bearing. A text match walks up to find the
 * banner around it, and a walk that goes one level too far takes the
 * application with it. So the walk is capped, and any candidate that contains
 * the canvas, or is most of the screen, or is a document root, is rejected
 * outright. The worst outcome available to this file is that a banner stays.
 *
 * These patterns were written against Figma's published copy rather than
 * against observed markup, so they want a look at a live session before each
 * release: open an editor file, confirm each banner this claims to hide is in
 * fact hidden, and confirm nothing else is. Nothing else in the extension
 * depends on them, and CONTRIBUTING.md says what to do when one stops
 * matching.
 */

'use strict';

const MM_PATTERNS = [
  {
    id: 'desktopBanner',
    label: 'Open in desktop app',
    note: 'The banner with no dismiss control.',
    match: /open (?:this |the )?(?:file )?in (?:the )?desktop app|open in figma|use the (?:desktop )?app/i,
  },
  {
    id: 'aiUpsell',
    label: 'AI and Figma Make promotion',
    note: 'Upsell surfaces for AI features, not the features themselves.',
    match: /try figma make|introducing figma ai|new: figma ai|upgrade to use ai|try ai for free/i,
  },
  {
    id: 'whatsNew',
    label: 'Release-note interruptions',
    note: "The “what’s new” modal on file open.",
    match: /what[’']?s new in figma|see what[’']?s new|new in figma this/i,
  },
];

const MM_HIDDEN_ATTR = 'data-muscle-memory-hidden';

/** Tags whose text is markup or data rather than something a person reads. */
const MM_NEVER_MATCH = new Set(['SCRIPT', 'STYLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'SVG']);

/** Elements it is never acceptable to hide, however well the text matched. */
function mmIsLoadBearing(el) {
  const tag = el.tagName;
  if (tag === 'HTML' || tag === 'BODY' || tag === 'MAIN') return true;
  if (MM_NEVER_MATCH.has(tag)) return true;
  if (el.querySelector && el.querySelector('canvas')) return true;
  if (el.id === 'root' || el.id === 'react-page') return true;
  const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  if (r && r.width * r.height > 0.4 * (window.innerWidth * window.innerHeight)) return true;
  return false;
}

/**
 * True when an element has no box yet, so its size cannot be judged.
 *
 * A node inserted this frame may not have been laid out, and a zero area
 * would otherwise sail through the size guard above as though it were small.
 * Callers treat this as "ask again later" rather than as a verdict.
 */
function mmUnmeasured(el) {
  if (!el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  return r.width === 0 && r.height === 0;
}

/**
 * From the element whose text matched, find the thing to hide.
 *
 * Walks up while the ancestor is still plausibly "the banner": a few levels at
 * most, stopping before anything load-bearing. Returns null rather than
 * guessing when nothing on the way up looks safe.
 */
function mmContainerFor(el, maxHops) {
  let best = null;
  let node = el;
  for (let hop = 0; node && hop < maxHops; hop += 1) {
    if (mmIsLoadBearing(node)) break;
    best = node;
    node = node.parentElement;
  }
  return best;
}

/**
 * Put back anything hidden under a rule that is no longer switched on.
 *
 * Without this the checkboxes are a one-way door: hiding is an inline
 * `display:none`, and turning the setting off only stopped new matches being
 * hidden. Somebody unticking a box wants the banner back, which is the whole
 * reason they unticked it.
 */
function mmUnhide(root, activeIds) {
  if (!root || !root.querySelectorAll) return 0;
  let shown = 0;
  for (const el of root.querySelectorAll('[' + MM_HIDDEN_ATTR + ']')) {
    if (activeIds.has(el.getAttribute(MM_HIDDEN_ATTR))) continue;
    el.removeAttribute(MM_HIDDEN_ATTR);
    if (el.style) el.style.removeProperty('display');
    shown += 1;
  }
  return shown;
}

let mmSeen = new WeakSet();

/** Forget what has been judged, so a re-enabled rule can match again. */
function mmResetSeen() { mmSeen = new WeakSet(); }

function mmHide(el, id) {
  if (!el || el.hasAttribute(MM_HIDDEN_ATTR)) return false;
  el.setAttribute(MM_HIDDEN_ATTR, id);
  el.style.setProperty('display', 'none', 'important');
  return true;
}

/**
 * Check one subtree for matches.
 *
 * Cheap on purpose, because on Figma this runs against a DOM that never stops
 * moving. The element list is gathered once and every pattern is tested
 * against each candidate, rather than walking the tree once per pattern.
 * Anything already judged is skipped through a WeakSet, and a subtree with
 * more text than a banner could hold is rejected before a regular expression
 * is ever run.
 *
 * The known gap: an element whose text is rewritten in place, without the node
 * being replaced, stays marked as seen and is not re-tested. Figma mounts its
 * banners as new subtrees, which the observer catches; re-testing every
 * element on every mutation would cost far more than that case is worth.
 */
function mmSweep(root, patterns) {
  if (!root || !root.querySelectorAll || !patterns || !patterns.length) return 0;
  let hidden = 0;

  const candidates = root.querySelectorAll('div,span,section,aside,a,p,h1,h2,h3,button');
  for (const el of candidates) {
    if (mmSeen.has(el)) continue;
    if (MM_NEVER_MATCH.has(el.tagName)) { mmSeen.add(el); continue; }
    // textContent concatenates the whole subtree, so reading it on a
    // container costs a walk of everything beneath it, and the length cap
    // below only rejects the result after that has been paid. A banner is
    // shallow, so anything deeply nested is not one and can be skipped
    // before the expensive read. Figma re-mounts subtrees of hundreds of
    // nodes on every selection change, and this runs on that path.
    if (el.childElementCount > 3) continue;
    const text = el.textContent;
    if (!text || text.length > 400) continue; // a banner is a sentence, not a page
    // Not laid out yet: no verdict is possible, so leave it unjudged and let
    // a later pass decide rather than hiding something of unknown size.
    if (mmUnmeasured(el)) continue;
    mmSeen.add(el);
    for (const pattern of patterns) {
      if (!pattern.match.test(text)) continue;
      const container = mmContainerFor(el, 4);
      if (container && mmHide(container, pattern.id)) hidden += 1;
      break;
    }
  }
  return hidden;
}

function mmActivePatterns(declutterSettings) {
  return MM_PATTERNS.filter((p) => declutterSettings && declutterSettings[p.id]);
}

const MM_SELECTORS = {
  PATTERNS: MM_PATTERNS,
  active: mmActivePatterns,
  sweep: mmSweep,
  unhide: mmUnhide,
  resetSeen: mmResetSeen,
  neverMatch: MM_NEVER_MATCH,
  containerFor: mmContainerFor,
  isLoadBearing: mmIsLoadBearing,
};

if (typeof globalThis !== 'undefined') globalThis.MM_SELECTORS = MM_SELECTORS;
if (typeof module !== 'undefined' && module.exports) module.exports = MM_SELECTORS;
