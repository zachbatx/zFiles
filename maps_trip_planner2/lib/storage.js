// Shared chrome.storage.local helpers used by popup.js and planner.js.

const LOCATIONS_KEY = "locations";
const API_KEY_KEY = "googleMapsApiKey";
const TRIP_KEY = "currentTrip"; // legacy single-trip key, kept for migration
const TRIPS_KEY = "trips";
const ACTIVE_TRIP_KEY = "activeTripId";

// The list a place saved from a map click lands in.
export const MAP_PICKS_LIST = "Map picks";

function newId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

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

// ---- Trips (multiple, each with metadata + ordered stops) ----------------
//
// A trip is: { id, title, summary, startDate, endDate, stops: [stop, ...] }
// A stop is: { name, listName, addressHint, lat?, lng? }
//
// getTrips() lazily migrates the old single-trip `currentTrip` array into a
// first trip the first time it's called, so existing data isn't lost.
export async function getTrips() {
  const { [TRIPS_KEY]: trips, [TRIP_KEY]: legacy } = await chrome.storage.local.get([
    TRIPS_KEY,
    TRIP_KEY,
  ]);
  if (Array.isArray(trips)) return trips;
  if (Array.isArray(legacy) && legacy.length) {
    const migrated = [
      {
        id: newId(),
        title: "My Trip",
        summary: "",
        startDate: "",
        endDate: "",
        stops: legacy,
        preferences: { travelMode: "DRIVING", avoidTolls: false, avoidHighways: false }
      },
    ];
    await chrome.storage.local.set({ [TRIPS_KEY]: migrated, [ACTIVE_TRIP_KEY]: migrated[0].id });
    return migrated;
  }
  return [];
}

export async function saveTrips(trips) {
  await chrome.storage.local.set({ [TRIPS_KEY]: trips });
}

export async function getActiveTripId() {
  const { [ACTIVE_TRIP_KEY]: id } = await chrome.storage.local.get(ACTIVE_TRIP_KEY);
  return id || "";
}

export async function setActiveTripId(id) {
  await chrome.storage.local.set({ [ACTIVE_TRIP_KEY]: id });
}

export async function createTrip(meta = {}) {
  const trips = await getTrips();
  const trip = {
    id: newId(),
    title: meta.title || "Untitled trip",
    summary: meta.summary || "",
    startDate: meta.startDate || "",
    endDate: meta.endDate || "",
    stops: [],
    preferences: {
      travelMode: meta.travelMode || "DRIVING",
      avoidTolls: !!meta.avoidTolls,
      avoidHighways: !!meta.avoidHighways
    }
  };
  trips.push(trip);
  await saveTrips(trips);
  await setActiveTripId(trip.id);
  return trip;
}

export async function updateTrip(id, patch) {
  const trips = await getTrips();
  const trip = trips.find((t) => t.id === id);
  if (!trip) return null;
  Object.assign(trip, patch);
  await saveTrips(trips);
  return trip;
}

export async function deleteTrip(id) {
  let trips = await getTrips();
  trips = trips.filter((t) => t.id !== id);
  await saveTrips(trips);
  if ((await getActiveTripId()) === id) {
    await setActiveTripId(trips[0] ? trips[0].id : "");
  }
  return trips;
}

// Patches a single stop in a trip (name, date, time, notes, addressHint, …).
export async function updateStopInTrip(tripId, index, patch) {
  const trips = await getTrips();
  const trip = trips.find((t) => t.id === tripId);
  if (!trip || !trip.stops[index]) return trips;
  Object.assign(trip.stops[index], patch);
  await saveTrips(trips);
  return trips;
}

// Adds a stop to a trip (creating a default trip if none is active yet),
// de-duping by stop name. Returns { trips, tripId }.
export async function addStopToTrip(tripId, stop) {
  const trips = await getTrips();
  let trip = trips.find((t) => t.id === tripId);
  if (!trip) {
    trip = {
      id: newId(),
      title: "My Trip",
      summary: "",
      startDate: "",
      endDate: "",
      stops: [],
      preferences: { travelMode: "DRIVING", avoidTolls: false, avoidHighways: false }
    };
    trips.push(trip);
    await setActiveTripId(trip.id);
  }
  if (!trip.stops.some((s) => s.name === stop.name)) {
    trip.stops.push(stop);
  }
  await saveTrips(trips);
  return { trips, tripId: trip.id };
}
