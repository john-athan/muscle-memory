/**
 * The options page.
 *
 * Built with DOM calls rather than innerHTML throughout. None of these strings
 * are untrusted, so this is not a live injection risk, but an extension page
 * is the wrong place to establish the habit of parsing markup at runtime.
 *
 * The page is generated from the same keymap.js the content script enforces,
 * so the two cannot drift: a chord not in the table cannot appear here, and a
 * row shown here is by construction the rule in effect.
 */

'use strict';

const KEYMAP = globalThis.MM_KEYMAP;
const SETTINGS = globalThis.MM_SETTINGS;
const SELECTORS = globalThis.MM_SELECTORS;

let settings = SETTINGS.merge(null);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A chord, drawn as the key it is. */
function cap(chord) {
  return el('span', 'cap', KEYMAP.label(chord));
}

/** Persist, without letting a write-quota rejection reach the console. */
function save() {
  try {
    const done = chrome.storage.sync.set(settings);
    if (done && typeof done.catch === 'function') done.catch(() => {});
  } catch (_) { /* nothing useful to do from a settings page */ }
}

function activeIds() {
  return SETTINGS.activeRules(settings);
}

/* ------------------------------------------------------------ the ledger */

/**
 * What is in effect right now, stated in full and never behind a disclosure.
 *
 * This is the only part of the page a user has to remember, so it is the part
 * that is always on screen. An earlier version buried it inside a collapsed
 * section and led with the reasoning instead, which is the wrong way round.
 */
function renderLedger() {
  const host = document.getElementById('ledger');
  host.replaceChildren();
  const on = activeIds();

  // The chord that can destroy work leads, whatever order the table is in.
  const shown = KEYMAP.RULES.filter((r) => on.has(r.id))
    .sort((a, b) => Number(!!b.destructive) - Number(!!a.destructive));

  for (const rule of shown) {
    const row = el('div', 'claim to-browser' + (rule.destructive ? ' is-danger' : ''));
    row.append(cap(rule.chord));

    const gets = el('div', 'claim-gets');
    gets.append(document.createTextNode(rule.browser));
    if (rule.destructive) gets.append(el('span', 'flag flag-danger', 'can lose work'));
    row.append(gets);

    const then = el('div', 'claim-then');
    if (rule.figma && rule.rehome) {
      then.append(document.createTextNode(rule.figma + ' moved to '));
      then.append(cap(rule.rehome.chord));
      if (rule.rehome.via === 'alias') then.append(el('span', 'flag flag-native', 'Figma’s own key'));
    } else if (rule.figma) {
      then.append(document.createTextNode('Figma used this for ' + rule.figma + '.'));
    } else if (rule.bindsNothing) {
      then.append(document.createTextNode('Figma binds nothing here, so nothing was lost.'));
    } else {
      then.append(document.createTextNode('We have not confirmed what Figma does with this key.'));
    }
    row.append(then);
    host.append(row);
  }

  if (settings.canvas.rightClick) {
    const row = el('div', 'claim to-browser');
    row.append(cap('Shift'));
    const gets = el('div', 'claim-gets');
    gets.append(document.createTextNode('+ right-click, for the browser’s menu'));
    row.append(gets);
    row.append(el('div', 'claim-then', 'A plain right-click still opens Figma’s.'));
    host.append(row);
  }

  if (!host.childElementCount) {
    host.append(el('p', 'lede', 'Nothing is being changed. Every chord goes to Figma.'));
  }
}

function renderKeeps() {
  const host = document.getElementById('keeps');
  host.replaceChildren();
  for (const keep of KEYMAP.KEEPS) {
    const row = el('div', 'claim to-figma');
    row.append(cap(keep.chord));
    row.append(el('div', 'claim-gets', keep.figma));
    row.append(el('div', 'claim-then', keep.why));
    host.append(row);
  }
}

/* -------------------------------------------------------------- the rules */

