/**
 * Tests for the keymap.
 *
 * Two kinds of test here, and the second kind is the reason the file exists.
 *
 * The behavioural tests pin down what resolve() does with a keystroke. The
 * invariant tests check the table itself for the mistakes that are easy to
 * make while editing data and impossible to notice by reading it: a chord
 * reclaimed and then used as the destination for something else, a rehome
 * pointing at a key the event constructor cannot express, a rule fighting one
 * of the chords Chrome never delivers anyway. Every one of those is silent at
 * runtime and produces a shortcut that simply does nothing.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const KEYMAP_PATH = path.join(__dirname, '..', 'src', 'keymap.js');

/** Load keymap.js fresh under a chosen platform. */
function loadKeymap(platform) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform, userAgent: platform },
    configurable: true,
    writable: true,
  });
  delete require.cache[require.resolve(KEYMAP_PATH)];
  return require(KEYMAP_PATH);
}

/** A keydown event, as far as chordOf is concerned. */
function key(code, mods = {}) {
  return {
    code,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  };
}

const mac = () => loadKeymap('MacIntel');
const pc = () => loadKeymap('Win32');

/* ---------------------------------------------------------------- chordOf */

test('Mod is Cmd on macOS and Ctrl elsewhere', () => {
  assert.equal(mac().chordOf(key('KeyR', { meta: true })), 'Mod+R');
  assert.equal(pc().chordOf(key('KeyR', { ctrl: true })), 'Mod+R');
});

test('the platform’s other modifier stays distinct from Mod', () => {
  // Ctrl+R on a Mac is not Cmd+R and must never resolve as one.
  assert.equal(mac().chordOf(key('KeyR', { ctrl: true })), 'Ctrl+R');
  assert.equal(pc().chordOf(key('KeyR', { meta: true })), 'Ctrl+R');
});

test('modifiers are named in a fixed order', () => {
  const K = mac();
  assert.equal(K.chordOf(key('KeyV', { meta: true, alt: true, shift: true })), 'Mod+Alt+Shift+V');
  // Same chord, different property order on the event: same string.
  assert.equal(K.chordOf(key('KeyV', { shift: true, meta: true, alt: true })), 'Mod+Alt+Shift+V');
});

test('chords are named by physical key, not by the character produced', () => {
  const K = mac();
  // Alt+V on a Mac reports key "√" and Shift+[ reports "{". Using `code`
  // is what keeps a chord recognisable once a modifier has rewritten `key`.
  assert.equal(K.chordOf(key('BracketLeft', { meta: true })), 'Mod+[');
  assert.equal(K.chordOf(key('BracketRight', { meta: true })), 'Mod+]');
  assert.equal(K.chordOf(key('Digit1', { meta: true })), 'Mod+1');
});

test('an unrecognised key yields no chord rather than a wrong one', () => {
  assert.equal(mac().chordOf(key('', { meta: true })), '');
});

/* ---------------------------------------------------------------- resolve */

test('an enabled rule reclaims its chord for the browser', () => {
  const K = mac();
  const out = K.resolve('Mod+R', new Set(['reload']), false);
  assert.equal(out.action, 'reclaim');
  assert.equal(out.rule.id, 'reload');
});

test('a disabled rule leaves the chord alone', () => {
  assert.equal(mac().resolve('Mod+R', new Set(), false), null);
});

test('an unlisted chord is never touched', () => {
  assert.equal(mac().resolve('Mod+K', new Set(['reload']), false), null);
});

test('the conventional chord dispatches the original at Figma', () => {
  const K = mac();
  const out = K.resolve('F2', new Set(['reload']), false);
  assert.equal(out.action, 'rehome');
  assert.equal(out.chord, 'Mod+R');
});

test('an alias rehome is left for Figma to handle natively', () => {
  // Paste to Replace still answers to Cmd+Opt+Shift+V. Intercepting that
  // would break the very shortcut the rule points people at.
  const K = mac();
  assert.equal(K.resolve('Mod+Alt+Shift+V', new Set(['hard-reload']), false), null);
});

