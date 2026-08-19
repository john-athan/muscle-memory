/**
 * The keymap: which chords Figma is allowed to see, and where its displaced
 * actions go instead.
 *
 * Two mechanisms, and the difference between them decides how much you can
 * trust a given row.
 *
 * RECLAIM is subtraction. We catch the event in the capture phase before
 * Figma's listener exists and stop it there, without calling preventDefault.
 * The browser then does what it always did. This needs no cooperation from
 * Figma and cannot be broken by a Figma release: an event they never receive
 * is an event they cannot act on.
 *
 * REHOME is addition. Reclaiming a chord strands whatever Figma bound to it,
 * so we bind that action to a conventional chord and, when it is pressed,
 * dispatch the chord Figma still understands. This one does depend on Figma:
 * a synthesised KeyboardEvent has isTrusted false, and an app is free to
 * ignore those. See dispatchChord() in content.js for how we find out at
 * runtime rather than guessing.
 *
 * A rehome via `alias` is the good case. Figma kept a second native chord for
 * the action, so we press that instead and nothing is synthesised at all --
 * subtraction only, with none of the risk. Paste to Replace is the important
 * one: Figma moved it to Cmd+Shift+R but never unbound Cmd+Opt+Shift+V.
 */

'use strict';

const MM_PUNCTUATION = new Set(['[', ']', '\\', ',', '.', '/', '-', '=', '`', "'", ';']);

const MM_CODE_PUNCTUATION = {
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Comma: ',', Period: '.',
  Slash: '/', Minus: '-', Equal: '=', Backquote: '`', Quote: "'", Semicolon: ';',
};

const MM_IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/**
 * Canonical chord string for an event or a chord literal, e.g. "Mod+Shift+R".
 *
 * "Mod" is Cmd on macOS and Ctrl everywhere else, which is the axis Figma and
 * the browser actually fight over. The platform's other modifier is tracked
 * separately as "Ctrl" so that Ctrl+Shift+? on a Mac stays distinct from the
 * Cmd chords and is never mistaken for one.
 */
function mmChord(e) {
  const mod = MM_IS_MAC ? e.metaKey : e.ctrlKey;
  const ctrl = MM_IS_MAC ? e.ctrlKey : e.metaKey;
  const parts = [];
  if (mod) parts.push('Mod');
  if (ctrl) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // `code` rather than `key`, because `key` is what the modifiers already did
  // to it: Alt+V on a Mac reports key "√", and Shift+[ reports "{". The
  // physical key is the only stable name for a chord.
  let base = e.code || '';
  if (base.startsWith('Key')) base = base.slice(3);
  else if (base.startsWith('Digit')) base = base.slice(5);
  else if (base === 'BracketLeft') base = '[';
  else if (base === 'BracketRight') base = ']';
  else if (base === 'Backslash') base = '\\';
  else if (base === 'Comma') base = ',';
  else if (base === 'Period') base = '.';
  else if (base === 'Slash') base = '/';
  else if (base === 'Minus') base = '-';
  else if (base === 'Equal') base = '=';
  else if (base === 'Backquote') base = '`';
  else if (base === 'Quote') base = "'";
  else if (base === 'Semicolon') base = ';';
  if (!base) return '';
  parts.push(base.toUpperCase());
  return parts.join('+');
}

// Apple writes modifiers in the order Control, Option, Shift, Command, with
// the key last, and every Mac menu bar in existence follows it. Our canonical
// form leads with Mod because that is the axis rules are grouped by, so the
// two orders differ and only one of them belongs in front of a person.
const MM_MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];

/** How a chord should be written in the interface, per platform. */
function mmChordLabel(chord) {
  if (!chord) return '';
  let parts = chord.split('+');
  if (MM_IS_MAC) {
    const base = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    parts = MM_MAC_ORDER.filter((m) => mods.includes(m)).concat([base]);
  }
  return parts
    .map((p) => {
      if (p === 'Mod') return MM_IS_MAC ? '⌘' : 'Ctrl';
      if (p === 'Ctrl') return MM_IS_MAC ? '⌃' : 'Meta';
      if (p === 'Alt') return MM_IS_MAC ? '⌥' : 'Alt';
      if (p === 'Shift') return MM_IS_MAC ? '⇧' : 'Shift';
      return p;
    })
    .join(MM_IS_MAC ? '' : '+');
}

