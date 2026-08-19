/**
 * Tests for settings merging.
 *
 * These matter more than the size of the file suggests. The content script
 * cannot wait for chrome.storage before it registers its key listener, so it
 * starts on the defaults and folds the stored values in when they arrive. That
 * is only sound while the merge is total: a stored object missing a key, or
 * carrying a key from an older version, must still produce a complete settings
 * object rather than an undefined lookup inside a keydown handler.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

Object.defineProperty(globalThis, 'navigator', {
  value: { platform: 'MacIntel', userAgent: 'MacIntel' },
  configurable: true,
  writable: true,
});
const KEYMAP = require(path.join(__dirname, '..', 'src', 'keymap.js'));
globalThis.MM_KEYMAP = KEYMAP;
const { MM_DEFAULTS, mmMerge, mmActiveRules } = require(path.join(__dirname, '..', 'src', 'settings.js'));

test('an empty profile yields the complete defaults', () => {
  const merged = mmMerge(null);
  for (const section of Object.keys(MM_DEFAULTS)) {
    assert.deepEqual(Object.keys(merged[section]).sort(), Object.keys(MM_DEFAULTS[section]).sort());
  }
});

test('a partial section keeps the keys it did not mention', () => {
  const merged = mmMerge({ canvas: { scroll: 'zoom' } });
  assert.equal(merged.canvas.scroll, 'zoom');
  assert.equal(merged.canvas.rightClick, MM_DEFAULTS.canvas.rightClick);
  assert.equal(merged.canvas.middleClickPan, MM_DEFAULTS.canvas.middleClickPan);
});

test('settings from an older version do not leave holes', () => {
  // A profile written before `declutter` existed must not produce an
  // undefined section, because the sweep reads it on every mutation.
  const merged = mmMerge({ keymap: { enabled: false } });
  assert.equal(typeof merged.declutter, 'object');
  assert.equal(merged.declutter.desktopBanner, MM_DEFAULTS.declutter.desktopBanner);
});

test('an unknown section is ignored rather than merged in', () => {
  const merged = mmMerge({ nonsense: { x: 1 } });
  assert.equal(merged.nonsense, undefined);
});

test('the master switch off means no rule is active', () => {
  const merged = mmMerge({ keymap: { enabled: false, rules: ['reload', 'find'] } });
  assert.equal(mmActiveRules(merged).size, 0, 'off must mean off, not "off except the ones listed"');
});

test('an unconfigured profile runs the keymap defaults', () => {
  const active = mmActiveRules(mmMerge(null));
  assert.deepEqual([...active].sort(), KEYMAP.defaultRuleIds().sort());
});

test('an explicit empty list is respected, not treated as unconfigured', () => {
  // The difference between "I turned them all off" and "I have not chosen"
  // is null versus [], and confusing the two silently re-enables rules.
  const active = mmActiveRules(mmMerge({ keymap: { enabled: true, rules: [] } }));
  assert.equal(active.size, 0);
});
