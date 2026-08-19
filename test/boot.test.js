/**
 * Boots the content script the way Chrome does and checks the one invariant
 * the whole extension rests on.
 *
 * The unit tests cover the keymap as data. This covers the wiring: the four
 * files are evaluated in the order the manifest lists them, in one shared
 * global, against stubs for the handful of browser objects they touch. That is
 * enough to catch the failures that unit tests structurally cannot, and which
 * are invisible until someone loads the extension: a file referencing a global
 * that a later file defines, a listener registered on the wrong target, an
 * exception during init that leaves no listener at all.
 *
 * The assertion that matters is the last one. Reclaiming a chord works only
 * because stopping propagation is not preventDefault: the event must be taken
 * away from the page while still reaching the browser's default action. A
 * refactor that added a preventDefault() to that path would hand the user a
 * dead key and break the entire premise, silently. So it is pinned here.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

/** The files the manifest injects, in the order it injects them. */
function manifestScripts() {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  return m.content_scripts[0].js;
}

/** Boot the content scripts in a fresh context and hand back what they did. */
function boot({ platform = 'MacIntel', stored = null, urlPath = '/design/abc/Deck' } = {}) {
  const listeners = { window: {}, document: {} };
  const written = [];

  // The third argument is the point. A listener recorded without its options
  // cannot be checked for the capture flag, and capture is the whole race.
  const record = (bag) => (type, fn, opts) => { (bag[type] = bag[type] || []).push({ fn, opts }); };

  const dispatched = [];
  const documentStub = {
    addEventListener: record(listeners.document),
    removeEventListener() {},
    activeElement: null,
    // As at document_start, before the body exists. documentElement is the
    // dispatch target of last resort and is the one that has to be real.
    body: null,
    documentElement: { dispatchEvent: (ev) => { dispatched.push(ev); return true; } },
    querySelectorAll: () => [],
    hidden: false,
  };

  const sandbox = {
    navigator: { platform, userAgent: platform },
    location: { pathname: urlPath, href: 'https://www.figma.com' + urlPath },
    document: documentStub,
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    MutationObserver: class {
      observe() { sandbox.observing = true; }
      disconnect() { sandbox.observing = false; }
    },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    WheelEvent: class { constructor(type) { this.type = type; } },
    chrome: {
      runtime: { lastError: null, id: 'test-extension-id' },
      storage: {
        sync: { get: (_k, cb) => cb(stored), set: (v) => { written.push(v); return Promise.resolve(); } },
        local: { set: (v) => { written.push(v); return Promise.resolve(); } },
        onChanged: { addListener() {} },
      },
    },
  };
  sandbox.window = {
    addEventListener: record(listeners.window),
    removeEventListener(type, fn) {
      const bag = listeners.window[type];
      if (bag) listeners.window[type] = bag.filter((r) => r.fn !== fn);
      if (listeners.window[type] && !listeners.window[type].length) delete listeners.window[type];
    },
    innerWidth: 1600,
    innerHeight: 900,
    listeners: listeners.window,
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  for (const rel of manifestScripts()) {
    const file = path.join(__dirname, '..', rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: rel });
  }
  return { listeners, sandbox, written, dispatched };
}

/** True when a listener was registered for the capture phase. */
function isCapture(opts) {
  return opts === true || (!!opts && opts.capture === true);
}

/** A keydown as the handler sees it, recording what was done to it. */
function keydown(code, mods = {}) {
  const calls = [];
  return {
    code,
    isTrusted: true,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    calls,
    stopImmediatePropagation() { calls.push('stopImmediatePropagation'); },
    stopPropagation() { calls.push('stopPropagation'); },
    preventDefault() { calls.push('preventDefault'); },
  };
}

test('every content script evaluates without throwing', () => {
  assert.doesNotThrow(() => boot());
});

test('the scripts publish the globals the next file expects', () => {
  const { sandbox } = boot();
  for (const name of ['MM_KEYMAP', 'MM_SETTINGS', 'MM_SELECTORS', 'MM_DEFAULTS']) {
    assert.ok(sandbox[name], name + ' was never defined');
  }
});

test('the key listener is on window, in the capture phase', () => {
  // Anywhere else and Figma's own listener runs first, which is the entire
  // race this extension exists to win. Asserting the listener merely exists
  // is not enough: without capture it is registered but useless, and an
  // earlier version of this test passed with the flag deleted.
  const { listeners } = boot();
  assert.equal(listeners.window.keydown.length, 1, 'no keydown listener on window');
  assert.equal(listeners.document.keydown, undefined, 'keydown must not be on document');
  assert.ok(isCapture(listeners.window.keydown[0].opts), 'keydown must be capture-phase');
});