/**
 * Chords the browser never hands to the page in the first place.
 *
 * Cmd+N, Cmd+T, Cmd+W and Cmd+Q are resolved by Chrome above the renderer, so
 * no page can preventDefault them and no extension needs to defend them. They
 * are listed to be shown as already-safe in the interface, and to keep anyone
 * from adding a rule that would silently do nothing.
 */
const MM_BROWSER_RESERVED = ['Mod+N', 'Mod+T', 'Mod+W', 'Mod+Q', 'Mod+Shift+N', 'Mod+Shift+T'];

/**
 * Chords Figma is right to keep.
 *
 * The rule the whole keymap turns on is not "the browser always wins" -- it is
 * "the meaning you expect wins". Inside a canvas, Cmd+D means duplicate and
 * Cmd+G means group, in Figma exactly as in every design tool for thirty
 * years; the browser's bookmark and find-next are the surprising readings, and
 * both have another way in. Cmd+= / Cmd+- / Cmd+0 are the same story: zooming
 * the canvas is what you meant, zooming the chrome around it is not.
 *
 * These are listed rather than merely omitted so the options page can show
 * them as deliberate, and say why.
 */
const MM_FIGMA_KEEPS = [
  { chord: 'Mod+D', figma: 'Duplicate selection', browser: 'Bookmark this page',
    why: 'Duplicate is the design-tool reading of Cmd+D. Bookmarking is still on the star in the address bar.' },
  { chord: 'Mod+G', figma: 'Group selection', browser: 'Find next',
    why: 'Group is the design-tool reading. Find next is Enter inside the find bar.' },
  { chord: 'Mod+Shift+G', figma: 'Ungroup selection', browser: 'Find previous',
    why: 'The counterpart to Cmd+G, and it has to travel with it.' },
  { chord: 'Mod+=', figma: 'Zoom in on the canvas', browser: 'Zoom the page',
    why: 'Zooming Figma’s chrome instead of the artboard is never what you meant.' },
  { chord: 'Mod+-', figma: 'Zoom out on the canvas', browser: 'Zoom the page', why: 'As above.' },
  { chord: 'Mod+0', figma: 'Zoom to 100%', browser: 'Reset page zoom', why: 'As above.' },
];

/**
 * The reclaim table.
 *
 * `figma` is only filled in where the binding was actually confirmed, because
 * a wrong label in the options page is a lie the user has no way to check.
 * Where it is null the interface says so plainly. This costs nothing in
 * behaviour: reclaiming does not need to know what Figma would have done, only
 * that Figma should not be the one to do it.
 *
 * `destructive` marks the rows that lose work rather than merely surprise you.
 * Those are on by default even for someone who turns the rest off.
 */
const MM_RULES = [
  {
    id: 'reload',
    chord: 'Mod+R',
    browser: 'Reload the page',
    figma: 'Rename selection',
    confirmed: true,
    destructive: false,
    rehome: { chord: 'F2', to: 'Mod+R', via: 'synthetic' },
    why: 'F2 renames in VS Code, in Finder and in Windows Explorer. Double-clicking the layer name still works too.',
  },
  {
    id: 'hard-reload',
    chord: 'Mod+Shift+R',
    browser: 'Hard reload, bypassing the cache',
    figma: 'Paste to Replace',
    confirmed: true,
    destructive: true,
    // The good case. Figma moved Paste to Replace here from Cmd+Opt+Shift+V
    // and left the old chord bound, so the action keeps a native home and we
    // synthesise nothing.
    rehome: { chord: 'Mod+Alt+Shift+V', to: null, via: 'alias' },
    why: 'Cmd+Opt+Shift+V is where Paste to Replace used to live, and Figma never unbound it. Nothing is emulated: this is the shortcut Figma itself still ships.',
  },
  {
    id: 'find',
    chord: 'Mod+F',
    browser: 'Find on the page',
    figma: 'Search the file',
    confirmed: true,
    destructive: false,
    rehome: { chord: 'Mod+Alt+F', to: 'Mod+F', via: 'synthetic' },
    why: 'Figma’s own quick actions on Cmd+/ also search the file, and are untouched.',
  },
  {
    id: 'print',
    chord: 'Mod+P',
    browser: 'Print',
    figma: null,
    confirmed: false,
    destructive: false,
    rehome: null,
    why: 'Printing a frame to PDF is the only way to get a physical page out of Figma without an export round trip.',
  },
  {
    id: 'save',
    chord: 'Mod+S',
    browser: 'Save the page',
    figma: null,
    confirmed: false,
    destructive: false,
    rehome: null,
    // Free of charge: Figma binds nothing to Cmd+S at all. It saves
    // continuously, and a named version is Cmd+Opt+S, which is untouched.
    why: 'Figma binds nothing here. It saves continuously, and a named version is Cmd+Opt+S, which this does not touch.',
  },
  {
    id: 'back',
    chord: 'Mod+[',
    browser: 'Go back',
    figma: 'Send backward',
    confirmed: true,
    destructive: false,
    rehome: { chord: 'Mod+Alt+[', to: 'Mod+[', via: 'synthetic' },
    // Off by default, and the only rule here that is genuinely a trade rather
    // than a free win: reordering layers is a real, frequent canvas action,
    // where browser history on a canvas mostly is not.
    why: 'Back and forward are how you leave a file you opened by accident. Off by default: layer order is the more valuable reading of this chord.',
    defaultOn: false,
  },
  {
    id: 'forward',
    chord: 'Mod+]',
    browser: 'Go forward',
    figma: 'Bring forward',
    confirmed: true,
    destructive: false,
    rehome: { chord: 'Mod+Alt+]', to: 'Mod+]', via: 'synthetic' },
    why: 'The counterpart to Cmd+[, and it has to travel with it.',
    defaultOn: false,
  },
];