/* -------------------------------------------------------- the text-field guard */

test('while typing, an ordinary reclaim stands down', () => {
  const K = mac();
  assert.equal(K.resolve('Mod+R', new Set(['reload']), true), null);
  assert.equal(K.resolve('Mod+F', new Set(['find']), true), null);
});

test('while typing, a destructive chord is still reclaimed', () => {
  // Paste to Replace can destroy the selection whatever has focus, and
  // Cmd+Shift+R meaning "reload" is never the wrong reading.
  const K = mac();
  const out = K.resolve('Mod+Shift+R', new Set(['hard-reload']), true);
  assert.equal(out.action, 'reclaim');
  assert.equal(out.rule.id, 'hard-reload');
});

/* ------------------------------------------------------------- invariants */

test('rule ids and chords are unique', () => {
  const K = mac();
  const ids = K.RULES.map((r) => r.id);
  const chords = K.RULES.map((r) => r.chord);
  assert.equal(new Set(ids).size, ids.length, 'duplicate rule id');
  assert.equal(new Set(chords).size, chords.length, 'two rules claim one chord');
});

test('no rule reclaims a chord the browser never delivers', () => {
  const K = mac();
  for (const rule of K.RULES) {
    assert.ok(!K.RESERVED.includes(rule.chord),
      rule.chord + ' is resolved above the page; a rule for it would do nothing');
  }
});

test('no rule reclaims a chord we decided Figma should keep', () => {
  const K = mac();
  const keeps = new Set(K.KEEPS.map((k) => k.chord));
  for (const rule of K.RULES) {
    assert.ok(!keeps.has(rule.chord), rule.chord + ' is in both tables');
  }
});

test('nothing is rehomed onto a chord that is itself reclaimed', () => {
  // The failure this prevents: pressing the new chord gets intercepted by the
  // rule that reclaimed it, so the moved action becomes unreachable.
  const K = mac();
  const reclaimed = new Set(K.RULES.map((r) => r.chord));
  for (const rule of K.RULES) {
    if (!rule.rehome) continue;
    assert.ok(!reclaimed.has(rule.rehome.chord),
      rule.id + ' is rehomed onto ' + rule.rehome.chord + ', which is reclaimed');
  }
});

test('two rules never rehome onto the same chord', () => {
  const K = mac();
  const dests = K.RULES.filter((r) => r.rehome).map((r) => r.rehome.chord);
  assert.equal(new Set(dests).size, dests.length, 'two actions share a destination chord');
});

test('every rehome destination can be turned into a real KeyboardEvent', () => {
  // A destination whose base key is not in the keycode table silently
  // produces null at dispatch time, and the shortcut does nothing at all.
  const K = mac();
  for (const rule of K.RULES) {
    if (!rule.rehome) continue;
    assert.ok(K.chordToInit(rule.rehome.chord), 'cannot express ' + rule.rehome.chord);
    if (rule.rehome.via === 'synthetic') {
      assert.ok(K.chordToInit(rule.rehome.to), 'cannot express ' + rule.rehome.to);
    }
  }
});

test('a synthetic rehome names what to press; an alias names nothing', () => {
  for (const rule of mac().RULES) {
    if (!rule.rehome) continue;
    if (rule.rehome.via === 'synthetic') assert.ok(rule.rehome.to, rule.id + ' has nowhere to dispatch');
    else assert.equal(rule.rehome.to, null, rule.id + ' is an alias and must not dispatch');
  }
});

test('every rule explains itself in the interface', () => {
  for (const rule of mac().RULES) {
    assert.ok(rule.browser, rule.id + ' does not say what the browser does');
    assert.ok(rule.why, rule.id + ' does not say why');
    // A Figma action may only be named where it was actually confirmed.
    if (rule.figma) assert.equal(rule.confirmed, true, rule.id + ' names an unconfirmed binding');
  }
});

