/**
 * The options page.
 *
 * Built with DOM calls rather than innerHTML throughout. None of the strings
 * here are untrusted, so this is not a live injection risk, but an extension
 * page is exactly the wrong place to establish the habit of parsing markup at
 * runtime, and an options page is small enough that there is no excuse.
 *
 * The page is generated from the same keymap.js the content script uses, so
 * the two cannot drift: a chord that is not in the table is not on the screen,
 * and a rule shown here is by construction the rule being enforced.
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

function kbd(chord) {
  return el('kbd', null, KEYMAP.label(chord));
}

function save() {
  chrome.storage.sync.set(settings);
}

/* ------------------------------------------------------------------- rules */

function renderRules() {
  const host = document.getElementById('rules');
  host.replaceChildren();
  const enabled = new Set(settings.keymap.rules || KEYMAP.defaultRuleIds());

  for (const rule of KEYMAP.RULES) {
    const row = el('div', 'rule');

    const toggleWrap = el('label', 'rule-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = enabled.has(rule.id);
    box.addEventListener('change', () => {
      const next = new Set(settings.keymap.rules || KEYMAP.defaultRuleIds());
      if (box.checked) next.add(rule.id); else next.delete(rule.id);
      settings.keymap.rules = [...next];
      save();
    });
    toggleWrap.append(box);

    const line = el('div', 'rule-line');
    line.append(kbd(rule.chord));
    line.append(el('span', 'rule-browser', rule.browser));
    if (rule.destructive) line.append(el('span', 'tag tag-destructive', 'destructive'));
    if (rule.rehome && rule.rehome.via === 'alias') {
      line.append(el('span', 'tag tag-native', 'no emulation'));
    }

    // What Figma loses, and where it goes. Only stated where the binding was
    // actually confirmed: an unchecked claim in this column would be a fact
    // the reader has no way to test.
    const detail = el('div', 'rule-figma');
    if (rule.figma) {
      detail.append(document.createTextNode('Figma uses this for ' + rule.figma + '. '));
    } else {
      detail.append(document.createTextNode('Whatever Figma binds here is handed back to the browser. '));
    }
    if (rule.rehome) {
      detail.append(document.createTextNode('Moved to '));
      detail.append(kbd(rule.rehome.chord));
      detail.append(document.createTextNode('.'));
    }

    row.append(toggleWrap, line, detail, el('div', 'rule-why', rule.why));
    host.append(row);
  }

  document.getElementById('rule-count').textContent =
    enabled.size + ' of ' + KEYMAP.RULES.length + ' on';
}

function renderKeeps() {
  const host = document.getElementById('keeps');
  host.replaceChildren();
  for (const keep of KEYMAP.KEEPS) {
    const row = el('div', 'rule');
    row.append(el('div', 'rule-toggle'));
    const line = el('div', 'rule-line');
    line.append(kbd(keep.chord));
    line.append(el('span', 'rule-browser', keep.figma));
    row.append(line);
    row.append(el('div', 'rule-figma', 'The browser would use this for ' + keep.browser + '.'));
    row.append(el('div', 'rule-why', keep.why));
    host.append(row);
  }
}

function renderReserved() {
  const host = document.getElementById('reserved');
  host.replaceChildren();
  for (const chord of KEYMAP.RESERVED) host.append(kbd(chord));
}

/* --------------------------------------------------------------- declutter */

function renderDeclutter() {
  const host = document.getElementById('declutter');
  host.replaceChildren();
  for (const pattern of SELECTORS.PATTERNS) {
    const label = el('label', 'check');
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

/* ------------------------------------------------------------- diagnostics */

function renderHealth(health) {
  const host = document.getElementById('health');
  host.replaceChildren();

  if (!health || !health.attempts) {
    host.textContent =
      'Nothing measured yet. The counter fills in once a rehomed chord is used.';
    return;
  }

  const { attempts, accepted, lastChord } = health;
  const works = accepted > 0;

  const verdict = el('span', works ? 'verdict-good' : 'verdict-bad',
    works ? 'Figma accepts synthesised keystrokes.' : 'Figma appears to ignore synthesised keystrokes.');
  host.append(verdict);
  host.append(document.createTextNode(' ' + accepted + ' of ' + attempts +
    ' rehomed presses were acted on' + (lastChord ? ' (last: ' + KEYMAP.label(lastChord) + ')' : '') + '. '));

  if (!works) {
    host.append(document.createTextNode(
      'Reclaiming still works, because it needs nothing from Figma: those chords go to the browser either way. ' +
      'Only the moved actions are affected, and each has another route in, listed beside it above.'));
  }
}

function loadHealth() {
  chrome.storage.local.get('health', (data) => {
    if (chrome.runtime.lastError) return;
    renderHealth(data && data.health);
  });
}

/* -------------------------------------------------------------------- wire */

function reflect() {
  const master = document.getElementById('keymap-enabled');
  master.checked = settings.keymap.enabled;
  master.closest('.card').querySelector('#rules').classList.toggle('is-off', !settings.keymap.enabled);
  document.querySelector('.switch-label').textContent = settings.keymap.enabled ? 'On' : 'Off';

  for (const radio of document.querySelectorAll('input[name="scroll"]')) {
    radio.checked = radio.value === settings.canvas.scroll;
  }
  document.getElementById('right-click').checked = settings.canvas.rightClick;
  document.getElementById('middle-click').checked = settings.canvas.middleClickPan;
}

function init() {
  if (new URLSearchParams(location.search).has('welcome')) {
    document.getElementById('welcome').hidden = false;
  }
  document.getElementById('version').textContent = 'Version ' + chrome.runtime.getManifest().version;

  document.getElementById('keymap-enabled').addEventListener('change', (e) => {
    settings.keymap.enabled = e.target.checked;
    save();
    reflect();
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
  });
  document.getElementById('middle-click').addEventListener('change', (e) => {
    settings.canvas.middleClickPan = e.target.checked;
    save();
  });

  document.getElementById('reset').addEventListener('click', () => {
    chrome.storage.sync.clear(() => {
      settings = SETTINGS.merge(null);
      reflect();
      renderRules();
      renderDeclutter();
    });
  });

  SETTINGS.load((loaded) => {
    settings = loaded;
    reflect();
    renderRules();
    renderKeeps();
    renderReserved();
    renderDeclutter();
  });

  loadHealth();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.health) renderHealth(changes.health.newValue);
  });
}

document.addEventListener('DOMContentLoaded', init);