/** Rules that are on when nothing has been configured yet. */
function mmDefaultRuleIds() {
  return MM_RULES.filter((r) => r.defaultOn !== false).map((r) => r.id);
}

/**
 * Every chord string a keydown could reasonably be called.
 *
 * `code` names a physical position on a US layout. That is stable under
 * modifiers but wrong under a remapped one: on Dvorak the key that types `r`
 * sits on physical `KeyO`, so a code-only match would let Cmd+R through to
 * Figma while Chrome reloaded anyway, firing both actions at once.
 *
 * So `key` leads, since with Cmd held it reports the plain letter, and `code`
 * follows as a fallback for letters, digits and function keys. Punctuation is
 * deliberately not taken from `code`: on a German layout physical
 * BracketLeft types `ü`, and treating that as `[` would reclaim a chord the
 * browser has nothing bound to, leaving a key that does nothing at all.
 */
function mmChordsOf(e) {
  const mod = MM_IS_MAC ? e.metaKey : e.ctrlKey;
  const ctrl = MM_IS_MAC ? e.ctrlKey : e.metaKey;
  const prefix = [];
  if (mod) prefix.push('Mod');
  if (ctrl) prefix.push('Ctrl');
  if (e.altKey) prefix.push('Alt');
  if (e.shiftKey) prefix.push('Shift');

  const out = [];
  const add = (base) => {
    if (!base) return;
    const chord = prefix.concat([base]).join('+');
    if (!out.includes(chord)) out.push(chord);
  };

  const key = typeof e.key === 'string' ? e.key : '';
  if (/^[a-zA-Z0-9]$/.test(key)) add(key.toUpperCase());
  else if (/^F\d+$/.test(key)) add(key);
  else if (MM_PUNCTUATION.has(key)) add(key);

  add(mmBaseFromCode(e.code, true));
  return out;
}

/**
 * The base name for a physical key, or '' if it has none we use.
 *
 * `lettersOnly` restricts the answer to letters, digits and function keys,
 * whose position and meaning coincide on every layout worth supporting.
 */
function mmBaseFromCode(code, lettersOnly) {
  const base = code || '';
  if (base.startsWith('Key')) return base.slice(3).toUpperCase();
  if (base.startsWith('Digit')) return base.slice(5);
  if (/^F\d+$/.test(base)) return base;
  if (lettersOnly) return '';
  return MM_CODE_PUNCTUATION[base] || '';
}

/** Resolve a keydown directly, trying every name its chord could go by. */
function mmResolveEvent(e, enabled, editing) {
  for (const chord of mmChordsOf(e)) {
    const decision = mmResolve(chord, enabled, editing);
    if (decision) return decision;
  }
  return null;
}

