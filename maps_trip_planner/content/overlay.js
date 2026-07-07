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
// (enough to read the saved-list markup and to navigate the tab) but not
// the page's JavaScript.

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
  let trip = [];

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .panel {
      position: fixed; top: 90px; right: 16px; width: 300px; z-index: 2147483647;
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
    .body { padding: 10px; max-height: 70vh; overflow-y: auto; }
    .panel.collapsed .body { display: none; }
    button.act {
      width: 100%; padding: 7px 9px; border: 1px solid #dadce0; border-radius: 6px;
      background: #f8f9fa; cursor: pointer; font-size: 12px; margin-bottom: 8px;
    }
    button.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; font-weight: 600; }
    button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    input.search {
      width: 100%; padding: 6px 8px; border: 1px solid #dadce0; border-radius: 6px;
      font-size: 12px; margin-bottom: 8px;
    }
    .section-title { font-size: 10px; font-weight: 700; color: #80868b; text-transform: uppercase; letter-spacing: .04em; margin: 6px 0 4px; }
    .list { max-height: 150px; overflow-y: auto; border: 1px solid #eee; border-radius: 6px; padding: 2px; }
    .group-title { font-size: 10px; font-weight: 700; color: #80868b; text-transform: uppercase; margin: 6px 2px 2px; }
    .place, .stop { display: flex; align-items: center; gap: 6px; padding: 4px; border-radius: 5px; }
    .place:hover { background: #f1f3f4; }
    .grow { flex: 1; min-width: 0; }
    .name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .type { font-size: 10px; color: #80868b; }
    .idx { font-weight: 700; color: #1a73e8; width: 16px; text-align: center; flex-shrink: 0; }
    .rowbtn { border: 1px solid #dadce0; background: #fff; border-radius: 5px; cursor: pointer; font-size: 11px; padding: 2px 6px; flex-shrink: 0; }
    .rowbtn:disabled { opacity: .4; cursor: not-allowed; }
    .stop { border-bottom: 1px solid #f1f3f4; }
    .actions { display: flex; gap: 6px; margin-top: 8px; }
    .actions button { margin-bottom: 0; }
    .hint { font-size: 11px; color: #5f6368; margin: 4px 0; }
    .status { font-size: 11px; min-height: 14px; margin-top: 6px; }
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
      <button class="act primary scrape">Scrape saved list on this page</button>
      <input class="search" type="search" placeholder="Search saved places…" />
      <div class="section-title">Saved places</div>
      <div class="list library"></div>
      <div class="section-title">Trip stops</div>
      <div class="list triplist"></div>
      <div class="actions">
        <button class="act clear">Clear</button>
        <button class="act primary route" disabled>Show route on map</button>
      </div>
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

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#d93025" : "#188038";
  }

  function inTrip(place) {
    return trip.some((s) => s.listName === place.listName && s.name === place.name);
  }

  function renderLibrary() {
    const q = searchEl.value.trim().toLowerCase();
    const filtered = locations.filter((p) => !q || p.name.toLowerCase().includes(q));
    const groups = new Map();
    for (const p of filtered) {
      if (!groups.has(p.listName)) groups.set(p.listName, []);
      groups.get(p.listName).push(p);
    }
    libraryEl.innerHTML = "";
    if (groups.size === 0) {
      libraryEl.innerHTML = '<div class="hint">No saved places yet. Open a saved list and scrape.</div>';
      return;
    }
    for (const [listName, places] of groups) {
      const gt = document.createElement("div");
      gt.className = "group-title";
      gt.textContent = `${listName} (${places.length})`;
      libraryEl.appendChild(gt);
      for (const place of places) {
        const row = document.createElement("div");
        row.className = "place";
        const info = document.createElement("div");
        info.className = "grow";
        info.innerHTML = `<div class="name">${escapeHtml(place.name)}</div><div class="type">${escapeHtml(place.type || "")}</div>`;
        const addBtn = document.createElement("button");
        addBtn.className = "rowbtn";
        addBtn.textContent = inTrip(place) ? "✓" : "Add";
        addBtn.disabled = inTrip(place);
        addBtn.addEventListener("click", () => addStop(place));
        row.append(info, addBtn);
        libraryEl.appendChild(row);
      }
    }
  }

  function renderTrip() {
    tripEl.innerHTML = "";
    routeBtn.disabled = trip.length < 2;
    if (trip.length === 0) {
      tripEl.innerHTML = '<div class="hint">Add places above to build a route.</div>';
      return;
    }
    trip.forEach((stop, i) => {
      const row = document.createElement("div");
      row.className = "stop";
      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = String(i + 1);
      const name = document.createElement("div");
      name.className = "grow name";
      name.textContent = stop.name;
      name.title = stop.name;
      const up = document.createElement("button");
      up.className = "rowbtn";
      up.textContent = "↑";
      up.disabled = i === 0;
      up.addEventListener("click", () => moveStop(i, -1));
      const down = document.createElement("button");
      down.className = "rowbtn";
      down.textContent = "↓";
      down.disabled = i === trip.length - 1;
      down.addEventListener("click", () => moveStop(i, 1));
      const rm = document.createElement("button");
      rm.className = "rowbtn";
      rm.textContent = "✕";
      rm.addEventListener("click", () => removeStop(i));
      row.append(idx, name, up, down, rm);
      tripEl.appendChild(row);
    });
  }

  async function addStop(place) {
    if (inTrip(place)) return;
    trip = [...trip, { name: place.name, listName: place.listName, addressHint: place.addressHint || "" }];
    await storage.setCurrentTrip(trip);
    renderLibrary();
    renderTrip();
  }

  async function moveStop(i, delta) {
    const t = i + delta;
    if (t < 0 || t >= trip.length) return;
    const copy = [...trip];
    [copy[i], copy[t]] = [copy[t], copy[i]];
    trip = copy;
    await storage.setCurrentTrip(trip);
    renderTrip();
  }

  async function removeStop(i) {
    trip = trip.filter((_, idx) => idx !== i);
    await storage.setCurrentTrip(trip);
    renderLibrary();
    renderTrip();
  }

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
      }
    } catch (err) {
      setStatus(`Scrape failed: ${err.message}`, true);
    } finally {
      scrapeBtn.disabled = false;
    }
  });

  searchEl.addEventListener("input", renderLibrary);

  $(".clear").addEventListener("click", async () => {
    trip = [];
    await storage.setCurrentTrip(trip);
    renderLibrary();
    renderTrip();
    setStatus("");
  });

  // "Drive the real map": navigate this Maps tab to the directions URL scheme.
  // This is the robust approach — Google's own /maps/dir/ URL loads the route
  // on the real map, so we don't have to poke Google's internal DOM (which
  // would be the brittle way). The overlay re-injects after the navigation.
  routeBtn.addEventListener("click", () => {
    const url = route.buildDirectionsUrl(trip);
    if (!url) return;
    window.__mtpLastRouteUrl = url; // test hook; harmless in production
    setStatus("Opening route on the map…");
    window.location.assign(url);
  });

  // Collapse / expand.
  $(".collapse").addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    $(".collapse").textContent = collapsed ? "+" : "–";
    $(".collapse").title = collapsed ? "Expand" : "Collapse";
  });

  // Drag by the header.
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
    if (changes.locations) { locations = changes.locations.newValue || []; renderLibrary(); }
    if (changes.currentTrip) { trip = changes.currentTrip.newValue || []; renderTrip(); }
  });

  async function init() {
    [locations, trip] = await Promise.all([storage.getLocations(), storage.getCurrentTrip()]);
    renderLibrary();
    renderTrip();
  }

  await init();
})();
