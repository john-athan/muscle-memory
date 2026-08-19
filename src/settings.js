/**
 * Settings: the defaults, and the one function that reads them.
 *
 * The defaults matter more than they usually would. A content script at
 * document_start has to register its key listener before Figma's bundle
 * registers its own, and chrome.storage is asynchronous -- awaiting it would
 * hand Figma the first two hundred milliseconds of every page load, which is
 * exactly the window in which someone reloads a file and starts pressing keys.
 *
 * So the listener goes on immediately using MM_DEFAULTS, and the stored
 * settings are folded in when they arrive. That is only correct because the
 * defaults are a compile-time constant both sides agree on, which is why this
 * file is shared by the content script and the options page rather than
 * duplicated.
 */

'use strict';

const MM_DEFAULTS = {
  keymap: {
    // The single setting. Off means the extension touches no keyboard event
    // at all -- not that it quietly keeps some of them.
    enabled: true,
    // Advanced. Which chords the browser gets back; see MM_RULES in keymap.js.
    rules: null, // null means "whatever keymap.js currently defaults to"
  },
  canvas: {
    // 'figma'  leave it alone
    // 'zoom'   wheel zooms, Shift+wheel pans -- what an external mouse expects
    // 'pan'    wheel pans, Mod+wheel zooms -- what a trackpad expects
    scroll: 'figma',
    middleClickPan: true,
    rightClick: true,
  },
  declutter: {
    desktopBanner: true,
    aiUpsell: true,
    whatsNew: true,
  },
};

/** Deep-merge stored values over the defaults, one level of nesting. */
function mmMerge(stored) {
  const out = {};
  for (const section of Object.keys(MM_DEFAULTS)) {
    out[section] = Object.assign({}, MM_DEFAULTS[section], (stored && stored[section]) || {});
  }
  return out;
}

/**
 * The set of active rule ids, given a settings object.
 *
 * Kept here rather than inline because three callers need to agree on what
 * "enabled" means, including the case where the master switch is off.
 */
function mmActiveRules(settings) {
  if (!settings.keymap.enabled) return new Set();
  const ids = settings.keymap.rules || MM_KEYMAP.defaultRuleIds();
  return new Set(ids);
}

function mmLoad(callback) {
  try {
    chrome.storage.sync.get(null, (stored) => {
      // A sync-storage read can fail when the profile has sync disabled, and
      // the failure arrives as lastError rather than an exception. Defaults
      // are a fine answer; a thrown error inside a storage callback is not.
      if (chrome.runtime.lastError) callback(mmMerge(null));
      else callback(mmMerge(stored));
    });
  } catch (_) {
    callback(mmMerge(null));
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.MM_DEFAULTS = MM_DEFAULTS;
  globalThis.MM_SETTINGS = { defaults: MM_DEFAULTS, merge: mmMerge, load: mmLoad, activeRules: mmActiveRules };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MM_DEFAULTS, mmMerge, mmActiveRules };
}