test('every intercepting listener is capture-phase', () => {
  const { listeners } = boot({ stored: { canvas: { scroll: 'zoom' } } });
  for (const type of ['keydown', 'keyup', 'contextmenu', 'mousedown', 'wheel']) {
    const bag = listeners.window[type];
    assert.ok(bag && bag.length, 'no ' + type + ' listener registered');
    assert.ok(isCapture(bag[0].opts), type + ' is not capture-phase, so Figma sees it first');
  }
});

test('the wheel listener stays off until a swap is configured', () => {
  const { listeners } = boot();
  assert.equal(listeners.window.wheel, undefined,
    'a non-passive wheel listener costs every user who left the wheel alone');
});

test('the wheel listener appears once a swap is stored', () => {
  const { listeners } = boot({ stored: { canvas: { scroll: 'zoom' } } });
  assert.ok(listeners.window.wheel, 'wheel swap configured but nothing listening');
});

test('reclaiming takes the event from the page WITHOUT preventing the default', () => {
  // The invariant the extension is built on. stopImmediatePropagation removes
  // the page's listener; the browser's default action is downstream of that
  // and still runs. preventDefault would cancel it, turning a reclaimed chord
  // into a dead key. If this assertion ever fails, the premise is broken.
  const { listeners } = boot();
  const onKeyDown = listeners.window.keydown[0].fn;

  const e = keydown('KeyR', { meta: true, shift: true }); // Cmd+Shift+R
  onKeyDown(e);

  assert.ok(e.calls.includes('stopImmediatePropagation'), 'Figma would still see it');
  assert.ok(!e.calls.includes('preventDefault'), 'the browser would not reload');
});

test('a chord with no rule is left completely untouched', () => {
  const { listeners } = boot();
  const e = keydown('KeyD', { meta: true }); // duplicate: Figma keeps this
  listeners.window.keydown[0].fn(e);
  assert.deepEqual(e.calls, [], 'Cmd+D must reach Figma unchanged');
});

test('the master switch off means no keystroke is touched', () => {
  const { listeners } = boot({ stored: { keymap: { enabled: false } } });
  const e = keydown('KeyR', { meta: true, shift: true });
  listeners.window.keydown[0].fn(e);
  assert.deepEqual(e.calls, [], 'off must mean the handler does nothing at all');
});

test('a stored profile survives the trip through storage', () => {
  // Rules stored as a list must still be honoured after the async load; a
  // reclaim that only works on the defaults would be a silent regression.
  const { listeners } = boot({ stored: { keymap: { enabled: true, rules: ['find'] } } });
  const reclaimed = keydown('KeyF', { meta: true });
  const ignored = keydown('KeyR', { meta: true });
  listeners.window.keydown[0].fn(reclaimed);
  listeners.window.keydown[0].fn(ignored);
  assert.ok(reclaimed.calls.includes('stopImmediatePropagation'), 'Cmd+F was configured');
  assert.deepEqual(ignored.calls, [], 'Cmd+R was not in the stored list');
});

test('right-click reaches Figma unless Shift is held', () => {
  const { listeners } = boot();
  const onContextMenu = listeners.window.contextmenu[0].fn;

  const plain = keydown('', {});
  onContextMenu(plain);
  assert.deepEqual(plain.calls, [], "Figma's own canvas menu is worth keeping");

  const shifted = keydown('', { shift: true });
  onContextMenu(shifted);
  assert.ok(shifted.calls.includes('stopImmediatePropagation'), 'Shift should reach the browser menu');
});

/* ---------------------------------------------------- wheel and stale keys */

/** A wheel event as onWheel sees it, recording what was done to it. */
function wheel(mods = {}) {
  const calls = [];
  return {
    type: 'wheel', isTrusted: true,
    deltaX: 0, deltaY: 120, deltaZ: 0, deltaMode: 0,
    clientX: 10, clientY: 10, screenX: 10, screenY: 10,
    ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: false,
    target: null,
    calls,
    stopImmediatePropagation() { calls.push('stopImmediatePropagation'); },
    stopPropagation() { calls.push('stopPropagation'); },
    preventDefault() { calls.push('preventDefault'); },
  };
}

