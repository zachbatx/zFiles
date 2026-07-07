// Floating, collapsible trip-planner overlay injected onto google.com/maps.
//
// This is a classic content script (not an ES module), so it can't use
// top-level `import`. Instead it dynamically imports the same lib/ modules
// the popup and planner tab use — they're listed in web_accessible_resources
// — so the scrape/route/storage logic is shared, not copied.
//
// The whole panel lives inside a Shadow DOM so Google's (aggressive) page
// CSS can't reach in and our styles can't leak out. Everything renders in
// the content script's isolated world, which shares the DOM with the page
// (enough to read the saved-list markup and to detect/navigate) but not the
// page's JavaScript.

(async function () {
  if (window.__mtpOverlayLoaded) return;
  window.__mtpOverlayLoaded = true;

  const base = chrome.runtime.getURL("");
  const [storage, route, scraper] = await Promise.all([
    import(base + "lib/storage.js"),
    import(base + "lib/route.js"),
    import(base + "lib/scraper.js"),
  ]);

  let locations = [];
  let trips = [];
  let activeId = "";
  let selected = null; // the place currently clicked on the map, or null
  let formMode = null; // "create" | "edit" | null
  let editingStop = null; // index of the stop being edited, or null
  let libCollapsed = false; // saved-places section collapsed?
  const collapsedGroups = new Set(); // list names collapsed within the library

  const norm = (s) => (s || "").trim().toLowerCase();
  const activeTrip = () => trips.find((t) => t.id === activeId) || null;
  const scrapedMatch = (name) => locations.find((p) => norm(p.name) === norm(name)) || null;

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .panel {
      position: fixed; top: 90px; right: 16px; width: 320px; z-index: 2147483647;
      background: #fff; color: #202124; border: 1px solid #dadce0;
      border-radius: 10px; box-shadow: 0 4px 18px rgba(0,0,0,0.28); overflow: hidden;
    }
    .header {
      display: flex; align-items: center; gap: 8px; padding: 8px 10px;
      background: #1a73e8; color: #fff; cursor: move; user-select: none;
    }
    .header .title { font-size: 13px; font-weight: 600; flex: 1; }
    .header button {
      background: rgba(255,255,255,0.18); color: #fff; border: none;
      border-radius: 5px; width: 22px; height: 22px; cursor: pointer; font-size: 13px; line-height: 1;
    }
    .body { padding: 10px; max-height: 76vh; overflow-y: auto; }
    .panel.collapsed .body { display: none; }
    button.act {
      width: 100%; padding: 7px 9px; border: 1px solid #dadce0; border-radius: 6px;
      background: #f8f9fa; cursor: pointer; font-size: 12px; margin-bottom: 8px;
    }
    button.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; font-weight: 600; }
    button.primary:disabled, button.act:disabled { opacity: 0.5; cursor: not-allowed; }
    input, select {
      width: 100%; padding: 6px 8px; border: 1px solid #dadce0; border-radius: 6px;
      font-size: 12px; margin-bottom: 8px; background: #fff; color: #202124;
    }
    .section-title { font-size: 10px; font-weight: 700; color: #80868b; text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 4px; }
    .list { max-height: 150px; overflow-y: auto; border: 1px solid #eee; border-radius: 6px; padding: 2px; }
    .group-title { font-size: 10px; font-weight: 700; color: #80868b; text-transform: uppercase; margin: 6px 2px 2px; cursor: pointer; user-select: none; }
    .group-title .caret { display: inline-block; width: 10px; }
    .section-title.toggle { cursor: pointer; user-select: none; }
    .stop-sub { font-size: 10px; color: #5f6368; }
    .stop-edit { padding: 6px 4px; border-bottom: 1px solid #f1f3f4; }
    .stop-edit .two { display: flex; gap: 6px; }
    .stop-edit input { margin-bottom: 6px; }
    .place, .stop { display: flex; align-items: center; gap: 6px; padding: 4px; border-radius: 5px; }
    .place:hover { background: #f1f3f4; }
    .place.match { background: #fef7e0; outline: 2px solid #f9ab00; }
    .grow { flex: 1; min-width: 0; }
    .name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .type { font-size: 10px; color: #80868b; }
    .idx { font-weight: 700; color: #1a73e8; width: 16px; text-align: center; flex-shrink: 0; }
    .rowbtn { border: 1px solid #dadce0; background: #fff; border-radius: 5px; cursor: pointer; font-size: 11px; padding: 2px 6px; flex-shrink: 0; }
    .rowbtn:disabled { opacity: .4; cursor: not-allowed; }
    .stop { border-bottom: 1px solid #f1f3f4; }
    .actions { display: flex; gap: 6px; }
    .actions button { margin-bottom: 0; }
    .hint { font-size: 11px; color: #5f6368; margin: 4px 0; }
    .status { font-size: 11px; min-height: 14px; margin-top: 6px; }
    .card { border: 1px solid #dadce0; border-radius: 8px; padding: 8px; margin-bottom: 10px; background: #f8f9fa; }
    .card.sel-in-data { background: #fef7e0; border-color: #f9ab00; }
    .card-title { font-size: 10px; font-weight: 700; color: #80868b; text-transform: uppercase; margin-bottom: 4px; }
    .sel-name { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
    .sel-sub { font-size: 11px; color: #5f6368; margin-bottom: 6px; }
    .badge { display: inline-block; font-size: 10px; font-weight: 700; color: #b06000; background: #feefc3; border-radius: 10px; padding: 1px 8px; margin-bottom: 6px; }
    .trip-bar { display: flex; gap: 6px; align-items: center; }
    .trip-bar select { margin-bottom: 0; }
    .trip-meta { font-size: 11px; color: #3c4043; background: #f1f3f4; border-radius: 6px; padding: 6px 8px; margin: 6px 0; }
    .trip-meta .mt-title { font-weight: 700; font-size: 12px; }
    .dates { display: flex; gap: 6px; }
    .hidden { display: none !important; }
  `;

  const host = document.createElement("div");
  host.id = "mtp-overlay-host";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  shadow.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="header">
      <span class="title">Trip Planner</span>
      <button class="collapse" title="Collapse">–</button>
    </div>
    <div class="body">
      <div class="card selected hidden">
        <div class="card-title">Selected on map</div>
        <div class="sel-name"></div>
        <div class="sel-sub"></div>
        <div class="badge sel-badge hidden">Already in saved places</div>
        <div class="actions">
          <button class="act add-saved">Add to saved places</button>
          <button class="act primary add-trip">Add to trip</button>
        </div>
      </div>

      <button class="act primary scrape">Scrape saved list on this page</button>

      <div class="section-title">Trip</div>
      <div class="trip-bar">
        <select class="trip-select"></select>
        <button class="rowbtn newtrip" title="New trip">＋</button>
        <button class="rowbtn edittrip" title="Edit trip details">✎</button>
        <button class="rowbtn deltrip" title="Delete trip">🗑</button>
      </div>
      <div class="trip-form hidden">
        <input class="tf-title" placeholder="Trip title" />
        <input class="tf-summary" placeholder="Summary (optional)" />
        <div class="dates">
          <input class="tf-start" type="date" title="Start date" />
          <input class="tf-end" type="date" title="End date" />
        </div>
        <div class="actions">
          <button class="act tf-cancel">Cancel</button>
          <button class="act primary tf-save">Create trip</button>
        </div>
      </div>
      <div class="trip-meta hidden"></div>

      <input class="search" type="search" placeholder="Search saved places…" />
      <div class="section-title toggle lib-toggle"><span class="caret">▾</span> Saved places</div>
      <div class="list library"></div>

      <div class="section-title">Stops</div>
      <div class="list triplist"></div>
      <div class="actions" style="margin-top:8px;">
        <button class="act clear">Clear stops</button>
        <button class="act primary route" disabled>Show route on map</button>
      </div>
      <button class="act details">Detailed view (distances &amp; schedule)</button>
      <div class="status"></div>
    </div>
  `;
  shadow.appendChild(panel);
  document.documentElement.appendChild(host);

  const $ = (sel) => shadow.querySelector(sel);
  const libraryEl = $(".library");
  const tripEl = $(".triplist");
  const searchEl = $(".search");
  const statusEl = $(".status");
  const routeBtn = $(".route");
  const scrapeBtn = $(".scrape");
  const selCard = $(".selected");
  const tripSelect = $(".trip-select");
  const tripForm = $(".trip-form");
  const tripMeta = $(".trip-meta");

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#d93025" : "#188038";
  }

  function inActiveTrip(name) {
    const t = activeTrip();
    return !!t && t.stops.some((s) => norm(s.name) === norm(name));
  }

  // ---- Selected-on-map card ----------------------------------------------
  function renderSelected() {
    if (!selected) {
      selCard.classList.add("hidden");
      return;
    }
    selCard.classList.remove("hidden");
    const match = scrapedMatch(selected.name);
    selCard.classList.toggle("sel-in-data", !!match);
    $(".sel-name").textContent = selected.name;
    $(".sel-sub").textContent =
      selected.lat != null ? `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}` : "";
    $(".sel-badge").classList.toggle("hidden", !match);
    const addSaved = $(".add-saved");
    addSaved.disabled = !!match;
    addSaved.textContent = match ? "In saved places ✓" : "Add to saved places";
    $(".add-trip").disabled = inActiveTrip(selected.name);
  }

  // ---- Saved-places library ----------------------------------------------
  function renderLibrary() {
    $(".lib-toggle .caret").textContent = libCollapsed ? "▸" : "▾";
    libraryEl.classList.toggle("hidden", libCollapsed);
    if (libCollapsed) return;

    const q = searchEl.value.trim().toLowerCase();
    const filtered = locations.filter((p) => !q || p.name.toLowerCase().includes(q));
    const groups = new Map();
    for (const p of filtered) {
      if (!groups.has(p.listName)) groups.set(p.listName, []);
      groups.get(p.listName).push(p);
    }
    libraryEl.innerHTML = "";
    if (groups.size === 0) {
      libraryEl.innerHTML = '<div class="hint">No saved places yet. Open a saved list and scrape, or click a place on the map.</div>';
      return;
    }
    for (const [listName, places] of groups) {
      const collapsed = collapsedGroups.has(listName);
      const gt = document.createElement("div");
      gt.className = "group-title";
      gt.innerHTML = `<span class="caret">${collapsed ? "▸" : "▾"}</span> ${escapeHtml(listName)} (${places.length})`;
      gt.addEventListener("click", () => {
        if (collapsedGroups.has(listName)) collapsedGroups.delete(listName);
        else collapsedGroups.add(listName);
        renderLibrary();
      });
      libraryEl.appendChild(gt);
      if (collapsed) continue;
      for (const place of places) {
        const row = document.createElement("div");
        row.className = "place";
        if (selected && norm(place.name) === norm(selected.name)) row.classList.add("match");
        const info = document.createElement("div");
        info.className = "grow";
        info.innerHTML = `<div class="name">${escapeHtml(place.name)}</div><div class="type">${escapeHtml(place.type || "")}</div>`;
        const addBtn = document.createElement("button");
        addBtn.className = "rowbtn";
        const already = inActiveTrip(place.name);
        addBtn.textContent = already ? "✓" : "Add";
        addBtn.disabled = already;
        addBtn.title = "Add to trip";
        addBtn.addEventListener("click", () => addStop(place));
        row.append(info, addBtn);
        libraryEl.appendChild(row);
      }
    }
  }

  // ---- Trip selector, form, metadata -------------------------------------
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
    $(".edittrip").disabled = !t;
    $(".deltrip").disabled = !t;

    if (t && (t.summary || t.startDate || t.endDate)) {
      const dates =
        t.startDate || t.endDate ? `${t.startDate || "…"} → ${t.endDate || "…"}` : "";
      tripMeta.innerHTML =
        `<div class="mt-title">${escapeHtml(t.title || "")}</div>` +
        (dates ? `<div>${escapeHtml(dates)}</div>` : "") +
        (t.summary ? `<div>${escapeHtml(t.summary)}</div>` : "");
      tripMeta.classList.remove("hidden");
    } else {
      tripMeta.classList.add("hidden");
    }
  }

  function openForm(mode) {
    formMode = mode;
    const t = activeTrip();
    if (mode === "edit" && t) {
      $(".tf-title").value = t.title || "";
      $(".tf-summary").value = t.summary || "";
      $(".tf-start").value = t.startDate || "";
      $(".tf-end").value = t.endDate || "";
      $(".tf-save").textContent = "Save changes";
    } else {
      $(".tf-title").value = "";
      $(".tf-summary").value = "";
      $(".tf-start").value = "";
      $(".tf-end").value = "";
      $(".tf-save").textContent = "Create trip";
    }
    tripForm.classList.remove("hidden");
  }

  function closeForm() {
    formMode = null;
    tripForm.classList.add("hidden");
  }

  async function saveForm() {
    const meta = {
      title: $(".tf-title").value.trim() || "Untitled trip",
      summary: $(".tf-summary").value.trim(),
      startDate: $(".tf-start").value,
      endDate: $(".tf-end").value,
    };
    if (formMode === "edit" && activeTrip()) {
      await storage.updateTrip(activeId, meta);
    } else {
      const t = await storage.createTrip(meta);
      activeId = t.id;
    }
    await reloadTrips();
    closeForm();
    setStatus(`Trip "${meta.title}" saved.`);
  }

  async function reloadTrips() {
    editingStop = null;
    trips = await storage.getTrips();
    activeId = await storage.getActiveTripId();
    if (!activeTrip() && trips.length) {
      activeId = trips[0].id;
      await storage.setActiveTripId(activeId);
    }
    renderTripBar();
    renderStops();
    renderLibrary();
    renderSelected();
  }

  // ---- Stops of the active trip ------------------------------------------
  function renderStops() {
    const t = activeTrip();
    tripEl.innerHTML = "";
    routeBtn.disabled = !t || t.stops.length < 2;
    if (!t) {
      tripEl.innerHTML = '<div class="hint">Create or pick a trip to add stops.</div>';
      return;
    }
    if (t.stops.length === 0) {
      tripEl.innerHTML = '<div class="hint">Add saved places or map picks to build a route.</div>';
      return;
    }
    t.stops.forEach((stop, i) => {
      if (editingStop === i) {
        tripEl.appendChild(buildStopEditor(stop, i));
        return;
      }
      const row = document.createElement("div");
      row.className = "stop";
      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = String(i + 1);
      const info = document.createElement("div");
      info.className = "grow";
      const sched = [stop.date, stop.time].filter(Boolean).join(" ");
      info.innerHTML =
        `<div class="name">${escapeHtml(stop.name)}</div>` +
        (sched || stop.notes
          ? `<div class="stop-sub">${escapeHtml([sched, stop.notes].filter(Boolean).join(" · "))}</div>`
          : "");
      const up = document.createElement("button");
      up.className = "rowbtn";
      up.textContent = "↑";
      up.disabled = i === 0;
      up.addEventListener("click", () => moveStop(i, -1));
      const down = document.createElement("button");
      down.className = "rowbtn";
      down.textContent = "↓";
      down.disabled = i === t.stops.length - 1;
      down.addEventListener("click", () => moveStop(i, 1));
      const edit = document.createElement("button");
      edit.className = "rowbtn";
      edit.textContent = "✎";
      edit.title = "Edit stop";
      edit.addEventListener("click", () => { editingStop = i; renderStops(); });
      const rm = document.createElement("button");
      rm.className = "rowbtn";
      rm.textContent = "✕";
      rm.addEventListener("click", () => removeStop(i));
      row.append(idx, info, up, down, edit, rm);
      tripEl.appendChild(row);
    });
  }

  function buildStopEditor(stop, i) {
    const box = document.createElement("div");
    box.className = "stop-edit";
    box.innerHTML = `
      <input class="se-name" type="text" value="${escapeHtml(stop.name)}" placeholder="Stop name" />
      <div class="two">
        <input class="se-date" type="date" value="${escapeHtml(stop.date || "")}" title="Date" />
        <input class="se-time" type="time" value="${escapeHtml(stop.time || "")}" title="Time" />
      </div>
      <input class="se-notes" type="text" value="${escapeHtml(stop.notes || "")}" placeholder="Notes (optional)" />
      <div class="actions">
        <button class="act se-done primary">Done</button>
      </div>
    `;
    const save = async () => {
      trips = await storage.updateStopInTrip(activeId, i, {
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
      renderStops();
      renderLibrary();
    });
    return box;
  }

  async function persistTrips() {
    await storage.saveTrips(trips);
  }

  async function addStop(place) {
    const stop = {
      name: place.name,
      listName: place.listName,
      addressHint: place.addressHint || "",
    };
    if (place.lat != null) { stop.lat = place.lat; stop.lng = place.lng; }
    const { trips: updated, tripId } = await storage.addStopToTrip(activeId, stop);
    trips = updated;
    activeId = tripId;
    renderStops();
    renderLibrary();
    renderSelected();
    renderTripBar();
  }

  async function moveStop(i, delta) {
    const t = activeTrip();
    const target = i + delta;
    if (!t || target < 0 || target >= t.stops.length) return;
    [t.stops[i], t.stops[target]] = [t.stops[target], t.stops[i]];
    await persistTrips();
    renderStops();
  }

  async function removeStop(i) {
    const t = activeTrip();
    if (!t) return;
    t.stops.splice(i, 1);
    editingStop = null;
    await persistTrips();
    renderStops();
    renderLibrary();
    renderSelected();
  }

  // ---- Map-selection detection -------------------------------------------
  // When you click a place on Google Maps, the SPA updates the URL to
  // /maps/place/<Name>/@<lat>,<lng>,.... pushState doesn't cross the
  // isolated-world boundary, so we poll location.href (plus popstate).
  function parseSelectedPlace() {
    const m = location.pathname.match(
      /\/maps\/place\/([^/@]+)(?:\/@(-?\d+\.\d+),(-?\d+\.\d+))?/
    );
    if (!m) return null;
    let name = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    const lat = m[2] ? parseFloat(m[2]) : null;
    const lng = m[3] ? parseFloat(m[3]) : null;
    if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(name)) name = "Dropped pin";
    return { name, lat, lng };
  }

  let lastSelKey = "";
  function checkSelection() {
    const p = parseSelectedPlace();
    const key = p ? `${p.name}|${p.lat}|${p.lng}` : "";
    if (key === lastSelKey) return;
    lastSelKey = key;
    selected = p;
    renderSelected();
    renderLibrary();
  }

  // ---- Wiring ------------------------------------------------------------
  scrapeBtn.addEventListener("click", async () => {
    scrapeBtn.disabled = true;
    setStatus("Scrolling and reading the list…");
    try {
      const places = await scraper.scrapePageForSavedPlaces();
      if (!places || places.length === 0) {
        setStatus("No places found. Open a saved list in the side panel first.", true);
      } else {
        locations = await storage.mergeLocations(places);
        setStatus(`Saved ${places.length} places from "${places[0].listName}".`);
        renderLibrary();
        renderSelected();
      }
    } catch (err) {
      setStatus(`Scrape failed: ${err.message}`, true);
    } finally {
      scrapeBtn.disabled = false;
    }
  });

  $(".add-saved").addEventListener("click", async () => {
    if (!selected) return;
    const place = {
      name: selected.name,
      type: "",
      addressHint: "",
      listName: storage.MAP_PICKS_LIST,
    };
    if (selected.lat != null) { place.lat = selected.lat; place.lng = selected.lng; }
    locations = await storage.mergeLocations([place]);
    setStatus(`Added "${selected.name}" to ${storage.MAP_PICKS_LIST}.`);
    renderLibrary();
    renderSelected();
  });

  $(".add-trip").addEventListener("click", async () => {
    if (!selected) return;
    const match = scrapedMatch(selected.name);
    const place = {
      name: selected.name,
      listName: match ? match.listName : storage.MAP_PICKS_LIST,
      addressHint: match ? match.addressHint : "",
    };
    if (selected.lat != null) { place.lat = selected.lat; place.lng = selected.lng; }
    await addStop(place);
    setStatus(`Added "${selected.name}" to the trip.`);
  });

  searchEl.addEventListener("input", renderLibrary);

  $(".lib-toggle").addEventListener("click", () => {
    libCollapsed = !libCollapsed;
    renderLibrary();
  });

  // Opens the full planner tab on the active trip's detailed itinerary.
  $(".details").addEventListener("click", () => {
    window.open(chrome.runtime.getURL("planner.html?view=detail"), "_blank");
  });

  tripSelect.addEventListener("change", async () => {
    activeId = tripSelect.value;
    editingStop = null;
    await storage.setActiveTripId(activeId);
    closeForm();
    renderTripBar();
    renderStops();
    renderLibrary();
    renderSelected();
  });

  $(".newtrip").addEventListener("click", () => openForm("create"));
  $(".edittrip").addEventListener("click", () => openForm("edit"));
  $(".tf-cancel").addEventListener("click", closeForm);
  $(".tf-save").addEventListener("click", saveForm);

  $(".deltrip").addEventListener("click", async () => {
    const t = activeTrip();
    if (!t) return;
    trips = await storage.deleteTrip(t.id);
    activeId = await storage.getActiveTripId();
    renderTripBar();
    renderStops();
    renderLibrary();
    renderSelected();
    setStatus(`Deleted trip "${t.title}".`);
  });

  $(".clear").addEventListener("click", async () => {
    const t = activeTrip();
    if (!t) return;
    t.stops = [];
    editingStop = null;
    await persistTrips();
    renderStops();
    renderLibrary();
    renderSelected();
    setStatus("Cleared stops.");
  });

  // "Drive the real map": navigate this Maps tab to the directions URL scheme.
  // Google's own /maps/dir/ URL loads the route on the real map, so we don't
  // poke Google's internal DOM (which would be the brittle way).
  routeBtn.addEventListener("click", () => {
    const t = activeTrip();
    if (!t) return;
    const url = route.buildDirectionsUrl(t.stops);
    if (!url) return;
    window.__mtpLastRouteUrl = url; // test hook; harmless in production
    setStatus("Opening route on the map…");
    window.location.assign(url);
  });

  $(".collapse").addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    $(".collapse").textContent = collapsed ? "+" : "–";
    $(".collapse").title = collapsed ? "Expand" : "Collapse";
  });

  (function makeDraggable() {
    const header = shadow.querySelector(".header");
    let dragging = false, offsetX = 0, offsetY = 0;
    header.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("collapse")) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - offsetX));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offsetY));
      panel.style.left = x + "px";
      panel.style.top = y + "px";
      panel.style.right = "auto";
    });
    document.addEventListener("mouseup", () => { dragging = false; });
  })();

  // Keep in sync if the popup/planner tab changes storage while this is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.locations) { locations = changes.locations.newValue || []; renderLibrary(); renderSelected(); }
    if (changes.trips || changes.activeTripId) { reloadTrips(); }
  });

  // Poll for map selection changes.
  setInterval(checkSelection, 800);
  window.addEventListener("popstate", checkSelection);

  async function init() {
    locations = await storage.getLocations();
    await reloadTrips();
    checkSelection();
  }

  await init();
})();
