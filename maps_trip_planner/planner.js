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
  updateStopInTrip,
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
const libraryToggle = document.getElementById("library-toggle");
const detailViewBtn = document.getElementById("detail-view-btn");
const itineraryEl = document.getElementById("itinerary");

let locations = [];
let trips = [];
let activeId = "";
let apiKey = "";
let formMode = null;
let editingStop = null;
let libCollapsed = false;
const collapsedGroups = new Set();

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
  const caret = libraryToggle.querySelector(".caret");
  if (caret) caret.textContent = libCollapsed ? "▸" : "▾";
  libraryList.classList.toggle("hidden", libCollapsed);
  searchInput.classList.toggle("hidden", libCollapsed);
  if (libCollapsed) return;

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
    const collapsed = collapsedGroups.has(listName);
    const title = document.createElement("div");
    title.className = "list-group-title toggle";
    title.innerHTML = `<span class="caret">${collapsed ? "▸" : "▾"}</span> ${escapeHtml(listName)} (${places.length})`;
    title.addEventListener("click", () => {
      if (collapsedGroups.has(listName)) collapsedGroups.delete(listName);
      else collapsedGroups.add(listName);
      renderLibrary();
    });
    libraryList.appendChild(title);
    if (collapsed) continue;

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
    if (editingStop === i) {
      tripList.appendChild(buildStopEditor(stop, i));
      return;
    }
    const row = document.createElement("div");
    row.className = "stop-row";

    const index = document.createElement("div");
    index.className = "stop-index";
    index.textContent = String(i + 1);

    const info = document.createElement("div");
    info.className = "stop-name";
    const sched = [stop.date, stop.time].filter(Boolean).join(" ");
    info.innerHTML =
      `<div>${escapeHtml(stop.name)}</div>` +
      (sched || stop.notes
        ? `<div class="stop-sub">${escapeHtml([sched, stop.notes].filter(Boolean).join(" · "))}</div>`
        : "");
    info.title = stop.name;

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

    const editBtn = document.createElement("button");
    editBtn.className = "row-btn";
    editBtn.textContent = "✎";
    editBtn.title = "Edit stop";
    editBtn.addEventListener("click", () => { editingStop = i; renderTrip(); });

    const removeBtn = document.createElement("button");
    removeBtn.className = "row-btn";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeStop(i));

    controls.append(upBtn, downBtn, editBtn, removeBtn);
    row.append(index, info, controls);
    tripList.appendChild(row);
  });
}

function buildStopEditor(stop, i) {
  const box = document.createElement("div");
  box.className = "stop-editor";
  box.innerHTML = `
    <input class="se-name" type="text" value="${escapeHtml(stop.name)}" placeholder="Stop name" />
    <div class="se-row">
      <label>Date <input class="se-date" type="date" value="${escapeHtml(stop.date || "")}" /></label>
      <label>Time <input class="se-time" type="time" value="${escapeHtml(stop.time || "")}" /></label>
    </div>
    <input class="se-notes" type="text" value="${escapeHtml(stop.notes || "")}" placeholder="Notes (optional)" />
    <div class="trip-actions">
      <button class="se-done primary">Done</button>
    </div>
  `;
  const save = async () => {
    trips = await updateStopInTrip(activeId, i, {
      name: box.querySelector(".se-name").value.trim() || stop.name,
      date: box.querySelector(".se-date").value,
      time: box.querySelector(".se-time").value,
      notes: box.querySelector(".se-notes").value.trim(),
    });
  };
  box.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", save));
  box.querySelector(".se-done").addEventListener("click", async () => {
    await save();
    editingStop = null;
    renderTrip();
    refreshItineraryIfOpen();
  });
  return box;
}

function refreshItineraryIfOpen() {
  if (itineraryEl.dataset.open === "1") renderItinerary();
}

async function reloadTrips() {
  editingStop = null;
  trips = await getTrips();
  activeId = await getActiveTripId();
  if (!activeTrip() && trips.length) {
    activeId = trips[0].id;
    await setActiveTripId(activeId);
  }
  renderTripBar();
  renderTrip();
  renderLibrary();
  refreshItineraryIfOpen();
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
  refreshItineraryIfOpen();
}

async function moveStop(index, delta) {
  const t = activeTrip();
  const target = index + delta;
  if (!t || target < 0 || target >= t.stops.length) return;
  [t.stops[index], t.stops[target]] = [t.stops[target], t.stops[index]];
  editingStop = null;
  await saveTrips(trips);
  renderTrip();
  refreshItineraryIfOpen();
}

