/**
 * The popup: what your keys do right now, and the one switch that governs it.
 *
 * The switch is labelled, because it controls the keymap and nothing else.
 * Unlabelled beside the product name it reads as an off switch for the whole
 * extension, and somebody who flips it and still sees a hidden banner would
 * be right to file that as a bug.
 */

'use strict';

const SETTINGS = globalThis.MM_SETTINGS;
const KEYMAP = globalThis.MM_KEYMAP;

let settings = SETTINGS.merge(null);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function cap(chord) {
  return el('span', 'cap', KEYMAP.label(chord));
}

function render() {
  const enabled = settings.keymap.enabled;
  document.getElementById('keymap-enabled').checked = enabled;
  document.getElementById('state').textContent =
    enabled ? 'Keyboard only. Mouse and banners are separate.' : 'Off. Figma gets every chord.';

  const host = document.getElementById('ledger');
  host.replaceChildren();

  if (!enabled) {
    host.append(el('p', 'empty', 'Every chord goes to Figma, including the ones the browser wanted.'));
    return;
  }

  const on = SETTINGS.activeRules(settings);
  // The chord that can destroy work leads, whatever order the table is in.
  const shown = KEYMAP.RULES.filter((r) => on.has(r.id))
    .sort((a, b) => Number(!!b.destructive) - Number(!!a.destructive));

  for (const rule of shown) {
    const row = el('div', 'claim to-browser' + (rule.destructive ? ' is-danger' : ''));
    row.append(cap(rule.chord));
    row.append(el('div', 'claim-gets', rule.browser));
    const then = el('div', 'claim-then');
    if (rule.figma && rule.rehome) {
      then.append(document.createTextNode(rule.figma + ' is now '));
      then.append(cap(rule.rehome.chord));
    } else {
      then.append(document.createTextNode(
        rule.figma ? 'Figma used this for ' + rule.figma + '.'
          : rule.bindsNothing ? 'Figma binds nothing here.'
            : 'Unconfirmed what Figma does here.'));
    }
    row.append(then);
    host.append(row);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('keymap-enabled').addEventListener('change', (e) => {
    settings.keymap.enabled = e.target.checked;
    try {
      const done = chrome.storage.sync.set(settings);
      if (done && typeof done.catch === 'function') done.catch(() => {});
    } catch (_) { /* nothing useful to do from a popup */ }
    render();
  });
  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  SETTINGS.load((loaded) => { settings = loaded; render(); });
});
