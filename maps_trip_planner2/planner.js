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
import { buildDirectionsUrl, buildEmbedUrl, buildFreeEmbedUrl, fetchDirectionsLegs, getHaversineDistance } from "./lib/route.js";
import * as backup from "./lib/backup.js";

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
const tabStops = document.getElementById("tab-stops");
const tabCalendar = document.getElementById("tab-calendar");
const tabItinerary = document.getElementById("tab-itinerary");
const subpaneStops = document.getElementById("subpane-stops");
const calendarOverlay = document.getElementById("calendar-overlay");
const closeCalendarOverlay = document.getElementById("close-calendar-overlay");
const subpaneItinerary = document.getElementById("subpane-itinerary");
const calendarDateRange = document.getElementById("calendar-date-range");
const calendarGridContainer = document.getElementById("calendar-grid-container");
const itineraryEl = document.getElementById("itinerary");
let activeDashboardTab = "stops";
const calViewType = document.getElementById("cal-view-type");
const calDetailLevel = document.getElementById("cal-detail-level");
let calActiveDayIndex = 0;
let calFocusYear = null;
let calFocusMonth = null;

const tripPrefs = document.getElementById("trip-prefs");
const prefMode = document.getElementById("pref-mode");
const prefTolls = document.getElementById("pref-tolls");
const prefHighways = document.getElementById("pref-highways");

let locations = [];
let activeLegs = null;
const expandedStops = new Set();
let trips = [];
let activeId = "";
let apiKey = "";
let formMode = null;
let editingStop = null;
let libCollapsed = false;
const collapsedGroups = new Set();
let mapSelection = null;
let reorderMode = false; // "Rearrange" toggle: drag/up-down instead of kebab actions

const norm = (s) => (s || "").trim().toLowerCase();
const activeTrip = () => trips.find((t) => t.id === activeId) || null;

// Format a 24h "HH:MM" (from <input type=time>) as "8:00 AM" / "12:30 PM".
function fmt12h(t) {
  if (!t) return "";
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t);
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return h + ":" + min + " " + ap;
}

// Close any open kebab menu in the stops list.
function closeStopMenus() {
  document.querySelectorAll(".stop-menu.open").forEach((m) => m.classList.remove("open"));
}

// Open this stop's location in Google Maps (new tab) — kebab "Show on map".
function openStopLocation(stop) {
  const query = stop.addressHint ? `${stop.name}, ${stop.addressHint}` : stop.name;
  const url = (stop.lat != null && stop.lng != null && stop.lat !== "" && stop.lng !== "")
    ? `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${stop.lat},${stop.lng},16z`
    : `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  window.open(url, "_blank", "noopener");
}

function inActiveTrip(name) {
  const t = activeTrip();
  return !!t && t.stops.some((s) => norm(s.name) === norm(name));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function buildAgendaDirectionsUrl(agenda, prefs = {}) {
  const validItems = agenda.filter(item => item.location && (item.location.name || item.location.lat != null));
  if (validItems.length < 2) return null;
  
  const getQuery = (item) => {
    if (item.location.lat != null && item.location.lng != null) {
      return `${item.location.lat},${item.location.lng}`;
    }
    return item.location.name;
  };
  
  const origin = encodeURIComponent(getQuery(validItems[0]));
  const destination = encodeURIComponent(getQuery(validItems[validItems.length - 1]));
  const waypoints = validItems
    .slice(1, -1)
    .map(item => encodeURIComponent(getQuery(item)))
    .join("|");
    
  const mode = (prefs.travelMode || "DRIVING").toLowerCase();
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${mode}`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  
  let dirflg = "";
  if (prefs.avoidTolls) dirflg += "t";
  if (prefs.avoidHighways) dirflg += "h";
  if (dirflg) url += `&dirflg=${dirflg}`;
  
  return url;
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
      removeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
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

  if (t) {
    const prefs = t.preferences || { travelMode: "DRIVING", avoidTolls: false, avoidHighways: false };
    prefMode.value = prefs.travelMode || "DRIVING";
    prefTolls.checked = !!prefs.avoidTolls;
    prefHighways.checked = !!prefs.avoidHighways;
    tripPrefs.classList.remove("hidden");
  } else {
    tripPrefs.classList.add("hidden");
  }
}

async function refreshLegsIfMismatched(t) {
  if (!t || t.stops.length < 2) return;
  if (apiKey) {
    let mismatched = !t.legs || t.legs.length !== t.stops.length - 1;
    if (!mismatched && t.legs) {
      for (let i = 0; i < t.legs.length; i++) {
        if (t.legs[i].from !== t.stops[i].name || t.legs[i].to !== t.stops[i + 1].name) {
          mismatched = true;
          break;
        }
      }
    }
    
    if (mismatched) {
      try {
        const result = await fetchDirectionsLegs(t.stops, apiKey, t.preferences);
        t.legs = result.legs;
        t.measuredTotal = { distanceText: result.totalMiles + " mi", durationText: result.totalHours + " hr" };
        await updateTrip(t.id, { legs: t.legs, measuredTotal: t.measuredTotal });
        
        trips = await getTrips();
        renderTrip();
        refreshItineraryIfOpen();
      } catch (err) {
        console.warn("Failed to auto-refresh directions legs:", err);
      }
    }
  }
}

