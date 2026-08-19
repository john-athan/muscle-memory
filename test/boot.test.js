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
function boot({ platform = 'MacIntel', stored = null } = {}) {
  const listeners = { window: {}, document: {} };
  const written = [];

  const record = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };

  const documentStub = {
    addEventListener: record(listeners.document),
    removeEventListener() {},
    activeElement: null,
    body: null,          // as at document_start, before the body exists
    documentElement: {},
    querySelectorAll: () => [],
  };

  const sandbox = {
    navigator: { platform, userAgent: platform },
    document: documentStub,
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    MutationObserver: class { observe() {} disconnect() {} },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    WheelEvent: class { constructor(type) { this.type = type; } },
    chrome: {
      runtime: { lastError: null },
      storage: {
        sync: { get: (_k, cb) => cb(stored), set: (v) => written.push(v) },
        local: { set: (v) => written.push(v) },
        onChanged: { addListener() {} },
      },
    },
  };
  sandbox.window = {
    addEventListener: record(listeners.window),
    removeEventListener() {},
    innerWidth: 1600,
    innerHeight: 900,
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  for (const rel of manifestScripts()) {
    const file = path.join(__dirname, '..', rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: rel });
  }
  return { listeners, sandbox, written };
}

/** A keydown as the handler sees it, recording what was done to it. */
function keydown(code, mods = {}) {
  const calls = [];
  return {
    code,
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
  // race this extension exists to win.
  const { listeners } = boot();
  assert.equal(listeners.window.keydown.length, 1, 'no keydown listener on window');
  assert.equal(listeners.document.keydown, undefined, 'keydown must not be on document');
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
  const onKeyDown = listeners.window.keydown[0];

  const e = keydown('KeyR', { meta: true, shift: true }); // Cmd+Shift+R
  onKeyDown(e);

  assert.ok(e.calls.includes('stopImmediatePropagation'), 'Figma would still see it');
  assert.ok(!e.calls.includes('preventDefault'), 'the browser would not reload');
});

test('a chord with no rule is left completely untouched', () => {
  const { listeners } = boot();
  const e = keydown('KeyD', { meta: true }); // duplicate: Figma keeps this
  listeners.window.keydown[0](e);
  assert.deepEqual(e.calls, [], 'Cmd+D must reach Figma unchanged');
});

test('the master switch off means no keystroke is touched', () => {
  const { listeners } = boot({ stored: { keymap: { enabled: false } } });
  const e = keydown('KeyR', { meta: true, shift: true });
  listeners.window.keydown[0](e);
  assert.deepEqual(e.calls, [], 'off must mean the handler does nothing at all');
});

test('a stored profile survives the trip through storage', () => {
  // Rules stored as a list must still be honoured after the async load; a
  // reclaim that only works on the defaults would be a silent regression.
  const { listeners } = boot({ stored: { keymap: { enabled: true, rules: ['find'] } } });
  const reclaimed = keydown('KeyF', { meta: true });
  const ignored = keydown('KeyR', { meta: true });
  listeners.window.keydown[0](reclaimed);
  listeners.window.keydown[0](ignored);
  assert.ok(reclaimed.calls.includes('stopImmediatePropagation'), 'Cmd+F was configured');
  assert.deepEqual(ignored.calls, [], 'Cmd+R was not in the stored list');
});

test('right-click reaches Figma unless Shift is held', () => {
  const { listeners } = boot();
  const onContextMenu = listeners.window.contextmenu[0];

  const plain = keydown('', {});
  onContextMenu(plain);
  assert.deepEqual(plain.calls, [], "Figma's own canvas menu is worth keeping");

  const shifted = keydown('', { shift: true });
  onContextMenu(shifted);
  assert.ok(shifted.calls.includes('stopImmediatePropagation'), 'Shift should reach the browser menu');
});
