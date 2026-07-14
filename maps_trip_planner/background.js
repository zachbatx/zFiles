// Minimal service worker. The on-map overlay is a content script running in
// the Google Maps page context, which can't open an extension page directly
// (a web page isn't allowed to navigate to chrome-extension:// URLs). So the
// overlay sends a message here and we open the tab with the extension's own
// privileges.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "openPlanner") {
    chrome.tabs.create({ url: chrome.runtime.getURL("planner.html" + (msg.query || "")) });
  }
});