function renderTrip() {
  const t = activeTrip();
  tripList.innerHTML = "";
  if (!t) {
    tripList.innerHTML = '<p class="hint">Create or pick a trip to add stops.</p>';
    return;
  }
  if (t.legs) {
    activeLegs = t.legs;
  } else {
    activeLegs = null;
  }
  
  refreshLegsIfMismatched(t);

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
    if (reorderMode) row.classList.add("reordering");

    // Dragging is only enabled in Rearrange mode so normal reading/clicking
    // (expand, text selection) isn't hijacked by the drag surface.
    if (reorderMode) {
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(i));
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        row.classList.add("dragover");
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("dragover");
      });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        row.classList.remove("dragover");
        const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
        const toIndex = i;
        if (fromIndex !== toIndex && !isNaN(fromIndex)) {
          const moved = t.stops.splice(fromIndex, 1)[0];
          t.stops.splice(toIndex, 0, moved);
          await saveTrips(trips);
          renderTrip();
          if (t.stops.length >= 2) {
            buildRoute();
          }
          refreshItineraryIfOpen();
        }
      });
    }

    const handle = document.createElement("div");
    handle.className = "drag-handle";
    handle.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="cursor: grab; color: var(--md-sys-color-outline);"><circle cx="9" cy="5" r="1.5"></circle><circle cx="9" cy="12" r="1.5"></circle><circle cx="9" cy="19" r="1.5"></circle><circle cx="15" cy="5" r="1.5"></circle><circle cx="15" cy="12" r="1.5"></circle><circle cx="15" cy="19" r="1.5"></circle></svg>`;

    const index = document.createElement("div");
    index.className = "stop-index";
    index.textContent = String(i + 1);

    const info = document.createElement("div");
    info.className = "stop-name";
    info.style.cursor = reorderMode ? "default" : "pointer";
    let dateStr = stop.date || "";
    if (stop.date && stop.endDate && stop.endDate !== stop.date) {
      dateStr = `${stop.date} → ${stop.endDate}`;
    }
    const sched = [dateStr, stop.time ? fmt12h(stop.time) : ""].filter(Boolean).join(" · ");
    info.innerHTML =
      `<div>${escapeHtml(stop.name)}</div>` +
      (sched || stop.notes
        ? `<div class="stop-sub">${escapeHtml([sched, stop.notes].filter(Boolean).join(" · "))}</div>`
        : "");
    info.title = reorderMode ? "" : "Click to expand/collapse details";
    info.addEventListener("click", () => {
      if (reorderMode) return; // reading actions are paused while rearranging
      if (expandedStops.has(i)) {
        expandedStops.delete(i);
      } else {
        expandedStops.add(i);
      }
      renderTrip();
    });

    const controls = document.createElement("div");
    controls.className = "stop-controls";

    // --- Rearrange controls (up/down) — shown only in Rearrange mode ---
    const upBtn = document.createElement("button");
    upBtn.className = "row-btn";
    upBtn.title = "Move up";
    upBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", (e) => { e.stopPropagation(); moveStop(i, -1); });

    const downBtn = document.createElement("button");
    downBtn.className = "row-btn";
    downBtn.title = "Move down";
    downBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;
    downBtn.disabled = i === t.stops.length - 1;
    downBtn.addEventListener("click", (e) => { e.stopPropagation(); moveStop(i, 1); });

    const reorderBtns = document.createElement("div");
    reorderBtns.className = "reorder-btns";
    reorderBtns.append(upBtn, downBtn);

    // --- Kebab (⋯) actions menu — shown only in reading mode ---
    // Keeps map/edit/remove out of the title row so the name gets full width.
    const kebab = document.createElement("button");
    kebab.className = "row-btn kebab";
    kebab.title = "Stop actions";
    kebab.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="12" cy="19" r="1.7"></circle></svg>`;
    const menu = document.createElement("div");
    menu.className = "stop-menu";
    menu.innerHTML =
      `<button class="menu-locate"><svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor"><path d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 294q122-112 181-203.5T720-552q0-109-69.5-178.5T480-800q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186Zm0 106Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 100-79.5 217.5T480-80Z"></path></svg> Show on map</button>` +
      `<button class="menu-edit"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit stop</button>` +
      `<button class="menu-remove danger"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Remove stop</button>`;
    kebab.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains("open");
      closeStopMenus();
      if (!isOpen) menu.classList.add("open");
    });
    menu.querySelector(".menu-locate").addEventListener("click", (e) => { e.stopPropagation(); closeStopMenus(); openStopLocation(stop); });
    menu.querySelector(".menu-edit").addEventListener("click", (e) => { e.stopPropagation(); closeStopMenus(); editingStop = i; renderTrip(); });
    menu.querySelector(".menu-remove").addEventListener("click", (e) => { e.stopPropagation(); closeStopMenus(); removeStop(i); });

    if (reorderMode) {
      controls.append(reorderBtns);
    } else {
      controls.append(kebab);
    }

    const mainEl = document.createElement("div");
    mainEl.className = "stop-row-main";
    if (reorderMode) {
      mainEl.append(handle, index, info, controls);
    } else {
      mainEl.append(index, info, controls);
    }
    row.append(mainEl, menu);

    // Keep rows compact while rearranging — expanded agenda editors would
    // make the list hard to drag/scan. They re-open when Rearrange is off.
    if (expandedStops.has(i) && !reorderMode) {
      row.classList.add("expanded");
      
      const expandedDiv = document.createElement("div");
      expandedDiv.className = "stop-expanded-details";
      expandedDiv.style.width = "100%";
      
      let html = `<div class="details-grid" style="padding: 8px 12px 10px 54px; background: var(--md-sys-color-surface-container-low); border-top: 1px solid var(--md-sys-color-outline-variant); border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; display: flex; flex-direction: column; gap: 8px;">`;
      
      if (stop.notes) {
        html += `<div style="font-size: 12px; color: var(--md-sys-color-on-surface);"><span style="font-weight:700;">Notes:</span> ${escapeHtml(stop.notes)}</div>`;
      }
      
      // Day Plan Agenda Section
      html += `<div class="agenda-section" style="margin-top: 6px; border-top: 1px solid var(--md-sys-color-outline-variant); padding-top: 8px;">`;
      
      const agenda = stop.agenda || [];
      const validMapItems = agenda.filter(item => item.location && (item.location.name || item.location.lat != null));
      
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--md-sys-color-on-surface-variant); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0;">Day Plan Agenda</div>
          <button class="btn btn-tonal btn-view-agenda-map hidden" style="font-size: 9px; height: 20px; padding: 0 6px; margin-bottom: 0; display: inline-flex; align-items: center; gap: 3px; border-radius: 10px; background-color: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container);" title="Show day plan agenda on the map">🗺️ Show on Map</button>
        </div>
      `;
      
      if (agenda.length === 0) {
        html += `<div class="hint" style="margin-bottom: 8px;">No agenda items planned for this day yet.</div>`;
      } else {
        html += `<div class="agenda-items" style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">`;
        agenda.forEach((item, itemIdx) => {
          const timeText = [item.startTime, item.endTime].filter(Boolean).map(fmt12h).join(" – ");
          const locText = item.location && item.location.name ? `@ ${item.location.name}` : "";
          html += `
            <div class="agenda-item-row" style="display: flex; align-items: flex-start; justify-content: space-between; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; padding: 6px 10px; gap: 8px;">
              <div class="agenda-item-info" style="flex: 1; min-width: 0; font-size: 12px;">
                <div style="font-weight: 600; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                  ${timeText ? `<span style="color: var(--md-sys-color-primary); background: var(--md-sys-color-primary-container); padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">${escapeHtml(timeText)}</span>` : ""}
                  <span>${escapeHtml(item.title)}</span>
                  ${locText ? `<span style="font-size: 11px; color: var(--md-sys-color-secondary); font-weight: 500;">${escapeHtml(locText)}</span>` : ""}
                </div>
                ${item.summary ? `<div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant); margin-top: 2px; font-style: italic;">${escapeHtml(item.summary)}</div>` : ""}
              </div>
              <div class="agenda-item-actions" style="display: flex; gap: 4px; flex-shrink: 0; align-self: center;">
                <button class="icon-btn btn-edit-agenda" data-item-idx="${itemIdx}" title="Edit item" style="width: 22px; height: 22px; cursor: pointer; border: none; background: transparent; display: flex; align-items: center; justify-content: center; padding: 0; color: var(--md-sys-color-on-surface-variant);"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                <button class="icon-btn btn-delete-agenda" data-item-idx="${itemIdx}" title="Delete item" style="width: 22px; height: 22px; cursor: pointer; border: none; background: transparent; display: flex; align-items: center; justify-content: center; padding: 0; color: var(--md-sys-color-error);"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
              </div>
            </div>
          `;
          
          // Distance/Time between agenda items
          if (itemIdx < agenda.length - 1) {
            const nextItem = agenda[itemIdx + 1];
            if (item.location && item.location.lat != null && nextItem.location && nextItem.location.lat != null) {
              const dist = getHaversineDistance(item.location.lat, item.location.lng, nextItem.location.lat, nextItem.location.lng);
              if (dist != null) {
                let avgSpeed = 40;
                const mode = (t.preferences && t.preferences.travelMode || "DRIVING").toUpperCase();
                if (mode === "WALKING") avgSpeed = 3;
                else if (mode === "BICYCLING") avgSpeed = 12;
                else if (mode === "TRANSIT") avgSpeed = 15;
                
                const estHours = dist / avgSpeed;
                const estMins = Math.round(estHours * 60);
                let durationText = estMins >= 60 ? `${Math.floor(estMins/60)}h ${estMins%60}m` : `${estMins} mins`;
                let emoji = "🚗";
                if (mode === "WALKING") emoji = "🚶";
                else if (mode === "BICYCLING") emoji = "🚲";
                else if (mode === "TRANSIT") emoji = "🚇";
                
                html += `
                  <div class="agenda-leg-connector" style="display: flex; align-items: center; padding: 2px 0 2px 20px; position: relative; min-height: 18px;">
                    <div class="agenda-leg-line" style="width: 1.5px; height: 100%; background: var(--md-sys-color-outline-variant); position: absolute; left: 30px; top: 0; z-index: 1;"></div>
                    <div class="agenda-leg-badge" style="font-size: 9px; font-weight: 700; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); border: 1px solid var(--md-sys-color-outline-variant); padding: 1px 8px; border-radius: 10px; margin-left: 20px; z-index: 2;">
                      📏 ${dist.toFixed(2)} mi · ${emoji} ~${durationText}
                    </div>
                  </div>
                `;
              }
            }
          }
        });
        html += `</div>`;
      }
      
      // Inline Agenda Form
      html += `
        <div class="agenda-form-container" style="background: var(--md-sys-color-surface-container-high); border-radius: 8px; padding: 8px; border: 1px dashed var(--md-sys-color-outline-variant); margin-bottom: 4px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--md-sys-color-on-surface-variant); margin-bottom: 6px;" class="agenda-form-title">Add Agenda Item</div>
          <input type="hidden" class="ag-edit-idx" value="" />
          <input type="hidden" class="ag-location-lat" value="" />
          <input type="hidden" class="ag-location-lng" value="" />
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <input class="ag-title" type="text" placeholder="Title (e.g. Lunch, Sightseeing)" style="font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--md-sys-color-outline-variant); outline: none; margin-bottom: 0; width: 100%; box-sizing: border-box;" />
            <div style="display: flex; gap: 6px;">
              <label style="flex: 1; font-size: 10px; color: var(--md-sys-color-on-surface-variant); display: flex; flex-direction: column; gap: 2px;">Start time <input class="ag-start" type="time" style="font-size: 11px; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--md-sys-color-outline-variant); outline: none; box-sizing: border-box; width: 100%;" /></label>
              <label style="flex: 1; font-size: 10px; color: var(--md-sys-color-on-surface-variant); display: flex; flex-direction: column; gap: 2px;">End time <input class="ag-end" type="time" style="font-size: 11px; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--md-sys-color-outline-variant); outline: none; box-sizing: border-box; width: 100%;" /></label>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <input class="ag-location" type="text" placeholder="Location name (optional)" style="font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--md-sys-color-outline-variant); outline: none; margin-bottom: 0; flex: 1; box-sizing: border-box;" />
              <button class="btn btn-tonal btn-use-selected" style="font-size: 10px; height: 28px; padding: 0 8px; flex-shrink: 0; margin-bottom: 0; border-radius: 14px; background-color: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container);" title="Fill from map selection">📍 Use Selected</button>
            </div>
            <input class="ag-summary" type="text" placeholder="Summary/Notes (optional)" style="font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--md-sys-color-outline-variant); outline: none; margin-bottom: 0; width: 100%; box-sizing: border-box;" />
            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
              <button class="btn btn-outlined btn-cancel-agenda hidden" style="font-size: 10px; height: 24px; padding: 0 10px; border-radius: 12px;">Cancel</button>
              <button class="btn btn-primary btn-save-agenda" style="font-size: 10px; height: 24px; padding: 0 10px; border-radius: 12px;">Add to agenda</button>
            </div>
          </div>
        </div>
      </div>`;
      
      html += `<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px;">`;
      
      if (stop.url) {
        html += `<a href="${escapeHtml(stop.url)}" target="_blank" rel="noopener" class="btn btn-tonal" style="font-size: 10px; height: 26px; padding: 0 10px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; background-color: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container);">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          Visit Website
        </a>`;
      }
      
      if (stop.lat != null) {
        const mapsLink = `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
        html += `<a href="${mapsLink}" target="_blank" rel="noopener" class="btn btn-tonal" style="font-size: 10px; height: 26px; padding: 0 10px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; background-color: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container);">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          Google Maps
        </a>`;
      }
      
      html += `<button class="btn btn-outlined btn-edit-inline" style="font-size: 10px; height: 26px; padding: 0 10px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        Edit details
      </button>`;
      
      html += `</div></div>`;
      expandedDiv.innerHTML = html;
      
      // Wire Agenda Form buttons & inputs
      const div = expandedDiv;
      const agTitleInput = div.querySelector(".ag-title");
      const agStartInput = div.querySelector(".ag-start");
      const agEndInput = div.querySelector(".ag-end");
      const agLocInput = div.querySelector(".ag-location");
      const agSumInput = div.querySelector(".ag-summary");
      const agEditIdx = div.querySelector(".ag-edit-idx");
      const btnSaveAgenda = div.querySelector(".btn-save-agenda");
      const btnCancelAgenda = div.querySelector(".btn-cancel-agenda");
      const formTitle = div.querySelector(".agenda-form-title");
      
      btnSaveAgenda.addEventListener("click", async (e) => {
        e.stopPropagation();
        const title = agTitleInput.value.trim();
        if (!title) return;
        
        const currentAgenda = [...(stop.agenda || [])];
        const editIdxVal = agEditIdx.value;
        const latVal = div.querySelector(".ag-location-lat").value;
        const lngVal = div.querySelector(".ag-location-lng").value;
        
        const agendaItem = {
          title,
          startTime: agStartInput.value || undefined,
          endTime: agEndInput.value || undefined,
          location: agLocInput.value.trim() ? {
            name: agLocInput.value.trim(),
            lat: latVal !== "" ? parseFloat(latVal) : undefined,
            lng: lngVal !== "" ? parseFloat(lngVal) : undefined
          } : undefined,
          summary: agSumInput.value.trim() || undefined
        };
        
        if (editIdxVal !== "") {
          const idx = parseInt(editIdxVal, 10);
          currentAgenda[idx] = { ...currentAgenda[idx], ...agendaItem };
        } else {
          currentAgenda.push({
            id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            ...agendaItem
          });
        }
        
        // Sort agenda by startTime if present
        currentAgenda.sort((a, b) => {
          if (!a.startTime) return 1;
          if (!b.startTime) return -1;
          return a.startTime.localeCompare(b.startTime);
        });
        
        trips = await updateStopInTrip(activeId, i, { agenda: currentAgenda });
        renderTrip();
        refreshItineraryIfOpen();
      });
      
      btnCancelAgenda.addEventListener("click", (e) => {
        e.stopPropagation();
        agTitleInput.value = "";
        agStartInput.value = "";
        agEndInput.value = "";
        agLocInput.value = "";
        agSumInput.value = "";
        agEditIdx.value = "";
        div.querySelector(".ag-location-lat").value = "";
        div.querySelector(".ag-location-lng").value = "";
        
        formTitle.textContent = "Add Agenda Item";
        btnSaveAgenda.textContent = "Add to agenda";
        btnCancelAgenda.classList.add("hidden");
      });
      
      // Delete buttons
      div.querySelectorAll(".btn-delete-agenda").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute("data-item-idx"), 10);
          const currentAgenda = [...(stop.agenda || [])];
          currentAgenda.splice(idx, 1);
          trips = await updateStopInTrip(activeId, i, { agenda: currentAgenda });
          renderTrip();
          refreshItineraryIfOpen();
        });
      });
      
      // Edit buttons
      div.querySelectorAll(".btn-edit-agenda").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute("data-item-idx"), 10);
          const item = stop.agenda[idx];
          
          agTitleInput.value = item.title || "";
          agStartInput.value = item.startTime || "";
          agEndInput.value = item.endTime || "";
          agLocInput.value = (item.location && item.location.name) || "";
          div.querySelector(".ag-location-lat").value = (item.location && item.location.lat != null) ? String(item.location.lat) : "";
          div.querySelector(".ag-location-lng").value = (item.location && item.location.lng != null) ? String(item.location.lng) : "";
          agSumInput.value = item.summary || "";
          agEditIdx.value = String(idx);
          
          formTitle.textContent = "Edit Agenda Item";
          btnSaveAgenda.textContent = "Save item";
          btnCancelAgenda.classList.remove("hidden");
        });
      });
      
      // Use Map Selection button
      const btnUseSelected = div.querySelector(".btn-use-selected");
      btnUseSelected.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!mapSelection) {
          alert("No place selected on map. Click a place on the map first.");
          return;
        }
        agLocInput.value = mapSelection.name;
        div.querySelector(".ag-location-lat").value = mapSelection.lat != null ? String(mapSelection.lat) : "";
        div.querySelector(".ag-location-lng").value = mapSelection.lng != null ? String(mapSelection.lng) : "";
      });
      
      // View on Map button
      const showOnMapBtn = div.querySelector(".btn-view-agenda-map");
      if (validMapItems.length >= 2) {
        showOnMapBtn.classList.remove("hidden");
        showOnMapBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const url = buildAgendaDirectionsUrl(agenda, t.preferences);
          if (url) {
            window.open(url, "_blank");
          }
        });
      }
      
      expandedDiv.querySelector(".btn-edit-inline").addEventListener("click", (e) => {
        e.stopPropagation();
        editingStop = i;
        renderTrip();
      });
      
      row.appendChild(expandedDiv);
    }

    tripList.appendChild(row);

    if (i < t.stops.length - 1) {
      const legDiv = document.createElement("div");
      legDiv.className = "stop-leg-connector";
      
      let labelText = "";
      if (activeLegs && activeLegs[i]) {
        labelText = `🚗 ${activeLegs[i].distanceText} · ${activeLegs[i].durationText}`;
      } else {
        const nextStop = t.stops[i + 1];
        const dist = getHaversineDistance(stop.lat, stop.lng, nextStop.lat, nextStop.lng);
        if (dist != null) {
          if (dist < 0.01 && stop.name !== nextStop.name) {
            labelText = "Calculating...";
          } else {
            let avgSpeed = 40;
            const mode = (t.preferences && t.preferences.travelMode || "DRIVING").toUpperCase();
            if (mode === "WALKING") avgSpeed = 3;
            else if (mode === "BICYCLING") avgSpeed = 12;
            else if (mode === "TRANSIT") avgSpeed = 15;
            
            const estHours = dist / avgSpeed;
            const estMins = Math.round(estHours * 60);
            let durationText = "";
            if (estMins >= 60) {
              const h = Math.floor(estMins / 60);
              const m = estMins % 60;
              durationText = m > 0 ? `${h}h ${m}m` : `${h}h`;
            } else {
              durationText = `${estMins} mins`;
            }
            
            let emoji = "🚗";
            if (mode === "WALKING") emoji = "🚶";
            else if (mode === "BICYCLING") emoji = "🚲";
            else if (mode === "TRANSIT") emoji = "🚇";

            labelText = `📏 ${dist.toFixed(1)} mi · ${emoji} ~${durationText}`;
          }
        }
      }
      
      legDiv.innerHTML = `<div class="leg-line"></div>` + 
                         (labelText ? `<div class="leg-badge">${labelText}</div>` : "");
      tripList.appendChild(legDiv);
    }
  });
}

function buildStopEditor(stop, i) {
  const box = document.createElement("div");
  box.className = "stop-editor";
  box.innerHTML = `
    <input class="se-name" type="text" value="${escapeHtml(stop.name)}" placeholder="Stop name" />
    
    <div class="se-date-type-container" style="display: flex; gap: 16px; margin-bottom: 8px;">
      <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; color: var(--md-sys-color-on-surface-variant); font-weight: 500;">
        <input type="radio" name="date-type-${i}" class="se-type-single" ${!stop.endDate || stop.endDate === stop.date ? 'checked' : ''} style="margin-bottom: 0; width: auto;" /> One day
      </label>
      <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; color: var(--md-sys-color-on-surface-variant); font-weight: 500;">
        <input type="radio" name="date-type-${i}" class="se-type-range" ${stop.endDate && stop.endDate !== stop.date ? 'checked' : ''} style="margin-bottom: 0; width: auto;" /> Date range
      </label>
    </div>

    <!-- Single Date Input Field -->
    <div class="se-row se-single-date-row ${stop.endDate && stop.endDate !== stop.date ? 'hidden' : ''}">
      <label>Date <input class="se-date" type="date" value="${escapeHtml(stop.date || "")}" /></label>
    </div>

    <!-- Date Range Input Fields -->
    <div class="se-row se-range-date-row ${stop.endDate && stop.endDate !== stop.date ? '' : 'hidden'}">
      <label>Start Date <input class="se-start-date" type="date" value="${escapeHtml(stop.date || "")}" /></label>
      <label>End Date <input class="se-end-date" type="date" value="${escapeHtml(stop.endDate || "")}" /></label>
    </div>

    <div class="se-row">
      <label>Time <input class="se-time" type="time" value="${escapeHtml(stop.time || "")}" /></label>
    </div>

    <input class="se-notes" type="text" value="${escapeHtml(stop.notes || "")}" placeholder="Notes (optional)" />
    <div class="trip-actions">
      <button class="se-done btn btn-primary">Done</button>
    </div>
  `;

  const typeSingle = box.querySelector(".se-type-single");
  const typeRange = box.querySelector(".se-type-range");
  const singleRow = box.querySelector(".se-single-date-row");
  const rangeRow = box.querySelector(".se-range-date-row");

  const updateVisibility = () => {
    if (typeRange.checked) {
      singleRow.classList.add("hidden");
      rangeRow.classList.remove("hidden");
      const singleDateVal = box.querySelector(".se-date").value;
      const startVal = box.querySelector(".se-start-date").value;
      if (singleDateVal && !startVal) {
        box.querySelector(".se-start-date").value = singleDateVal;
      }
    } else {
      singleRow.classList.remove("hidden");
      rangeRow.classList.add("hidden");
      const singleDateVal = box.querySelector(".se-date").value;
      const startVal = box.querySelector(".se-start-date").value;
      if (startVal && !singleDateVal) {
        box.querySelector(".se-date").value = startVal;
      }
    }
  };

  typeSingle.addEventListener("change", updateVisibility);
  typeRange.addEventListener("change", updateVisibility);
  // Initial visibility update
  updateVisibility();

  const save = async () => {
    const isRange = typeRange.checked;
    const date = isRange ? box.querySelector(".se-start-date").value : box.querySelector(".se-date").value;
    const endDate = isRange ? box.querySelector(".se-end-date").value : "";

    trips = await updateStopInTrip(activeId, i, {
      name: box.querySelector(".se-name").value.trim() || stop.name,
      date,
      endDate,
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
  if (activeDashboardTab === "itinerary") renderItinerary();
  else if (activeDashboardTab === "calendar") renderCalendar();
}

async function reloadTrips() {
  editingStop = null;
  activeLegs = null;
  expandedStops.clear();
  calFocusYear = null;
  calFocusMonth = null;
  trips = await getTrips();
  activeId = await getActiveTripId();
  if (!activeTrip() && trips.length) {
    activeId = trips[0].id;
    await setActiveTripId(activeId);
  }
  renderTripBar();
  renderLibrary();
  switchDashboardTab(activeDashboardTab);
}

async function addStop(place) {
  const stop = { name: place.name, listName: place.listName, addressHint: place.addressHint || "" };
  if (place.lat != null) { stop.lat = place.lat; stop.lng = place.lng; }
  const { trips: updated, tripId } = await addStopToTrip(activeId, stop);
  trips = updated;
  activeId = tripId;
  
  const t = activeTrip();
  if (t) {
    const idx = t.stops.findIndex(s => s.name === stop.name);
    if (idx !== -1) {
      editingStop = idx;
    }
  }

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

  // Reset full-width map expansion
  const mainEl = document.querySelector("main");
  if (mainEl && mainEl.classList.contains("map-expanded")) {
    mainEl.classList.remove("map-expanded");
    const expandBtn = document.getElementById("toggle-map-expand-btn");
    if (expandBtn) {
      const textSpan = expandBtn.querySelector("#expand-map-text");
      if (textSpan) textSpan.textContent = "Expand Map";
      const iconSvg = expandBtn.querySelector("#expand-map-icon");
      if (iconSvg) iconSvg.innerHTML = `<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>`;
    }
  }
  const expandBtn = document.getElementById("toggle-map-expand-btn");
  if (expandBtn) expandBtn.classList.add("hidden");
}

async function buildRoute() {
  const t = activeTrip();
  const stops = t ? t.stops : [];
  if (stops.length < 2) {
    resetRoutePanel('Add at least two stops, then click "Build route".');
    return;
  }

  routeEmpty.classList.add("hidden");
  const expandBtn = document.getElementById("toggle-map-expand-btn");
  if (expandBtn) expandBtn.classList.remove("hidden");

  const directionsUrl = buildDirectionsUrl(stops, t.preferences);
  openInMapsLink.href = directionsUrl;
  openInMapsLink.classList.remove("hidden");
  routeLegs.innerHTML = "";

  if (!apiKey) {
    routeEmbed.src = buildFreeEmbedUrl(stops, t.preferences);
    routeEmbed.classList.remove("hidden");
    routeLegs.innerHTML = '<p class="hint" style="text-align: center; margin-top: 8px;">Showing standard maps view. Add a Google Maps API Key (top-right Settings) to calculate precise driving leg distances/durations.</p>';
    return;
  }

  routeEmbed.src = buildEmbedUrl(stops, apiKey, t.preferences);
  routeEmbed.classList.remove("hidden");

  routeLegs.innerHTML = '<p class="hint">Loading distances…</p>';
  try {
    const result = await fetchDirectionsLegs(stops, apiKey, t.preferences);
    activeLegs = result.legs;
    renderTrip();
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

// ---- Visual Calendar View ----------------------------------------------
function getDaysInRange(startStr, endStr) {
  const dates = [];
  if (!startStr) return dates;
  const start = new Date(startStr + "T00:00:00");
  const end = endStr ? new Date(endStr + "T00:00:00") : new Date(start);
  if (end < start) return [startStr];
  
  let current = new Date(start);
  for (let i = 0; i < 14; i++) {
    const iso = current.toISOString().split("T")[0];
    dates.push(iso);
    if (iso === endStr) break;
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getIncomingLegText(t, i) {
  if (i <= 0) return "";
  if (activeLegs && activeLegs[i - 1]) {
    return `${activeLegs[i - 1].distanceText} · ${activeLegs[i - 1].durationText}`;
  }
  const prev = t.stops[i - 1];
  const curr = t.stops[i];
  const dist = getHaversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
  if (dist != null) {
    let avgSpeed = 40;
    const mode = (t.preferences && t.preferences.travelMode || "DRIVING").toUpperCase();
    if (mode === "WALKING") avgSpeed = 3;
    else if (mode === "BICYCLING") avgSpeed = 12;
    else if (mode === "TRANSIT") avgSpeed = 15;
    
    const estHours = dist / avgSpeed;
    const estMins = Math.round(estHours * 60);
    let durationText = "";
    if (estMins >= 60) {
      const h = Math.floor(estMins / 60);
      const m = estMins % 60;
      durationText = m > 0 ? `${h}h ${m}m` : `${h}h`;
    } else {
      durationText = `${estMins} mins`;
    }
    
    let emoji = "🚗";
    if (mode === "WALKING") emoji = "🚶";
    else if (mode === "BICYCLING") emoji = "🚲";
    else if (mode === "TRANSIT") emoji = "🚇";
    
    return `📏 ${dist.toFixed(1)} mi · ${emoji} ~${durationText}`;
  }
  return "";
}

function renderCalendar() {
  const t = activeTrip();
  calendarGridContainer.innerHTML = "";
  calendarDateRange.textContent = "";

  if (!t) return;

  const viewType = calViewType.value; // "month" | "week" | "day"

  if (!t.startDate && (viewType === "week" || viewType === "day")) {
    calendarGridContainer.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 13px;">
      <p>Set start/end dates in trip details to unlock the Week/Day visual scheduler.</p>
      <button class="btn btn-tonal" id="cal-edit-dates-btn" style="margin-top: 10px;">Set Dates</button>
    </div>`;
    const btn = document.getElementById("cal-edit-dates-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        openForm("edit");
      });
    }
    return;
  }

  const days = getDaysInRange(t.startDate, t.endDate);
  
  if (viewType === "month") {
    renderMonthView(t);
  } else if (viewType === "day") {
    renderDayView(t, days);
  } else {
    renderWeekView(t, days);
  }
}

