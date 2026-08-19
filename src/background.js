/**
 * Service worker. Deliberately almost empty.
 *
 * Everything that matters happens in the content script, which the manifest
 * injects directly -- there is no message broker, no state to keep warm and
 * nothing that needs the worker alive. MV3 will shut it down within seconds
 * and that is the intended behaviour, not a limitation being worked around.
 *
 * The one job worth having a worker for is the first run. A manifest-declared
 * content script is not injected into tabs that were already open when the
 * extension installed, so a Figma tab from before the install is running
 * without it, in a way that looks exactly like the extension not working.
 * Opening the options page once gives that fact somewhere to be said.
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html?welcome=1') });
  }
});
