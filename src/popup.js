/**
 * The popup: the single setting, and a sentence saying what it is currently
 * doing. Anything that needs explaining belongs in the options page, which is
 * one click away.
 */

'use strict';

const SETTINGS = globalThis.MM_SETTINGS;
const KEYMAP = globalThis.MM_KEYMAP;

let settings = SETTINGS.merge(null);

function describe() {
  const state = document.getElementById('state');
  if (!settings.keymap.enabled) {
    state.textContent = 'Off. Figma receives every keystroke, including the ones the browser wanted.';
    return;
  }
  const count = (settings.keymap.rules || KEYMAP.defaultRuleIds()).length;
  state.textContent = count + (count === 1 ? ' chord is' : ' chords are') +
    ' being handed back to the browser on figma.com.';
}

function reflect() {
  document.getElementById('keymap-enabled').checked = settings.keymap.enabled;
  describe();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('keymap-enabled').addEventListener('change', (e) => {
    settings.keymap.enabled = e.target.checked;
    chrome.storage.sync.set(settings);
    describe();
  });
  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  SETTINGS.load((loaded) => { settings = loaded; reflect(); });
});
