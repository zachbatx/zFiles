// Shared chrome.storage.local helpers used by popup.js and planner.js.

const LOCATIONS_KEY = "locations";
const API_KEY_KEY = "googleMapsApiKey";
const TRIP_KEY = "currentTrip";

export async function getLocations() {
  const { [LOCATIONS_KEY]: locations } = await chrome.storage.local.get(LOCATIONS_KEY);
  return locations || [];
}

export async function setLocations(locations) {
  await chrome.storage.local.set({ [LOCATIONS_KEY]: locations });
}

// Merge freshly scraped/imported places into storage, de-duping by
// (listName, name) so re-scraping the same list doesn't create duplicates.
export async function mergeLocations(newPlaces) {
  const existing = await getLocations();
  const key = (p) => `${p.listName}::${p.name}`;
  const byKey = new Map(existing.map((p) => [key(p), p]));
  for (const place of newPlaces) {
    byKey.set(key(place), { ...byKey.get(key(place)), ...place });
  }
  const merged = Array.from(byKey.values());
  await setLocations(merged);
  return merged;
}

export async function removeLocation(listName, name) {
  const existing = await getLocations();
  const filtered = existing.filter((p) => !(p.listName === listName && p.name === name));
  await setLocations(filtered);
  return filtered;
}

export async function getApiKey() {
  const { [API_KEY_KEY]: key } = await chrome.storage.local.get(API_KEY_KEY);
  return key || "";
}

export async function setApiKey(key) {
  await chrome.storage.local.set({ [API_KEY_KEY]: key });
}

export async function getCurrentTrip() {
  const { [TRIP_KEY]: trip } = await chrome.storage.local.get(TRIP_KEY);
  return trip || [];
}

export async function setCurrentTrip(stops) {
  await chrome.storage.local.set({ [TRIP_KEY]: stops });
}