test('a wheel mode that cannot act does not register a listener', () => {
  // Binding a non-passive capture listener on window opts the whole tab out
  // of threaded scrolling. Paying that for a mode that rewrites nothing is
  // strictly worse than leaving the wheel alone.
  for (const scroll of ['figma', 'pan']) {
    const { listeners } = boot({ stored: { canvas: { scroll } } });
    assert.equal(listeners.window.wheel, undefined,
      `scroll:'${scroll}' bound a wheel listener it cannot use`);
  }
});

test('wheel-zooms mode rewrites a plain wheel into a zoom', () => {
  const { listeners, dispatched } = boot({ stored: { canvas: { scroll: 'zoom' } } });
  const e = wheel();
  listeners.window.wheel[0].fn(e);
  assert.ok(e.calls.includes('preventDefault'), 'the page must not also scroll');
  assert.ok(e.calls.includes('stopImmediatePropagation'));
  assert.equal(dispatched.length, 1, 'a replacement wheel event should have gone out');
});

test('wheel-zooms mode leaves a real pinch alone', () => {
  // A pinch already arrives with ctrlKey set, which is what Figma reads as a
  // zoom, so there is nothing to rewrite and no reason to touch the event.
  const { listeners } = boot({ stored: { canvas: { scroll: 'zoom' } } });
  const e = wheel({ ctrl: true });
  listeners.window.wheel[0].fn(e);
  assert.deepEqual(e.calls, []);
});

test('wheel-zooms mode lets Shift through as a pan', () => {
  const { listeners } = boot({ stored: { canvas: { scroll: 'zoom' } } });
  const e = wheel({ shift: true });
  listeners.window.wheel[0].fn(e);
  assert.deepEqual(e.calls, [], 'shift+wheel is already a pan; leave it');
});

test('an untrusted wheel event is ignored', () => {
  const { listeners } = boot({ stored: { canvas: { scroll: 'zoom' } } });
  const e = wheel();
  e.isTrusted = false;
  listeners.window.wheel[0].fn(e);
  assert.deepEqual(e.calls, []);
});

test('a lost keyup does not make the next plain keypress disappear', () => {
  // Cmd+F opens Chrome's find bar, which takes focus, so the keyup never
  // reaches the page. If the swallow record survived that, the next ordinary
  // press of "f" would have its keyup eaten and Figma would see half a
  // keystroke. Losing focus is the signal that the record is stale.
  const { listeners, sandbox } = boot({ stored: { keymap: { enabled: true, rules: ['find'] } } });
  const onKeyDown = listeners.window.keydown[0].fn;
  const onKeyUp = listeners.window.keyup[0].fn;

  const chord = keydown('KeyF', { meta: true });
  onKeyDown(chord);
  assert.ok(chord.calls.includes('stopImmediatePropagation'), 'Cmd+F should be reclaimed');

  // Focus leaves the page for the find bar; the keyup lands there, not here.
  sandbox.window.listeners.blur.forEach((r) => r.fn());

  const plain = keydown('KeyF');
  onKeyUp(plain);
  assert.deepEqual(plain.calls, [], 'an ordinary keyup must reach Figma intact');
});

test('an untrusted keydown cannot poison the swallow record', () => {
  // A page script can dispatch its own KeyboardEvent. Treating that as a
  // keypress would let the page eat the user's next real keyup.
  const { listeners } = boot();
  const forged = keydown('KeyR', { meta: true, shift: true });
  forged.isTrusted = false;
  listeners.window.keydown[0].fn(forged);
  assert.deepEqual(forged.calls, []);

  const real = keydown('KeyR');
  listeners.window.keyup[0].fn(real);
  assert.deepEqual(real.calls, [], 'the page must not be able to strand a key');
});

/* ------------------------------------------------------- where it applies */

test('banner hiding is confined to the editor', () => {
  // The patterns match on wording, and the same wording is the real headline
  // copy on figma.com's marketing and help pages. Hiding it there would make
  // Figma's own site look broken with nothing on screen to explain why.
  for (const urlPath of ['/', '/community', '/pricing', '/downloads']) {
    const { sandbox } = boot({ urlPath });
    assert.equal(sandbox.observing, undefined,
      'the declutter observer should not run on ' + urlPath);
  }
});

test('banner hiding does run on an editor URL', () => {
  const { sandbox } = boot({ urlPath: '/design/abc/Deck' });
  assert.equal(sandbox.observing, true, 'the observer should be watching an editor page');
});
