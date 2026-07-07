import {
  getLocations,
  removeLocation,
  getApiKey,
  setApiKey,
  getCurrentTrip,
  setCurrentTrip,
} from "./lib/storage.js";
import { buildDirectionsUrl, buildEmbedUrl, fetchDirectionsLegs } from "./lib/route.js";

const libraryList = document.getElementById("library-list");
const tripList = document.getElementById("trip-list");
const searchInput = document.getElementById("search-input");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const apiKeyInput = document.getElementById("api-key-input");
const saveKeyBtn = document.getElementById("save-key-btn");
const clearTripBtn = document.getElementById("clear-trip-btn");
const buildRouteBtn = document.getElementById("build-route-btn");
const routeEmpty = document.getElementById("route-empty");
const openInMapsLink = document.getElementById("open-in-maps-link");
const routeEmbed = document.getElementById("route-embed");
const routeLegs = document.getElementById("route-legs");

let locations = [];
let trip = [];
let apiKey = "";

function isInTrip(place) {
  return trip.some((s) => s.listName === place.listName && s.name === place.name);
}

function renderLibrary() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = locations.filter((p) => !query || p.name.toLowerCase().includes(query));

  const groups = new Map();
  for (const place of filtered) {
    if (!groups.has(place.listName)) groups.set(place.listName, []);
    groups.get(place.listName).push(place);
  }

  libraryList.innerHTML = "";
  if (groups.size === 0) {
    libraryList.innerHTML = '<p class="hint">No saved places yet. Use the extension popup to scrape or import a list.</p>';
    return;
  }

  for (const [listName, places] of groups) {
    const title = document.createElement("div");
    title.className = "list-group-title";
    title.textContent = `${listName} (${places.length})`;
    libraryList.appendChild(title);

    for (const place of places) {
      const row = document.createElement("div");
      row.className = "place-row";

      const info = document.createElement("div");
      info.className = "place-info";
      info.innerHTML = `<div class="place-name">${escapeHtml(place.name)}</div><div class="place-type">${escapeHtml(place.type || "")}</div>`;

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "4px";

      const addBtn = document.createElement("button");
      addBtn.className = "row-btn";
      addBtn.textContent = isInTrip(place) ? "Added" : "Add";
      addBtn.disabled = isInTrip(place);
      addBtn.addEventListener("click", () => addStop(place));

      const removeBtn = document.createElement("button");
      removeBtn.className = "row-btn";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove from saved places";
      removeBtn.addEventListener("click", () => deletePlace(place));

      actions.append(addBtn, removeBtn);
      row.append(info, actions);
      libraryList.appendChild(row);
    }
  }
}

function renderTrip() {
  tripList.innerHTML = "";
  if (trip.length === 0) {
    tripList.innerHTML = '<p class="hint">Add places from the left to build your route.</p>';
    return;
  }

  trip.forEach((stop, i) => {
    const row = document.createElement("div");
    row.className = "stop-row";

    const index = document.createElement("div");
    index.className = "stop-index";
    index.textContent = String(i + 1);

    const name = document.createElement("div");
    name.className = "stop-name";
    name.textContent = stop.name;
    name.title = stop.name;

    const controls = document.createElement("div");
    controls.className = "stop-controls";

    const upBtn = document.createElement("button");
    upBtn.className = "row-btn";
    upBtn.textContent = "↑";
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", () => moveStop(i, -1));

    const downBtn = document.createElement("button");
    downBtn.className = "row-btn";
    downBtn.textContent = "↓";
    downBtn.disabled = i === trip.length - 1;
    downBtn.addEventListener("click", () => moveStop(i, 1));

    const removeBtn = document.createElement("button");
    removeBtn.className = "row-btn";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeStop(i));

    controls.append(upBtn, downBtn, removeBtn);
    row.append(index, name, controls);
    tripList.appendChild(row);
  });
}

async function addStop(place) {
  if (isInTrip(place)) return;
  trip = [...trip, { name: place.name, listName: place.listName, addressHint: place.addressHint || "" }];
  await setCurrentTrip(trip);
  renderLibrary();
  renderTrip();
}

async function moveStop(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= trip.length) return;
  const copy = [...trip];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  trip = copy;
  await setCurrentTrip(trip);
  renderTrip();
}

async function removeStop(index) {
  trip = trip.filter((_, i) => i !== index);
  await setCurrentTrip(trip);
  renderLibrary();
  renderTrip();
}

async function deletePlace(place) {
  locations = await removeLocation(place.listName, place.name);
  if (isInTrip(place)) await removeStop(trip.findIndex((s) => s.listName === place.listName && s.name === place.name));
  renderLibrary();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function resetRoutePanel(message) {
  routeEmpty.textContent = message;
  routeEmpty.classList.remove("hidden");
  routeEmpty.classList.remove("error");
  openInMapsLink.classList.add("hidden");
  routeEmbed.classList.add("hidden");
  routeEmbed.src = "";
  routeLegs.innerHTML = "";
}

async function buildRoute() {
  if (trip.length < 2) {
    resetRoutePanel('Add at least two stops, then click "Build route".');
    return;
  }

  routeEmpty.classList.add("hidden");
  const directionsUrl = buildDirectionsUrl(trip);
  openInMapsLink.href = directionsUrl;
  openInMapsLink.classList.remove("hidden");
  routeLegs.innerHTML = "";

  if (!apiKey) {
    routeEmbed.classList.add("hidden");
    routeLegs.innerHTML = '<p class="hint">Add an API key above to see an embedded map and per-leg distances.</p>';
    return;
  }

  routeEmbed.src = buildEmbedUrl(trip, apiKey);
  routeEmbed.classList.remove("hidden");

  routeLegs.innerHTML = '<p class="hint">Loading distances…</p>';
  try {
    const result = await fetchDirectionsLegs(trip, apiKey);
    routeLegs.innerHTML = "";
    for (const leg of result.legs) {
      const row = document.createElement("div");
      row.className = "leg-row";
      row.innerHTML = `<span>${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}</span><span>${leg.distanceText} · ${leg.durationText}</span>`;
      routeLegs.appendChild(row);
    }
    const totals = document.createElement("div");
    totals.className = "leg-totals";
    totals.textContent = `Total: ${result.totalMiles} mi · ${result.totalHours} hr driving`;
    routeLegs.appendChild(totals);
  } catch (err) {
    routeLegs.innerHTML = `<p class="error">Distances unavailable: ${escapeHtml(err.message)}. The map above still shows your route.</p>`;
  }
}

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

saveKeyBtn.addEventListener("click", async () => {
  apiKey = apiKeyInput.value.trim();
  await setApiKey(apiKey);
  settingsPanel.classList.add("hidden");
});

searchInput.addEventListener("input", renderLibrary);

clearTripBtn.addEventListener("click", async () => {
  trip = [];
  await setCurrentTrip(trip);
  renderLibrary();
  renderTrip();
  resetRoutePanel('Add at least two stops, then click "Build route".');
});

buildRouteBtn.addEventListener("click", buildRoute);

async function init() {
  [locations, trip, apiKey] = await Promise.all([getLocations(), getCurrentTrip(), getApiKey()]);
  apiKeyInput.value = apiKey;
  renderLibrary();
  renderTrip();
}

init();