function initCalendarFocus() {
  const t = activeTrip();
  if (!t) return;
  
  if (t.startDate) {
    const d = new Date(t.startDate + "T00:00:00");
    calFocusYear = d.getFullYear();
    calFocusMonth = d.getMonth();
    return;
  }
  
  const stopWithDate = t.stops.find(s => s.date);
  if (stopWithDate) {
    const d = new Date(stopWithDate.date + "T00:00:00");
    calFocusYear = d.getFullYear();
    calFocusMonth = d.getMonth();
    return;
  }
  
  const d = new Date();
  calFocusYear = d.getFullYear();
  calFocusMonth = d.getMonth();
}

function renderMonthView(t) {
  if (calFocusYear === null || calFocusMonth === null) {
    initCalendarFocus();
  }
  const year = calFocusYear;
  const month = calFocusMonth;

  const d = new Date(year, month, 1);
  const monthLabel = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  
  calendarDateRange.innerHTML = `
    <span id="cal-prev-month" style="cursor:pointer; margin-right:12px; user-select:none; font-weight:900;">◀</span>
    <span>${monthLabel}</span>
    <span id="cal-next-month" style="cursor:pointer; margin-left:12px; user-select:none; font-weight:900;">▶</span>
  `;
  
  document.getElementById("cal-prev-month").addEventListener("click", (e) => {
    e.stopPropagation();
    calFocusMonth--;
    if (calFocusMonth < 0) {
      calFocusMonth = 11;
      calFocusYear--;
    }
    renderCalendar();
  });
  
  document.getElementById("cal-next-month").addEventListener("click", (e) => {
    e.stopPropagation();
    calFocusMonth++;
    if (calFocusMonth > 11) {
      calFocusMonth = 0;
      calFocusYear++;
    }
    renderCalendar();
  });

  const firstDay = new Date(year, month, 1);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const container = document.createElement("div");
  container.style.flex = "1";
  container.style.overflow = "auto";

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(7, 1fr)";
  grid.style.background = "var(--md-sys-color-outline-variant)";
  grid.style.gap = "1px";
  grid.style.minWidth = "600px";

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  weekdays.forEach(day => {
    const hdr = document.createElement("div");
    hdr.style.padding = "8px 6px";
    hdr.style.textAlign = "center";
    hdr.style.fontWeight = "700";
    hdr.style.fontSize = "11px";
    hdr.style.background = "var(--md-sys-color-surface-container)";
    hdr.style.color = "var(--md-sys-color-on-surface)";
    grid.appendChild(hdr);
    hdr.textContent = day;
  });

  for (let i = 0; i < startDayOfWeek; i++) {
    const empty = document.createElement("div");
    empty.style.background = "#ffffff";
    grid.appendChild(empty);
  }

  const detailLevel = calDetailLevel.value;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    cell.style.background = "#ffffff";
    cell.style.padding = "6px";
    cell.style.minHeight = "96px";
    cell.style.display = "flex";
    cell.style.flexDirection = "column";
    cell.style.cursor = "pointer";

    const num = document.createElement("div");
    num.style.fontWeight = "700";
    num.style.fontSize = "11px";
    num.style.color = "var(--md-sys-color-on-surface-variant)";
    num.style.marginBottom = "6px";
    num.textContent = String(day);
    cell.appendChild(num);

    const mStr = String(month + 1).padStart(2, "0");
    const dStr = String(day).padStart(2, "0");
    const dayIso = `${year}-${mStr}-${dStr}`;

    if (t.startDate && t.endDate) {
      if (dayIso >= t.startDate && dayIso <= t.endDate) {
        cell.style.background = "#f4f8fc";
      }
    } else if (dayIso === t.startDate) {
      cell.style.background = "#f4f8fc";
    }

    cell.addEventListener("click", async () => {
      const stopName = prompt(`Enter custom stop name or note for ${dayIso}:`);
      if (stopName && stopName.trim()) {
        const stop = { 
          name: stopName.trim(), 
          listName: "Custom Stops", 
          date: dayIso,
          time: "12:00",
          notes: ""
        };
        await addStopToTrip(activeId, stop);
        await reloadTrips();
      }
    });

    const dayStops = t.stops.map((stop, idx) => ({ ...stop, originalIndex: idx }))
                           .filter(stop => {
                             if (!stop.date) return false;
                             const start = stop.date;
                             const end = stop.endDate || stop.date;
                             return dayIso >= start && dayIso <= end;
                           });

    dayStops.forEach(stop => {
      const item = document.createElement("div");
      item.style.fontSize = "9px";
      item.style.fontWeight = "600";
      item.style.padding = "2px 4px";
      item.style.borderRadius = "4px";
      item.style.marginBottom = "2px";
      item.style.whiteSpace = "nowrap";
      item.style.overflow = "hidden";
      item.style.textOverflow = "ellipsis";
      item.style.cursor = "pointer";

      if (detailLevel === "detailed") {
        item.style.background = "var(--md-sys-color-primary-container)";
        item.style.color = "var(--md-sys-color-on-primary-container)";
        item.style.border = "1px solid var(--md-sys-color-primary)";
        item.style.height = "auto";
        item.style.whiteSpace = "normal";
        item.style.overflow = "visible";
        item.style.textOverflow = "clip";
        
        const timeStr = stop.time ? new Date(`2000-01-01T${stop.time}`).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : "";
        const legText = getIncomingLegText(t, stop.originalIndex);
        
        item.innerHTML = `
          <div style="font-weight: 700; font-size: 9px; line-height: 1.1;">${timeStr ? `<b>${timeStr}</b> ` : ""}${escapeHtml(stop.name)}</div>
          ${stop.notes ? `<div style="font-size: 8px; opacity: 0.85; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📝 ${escapeHtml(stop.notes)}</div>` : ""}
          ${legText ? `<div style="font-size: 8px; font-weight: 700; color: var(--md-sys-color-primary); margin-top: 2px;">${legText}</div>` : ""}
        `;
      } else {
        item.style.background = "var(--md-sys-color-surface-container-high)";
        item.style.color = "var(--md-sys-color-on-surface)";
        item.style.whiteSpace = "nowrap";
        item.style.height = "16px";
        item.style.lineHeight = "12px";
        item.textContent = stop.name;
      }

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        editingStop = stop.originalIndex;
        switchDashboardTab("stops");
      });

      cell.appendChild(item);
    });

    grid.appendChild(cell);
  }

  container.appendChild(grid);
  calendarGridContainer.appendChild(container);
}

function renderDayView(t, days) {
  if (calActiveDayIndex >= days.length) calActiveDayIndex = 0;
  const activeDayIso = days[calActiveDayIndex];
  const activeDayDate = new Date(activeDayIso + "T00:00:00");
  const dateLabel = activeDayDate.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric", year: "numeric" });
  calendarDateRange.textContent = `Day ${calActiveDayIndex + 1} of ${days.length}`;

  const navBar = document.createElement("div");
  navBar.style.display = "flex";
  navBar.style.alignItems = "center";
  navBar.style.justifyContent = "center";
  navBar.style.gap = "16px";
  navBar.style.padding = "8px";
  navBar.style.background = "var(--md-sys-color-surface-container)";
  navBar.style.borderBottom = "1px solid var(--md-sys-color-outline-variant)";
  
  const prevBtn = document.createElement("button");
  prevBtn.className = "icon-btn";
  prevBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
  prevBtn.disabled = calActiveDayIndex === 0;
  prevBtn.addEventListener("click", () => {
    calActiveDayIndex--;
    renderCalendar();
  });

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "12px";
  title.style.color = "var(--md-sys-color-on-surface)";
  title.textContent = dateLabel;

  const nextBtn = document.createElement("button");
  nextBtn.className = "icon-btn";
  nextBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  nextBtn.disabled = calActiveDayIndex === days.length - 1;
  nextBtn.addEventListener("click", () => {
    calActiveDayIndex++;
    renderCalendar();
  });

  navBar.append(prevBtn, title, nextBtn);
  calendarGridContainer.appendChild(navBar);

  const scrollWrapper = document.createElement("div");
  scrollWrapper.style.flex = "1";
  scrollWrapper.style.overflowY = "auto";
  scrollWrapper.style.padding = "12px";

  const dayStops = t.stops.map((stop, idx) => ({ ...stop, originalIndex: idx }))
                         .filter(stop => {
                           if (!stop.date) return false;
                           const start = stop.date;
                           const end = stop.endDate || stop.date;
                           return activeDayIso >= start && activeDayIso <= end;
                         });

  if (dayStops.length === 0) {
    scrollWrapper.innerHTML = `<div style="text-align: center; color: var(--md-sys-color-on-surface-variant); padding: 40px; font-size: 13px;">No stops scheduled for this day.</div>`;
    calendarGridContainer.appendChild(scrollWrapper);
    return;
  }

  dayStops.sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });

  const detailLevel = calDetailLevel.value;

  dayStops.forEach((stop) => {
    const card = document.createElement("div");
    card.style.background = "var(--md-sys-color-surface-container-lowest)";
    card.style.border = "1px solid var(--md-sys-color-outline-variant)";
    card.style.borderRadius = "12px";
    card.style.padding = "10px 12px";
    card.style.marginBottom = "8px";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "4px";

    const timeFmt = stop.time ? new Date(`2000-01-01T${stop.time}`).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : "Unsched";
    
    const hdr = document.createElement("div");
    hdr.style.display = "flex";
    hdr.style.justifyContent = "space-between";
    hdr.style.alignItems = "center";
    
    const nameEl = document.createElement("div");
    nameEl.style.fontWeight = "700";
    nameEl.style.fontSize = "12px";
    nameEl.textContent = stop.name;

    const timeEl = document.createElement("div");
    timeEl.style.fontSize = "10px";
    timeEl.style.fontWeight = "700";
    timeEl.style.color = "var(--md-sys-color-primary)";
    timeEl.textContent = timeFmt;

    hdr.append(nameEl, timeEl);
    card.appendChild(hdr);

    if (detailLevel === "detailed") {
      if (stop.addressHint) {
        const addr = document.createElement("div");
        addr.style.fontSize = "10px";
        addr.style.color = "var(--md-sys-color-secondary)";
        addr.textContent = stop.addressHint;
        card.appendChild(addr);
      }

      const legText = getIncomingLegText(t, stop.originalIndex);
      if (legText) {
        const legEl = document.createElement("div");
        legEl.style.fontSize = "10px";
        legEl.style.fontWeight = "700";
        legEl.style.color = "var(--md-sys-color-primary)";
        legEl.style.marginTop = "2px";
        legEl.textContent = `Transit Leg: ${legText}`;
        card.appendChild(legEl);
      }

      if (stop.notes) {
        const notes = document.createElement("div");
        notes.style.fontSize = "11px";
        notes.style.color = "var(--md-sys-color-on-surface-variant)";
        notes.style.marginTop = "4px";
        notes.innerHTML = `<i>Notes:</i> ${escapeHtml(stop.notes)}`;
        card.appendChild(notes);
      }

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "6px";
      actions.style.marginTop = "6px";

      if (stop.url) {
        const website = document.createElement("a");
        website.href = stop.url;
        website.target = "_blank";
        website.rel = "noopener";
        website.className = "btn btn-tonal";
        website.style.fontSize = "9px";
        website.style.height = "24px";
        website.style.padding = "0 8px";
        website.style.textDecoration = "none";
        website.style.display = "inline-flex";
        website.style.alignItems = "center";
        website.style.gap = "3px";
        website.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg> Website`;
        actions.appendChild(website);
      }

      if (stop.lat != null) {
        const mapLink = document.createElement("a");
        mapLink.href = `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
        mapLink.target = "_blank";
        mapLink.rel = "noopener";
        mapLink.className = "btn btn-tonal";
        mapLink.style.fontSize = "9px";
        mapLink.style.height = "24px";
        mapLink.style.padding = "0 8px";
        mapLink.style.textDecoration = "none";
        mapLink.style.display = "inline-flex";
        mapLink.style.alignItems = "center";
        mapLink.style.gap = "3px";
        mapLink.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Map`;
        actions.appendChild(mapLink);
      }

      const edit = document.createElement("button");
      edit.className = "btn btn-outlined";
      edit.style.fontSize = "9px";
      edit.style.height = "24px";
      edit.style.padding = "0 8px";
      edit.style.display = "inline-flex";
      edit.style.alignItems = "center";
      edit.style.gap = "3px";
      edit.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit`;
      edit.addEventListener("click", () => {
        editingStop = stop.originalIndex;
        switchDashboardTab("stops");
      });
      actions.appendChild(edit);

      card.appendChild(actions);
    }

    scrollWrapper.appendChild(card);
  });

  calendarGridContainer.appendChild(scrollWrapper);
}

function renderWeekView(t, days) {
  const startFmt = new Date(t.startDate + "T00:00:00").toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  const endFmt = t.endDate ? new Date(t.endDate + "T00:00:00").toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : "";
  calendarDateRange.textContent = endFmt ? `${startFmt} — ${endFmt}` : startFmt;

  const scrollWrapper = document.createElement("div");
  scrollWrapper.style.flex = "1";
  scrollWrapper.style.overflow = "auto";
  
  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  grid.style.gridTemplateColumns = `50px repeat(${days.length}, 1fr)`;
  grid.style.minWidth = `${50 + days.length * 110}px`;
  
  const startHour = 8;
  const endHour = 22;
  const timeCol = document.createElement("div");
  timeCol.className = "calendar-time-col";
  
  // Empty space in time column to align with All-Day container header space!
  const timeAllDayHdr = document.createElement("div");
  timeAllDayHdr.style.height = "57px"; // 33px header + 24px minimum all-day row height
  timeAllDayHdr.style.borderBottom = "1px solid var(--md-sys-color-outline-variant)";
  timeCol.appendChild(timeAllDayHdr);

  for (let h = startHour; h <= endHour; h++) {
    const slot = document.createElement("div");
    slot.className = "calendar-time-slot";
    const ampm = h >= 12 ? (h === 12 ? "12 PM" : `${h - 12} PM`) : `${h} AM`;
    slot.textContent = ampm;
    timeCol.appendChild(slot);
  }
  grid.appendChild(timeCol);

  const detailLevel = calDetailLevel.value;

  days.forEach((dayIso) => {
    const dayCol = document.createElement("div");
    dayCol.className = "calendar-day-col";
    
    const dayDate = new Date(dayIso + "T00:00:00");
    const label = dayDate.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
    const header = document.createElement("div");
    header.className = "calendar-day-header";
    header.textContent = label;
    dayCol.appendChild(header);

    const dayStops = t.stops.map((stop, index) => ({ ...stop, originalIndex: index }))
                           .filter(stop => {
                             if (!stop.date) return false;
                             const start = stop.date;
                             const end = stop.endDate || stop.date;
                             return dayIso >= start && dayIso <= end;
                           });

    // Split timed and untimed stops
    const allDayStops = dayStops.filter(s => !s.time);
    const timedStops = dayStops.filter(s => s.time);

    // All Day row
    const allDayContainer = document.createElement("div");
    allDayContainer.className = "calendar-all-day-container";
    allDayContainer.style.background = "var(--md-sys-color-surface-container-low)";
    allDayContainer.style.borderBottom = "1px solid var(--md-sys-color-outline-variant)";
    allDayContainer.style.padding = "4px";
    allDayContainer.style.display = "flex";
    allDayContainer.style.flexDirection = "column";
    allDayContainer.style.gap = "2px";
    allDayContainer.style.minHeight = "24px";
    
    allDayStops.forEach(stop => {
      const eventEl = document.createElement("div");
      eventEl.className = "calendar-event";
      eventEl.style.position = "static";
      eventEl.style.height = "auto";
      eventEl.style.minHeight = "22px";
      eventEl.style.padding = "2px 6px";
      eventEl.style.marginBottom = "2px";
      eventEl.style.fontSize = "10px";
      eventEl.style.background = "var(--md-sys-color-secondary-container)";
      eventEl.style.color = "var(--md-sys-color-on-secondary-container)";
      eventEl.style.border = "1px solid var(--md-sys-color-outline-variant)";
      
      if (detailLevel === "detailed") {
        const legText = getIncomingLegText(t, stop.originalIndex);
        eventEl.innerHTML = `
          <span class="calendar-event-name" style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${escapeHtml(stop.name)}</span>
          ${stop.notes ? `<span style="font-size:8px; opacity:0.8; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">📝 ${escapeHtml(stop.notes)}</span>` : ""}
          ${legText ? `<span style="font-size:8px; color:var(--md-sys-color-primary); display:block; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${legText}</span>` : ""}
        `;
      } else {
        eventEl.innerHTML = `<span class="calendar-event-name" style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${escapeHtml(stop.name)}</span>`;
      }
      eventEl.addEventListener("click", () => {
        editingStop = stop.originalIndex;
        switchDashboardTab("stops");
      });
      
      allDayContainer.appendChild(eventEl);
    });
    dayCol.appendChild(allDayContainer);

    // Body wrapper container for background cells and overlay events
    const bodyContainer = document.createElement("div");
    bodyContainer.style.position = "relative";
    bodyContainer.style.flex = "1";

    for (let h = startHour; h <= endHour; h++) {
      const cell = document.createElement("div");
      cell.className = "calendar-hour-cell";
      bodyContainer.appendChild(cell);
    }

    timedStops.forEach((stop) => {
      const [hStr, mStr] = stop.time.split(":");
      const hour = parseInt(hStr, 10) + parseInt(mStr, 10) / 60;
      
      if (hour >= startHour && hour <= endHour + 1) {
        const hoursSinceStart = hour - startHour;
        const topOffset = hoursSinceStart * 40;
        
        const eventEl = document.createElement("div");
        eventEl.className = "calendar-event";
        eventEl.style.top = `${topOffset}px`;
        
        const timeFmt = new Date(`2000-01-01T${stop.time}`).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
        
        if (detailLevel === "detailed") {
          eventEl.style.height = "auto";
          eventEl.style.minHeight = "64px";
          eventEl.style.padding = "4px 6px";
          
          const legText = getIncomingLegText(t, stop.originalIndex);
          eventEl.innerHTML = `
            <span class="calendar-event-time" style="font-weight:700; font-size:8px;">${timeFmt}</span>
            <span class="calendar-event-name" style="font-weight:700; display:block; font-size:9px; line-height:1.1; margin-top:1px;">${escapeHtml(stop.name)}</span>
            ${stop.notes ? `<span style="font-size:8px; opacity:0.85; display:block; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">📝 ${escapeHtml(stop.notes)}</span>` : ""}
            ${legText ? `<span style="font-size:8px; color:var(--md-sys-color-primary); display:block; margin-top:2px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${legText}</span>` : ""}
          `;
        } else {
          eventEl.style.height = "32px";
          eventEl.style.padding = "2px 6px";
          eventEl.innerHTML = `
            <span class="calendar-event-time">${timeFmt}</span>
            <span class="calendar-event-name">${escapeHtml(stop.name)}</span>
          `;
        }
        
        eventEl.addEventListener("click", () => {
          editingStop = stop.originalIndex;
          switchDashboardTab("stops");
        });
        
        bodyContainer.appendChild(eventEl);
      }
    });

    dayCol.appendChild(bodyContainer);
    grid.appendChild(dayCol);
  });

  scrollWrapper.appendChild(grid);
  calendarGridContainer.appendChild(scrollWrapper);
}

function switchDashboardTab(tabName) {
  activeDashboardTab = tabName;
  
  [tabStops, tabCalendar, tabItinerary].forEach(btn => btn.classList.remove("active-tab"));
  [subpaneStops, subpaneItinerary].forEach(pane => pane.classList.add("hidden"));
  calendarOverlay.classList.add("hidden");
  
  if (tabName === "stops") {
    tabStops.classList.add("active-tab");
    subpaneStops.classList.remove("hidden");
    renderTrip();
  } else if (tabName === "calendar") {
    tabCalendar.classList.add("active-tab");
    calendarOverlay.classList.remove("hidden");
    renderCalendar();
  } else if (tabName === "itinerary") {
    tabItinerary.classList.add("active-tab");
    subpaneItinerary.classList.remove("hidden");
    renderItinerary();
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

  let legs = t.legs || null;
  let totals = null;
  if (t.measuredTotal) {
    totals = {
      totalMiles: parseFloat(t.measuredTotal.distanceText) || 0,
      totalHours: parseFloat(t.measuredTotal.durationText) || 0
    };
  } else if (!legs && apiKey && t.stops.length >= 2) {
    itineraryEl.innerHTML = '<p class="hint">Loading distances…</p>';
    try {
      const result = await fetchDirectionsLegs(t.stops, apiKey, t.preferences);
      legs = result.legs;
      totals = result;
      t.legs = result.legs;
      t.measuredTotal = { distanceText: result.totalMiles + " mi", durationText: result.totalHours + " hr" };
      await updateTrip(t.id, { legs: t.legs, measuredTotal: t.measuredTotal });
    } catch (err) {
      legs = null;
      totals = { error: err.message };
    }
  }

  itineraryEl.innerHTML = `<h2>Itinerary — ${escapeHtml(t.title || "Untitled trip")}</h2>`;
  t.stops.forEach((stop, i) => {
    let dateStr = stop.date || "";
    if (stop.date && stop.endDate && stop.endDate !== stop.date) {
      dateStr = `${stop.date} → ${stop.endDate}`;
    }
    const when = [dateStr, stop.time].filter(Boolean).join(" ");
    const stopEl = document.createElement("div");
    stopEl.className = "itin-stop";
    
    let agendaHtml = "";
    if (stop.agenda && stop.agenda.length > 0) {
      agendaHtml += `<div class="itin-agenda" style="margin-top: 8px; border-left: 2px solid var(--md-sys-color-primary-container); padding-left: 10px; display: flex; flex-direction: column; gap: 4px;">`;
      stop.agenda.forEach(item => {
        const itemTime = [item.startTime, item.endTime].filter(Boolean).map(fmt12h).join(" – ");
        const locPart = item.location && item.location.name ? ` @ ${item.location.name}` : "";
        agendaHtml += `
          <div style="font-size: 12px; color: var(--md-sys-color-on-surface-variant); line-height: 1.4;">
            <strong>${escapeHtml(itemTime || "Agenda")}</strong>: ${escapeHtml(item.title)}${escapeHtml(locPart)}
            ${item.summary ? `<div style="font-size: 11px; font-style: italic; opacity: 0.8; padding-left: 4px; margin-top: 1px;">${escapeHtml(item.summary)}</div>` : ""}
          </div>
        `;
      });
      agendaHtml += `</div>`;
    }

    stopEl.innerHTML =
      `<div class="itin-idx">${i + 1}</div>` +
      `<div><div>${escapeHtml(stop.name)}</div>` +
      (when ? `<div class="itin-when">${escapeHtml(when)}</div>` : "") +
      (stop.notes ? `<div class="itin-when">${escapeHtml(stop.notes)}</div>` : "") +
      agendaHtml +
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

tabStops.addEventListener("click", () => switchDashboardTab("stops"));
tabCalendar.addEventListener("click", () => switchDashboardTab("calendar"));
tabItinerary.addEventListener("click", () => switchDashboardTab("itinerary"));

const reorderToggle = document.getElementById("reorder-toggle");
if (reorderToggle) {
  reorderToggle.addEventListener("change", (e) => {
    reorderMode = e.target.checked;
    if (reorderMode) closeStopMenus();
    renderTrip();
  });
}
// Click anywhere else closes an open stop kebab menu.
document.addEventListener("click", () => closeStopMenus());
calViewType.addEventListener("change", renderCalendar);
calDetailLevel.addEventListener("change", renderCalendar);
closeCalendarOverlay.addEventListener("click", () => switchDashboardTab("stops"));

saveKeyBtn.addEventListener("click", async () => {
  apiKey = apiKeyInput.value.trim();
  await setApiKey(apiKey);
  settingsPanel.classList.add("hidden");
});

searchInput.addEventListener("input", renderLibrary);

tripSelect.addEventListener("change", async () => {
  activeId = tripSelect.value;
  editingStop = null;
  activeLegs = null;
  expandedStops.clear();
  calFocusYear = null;
  calFocusMonth = null;
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

async function savePrefs(patch) {
  const t = activeTrip();
  if (!t) return;
  const current = t.preferences || { travelMode: "DRIVING", avoidTolls: false, avoidHighways: false };
  const updated = { ...current, ...patch };
  await updateTrip(activeId, { preferences: updated });
  t.preferences = updated;
  if (t.stops.length >= 2) {
    buildRoute();
  }
}

prefMode.addEventListener("change", (e) => savePrefs({ travelMode: e.target.value }));
prefTolls.addEventListener("change", (e) => savePrefs({ avoidTolls: e.target.checked }));
prefHighways.addEventListener("change", (e) => savePrefs({ avoidHighways: e.target.checked }));

buildRouteBtn.addEventListener("click", buildRoute);

const toggleMapExpandBtn = document.getElementById("toggle-map-expand-btn");
if (toggleMapExpandBtn) {
  toggleMapExpandBtn.addEventListener("click", () => {
    const mainEl = document.querySelector("main");
    if (!mainEl) return;
    
    const isExpanded = mainEl.classList.toggle("map-expanded");
    const textSpan = toggleMapExpandBtn.querySelector("#expand-map-text");
    const iconSvg = toggleMapExpandBtn.querySelector("#expand-map-icon");
    
    if (isExpanded) {
      if (textSpan) textSpan.textContent = "Collapse Map";
      if (iconSvg) {
        iconSvg.innerHTML = `<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>`;
      }
    } else {
      if (textSpan) textSpan.textContent = "Expand Map";
      if (iconSvg) {
        iconSvg.innerHTML = `<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>`;
      }
    }
  });
}

// ---- Data & Backup --------------------------------------------------------
const backupStatusEl = document.getElementById("backup-status");
const linkBackupBtn = document.getElementById("link-backup-btn");
const reconnectBackupBtn = document.getElementById("reconnect-backup-btn");
const restoreBackupBtn = document.getElementById("restore-backup-btn");
const unlinkBackupBtn = document.getElementById("unlink-backup-btn");
const exportTripsBtn = document.getElementById("export-trips-btn");
const importTripsBtn = document.getElementById("import-trips-btn");
const importTripsInput = document.getElementById("import-trips-input");
const restoreBanner = document.getElementById("restore-banner");

let backupHandle = null;
let backupNeedsPermission = false;
let backupWriteTimer = null;

async function currentStateForBackup() {
  const s = await chrome.storage.local.get(["trips", "activeTripId", "locations"]);
  return { trips: s.trips || [], activeTripId: s.activeTripId || "", locations: s.locations || [] };
}

async function applyImported(data) {
  const patch = {
    trips: data.trips || [],
    activeTripId: data.activeTripId || (data.trips && data.trips[0] && data.trips[0].id) || "",
  };
  if (data.locations && data.locations.length) patch.locations = data.locations;
  await chrome.storage.local.set(patch);
  await reloadTrips();
  scheduleBackupWrite();
}

function fmtNow() {
  return new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function setBackupStatus(kind, extra) {
  if (!backupStatusEl) return;
  backupStatusEl.classList.remove("linked", "warn");
  const name = backupHandle ? (backupHandle.name || "backup.json") : null;
  if (kind === "unlinked") {
    backupStatusEl.innerHTML = "Backup file: <strong>not linked</strong>";
  } else if (kind === "needs-permission") {
    backupStatusEl.classList.add("warn");
    backupStatusEl.innerHTML = `Backup file <strong>${escapeHtml(name)}</strong> needs to be re-approved for this session.`;
  } else if (kind === "saved") {
    backupStatusEl.classList.add("linked");
    backupStatusEl.innerHTML = `Backup: <strong>${escapeHtml(name)}</strong> · saved ${escapeHtml(extra || fmtNow())}`;
  } else if (kind === "linked") {
    backupStatusEl.classList.add("linked");
    backupStatusEl.innerHTML = `Backup: <strong>${escapeHtml(name)}</strong> · linked`;
  } else if (kind === "error") {
    backupStatusEl.classList.add("warn");
    backupStatusEl.innerHTML = `Backup error: ${escapeHtml(extra || "write failed")}`;
  }
}

function updateBackupUi() {
  const linked = !!backupHandle;
  linkBackupBtn.classList.toggle("hidden", linked);
  unlinkBackupBtn.classList.toggle("hidden", !linked);
  reconnectBackupBtn.classList.toggle("hidden", !(linked && backupNeedsPermission));
  if (!backup.isSupported()) {
    linkBackupBtn.disabled = true;
    linkBackupBtn.title = "This browser can't link a file — use Export/Import instead.";
  }
}

function scheduleBackupWrite() {
  if (!backupHandle) return;
  clearTimeout(backupWriteTimer);
  backupWriteTimer = setTimeout(doBackupWrite, 600);
}

async function doBackupWrite() {
  if (!backupHandle) return;
  try {
    if (!(await backup.queryGranted(backupHandle, true))) {
      backupNeedsPermission = true;
      setBackupStatus("needs-permission");
      updateBackupUi();
      return;
    }
    backupNeedsPermission = false;
    await backup.writeHandle(backupHandle, backup.serialize(await currentStateForBackup()));
    setBackupStatus("saved");
    updateBackupUi();
  } catch (e) {
    setBackupStatus("error", e.message);
  }
}

async function linkBackupFile() {
  if (!backup.isSupported()) {
    alert("This browser can't link a file directly. Use Export snapshot / Import instead.");
    return;
  }
  try {
    const handle = await backup.pickSaveFile();
    if (!(await backup.verifyPermission(handle, true))) return;
    backupHandle = handle;
    backupNeedsPermission = false;
    await doBackupWrite();                          // write + update UI first
    backup.saveHandle(handle).catch(() => {});      // persist for next session, best-effort
  } catch (e) {
    if (e.name !== "AbortError") alert("Couldn't link file: " + e.message);
  }
}

async function reconnectBackupFile() {
  if (!backupHandle) return;
  try {
    if (await backup.verifyPermission(backupHandle, true)) {
      backupNeedsPermission = false;
      await doBackupWrite();
    }
  } catch (e) {
    if (e.name !== "AbortError") alert("Couldn't reconnect: " + e.message);
  }
}

async function unlinkBackupFile() {
  backupHandle = null;
  backupNeedsPermission = false;
  await backup.clearHandle();
  setBackupStatus("unlinked");
  updateBackupUi();
}

async function restoreFromFile() {
  try {
    let handle = backupHandle;
    if (!handle) {
      if (!backup.isSupported()) { importTripsInput.click(); return; }
      handle = await backup.pickOpenFile();
    }
    if (!(await backup.verifyPermission(handle, false))) return;
    const data = backup.parse(await backup.readHandle(handle));
    if (!confirm(`Restore ${data.trips.length} trip(s) and ${data.locations.length} saved place(s)? This replaces the current data.`)) return;
    await applyImported(data);
    if (!backupHandle && backup.isSupported()) {
      backupHandle = handle;
      backup.saveHandle(handle).catch(() => {});
    }
    hideRestoreBanner();
    setBackupStatus(backupHandle ? "linked" : "unlinked");
    updateBackupUi();
  } catch (e) {
    if (e.name !== "AbortError") alert("Restore failed: " + e.message);
  }
}

function exportSnapshot() {
  currentStateForBackup().then((state) => {
    const blob = new Blob([backup.serialize(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "maps-trip-planner-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

async function importSnapshotFile(file) {
  try {
    const data = backup.parse(await file.text());
    if (!confirm(`Import ${data.trips.length} trip(s) and ${data.locations.length} saved place(s)? This replaces the current data.`)) return;
    await applyImported(data);
    hideRestoreBanner();
  } catch (e) {
    alert("Import failed: " + e.message);
  }
}

function showRestoreBanner(data) {
  if (!restoreBanner) return;
  restoreBanner.classList.remove("hidden");
  restoreBanner.innerHTML =
    `<span>Your linked backup file has <strong>${data.trips.length} trip(s)</strong> but this browser has none. Restore them?</span>` +
    `<button class="btn btn-primary" id="do-restore-banner">Restore</button>` +
    `<button class="btn btn-tonal" id="dismiss-restore-banner">Dismiss</button>`;
  restoreBanner.querySelector("#do-restore-banner").addEventListener("click", restoreFromFile);
  restoreBanner.querySelector("#dismiss-restore-banner").addEventListener("click", hideRestoreBanner);
}
function hideRestoreBanner() {
  if (restoreBanner) { restoreBanner.classList.add("hidden"); restoreBanner.innerHTML = ""; }
}

linkBackupBtn.addEventListener("click", linkBackupFile);
reconnectBackupBtn.addEventListener("click", reconnectBackupFile);
restoreBackupBtn.addEventListener("click", restoreFromFile);
unlinkBackupBtn.addEventListener("click", unlinkBackupFile);
exportTripsBtn.addEventListener("click", exportSnapshot);
importTripsBtn.addEventListener("click", () => importTripsInput.click());
importTripsInput.addEventListener("change", () => {
  const f = importTripsInput.files[0];
  importTripsInput.value = "";
  if (f) importSnapshotFile(f);
});

async function initBackup() {
  setBackupStatus("unlinked");
  updateBackupUi();
  if (!backup.isSupported()) return;
  try {
    backupHandle = await backup.getSavedHandle();
  } catch { backupHandle = null; }
  if (!backupHandle) return;

  const granted = await backup.queryGranted(backupHandle, true);
  backupNeedsPermission = !granted;
  setBackupStatus(granted ? "linked" : "needs-permission");
  updateBackupUi();

  // If this browser's storage is empty but the file has trips, offer a restore.
  if (!trips || trips.length === 0) {
    try {
      if (await backup.queryGranted(backupHandle, false)) {
        const data = backup.parse(await backup.readHandle(backupHandle));
        if (data.trips && data.trips.length) showRestoreBanner(data);
      }
    } catch { /* ignore */ }
  }
}

async function init() {
  [locations, apiKey] = await Promise.all([getLocations(), getApiKey()]);
  apiKeyInput.value = apiKey;
  
  const { mapSelection: initialSel } = await chrome.storage.local.get("mapSelection");
  mapSelection = initialSel || null;
  
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.mapSelection) {
      mapSelection = changes.mapSelection.newValue || null;
    }
    if (changes.trips || changes.activeTripId) {
      const newVal = changes.trips ? changes.trips.newValue : undefined;
      const newIdVal = changes.activeTripId ? changes.activeTripId.newValue : undefined;
      
      const hasIdChanged = newIdVal !== undefined && newIdVal !== activeId;
      const hasTripsChanged = newVal !== undefined && JSON.stringify(newVal) !== JSON.stringify(trips);
      
      if (hasIdChanged || hasTripsChanged) {
        reloadTrips();
      }
    }
    if (changes.locations) {
      locations = changes.locations.newValue || [];
      renderLibrary();
    }
    // Mirror any data change (from this page, the overlay, or the popup) into
    // the linked backup file.
    if (changes.trips || changes.activeTripId || changes.locations) {
      scheduleBackupWrite();
    }
  });

  await reloadTrips();
  await initBackup();

  // The overlay's "Detailed view" button opens planner.html?view=detail.
  if (new URLSearchParams(location.search).get("view") === "detail") {
    switchDashboardTab("itinerary");
  }
}

init();