function renderRules() {
  const host = document.getElementById('rules');
  host.replaceChildren();
  const on = new Set(settings.keymap.rules || KEYMAP.defaultRuleIds());

  for (const rule of KEYMAP.RULES) {
    const row = el('div', 'rule');

    const wrap = el('label', 'rule-box');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = on.has(rule.id);
    // The label wraps only the input, so without this the control has no
    // accessible name and a screen reader announces seven bare checkboxes.
    box.setAttribute('aria-label', KEYMAP.label(rule.chord) + ', ' + rule.browser);
    box.addEventListener('change', () => {
      const next = new Set(settings.keymap.rules || KEYMAP.defaultRuleIds());
      if (box.checked) next.add(rule.id); else next.delete(rule.id);
      settings.keymap.rules = [...next];
      save();
      renderLedger();
      renderCount();
    });
    wrap.append(box);

    const head = el('div', 'rule-head');
    head.append(cap(rule.chord));
    head.append(el('strong', null, rule.browser));
    if (rule.destructive) head.append(el('span', 'flag flag-danger', 'can lose work'));
    if (rule.rehome && rule.rehome.via === 'alias') {
      head.append(el('span', 'flag flag-native', 'Figma’s own key'));
    }

    const note = el('div', 'rule-note');
    if (rule.figma) note.append(document.createTextNode('Figma uses this for ' + rule.figma + '. '));
    else note.append(document.createTextNode('We have not confirmed what Figma does with this key. Either way the browser gets it. '));
    if (rule.rehome) {
      note.append(document.createTextNode('Moved to '));
      note.append(cap(rule.rehome.chord));
      note.append(document.createTextNode('.'));
    }

    row.append(wrap, head, note, el('div', 'rule-why', rule.why));
    host.append(row);
  }
  renderCount();
}

function renderCount() {
  const total = KEYMAP.RULES.length;
  document.getElementById('rule-count').textContent =
    settings.keymap.enabled ? activeIds().size + ' of ' + total + ' on' : 'all off';
}

/* ---------------------------------------------------------------- banners */

function renderDeclutter() {
  const host = document.getElementById('declutter');
  host.replaceChildren();
  for (const pattern of SELECTORS.PATTERNS) {
    const label = el('label', 'opt');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!settings.declutter[pattern.id];
    box.addEventListener('change', () => {
      settings.declutter[pattern.id] = box.checked;
      save();
    });
    const span = el('span');
    span.append(el('strong', null, pattern.label), el('small', null, pattern.note));
    label.append(box, span);
    host.append(label);
  }
}

/* ------------------------------------------------------------ does it work */

let waitingForCheck = 0;

/**
 * Say what was measured, in terms of what the reader loses if it failed.
 *
 * Four states rather than two. An earlier version called it working as soon
 * as a single dispatch landed, which is exactly the false confidence this
 * panel exists to prevent.
 */
function renderVerdict(health) {
  const box = document.getElementById('verdict');
  box.replaceChildren();
  box.className = 'verdict';

  const attempts = (health && health.attempts) || 0;
  const accepted = (health && health.accepted) || 0;

  if (health && health.probe === 'unreachable') {
    box.append(el('b', null, 'No open Figma file to check in.'));
    box.append(document.createTextNode('Open a Figma file in another tab, then check again.'));
    return;
  }
  if (!attempts) {
    box.append(el('b', null, 'Not checked yet.'));
    box.append(document.createTextNode(
      'Use a moved shortcut, or press the button below with a Figma file open.'));
    return;
  }

  if (accepted === attempts) {
    box.classList.add('good');
    box.append(el('b', null, 'Working.'));
    box.append(document.createTextNode(
      'The moved shortcuts do what they say. Checked ' + attempts +
      (attempts === 1 ? ' time, and it landed.' : ' times, and all of them landed.')));
    return;
  }

  if (accepted === 0) {
    box.classList.add('bad');
    box.append(el('b', null, 'Not working on this machine.'));
    box.append(document.createTextNode(
      'Figma is ignoring the keypresses we send, so F2 will not rename and ' +
      KEYMAP.label('Mod+Alt+F') + ' will not open search. Nothing else is affected: ' +
      'every chord handed back to the browser still works, and each moved command ' +
      'still has its own way in. Double-click a layer name to rename, and ' +
      KEYMAP.label('Mod+/') + ' to search.'));
    return;
  }

  box.classList.add('mixed');
  box.append(el('b', null, 'Mostly working.'));
  box.append(document.createTextNode(
    accepted + ' of ' + attempts + ' presses landed. If a moved shortcut ever does ' +
    'nothing, use the alternative listed beside it.'));
}

