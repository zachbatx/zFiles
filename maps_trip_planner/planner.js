import {
  getLocations,
  removeLocation,
  getApiKey,
  setApiKey,
  getTrips,
  saveTrips,
  getActiveTripId,
  setActiveTripId,
  createTrip,
  updateTrip,
  deleteTrip,
  addStopToTrip,
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

const tripSelect = document.getElementById("trip-select");
const newTripBtn = document.getElementById("new-trip-btn");
const editTripBtn = document.getElementById("edit-trip-btn");
const deleteTripBtn = document.getElementById("delete-trip-btn");
const tripForm = document.getElementById("trip-form");
const tfTitle = document.getElementById("tf-title");
const tfSummary = document.getElementById("tf-summary");
const tfStart = document.getElementById("tf-start");
const tfEnd = document.getElementById("tf-end");
const tfCancel = document.getElementById("tf-cancel");
const tfSave = document.getElementById("tf-save");
const tripMeta = document.getElementById("trip-meta");

let locations = [];
let trips = [];
let activeId = "";
let apiKey = "";
let formMode = null;

const norm = (s) => (s || "").trim().toLowerCase();
const activeTrip = () => trips.find((t) => t.id === activeId) || null;

function inActiveTrip(name) {
  const t = activeTrip();
  return !!t && t.stops.some((s) => norm(s.name) === norm(name));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
    libraryList.innerHTML =
      '<p class="hint">No saved places yet. Use the extension popup or the on-map overlay to scrape or import a list.</p>';
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
      const already = inActiveTrip(place.name);
      addBtn.textContent = already ? "Added" : "Add";
      addBtn.disabled = already;
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

function renderTripBar() {
  tripSelect.innerHTML = "";
  if (trips.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No trips yet — create one";
    tripSelect.appendChild(opt);
  }
  for (const t of trips) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.title || "Untitled trip";
    if (t.id === activeId) opt.selected = true;
    tripSelect.appendChild(opt);
  }

  const t = activeTrip();
  editTripBtn.disabled = !t;
  deleteTripBtn.disabled = !t;

  if (t && (t.summary || t.startDate || t.endDate)) {
    const dates = t.startDate || t.endDate ? `${t.startDate || "…"} → ${t.endDate || "…"}` : "";
    tripMeta.innerHTML =
      `<div class="mt-title">${escapeHtml(t.title || "")}</div>` +
      (dates ? `<div>${escapeHtml(dates)}</div>` : "") +
      (t.summary ? `<div>${escapeHtml(t.summary)}</div>` : "");
    tripMeta.classList.remove("hidden");
  } else {
    tripMeta.classList.add("hidden");
  }
}

function renderTrip() {
  const t = activeTrip();
  tripList.innerHTML = "";
  if (!t) {
    tripList.innerHTML = '<p class="hint">Create or pick a trip to add stops.</p>';
    return;
  }
  if (t.stops.length === 0) {
    tripList.innerHTML = '<p class="hint">Add places from the left to build your route.</p>';
    return;
  }

  t.stops.forEach((stop, i) => {
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
    downBtn.disabled = i === t.stops.length - 1;
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

async function reloadTrips() {
  trips = await getTrips();
  activeId = await getActiveTripId();
  if (!activeTrip() && trips.length) {
    activeId = trips[0].id;
    await setActiveTripId(activeId);
  }
  renderTripBar();
  renderTrip();
  renderLibrary();
}

async function addStop(place) {
  const stop = { name: place.name, listName: place.listName, addressHint: place.addressHint || "" };
  if (place.lat != null) { stop.lat = place.lat; stop.lng = place.lng; }
  const { trips: updated, tripId } = await addStopToTrip(activeId, stop);
  trips = updated;
  activeId = tripId;
  renderTripBar();
  renderTrip();
  renderLibrary();
}

async function moveStop(index, delta) {
  const t = activeTrip();
  const target = index + delta;
  if (!t || target < 0 || target >= t.stops.length) return;
  [t.stops[index], t.stops[target]] = [t.stops[target], t.stops[index]];
  await saveTrips(trips);
  renderTrip();
}

async function removeStop(index) {
  const t = activeTrip();
  if (!t) return;
  t.stops.splice(index, 1);
  await saveTrips(trips);
  renderTrip();
  renderLibrary();
}

async function deletePlace(place) {
  locations = await removeLocation(place.listName, place.name);
  renderLibrary();
}

// ---- Trip form (create / edit) ------------------------------------------
function openForm(mode) {
  formMode = mode;
  const t = activeTrip();
  if (mode === "edit" && t) {
    tfTitle.value = t.title || "";
    tfSummary.value = t.summary || "";
    tfStart.value = t.startDate || "";
    tfEnd.value = t.endDate || "";
    tfSave.textContent = "Save changes";
  } else {
    tfTitle.value = "";
    tfSummary.value = "";
    tfStart.value = "";
    tfEnd.value = "";
    tfSave.textContent = "Create trip";
  }
  tripForm.classList.remove("hidden");
}

function closeForm() {
  formMode = null;
  tripForm.classList.add("hidden");
}

async function saveForm() {
  const meta = {
    title: tfTitle.value.trim() || "Untitled trip",
    summary: tfSummary.value.trim(),
    startDate: tfStart.value,
    endDate: tfEnd.value,
  };
  if (formMode === "edit" && activeTrip()) {
    await updateTrip(activeId, meta);
  } else {
    const t = await createTrip(meta);
    activeId = t.id;
  }
  await reloadTrips();
  closeForm();
}

// ---- Route --------------------------------------------------------------
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
  const t = activeTrip();
  const stops = t ? t.stops : [];
  if (stops.length < 2) {
    resetRoutePanel('Add at least two stops, then click "Build route".');
    return;
  }

  routeEmpty.classList.add("hidden");
  const directionsUrl = buildDirectionsUrl(stops);
  openInMapsLink.href = directionsUrl;
  openInMapsLink.classList.remove("hidden");
  routeLegs.innerHTML = "";

  if (!apiKey) {
    routeEmbed.classList.add("hidden");
    routeLegs.innerHTML = '<p class="hint">Add an API key above to see an embedded map and per-leg distances.</p>';
    return;
  }

  routeEmbed.src = buildEmbedUrl(stops, apiKey);
  routeEmbed.classList.remove("hidden");

  routeLegs.innerHTML = '<p class="hint">Loading distances…</p>';
  try {
    const result = await fetchDirectionsLegs(stops, apiKey);
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

// ---- Wiring -------------------------------------------------------------
settingsToggle.addEventListener("click", () => settingsPanel.classList.toggle("hidden"));

saveKeyBtn.addEventListener("click", async () => {
  apiKey = apiKeyInput.value.trim();
  await setApiKey(apiKey);
  settingsPanel.classList.add("hidden");
});

searchInput.addEventListener("input", renderLibrary);

tripSelect.addEventListener("change", async () => {
  activeId = tripSelect.value;
  await setActiveTripId(activeId);
  closeForm();
  renderTripBar();
  renderTrip();
  renderLibrary();
  resetRoutePanel('Add at least two stops, then click "Build route".');
});

newTripBtn.addEventListener("click", () => openForm("create"));
editTripBtn.addEventListener("click", () => openForm("edit"));
tfCancel.addEventListener("click", closeForm);
tfSave.addEventListener("click", saveForm);

deleteTripBtn.addEventListener("click", async () => {
  const t = activeTrip();
  if (!t) return;
  trips = await deleteTrip(t.id);
  activeId = await getActiveTripId();
  renderTripBar();
  renderTrip();
  renderLibrary();
  resetRoutePanel('Add at least two stops, then click "Build route".');
});

clearTripBtn.addEventListener("click", async () => {
  const t = activeTrip();
  if (!t) return;
  t.stops = [];
  await saveTrips(trips);
  renderTrip();
  renderLibrary();
  resetRoutePanel('Add at least two stops, then click "Build route".');
});

buildRouteBtn.addEventListener("click", buildRoute);

async function init() {
  [locations, apiKey] = await Promise.all([getLocations(), getApiKey()]);
  apiKeyInput.value = apiKey;
  await reloadTrips();
}

init();
