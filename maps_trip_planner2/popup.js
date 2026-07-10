import { mergeLocations, getLocations } from "./lib/storage.js";
import { scrapePageForSavedPlaces, parseImportedHtml, parseImportedJson } from "./lib/scraper.js";

const scrapeBtn = document.getElementById("scrape-btn");
const scrapeHint = document.getElementById("scrape-hint");
const importInput = document.getElementById("import-input");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("location-count");
const openPlannerBtn = document.getElementById("open-planner-btn");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#d93025" : "#188038";
}

async function refreshCount() {
  const locations = await getLocations();
  countEl.textContent = `${locations.length} location${locations.length === 1 ? "" : "s"} saved`;
}

async function getActiveMapsTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.startsWith("https://www.google.com/maps")) return tab;
  return null;
}

async function init() {
  const tab = await getActiveMapsTab();
  if (tab) {
    scrapeBtn.disabled = false;
    scrapeHint.textContent = "Open a saved list's panel on this tab, then scrape.";
  } else {
    scrapeBtn.disabled = true;
    scrapeHint.textContent = "Open google.com/maps, open a saved list, then click the extension.";
  }
  await refreshCount();
}

scrapeBtn.addEventListener("click", async () => {
  const tab = await getActiveMapsTab();
  if (!tab) return;
  scrapeBtn.disabled = true;
  setStatus("Scrolling and reading the list…");
  try {
    const [{ result: places }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePageForSavedPlaces,
    });
    if (!places || places.length === 0) {
      setStatus("No places found. Make sure a saved list is open in the panel.", true);
    } else {
      await mergeLocations(places);
      setStatus(`Saved ${places.length} places from "${places[0].listName}".`);
      await refreshCount();
    }
  } catch (err) {
    setStatus(`Scrape failed: ${err.message}`, true);
  } finally {
    scrapeBtn.disabled = false;
  }
});

importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const isJson = file.name.toLowerCase().endsWith(".json");
    const places = isJson
      ? parseImportedJson(text)
      : parseImportedHtml(text, file.name.replace(/\.[^.]+$/, ""));
    if (places.length === 0) {
      setStatus("No places found in that file.", true);
    } else {
      await mergeLocations(places);
      setStatus(`Imported ${places.length} places from ${file.name}.`);
      await refreshCount();
    }
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, true);
  } finally {
    importInput.value = "";
  }
});

openPlannerBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("planner.html") });
});

init();