function loadHealth() {
  try {
    chrome.storage.local.get('health', (data) => {
      if (chrome.runtime.lastError) return;
      renderVerdict(data && data.health);
    });
  } catch (_) { /* storage is gone; the panel simply stays as it is */ }
}

/**
 * Ask a live content script to try one keystroke and report back.
 *
 * The options page has no content script of its own, so the request goes
 * through storage and the answer comes back the same way. If nothing answers,
 * there is no Figma file open to answer, which is worth saying plainly rather
 * than leaving the button looking broken.
 */
function checkNow() {
  const button = document.getElementById('check');
  button.disabled = true;
  button.textContent = 'Checking…';
  waitingForCheck = Date.now();

  try {
    chrome.storage.local.set({ selfTest: waitingForCheck });
  } catch (_) { /* handled by the timeout below */ }

  setTimeout(() => {
    button.disabled = false;
    button.textContent = 'Check again';
    if (waitingForCheck) {
      waitingForCheck = 0;
      renderVerdict({ probe: 'unreachable' });
    }
  }, 2000);
}

/* -------------------------------------------------------------------- wire */

function reflect() {
  const enabled = settings.keymap.enabled;
  document.getElementById('keymap-enabled').checked = enabled;
  document.getElementById('switch-state').textContent = enabled ? 'On' : 'Off';

  // Dimming a control that still works is worse than not dimming it. `inert`
  // takes the whole subtree out of focus order and out of pointer events, so
  // what looks unavailable actually is.
  const detail = document.getElementById('rules-detail');
  detail.inert = !enabled;
  detail.style.opacity = enabled ? '' : '.55';

  for (const radio of document.querySelectorAll('input[name="scroll"]')) {
    radio.checked = radio.value === settings.canvas.scroll;
  }
  document.getElementById('right-click').checked = settings.canvas.rightClick;
  document.getElementById('middle-click').checked = settings.canvas.middleClickPan;
}

function renderAll() {
  reflect();
  renderLedger();
  renderRules();
  renderKeeps();
  renderDeclutter();
}

function init() {
  if (new URLSearchParams(location.search).has('welcome')) {
    document.getElementById('welcome').hidden = false;
  }
  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  document.getElementById('keymap-enabled').addEventListener('change', (e) => {
    settings.keymap.enabled = e.target.checked;
    save();
    reflect();
    renderLedger();
    renderCount();
  });

  for (const radio of document.querySelectorAll('input[name="scroll"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      settings.canvas.scroll = radio.value;
      save();
    });
  }
  document.getElementById('right-click').addEventListener('change', (e) => {
    settings.canvas.rightClick = e.target.checked;
    save();
    renderLedger();
  });
  document.getElementById('middle-click').addEventListener('change', (e) => {
    settings.canvas.middleClickPan = e.target.checked;
    save();
  });

  document.getElementById('check').addEventListener('click', checkNow);

  document.getElementById('reset').addEventListener('click', () => {
    chrome.storage.sync.clear(() => {
      // "everything" would have to include the counters, and it did not.
      chrome.storage.local.remove(['health', 'selfTest'], () => {
        settings = SETTINGS.merge(null);
        renderAll();
        renderVerdict(null);
      });
    });
  });

  SETTINGS.load((loaded) => { settings = loaded; renderAll(); });
  loadHealth();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.health) {
      waitingForCheck = 0;
      const button = document.getElementById('check');
      button.disabled = false;
      button.textContent = 'Check again';
      renderVerdict(changes.health.newValue);
    }
    if (area === 'sync') SETTINGS.load((loaded) => { settings = loaded; renderAll(); });
  });
}

document.addEventListener('DOMContentLoaded', init);