async function removeStop(index) {
  const t = activeTrip();
  if (!t) return;
  t.stops.splice(index, 1);
  editingStop = null;
  await saveTrips(trips);
  renderTrip();
  renderLibrary();
  refreshItineraryIfOpen();
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

// ---- Detailed itinerary view -------------------------------------------
// Combines each stop's editable schedule (date/time/notes) with the driving
// leg to the next stop and overall totals. Distances/times need an API key
// (Directions API); without one, it still shows the stop-by-stop schedule.
async function renderItinerary() {
  const t = activeTrip();
  itineraryEl.classList.remove("hidden");
  if (!t || t.stops.length === 0) {
    itineraryEl.innerHTML = '<p class="hint">Add stops to see the itinerary.</p>';
    return;
  }

  let legs = null;
  let totals = null;
  if (apiKey && t.stops.length >= 2) {
    itineraryEl.innerHTML = '<p class="hint">Loading distances…</p>';
    try {
      const result = await fetchDirectionsLegs(t.stops, apiKey);
      legs = result.legs;
      totals = result;
    } catch (err) {
      // Fall through to a schedule-only itinerary with a note.
      legs = null;
      totals = { error: err.message };
    }
  }

  itineraryEl.innerHTML = `<h2>Itinerary — ${escapeHtml(t.title || "Untitled trip")}</h2>`;
  t.stops.forEach((stop, i) => {
    const when = [stop.date, stop.time].filter(Boolean).join(" ");
    const stopEl = document.createElement("div");
    stopEl.className = "itin-stop";
    stopEl.innerHTML =
      `<div class="itin-idx">${i + 1}</div>` +
      `<div><div>${escapeHtml(stop.name)}</div>` +
      (when ? `<div class="itin-when">${escapeHtml(when)}</div>` : "") +
      (stop.notes ? `<div class="itin-when">${escapeHtml(stop.notes)}</div>` : "") +
      `</div>`;
    itineraryEl.appendChild(stopEl);

    if (legs && i < legs.length) {
      const legEl = document.createElement("div");
      legEl.className = "itin-leg";
      legEl.textContent = `↓ ${legs[i].distanceText} · ${legs[i].durationText}`;
      itineraryEl.appendChild(legEl);
    }
  });

  const totalsEl = document.createElement("div");
  totalsEl.className = "itin-totals";
  if (totals && totals.totalMiles) {
    totalsEl.textContent = `Total: ${totals.totalMiles} mi · ${totals.totalHours} hr driving`;
  } else if (t.measuredTotal) {
    // Free overall total read from Google's own directions view by the
    // overlay after "Show route on map" — no API key needed.
    const m = t.measuredTotal;
    totalsEl.innerHTML =
      `Total: ${escapeHtml(m.distanceText)} · ${escapeHtml(m.durationText)} ` +
      `<span class="hint">(from Google Maps)</span>`;
  } else if (totals && totals.error) {
    totalsEl.innerHTML = `<span class="hint">Distances unavailable: ${escapeHtml(totals.error)}.</span>`;
  } else {
    totalsEl.innerHTML =
      '<span class="hint">Use “Show route on map” in the overlay to capture the total distance/time, ' +
      "or add a Google Maps API key (top-right) for per-leg distances.</span>";
  }
  itineraryEl.appendChild(totalsEl);
}

// ---- Wiring -------------------------------------------------------------
settingsToggle.addEventListener("click", () => settingsPanel.classList.toggle("hidden"));

libraryToggle.addEventListener("click", () => {
  libCollapsed = !libCollapsed;
  renderLibrary();
});

detailViewBtn.addEventListener("click", () => {
  if (!itineraryEl.classList.contains("hidden") && itineraryEl.dataset.open === "1") {
    itineraryEl.classList.add("hidden");
    itineraryEl.dataset.open = "0";
    detailViewBtn.textContent = "Detailed view";
  } else {
    itineraryEl.dataset.open = "1";
    detailViewBtn.textContent = "Hide detailed view";
    renderItinerary();
  }
});

saveKeyBtn.addEventListener("click", async () => {
  apiKey = apiKeyInput.value.trim();
  await setApiKey(apiKey);
  settingsPanel.classList.add("hidden");
});

searchInput.addEventListener("input", renderLibrary);

tripSelect.addEventListener("change", async () => {
  activeId = tripSelect.value;
  editingStop = null;
  await setActiveTripId(activeId);
  closeForm();
  renderTripBar();
  renderTrip();
  renderLibrary();
  resetRoutePanel('Add at least two stops, then click "Build route".');
  refreshItineraryIfOpen();
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
  editingStop = null;
  await saveTrips(trips);
  renderTrip();
  renderLibrary();
  resetRoutePanel('Add at least two stops, then click "Build route".');
  refreshItineraryIfOpen();
});

buildRouteBtn.addEventListener("click", buildRoute);

async function init() {
  [locations, apiKey] = await Promise.all([getLocations(), getApiKey()]);
  apiKeyInput.value = apiKey;
  await reloadTrips();

  // The overlay's "Detailed view" button opens planner.html?view=detail.
  if (new URLSearchParams(location.search).get("view") === "detail") {
    itineraryEl.dataset.open = "1";
    detailViewBtn.textContent = "Hide detailed view";
    renderItinerary();
  }
}

init();