test('the defaults are a subset of the rules, and include every destructive one', () => {
  const K = mac();
  const defaults = new Set(K.defaultRuleIds());
  const all = new Set(K.RULES.map((r) => r.id));
  for (const id of defaults) assert.ok(all.has(id), id + ' is a default but not a rule');
  for (const rule of K.RULES) {
    if (rule.destructive) assert.ok(defaults.has(rule.id), rule.id + ' destroys work and must default on');
  }
});

/* ------------------------------------------------------------ chordToInit */

test('chordToInit sets the deprecated keyCode that older handlers read', () => {
  const K = mac();
  assert.equal(K.chordToInit('Mod+R').keyCode, 82);
  assert.equal(K.chordToInit('F2').keyCode, 113);
  assert.equal(K.chordToInit('Mod+[').keyCode, 219);
});

test('chordToInit reports the shifted form of a letter', () => {
  const K = mac();
  assert.equal(K.chordToInit('Mod+R').key, 'r');
  assert.equal(K.chordToInit('Mod+Shift+R').key, 'R');
});

test('chordToInit maps Mod to the right modifier per platform', () => {
  assert.equal(mac().chordToInit('Mod+R').metaKey, true);
  assert.equal(mac().chordToInit('Mod+R').ctrlKey, false);
  assert.equal(pc().chordToInit('Mod+R').ctrlKey, true);
  assert.equal(pc().chordToInit('Mod+R').metaKey, false);
});

test('chordToInit refuses a key it cannot express', () => {
  assert.equal(mac().chordToInit('Mod+Nonsense'), null);
});

/* ----------------------------------------------------------------- labels */

test('chords are written the way the platform writes them', () => {
  // Apple's order is Control, Option, Shift, Command, key last, and every Mac
  // menu bar follows it. Our canonical form leads with Mod because that is
  // the axis rules group by, so the label has to reorder rather than print
  // the internal form at a person.
  assert.equal(mac().label('Mod+Shift+R'), '⇧⌘R');
  assert.equal(mac().label('Mod+Alt+Shift+V'), '⌥⇧⌘V');
  assert.equal(mac().label('Mod+Alt+F'), '⌥⌘F');
  assert.equal(pc().label('Mod+Shift+R'), 'Ctrl+Shift+R');
});

test('a keydown is recognised whatever the layout calls its physical key', () => {
  // Dvorak: the key that types "r" sits on physical KeyO. Matching on `code`
  // alone would miss it, Chrome would reload anyway, and Figma would ALSO
  // rename the layer, which is the original bug with an extra step.
  const K = mac();
  const dvorak = { key: 'r', code: 'KeyO', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  const out = K.resolveEvent(dvorak, new Set(['reload']), false);
  assert.ok(out, 'Cmd+R must be recognised on a remapped layout');
  assert.equal(out.action, 'reclaim');
});

test('punctuation is never inferred from the physical key', () => {
  // On a German layout physical BracketLeft types "ü". Treating that as "["
  // would reclaim a chord the browser has nothing bound to, so the key would
  // do nothing at all rather than something wrong.
  const K = mac();
  const german = { key: 'ü', code: 'BracketLeft', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  assert.equal(K.resolveEvent(german, new Set(['back']), false), null);
});

test('a rehome does not fire while typing', () => {
  // F2 mid-sentence is part of the text, not a rename command.
  const K = mac();
  assert.equal(K.resolve('F2', new Set(['reload']), true), null);
});

/* ------------------------------------------- the shortcut this was built for */

test('Cmd+Shift+R reloads, and Paste to Replace keeps a native home', () => {
  const K = mac();
  const rule = K.RULES.find((r) => r.id === 'hard-reload');

  const pressed = K.chordOf(key('KeyR', { meta: true, shift: true }));
  const out = K.resolve(pressed, new Set(K.defaultRuleIds()), false);

  assert.equal(out.action, 'reclaim', 'Figma must not see Cmd+Shift+R');
  assert.equal(rule.destructive, true);
  // Nothing is emulated here: the action moves to a chord Figma still ships,
  // so this rule works whether or not synthesised events are honoured.
  assert.equal(rule.rehome.via, 'alias');
  assert.equal(rule.rehome.chord, 'Mod+Alt+Shift+V');
});
