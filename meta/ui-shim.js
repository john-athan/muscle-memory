/**
 * Enough of the extension APIs for the options page to render outside Chrome.
 *
 * The store screenshots show the real interface, not a mock-up of it, so they
 * are captured from src/options.html itself. That page needs chrome.storage,
 * which a file:// URL does not have. This supplies an empty profile, which is
 * the state a new install is in and therefore the honest thing to photograph.
 *
 * It is loaded only by meta/capture-ui.sh, never packed into the extension.
 */

'use strict';

const store = { sync: {}, local: {} };

function area(name) {
  return {
    get(keys, cb) { if (typeof keys === 'function') cb(store[name]); else cb({}); },
    set(v) { Object.assign(store[name], v); return Promise.resolve(); },
    remove(_k, cb) { if (cb) cb(); },
    clear(cb) { if (cb) cb(); },
  };
}

globalThis.chrome = {
  runtime: {
    id: 'capture',
    lastError: null,
    getManifest: () => ({ version: '1.0.0' }),
    getURL: (p) => p,
    openOptionsPage() {},
  },
  storage: { sync: area('sync'), local: area('local'), onChanged: { addListener() {} } },
};