/**
 * Resolve a keydown into what should happen to it.
 *
 * Returns one of:
 *   null                            leave the event alone
 *   {action:'reclaim', rule}        stop it, let the browser have it
 *   {action:'rehome', rule, chord}  stop it, press `chord` at Figma instead
 *
 * `enabled` is the set of active rule ids; `editing` is true when focus is in
 * a text field, where a chord means something else entirely and the whole
 * keymap steps aside.
 */
function mmResolve(chord, enabled, editing) {
  if (!chord) return null;

  for (const rule of MM_RULES) {
    if (!enabled.has(rule.id)) continue;

    // The reclaimed chord itself.
    if (chord === rule.chord) {
      // While typing, a chord is part of editing text and not a canvas
      // command -- with one exception. Paste to Replace is destructive
      // whatever has focus, and Cmd+Shift+R meaning "reload" is never wrong.
      if (editing && !rule.destructive) return null;
      return { action: 'reclaim', rule };
    }

    // The conventional chord we put the displaced action on. An `alias`
    // rehome is Figma's own second binding, so we must not intercept it --
    // Figma already handles it and stopping the event would break it.
    if (rule.rehome && rule.rehome.via === 'synthetic' && chord === rule.rehome.chord) {
      // Same reasoning as the reclaim branch above: mid-sentence, F2 and
      // Cmd+Opt+F are part of the text being typed, not canvas commands.
      if (editing) return null;
      return { action: 'rehome', rule, chord: rule.rehome.to };
    }
  }
  return null;
}

const KEYCODES = {
  '[': [219, 'BracketLeft'], ']': [221, 'BracketRight'], '\\': [220, 'Backslash'],
  ',': [188, 'Comma'], '.': [190, 'Period'], '/': [191, 'Slash'],
  '-': [189, 'Minus'], '=': [187, 'Equal'], '`': [192, 'Backquote'],
  "'": [222, 'Quote'], ';': [186, 'Semicolon'],
};

/**
 * Turn a canonical chord string back into the fields a KeyboardEvent needs.
 *
 * `keyCode` and `which` are deprecated, and they are set here because plenty
 * of handlers still read them, including code compiled from other languages.
 * They are not members of the modern KeyboardEventInit, but the UI Events
 * spec keeps them in a legacy partial dictionary and Chrome honours it:
 * constructing with `keyCode: 82` yields `event.keyCode === 82`, where
 * omitting it yields 0. Verified against Chrome rather than assumed, because
 * the alternative, defining the properties on the event afterwards, silently
 * does nothing: an accessor installed from an isolated world lives on that
 * world's wrapper and the page reads through its own.
 */
function chordToInit(chord) {
  const parts = chord.split('+');
  const base = parts[parts.length - 1];
  const mod = parts.includes('Mod');
  const shift = parts.includes('Shift');
  const init = {
    metaKey: MM_IS_MAC ? mod : parts.includes('Ctrl'),
    ctrlKey: MM_IS_MAC ? parts.includes('Ctrl') : mod,
    altKey: parts.includes('Alt'),
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  if (/^[A-Z]$/.test(base)) {
    init.key = shift ? base : base.toLowerCase();
    init.code = 'Key' + base;
    init.keyCode = base.charCodeAt(0);
  } else if (/^[0-9]$/.test(base)) {
    init.key = base;
    init.code = 'Digit' + base;
    init.keyCode = 48 + Number(base);
  } else if (/^F\d+$/.test(base)) {
    init.key = base;
    init.code = base;
    init.keyCode = 111 + Number(base.slice(1));
  } else if (KEYCODES[base]) {
    init.key = base;
    init.code = KEYCODES[base][1];
    init.keyCode = KEYCODES[base][0];
  } else {
    return null;
  }
  init.which = init.keyCode;
  return init;
}

const MM_KEYMAP = {
  isMac: MM_IS_MAC,
  chordOf: mmChord,
  chordToInit: chordToInit,
  label: mmChordLabel,
  resolve: mmResolve,
  resolveEvent: mmResolveEvent,
  chordsOf: mmChordsOf,
  defaultRuleIds: mmDefaultRuleIds,
  RULES: MM_RULES,
  RESERVED: MM_BROWSER_RESERVED,
  KEEPS: MM_FIGMA_KEEPS,
};

if (typeof globalThis !== 'undefined') globalThis.MM_KEYMAP = MM_KEYMAP;
// Present under Node for the test suite, absent in a content script.
if (typeof module !== 'undefined' && module.exports) module.exports = MM_KEYMAP;
