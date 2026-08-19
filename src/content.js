/**
 * The engine. Runs at document_start, before Figma's bundle exists.
 *
 * The whole extension turns on one detail of the DOM event model. A listener
 * registered on `window` in the capture phase runs before any listener further
 * down the tree, and listeners at the same target run in registration order.
 * We are the first script on the page, so we are first in that queue, and
 * stopImmediatePropagation() from here means Figma's handler is never called.
 *
 * The second detail is the one that does the actual work: stopping propagation
 * is not preventDefault(). The event still reaches the browser's own default
 * action. So an event we intercept and drop is an event Chrome handles exactly
 * as it would on a page that had no listeners at all -- which is the entire
 * definition of "the browser's shortcuts work". We must therefore never call
 * preventDefault() on a reclaimed chord, and the one place that would be easy
 * to get wrong is marked below.
 */

'use strict';

(function () {
  const KEYMAP = globalThis.MM_KEYMAP;
  const SETTINGS = globalThis.MM_SETTINGS;
  const SELECTORS = globalThis.MM_SELECTORS;

  // Applied synchronously; replaced when storage answers. See settings.js.
  let settings = SETTINGS.merge(null);
  let active = SETTINGS.activeRules(settings);

  // Set on events we generated, so the capture listener lets its own
  // synthetic events through instead of resolving them a second time. The
  // property lives on the isolated-world wrapper, so the page cannot see it
  // and a page script cannot forge it.
  const SYNTHETIC = '__mmSynthetic';

  // What we learned at runtime about whether Figma acts on synthesised
  // events. Reported in the options page rather than assumed. See rehome().
  const health = { attempts: 0, accepted: 0, lastChord: null };

  /* ------------------------------------------------------------------ keys */

  /**
   * Press a chord at Figma and report whether it landed.
   *
   * A constructed KeyboardEvent carries isTrusted false, and an application is
   * entitled to ignore it. Rather than assume either way, we read the answer
   * off the dispatch itself: an app that acts on a shortcut calls
   * preventDefault to stop the browser also acting on it, and dispatchEvent
   * returns false exactly when that happened. So `accepted` below is a
   * measurement of Figma's behaviour on this machine, this release, not a
   * guess -- and it is what the options page shows.
   *
   * keyCode and which are not members of KeyboardEventInit and are dropped by
   * the constructor, so they are pinned afterwards. They are deprecated and
   * still widely read, including by code compiled from other languages.
   */
  function dispatchChord(chord) {
    const init = KEYMAP.chordToInit(chord);
    if (!init) return false;

    const target = document.activeElement || document.body || document.documentElement;
    let accepted = false;

    for (const type of ['keydown', 'keyup']) {
      const ev = new KeyboardEvent(type, init);
      for (const prop of ['keyCode', 'which']) {
        try {
          Object.defineProperty(ev, prop, { get: () => init.keyCode, configurable: true });
        } catch (_) { /* a browser that refuses is a browser that reads `code` */ }
      }
      ev[SYNTHETIC] = true;
      const notCancelled = target.dispatchEvent(ev);
      if (type === 'keydown') accepted = !notCancelled;
    }

    health.attempts += 1;
    if (accepted) health.accepted += 1;
    health.lastChord = chord;
    publishHealth();
    return accepted;
  }

  /** True when a chord belongs to the text being typed rather than to the canvas. */
  function isEditing() {
    const el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  // Chords whose keydown we swallowed, so the matching keyup can be swallowed
  // too. Figma would otherwise see the second half of a keystroke whose first
  // half never arrived, which is how a modifier gets stuck down.
  const swallowed = new Set();

  function onKeyDown(e) {
    if (e[SYNTHETIC]) return; // ours; Figma is the intended recipient
    if (!settings.keymap.enabled) return;

    const chord = KEYMAP.chordOf(e);
    const decision = KEYMAP.resolve(chord, active, isEditing());
    if (!decision) return;

    // Take the event away from the page. Deliberately no preventDefault():
    // for a reclaim, the browser's default action is the entire point, and
    // for a rehome the source chord has no default worth suppressing.
    e.stopImmediatePropagation();
    e.stopPropagation();
    swallowed.add(e.code);

    if (decision.action === 'rehome' && decision.chord) {
      // After the current event finishes dispatching, so Figma sees a clean
      // keystroke rather than one nested inside another.
      setTimeout(() => dispatchChord(decision.chord), 0);
    }
  }

  function onKeyUpOrPress(e) {
    if (e[SYNTHETIC]) return;
    if (!swallowed.has(e.code)) return;
    if (e.type === 'keyup') swallowed.delete(e.code);
    e.stopImmediatePropagation();
    e.stopPropagation();
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keypress', onKeyUpOrPress, true);
  window.addEventListener('keyup', onKeyUpOrPress, true);

  /* ---------------------------------------------------------------- canvas */

  /**
   * Right-click.
   *
   * Figma's canvas menu is worth having, so taking contextmenu away wholesale
   * would be a downgrade. Shift+right-click is the long-standing convention
   * for "give me the browser's menu, not yours" -- it is what Firefox does for
   * pages that override the menu -- so that is the escape hatch, and an
   * unmodified right-click still gets Figma.
   */
  function onContextMenu(e) {
    if (!settings.canvas.rightClick) return;
    if (!e.shiftKey) return;
    e.stopImmediatePropagation();
    e.stopPropagation();
  }
  window.addEventListener('contextmenu', onContextMenu, true);

  /**
   * Wheel.
   *
   * Figma reads a wheel event with ctrlKey set as a zoom, because that is how
   * every browser reports a trackpad pinch. Swapping the two modes is
   * therefore a matter of rewriting the modifier and re-dispatching, not of
   * driving Figma's viewport ourselves.
   */
  function onWheel(e) {
    const mode = settings.canvas.scroll;
    if (mode === 'figma') return;
    if (e[SYNTHETIC]) return;

    const isZoomGesture = e.ctrlKey || e.metaKey;
    let wantZoom;
    if (mode === 'zoom') wantZoom = !e.shiftKey; // plain wheel zooms
    else wantZoom = isZoomGesture;               // 'pan': only a real pinch zooms

    if (wantZoom === isZoomGesture) return; // already what Figma would do

    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault(); // here it is correct: the page must not also scroll

    const ev = new WheelEvent('wheel', {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY,
      screenX: e.screenX, screenY: e.screenY,
      ctrlKey: wantZoom, metaKey: false, shiftKey: false, altKey: e.altKey,
      bubbles: true, cancelable: true, composed: true,
    });
    ev[SYNTHETIC] = true;
    (e.target || document.body).dispatchEvent(ev);
  }
  // Attached only while a swap is actually configured. A non-passive wheel
  // listener opts the whole page out of the browser's threaded scrolling, so
  // registering one unconditionally would slow down every user who left the
  // wheel alone, which is the default.
  let wheelBound = false;
  function bindWheel() {
    const want = settings.canvas.scroll !== 'figma';
    if (want === wheelBound) return;
    if (want) window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    else window.removeEventListener('wheel', onWheel, { capture: true });
    wheelBound = want;
  }
  bindWheel();

  /**
   * Middle-click drag.
   *
   * Figma pans on a middle-button drag, but on Windows and Linux Chrome claims
   * the same gesture first for autoscroll, and on X11 a middle click also
   * pastes the primary selection. Suppressing the browser's default on the
   * canvas leaves the gesture to Figma, which is what it does on a Mac
   * already. This is the whole of the fix: we do not pan anything ourselves.
   */
  function onAuxDown(e) {
    if (!settings.canvas.middleClickPan) return;
    if (e.button !== 1) return;
    if (isEditing()) return;
    e.preventDefault(); // stop autoscroll and primary-selection paste
  }
  window.addEventListener('mousedown', onAuxDown, true);
  window.addEventListener('auxclick', (e) => {
    if (settings.canvas.middleClickPan && e.button === 1 && !isEditing()) e.preventDefault();
  }, true);

  /* ------------------------------------------------------------- declutter */

  let observer = null;
  let pending = [];
  let scheduled = 0;

  /**
   * Sweep only what was added, and no more than once a frame.
   *
   * Figma mutates the DOM continuously, so a handler that rescanned the whole
   * document on every record would be a permanent tax on the canvas. Mutation
   * records already say exactly which subtrees are new, and a banner arrives
   * as one of them.
   */
  function drain() {
    scheduled = 0;
    const wanted = SELECTORS.active(settings.declutter);
    if (!wanted.length) { pending = []; return; }
    const roots = pending;
    pending = [];
    for (const node of roots) {
      if (node.nodeType !== 1) continue;
      SELECTORS.sweep(node, wanted);
      // querySelectorAll does not include the root, and a banner is often the
      // added node itself rather than something inside it.
      SELECTORS.sweep({ querySelectorAll: () => [node] }, wanted);
    }
  }

  function onMutations(records) {
    for (const record of records) {
      for (const node of record.addedNodes) pending.push(node);
    }
    if (pending.length && !scheduled) {
      scheduled = requestAnimationFrame(drain);
    }
  }

  function applyDeclutter() {
    if (!SELECTORS) return;
    const wanted = SELECTORS.active(settings.declutter);

    if (!wanted.length) {
      if (observer) { observer.disconnect(); observer = null; }
      return;
    }

    // One full pass for whatever is already on the page, then incremental.
    if (document.body) SELECTORS.sweep(document, wanted);

    if (!observer) {
      observer = new MutationObserver(onMutations);
      const start = () => observer.observe(document.documentElement, { childList: true, subtree: true });
      if (document.documentElement) start();
      else document.addEventListener('readystatechange', start, { once: true });
    }
  }

  /* -------------------------------------------------------------- settings */

  function adopt(next) {
    settings = next;
    active = SETTINGS.activeRules(settings);
    bindWheel();
    applyDeclutter();
  }

  SETTINGS.load(adopt);

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') SETTINGS.load(adopt);
  });

  /**
   * Publish the synthetic-event verdict for the options page.
   *
   * Through storage rather than a message, which is what keeps the extension
   * on a single "storage" permission: chrome.tabs.sendMessage would require
   * host access to figma.com purely to ask a question the content script is
   * happy to volunteer. Debounced because a rehome can fire on every
   * keystroke and this is diagnostics, not telemetry -- it never leaves the
   * machine, and records counts rather than keys.
   */
  let healthTimer = 0;
  function publishHealth() {
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => {
      try {
        chrome.storage.local.set({ health: { ...health, at: Date.now() } });
      } catch (_) { /* the page is going away; the numbers are not worth an error */ }
    }, 1000);
  }

  applyDeclutter();
})();
