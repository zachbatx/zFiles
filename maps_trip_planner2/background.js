import { fetchDirectionsLegsDirect } from "./lib/route.js";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "openPlanner") {
    chrome.tabs.create({ url: chrome.runtime.getURL("planner.html" + (msg.query || "")) });
  } else if (msg && msg.type === "fetchDirections") {
    fetchDirectionsLegsDirect(msg.stops, msg.apiKey, msg.prefs)
      .then((result) => sendResponse({ result }))
      .catch((error) => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
});
