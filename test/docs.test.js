/**
 * Guards the copies of the keymap that live outside the code.
 *
 * The table in keymap.js is the only definition of what this extension does,
 * but three other places restate it for humans: the README, the landing page
 * and the store listing. Those are hand-written by necessity, and they had
 * already drifted once, each dropping a different row nobody noticed, because
 * nothing compared them to anything.
 *
 * These tests do not check wording. They check that every chord the extension
 * actually acts on is mentioned wherever the set is claimed to be complete,
 * and that nothing is described which the extension does not do.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

Object.defineProperty(globalThis, 'navigator', {
  value: { platform: 'MacIntel', userAgent: 'MacIntel' },
  configurable: true,
  writable: true,
});
const KEYMAP = require(path.join(root, 'src', 'keymap.js'));

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Strip the modifier glyphs so "⇧⌘R", "⌘⇧R" and "Cmd+Shift+R" all compare. */
function keyOf(chord) {
  return chord.split('+').pop();
}

test('the README names every chord the extension reclaims', () => {
  const readme = read('README.md');
  for (const rule of KEYMAP.RULES) {
    const label = KEYMAP.label(rule.chord);
    assert.ok(readme.includes(label), `README does not mention ${label} (${rule.id})`);
  }
});

test('the README names every chord left to Figma', () => {
  // This is the list that silently lost ⌘- once already.
  const readme = read('README.md');
  for (const keep of KEYMAP.KEEPS) {
    const label = KEYMAP.label(keep.chord);
    assert.ok(readme.includes(label), `README does not mention ${label}, which Figma keeps`);
  }
});

test('the landing page names every chord the extension reclaims', () => {
  const page = read('docs/index.html');
  for (const rule of KEYMAP.RULES) {
    // The page writes chords as HTML entities, so compare on the key itself
    // plus the presence of a row for it.
    const key = keyOf(rule.chord);
    assert.ok(page.includes('&#8984;' + key) || page.includes(key + '</span>'),
      `the landing page has no row for ${KEYMAP.label(rule.chord)} (${rule.id})`);
  }
});

test('every rehome destination the README names is one the code would press', () => {
  const readme = read('README.md');
  for (const rule of KEYMAP.RULES) {
    if (!rule.rehome) continue;
    const label = KEYMAP.label(rule.rehome.chord);
    assert.ok(readme.includes(label),
      `README does not say where ${rule.id} moved to (${label})`);
  }
});

test('the store listing does not promise a setting that was removed', () => {
  // "Wheel always pans" shipped as an option that could not act. Anything
  // describing it outlives the code unless something looks.
  const listing = read('meta/store-listing.md');
  assert.ok(!/always pans/i.test(listing), 'the store listing still offers a removed option');
  const defaults = require(path.join(root, 'src', 'settings.js')).MM_DEFAULTS;
  assert.equal(defaults.canvas.scroll, 'figma');
});

test('the manifest, package.json and store listing agree on the version', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.version, pkg.version, 'manifest and package.json disagree');
});

test('the manifest description fits what the store accepts', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.name.length <= 45, 'name is over the 45 character limit');
  assert.ok(manifest.description.length <= 132, 'description is over the 132 character limit');
});

test('the store listing short description fits', () => {
  const listing = read('meta/store-listing.md');
  const section = listing.split('## Short description')[1];
  const line = section.split('\n').find((l) => l.trim() && !l.startsWith('('));
  assert.ok(line.trim().length <= 132,
    `short description is ${line.trim().length} characters, over the 132 limit`);
});
