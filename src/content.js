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

  /**
   * Every handler here acts on `event.isTrusted` and nothing else.
   *
   * The question worth asking is not "did I make this event?" but "did the
   * user?". A private marker answers only the first, so a page script could
   * dispatch its own Cmd+Shift+R and we would treat it as a keypress: enough
   * to strand an entry in `swallowed` and eat the user's next real keyup, and
   * enough to drive the diagnostics counters that this extension presents as
   * a measurement rather than a claim.
   *
   * `isTrusted` read from an isolated world is authoritative. A page cannot
   * forge it, and its attempts to patch Event.prototype apply to its own
   * world only. It also covers our own dispatches, which are untrusted too,
   * so it replaces the marker outright rather than sitting alongside it.
   *
   * The trade: keystrokes synthesised by assistive technology or by another
   * extension are ignored as well. That is the correct reading of "the user
   * pressed a key", but it is a behaviour choice, not an accident.
   */

  // What we learned at runtime about whether Figma acts on synthesised
  // events. Reported in the options page rather than assumed. See rehome().
  const health = { attempts: 0, accepted: 0, lastChord: null };
  let healthTimer = 0;

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
   * The legacy keyCode and which fields are set by the constructor, through
   * the init dictionary that chordToInit builds. Assigning them to the event
   * afterwards would look equivalent and do nothing at all: a property
   * defined from an isolated world lives on that world's wrapper, and the
   * page reads the event through its own.
   */
  function dispatchChord(chord, count) {
    const init = KEYMAP.chordToInit(chord);
    if (!init) return false;

    const target = document.activeElement || document.body || document.documentElement;
    let accepted = false;

    for (const type of ['keydown', 'keyup']) {
      const ev = new KeyboardEvent(type, init);
      const notCancelled = target.dispatchEvent(ev);
      if (type === 'keydown') accepted = !notCancelled;
    }

    if (count !== false) {
      health.attempts += 1;
      if (accepted) health.accepted += 1;
      health.lastChord = chord;
      publishHealth();
    }
    return accepted;
  }

  /**
   * True when a chord belongs to the text being typed rather than to the canvas.
   *
   * Descends through shadow roots, because document.activeElement reports the
   * host rather than the field when focus is inside one, and a field in a
   * shadow tree would otherwise read as "not typing".
   */
  function isEditing() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  /**
   * Keys whose keydown we took, so the matching keyup can be taken too.
   * Figma would otherwise see the release half of a keystroke whose press it
   * never saw.
   *
   * Emptied whenever the page loses focus, which is the case that made an
   * earlier version misbehave. Cmd+F hands focus to Chrome's find bar and
   * Cmd+P to the print dialog, so those keyups are delivered to browser UI
   * and never arrive here. The record would then outlive the keystroke and
   * eat the release of the next ordinary press of that letter.
   */
  const swallowed = new Set();
  const forgetSwallowed = () => swallowed.clear();
  window.addEventListener('blur', forgetSwallowed, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) forgetSwallowed();
  });

  function onKeyDown(e) {
    if (!e.isTrusted) return; // ours, or the page's; either way not a keypress
    if (!settings.keymap.enabled) return;

    const decision = KEYMAP.resolveEvent(e, active, isEditing());
    if (!decision) return;

    // Take the event away from the page. Deliberately no preventDefault():
    // for a reclaim, the browser's default action is the entire point, and
    // for a rehome the source chord has no default worth suppressing.
    e.stopImmediatePropagation(); // note: no preventDefault; see the file header
    swallowed.add(e.code);

    if (decision.action === 'rehome' && decision.chord) {
      // Auto-repeat would otherwise fire one synthetic chord per repeat for
      // as long as the key is held, which is a storm at Figma and a lie in
      // the diagnostics counters.
      if (e.repeat) return;
      // After the current event finishes dispatching, so Figma sees a clean
      // keystroke rather than one nested inside another.
      setTimeout(() => dispatchChord(decision.chord), 0);
    }
  }

  function onKeyUp(e) {
    if (!e.isTrusted) return;
    if (!swallowed.has(e.code)) return;
    swallowed.delete(e.code);
    e.stopImmediatePropagation();
  }

  // Losing focus mid-chord means the keyup lands somewhere else and our
  // record of a half-finished keystroke would outlive the keystroke. The next
  // press of that key would then have its keyup eaten while Figma had already
  // seen the keydown, which is how a tool gets stuck down.
  window.addEventListener('blur', () => swallowed.clear());

  window.addEventListener('keydown', onKeyDown, true);
  // No keypress listener: Chrome does not fire keypress for a modified or
  // non-printable chord, so it can never fire for one we reclaimed. It could
  // only ever match a stale record, which is to say do harm.
  window.addEventListener('keyup', onKeyUp, true);

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
    if (!e.isTrusted) return;
    if (!settings.canvas.rightClick) return;
    if (!e.shiftKey) return;
    e.stopImmediatePropagation();
  }
  window.addEventListener('contextmenu', onContextMenu, true);

  /**
   * Wheel.
   *
   * Figma reads a wheel event with ctrlKey set as a zoom, because that is how
   * every browser reports a trackpad pinch. So the only thing this can offer
   * is to set that flag on a plain wheel, turning it into a zoom for someone
   * on an external mouse. Shift is left as the escape hatch back to panning.
   *
   * There is deliberately no "always pan" setting. Pan-unless-pinch is
   * already what Figma does with an untouched event, so such an option could
   * only rewrite events into what they already were: no behaviour, and a
   * non-passive listener taking the whole document off the compositor thread
   * to deliver it. An earlier version shipped exactly that.
   */
  function onWheel(e) {
    if (!e.isTrusted) return;
    if (settings.canvas.scroll !== 'zoom') return;
    if (e.ctrlKey || e.metaKey) return; // already a zoom gesture; leave it
    if (e.shiftKey) return;             // the deliberate pan

    e.stopImmediatePropagation();
    e.preventDefault(); // here it is correct: the page must not also scroll

    const ev = new WheelEvent('wheel', {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY,
      screenX: e.screenX, screenY: e.screenY,
      ctrlKey: true, metaKey: false, shiftKey: false, altKey: e.altKey,
      bubbles: true, cancelable: true, composed: true,
    });
    (e.target || document.body || document.documentElement).dispatchEvent(ev);
  }

  // Attached only while the swap is configured. A non-passive wheel listener
  // opts the whole page out of the browser's threaded scrolling, so binding
  // one unconditionally would slow down every user who left the wheel alone,
  // which is the default.
  let wheelBound = false;
  function bindWheel() {
    const want = settings.canvas.scroll === 'zoom';
    if (want === wheelBound) return;
    if (want) window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    else window.removeEventListener('wheel', onWheel, { capture: true });
    wheelBound = want;
  }
  bindWheel();

  /**
   * Middle-click drag.
   *
   * Figma pans on a middle-button drag, but on Windows and Linux Chrome
   * claims the same gesture first for autoscroll, and on X11 a middle click
   * also pastes the primary selection. Cancelling the mousedown default
   * leaves the gesture to Figma, which is what already happens on a Mac.
   *
   * Deliberately not cancelled on a link. Middle-clicking a link opens it in
   * a new tab, and that gesture is worth more than autoscroll suppression on
   * a file card in the browser or a link in a comment. An earlier version
   * cancelled auxclick everywhere and quietly broke it across the whole site.
   */
  function onAuxDown(e) {
    if (!e.isTrusted) return;
    if (!settings.canvas.middleClickPan) return;
    if (e.button !== 1) return;
    if (isEditing()) return;
    const el = e.target;
    if (el && el.closest && el.closest('a[href]')) return;
    e.preventDefault(); // stop autoscroll and primary-selection paste
  }
  window.addEventListener('mousedown', onAuxDown, true);

  /* ------------------------------------------------------------- declutter */

  // Editor surfaces only. The banner patterns match on wording, and the same
  // wording is the actual headline copy on figma.com's marketing and help
  // pages, where hiding it would make Figma's own site look broken with
  // nothing on screen to say why.
  const EDITOR_PATH = /^\/(file|design|board|slides|deck|proto|buzz)\//;
  function declutterAllowedHere() {
    return EDITOR_PATH.test(location.pathname);
  }

  let observer = null;
  let pending = [];
  let scheduled = 0;
  let needsFullSweep = false;

  // Above this many queued subtrees, the queue itself is the problem: drop it
  // and owe one full pass instead. Keeps a hostile or merely busy page from
  // turning a cheap DOM insertion into an unbounded list of strong references
  // to nodes that would otherwise be collected.
  const PENDING_CAP = 2000;

  function schedule() {
    if (!scheduled) scheduled = requestAnimationFrame(drain);
  }

  /**
   * Sweep what was added, within a time budget, and no more than once a frame.
   *
   * Figma mutates the DOM continuously, so rescanning the whole document per
   * record would be a permanent tax on the canvas. Mutation records already
   * name the new subtrees, and a banner arrives as one of them. The budget
   * exists because a single burst can queue thousands of nodes, and spending
   * a whole frame on them would drop the canvas instead of the banner.
   */
  function drain() {
    scheduled = 0;
    const wanted = SELECTORS.active(settings.declutter);
    if (!wanted.length) { pending = []; needsFullSweep = false; return; }

    if (needsFullSweep) {
      needsFullSweep = false;
      pending = [];
      SELECTORS.sweep(document, wanted);
      return;
    }

    const roots = pending;
    pending = [];
    const deadline = Date.now() + 8;
    let i = 0;
    for (; i < roots.length; i += 1) {
      const node = roots[i];
      if (!node || node.nodeType !== 1) continue;
      SELECTORS.sweep(node, wanted);
      // querySelectorAll does not include the root, and a banner is often the
      // added node itself rather than something inside it.
      SELECTORS.sweep({ querySelectorAll: () => [node] }, wanted);
      if (Date.now() > deadline) { i += 1; break; }
    }
    if (i < roots.length) {
      pending = roots.slice(i).concat(pending);
      schedule();
    }
  }

  function onMutations(records) {
    // requestAnimationFrame does not fire in a background tab. Queuing there
    // would grow for as long as the tab stays hidden, holding detached nodes
    // alive, so remember that a pass is owed and throw the queue away.
    if (document.hidden) {
      needsFullSweep = true;
      pending = [];
      return;
    }
    for (const record of records) {
      for (const node of record.addedNodes) pending.push(node);
    }
    if (pending.length > PENDING_CAP) {
      needsFullSweep = true;
      pending = [];
    }
    if (pending.length || needsFullSweep) schedule();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (needsFullSweep || pending.length)) schedule();
  });

  function applyDeclutter() {
    const wanted = declutterAllowedHere() ? SELECTORS.active(settings.declutter) : [];
    const activeIds = new Set(wanted.map((p) => p.id));

    // Anything hidden under a rule that is now switched off goes back. Hiding
    // is an inline style, so without this the checkbox is a one-way door and
    // unticking it does nothing a user can see.
    if (document.body) SELECTORS.unhide(document, activeIds);

    if (!wanted.length) {
      if (observer) { observer.disconnect(); observer = null; }
      pending = [];
      needsFullSweep = false;
      return;
    }

    // A rule switched back on has to be able to match elements this session
    // already judged and dismissed.
    SELECTORS.resetSeen();
    if (document.body) SELECTORS.sweep(document, wanted);

    if (!observer) {
      // documentElement exists by definition at document_start, which is what
      // run_at means: after the document element, before any page script.
      observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement, { childList: true, subtree: true });
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

  /**
   * Answer the options page's "check now".
   *
   * The options page has no content script, so it cannot ask a question
   * directly without host permissions this extension does not want. It writes
   * a request to storage instead and we answer through the same channel. Only
   * an editor page answers: nowhere else has a Figma to press a key at, and a
   * silent non-answer is what the options page reads as "no file open".
   */
  function runSelfTest() {
    if (!declutterAllowedHere()) return;
    dispatchChord(KEYMAP.PROBE.open);
    // Leave no trace: whatever the probe opened is closed again, and the
    // close is not counted, since it measures nothing.
    setTimeout(() => dispatchChord(KEYMAP.PROBE.close, false), 150);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') SETTINGS.load(adopt);
      if (area === 'local' && changes.selfTest && changes.selfTest.newValue) runSelfTest();
    });
  } catch (_) {
    // Storage is unavailable, so settings can never change. The listeners
    // registered above keep working on the defaults, which is a far better
    // outcome than aborting init half-way through.
  }

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
  /**
   * Write to storage without ever producing an unhandled rejection.
   *
   * Reloading or updating an extension leaves its old content scripts running
   * in open tabs with a dead runtime, and every chrome.* call then fails.
   * With MV3 that failure is a rejected promise, not only a throw, so a bare
   * try/catch leaves "Extension context invalidated" in the user's console on
   * every write afterwards. Checking runtime.id first catches the common
   * case; catching the rejection covers the rest, including the write-quota
   * error that a fast series of clicks in the options page can produce.
   */
  function save(value, area) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) return;
      const done = chrome.storage[area].set(value);
      if (done && typeof done.catch === 'function') done.catch(() => {});
    } catch (_) { /* the context went away mid-call; nothing to report to */ }
  }

  function publishHealth() {
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => save({ health: { ...health } }, 'local'), 1000);
  }

  applyDeclutter();
})();
