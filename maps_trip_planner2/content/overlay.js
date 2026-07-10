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
  let apiKey = "";
  let selected = null; // the place currently clicked on the map, or null
  let formMode = null; // "create" | "edit" | null
  let editingStop = null; // index of the stop being edited, or null
  let activeLegs = null;
  let libCollapsed = false; // saved-places section collapsed?
  const collapsedGroups = new Set(); // list names collapsed within the library
  const expandedStops = new Set();
  let detailedStopsView = false;

  const norm = (s) => (s || "").trim().toLowerCase();
  const activeTrip = () => trips.find((t) => t.id === activeId) || null;
  const scrapedMatch = (name) => locations.find((p) => norm(p.name) === norm(name)) || null;

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

  const SVG_EXPAND = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 8 12 4 16 8"></polyline><polyline points="8 16 12 20 16 16"></polyline><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
  const SVG_CONTRACT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 4 12 8 16 4"></polyline><polyline points="8 20 12 16 16 20"></polyline><line x1="12" y1="8" x2="12" y2="16"></line></svg>`;

  const PANEL_CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Roboto:wght@400;500&display=swap');

    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    
    .panel {
      position: fixed; top: 90px; right: 16px; width: 340px; z-index: 2147483647;
      background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      color: #1f1f1f; border: 1px solid rgba(255, 255, 255, 0.4);
      border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); overflow: hidden;
      display: flex; flex-direction: column;
      transition: height 0.25s cubic-bezier(0.2, 0, 0, 1);
    }
    
    .header {
      display: flex; align-items: center; gap: 8px; padding: 12px 14px;
      background: #0b57d0; color: #fff; cursor: move; user-select: none;
    }
    
    .header .title { font-size: 14px; font-weight: 700; flex: 1; display: flex; align-items: center; gap: 6px; }
    
    .header .collapse, .header .expand-y {
      background: rgba(255,255,255,0.2); color: #fff; border: none;
      border-radius: 50%; width: 24px; height: 24px; cursor: pointer; 
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; transition: 0.2s; flex-shrink: 0;
    }
    .header .collapse:hover, .header .expand-y:hover { background: rgba(255,255,255,0.3); }
    .panel.collapsed .expand-y { display: none; }
    
    .body { padding: 12px; max-height: 72vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; transition: max-height 0.25s cubic-bezier(0.2, 0, 0, 1); }
    .panel.collapsed { height: 48px !important; }
    .panel.collapsed .body { display: none; }
    
    .panel.expanded-y .body { max-height: 85vh; }
    .panel.expanded-y .list { max-height: max(160px, calc(85vh - 260px)); }
    
    /* Tabs styling */
    .tabs {
      display: flex; background: rgba(0, 0, 0, 0.04); padding: 4px; gap: 4px; border-radius: 10px; margin-bottom: 4px;
    }
    .tab-btn {
      flex: 1; height: 32px; border-radius: 8px; border: none; background: transparent;
      color: #444746; font-family: 'Outfit', sans-serif; font-size: 12px; font-weight: 600;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      transition: 0.2s;
    }
    .tab-btn.active {
      background: #ffffff; color: #0b57d0; box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    }
    .tab-btn .badge-dot {
      width: 6px; height: 6px; border-radius: 50%; background-color: #ba1a1a; display: inline-block;
    }

    .pane { display: flex; flex-direction: column; gap: 8px; }
    
    button.act {
      width: 100%; padding: 8px 12px; border: 1px solid #747775; border-radius: 18px;
      background: transparent; color: #0b57d0; font-weight: 600; cursor: pointer; font-size: 12px;
      font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; gap: 6px;
      transition: 0.2s;
    }
    button.act:hover { background: rgba(11, 87, 208, 0.04); }
    button.primary { background: #0b57d0; color: #fff; border-color: #0b57d0; }
    button.primary:hover { background: #0842a0; }
    button.primary:disabled, button.act:disabled { opacity: 0.5; cursor: not-allowed; }
    
    input, select {
      width: 100%; padding: 8px 12px; border: 1px solid #747775; border-radius: 8px;
      font-size: 12px; margin-bottom: 6px; background: #fff; color: #1f1f1f;
      outline: none; font-family: 'Outfit', sans-serif;
    }
    input:focus, select:focus { border-color: #0b57d0; }

    .section-title { font-size: 10px; font-weight: 700; color: #444746; text-transform: uppercase; letter-spacing: .06em; margin: 4px 0 2px; }
    .list { max-height: 160px; overflow-y: auto; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 8px; padding: 4px; background: #ffffff; transition: max-height 0.25s cubic-bezier(0.2, 0, 0, 1); }
    
    /* Scrollbar */
    .list::-webkit-scrollbar { width: 4px; }
    .list::-webkit-scrollbar-track { background: transparent; }
    .list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }

    .group-title { font-size: 10px; font-weight: 700; color: #444746; text-transform: uppercase; margin: 6px 2px 2px; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 2px; }
    .group-title .caret { display: inline-block; width: 10px; }
    .section-title.toggle { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 4px; }
    
    .stop-sub { font-size: 10px; color: #444746; margin-top: 2px; }
    .stop-edit { padding: 8px; border: 1px dashed #747775; border-radius: 8px; background: rgba(0, 0, 0, 0.02); display: flex; flex-direction: column; gap: 6px; }
    .stop-edit .two { display: flex; gap: 6px; }
    .stop-edit input { margin-bottom: 0; }
    
    .place, .stop { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 8px; border-bottom: 1px solid rgba(0, 0, 0, 0.03); }
    .place:hover { background: rgba(0,0,0,0.04); }
    .place.match { background: #feefc3; outline: 1px solid #f9ab00; }
    
    .stop.dragging { opacity: 0.4; }
    .stop.dragover { background: #d3e3fd !important; outline: 1px dashed #0b57d0; }
    
    .grow { flex: 1; min-width: 0; }
    .name { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .type { font-size: 10px; color: #00639b; background-color: #c2e7ff; padding: 1px 4px; border-radius: 4px; display: inline-block; margin-top: 2px; width: fit-content; }
    
    .idx { font-weight: 700; color: #0b57d0; background-color: #d3e3fd; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0; }
    
    .rowbtn { border: 1px solid #747775; background: #fff; border-radius: 4px; cursor: pointer; font-size: 11px; padding: 2px 6px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
    .rowbtn:hover { background-color: rgba(11, 87, 208, 0.04); }
    .rowbtn:disabled { opacity: .4; cursor: not-allowed; }
    
    .stop .rowbtn { width: 22px; height: 22px; border-radius: 50%; padding: 0; border: none; background: rgba(0,0,0,0.04); color: #444746; }
    .stop .rowbtn:hover { background-color: #d3e3fd; color: #0b57d0; }
    
    .stop-detail-btn {
      border: 1px solid #747775; background: #fff; border-radius: 4px; cursor: pointer;
      font-size: 10px; height: 22px; padding: 0 8px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      font-family: 'Outfit', sans-serif; font-weight: 500; text-decoration: none;
      box-sizing: border-box; transition: background-color 0.2s, color 0.2s;
      color: #1f1f1f;
    }
    .stop-detail-btn:hover { background-color: rgba(11, 87, 208, 0.04); }
    .stop-detail-btn.website-btn { background-color: #c2e7ff; color: #001d35; border: none; }
    .stop-detail-btn.website-btn:hover { background-color: #b0daf4; }
    .stop-detail-btn.maps-btn { background-color: #d3e3fd; color: #041e49; border: none; }
    .stop-detail-btn.maps-btn:hover { background-color: #c0d5f8; }
    
    .agenda-item-btn {
      width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
      border: none; background: transparent; cursor: pointer; color: #444746; border-radius: 4px; padding: 0;
      transition: background-color 0.2s, color 0.2s;
    }
    .agenda-item-btn:hover { background-color: rgba(0,0,0,0.06); color: #0b57d0; }
    .agenda-item-btn.delete-btn { color: #b3261e; }
    .agenda-item-btn.delete-btn:hover { background-color: rgba(179, 38, 30, 0.08); color: #b3261e; }
    
    /* Material 3 Switch */
    .m3-switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      font-size: 10px;
      font-weight: 600;
      color: #444746;
    }
    .m3-switch input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .m3-switch-track {
      position: relative;
      width: 28px;
      height: 16px;
      background-color: #e1e3e1;
      border: 1.5px solid #dadada;
      border-radius: 8px;
      transition: background-color 0.2s, border-color 0.2s;
      box-sizing: border-box;
      display: inline-block;
    }
    .m3-switch-thumb {
      position: absolute;
      top: 50%;
      left: 2px;
      transform: translateY(-50%);
      width: 8px;
      height: 8px;
      background-color: #444746;
      border-radius: 50%;
      transition: left 0.2s, width 0.2s, height 0.2s, background-color 0.2s;
    }
    .m3-switch input:checked + .m3-switch-track {
      background-color: #0b57d0;
      border-color: #0b57d0;
    }
    .m3-switch input:checked + .m3-switch-track .m3-switch-thumb {
      left: 14px;
      width: 10px;
      height: 10px;
      background-color: #ffffff;
    }
    .m3-switch:hover .m3-switch-track {
      background-color: #d1d3d1;
    }
    .m3-switch:hover input:checked + .m3-switch-track {
      background-color: #0842a0;
      border-color: #0842a0;
    }
    
    .actions { display: flex; gap: 6px; }
    .actions button { margin-bottom: 0; }
    
    .hint { font-size: 11px; color: #444746; margin: 2px 0; }
    .status { font-size: 11px; min-height: 14px; margin-top: 4px; font-weight: 500; text-align: center; }
    
    .card { border: 1px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 12px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
    .card.sel-in-data { background: #feefc3; border-color: #f9ab00; }
    .card-title { font-size: 10px; font-weight: 700; color: #444746; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.04em; }
    
    .sel-name { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
    .sel-sub { font-size: 11px; color: #444746; margin-bottom: 8px; }
    .badge { display: inline-block; font-size: 10px; font-weight: 700; color: #b06000; background: #feefc3; border-radius: 10px; padding: 1px 8px; margin-bottom: 8px; }
    
    .trip-bar { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
    .trip-bar select { margin-bottom: 0; }
    .trip-bar .rowbtn { height: 32px; width: 32px; border-radius: 50%; padding: 0; border: none; background: rgba(0,0,0,0.04); }
    .trip-bar .rowbtn:hover { background-color: #d3e3fd; color: #0b57d0; }
    
    .trip-meta { font-size: 11px; color: #1f1f1f; background: rgba(0, 0, 0, 0.04); border-radius: 8px; padding: 8px 10px; margin: 4px 0 8px; }
    .trip-meta .mt-title { font-weight: 700; font-size: 12px; margin-bottom: 2px; }
    .dates { display: flex; gap: 6px; }
    .hidden { display: none !important; }

    /* Stop Leg Connectors */
    .stop-leg-connector {
      display: flex;
      align-items: center;
      padding: 2px 0 2px 34px;
      margin-top: -2px;
      margin-bottom: -2px;
      position: relative;
      min-height: 24px;
    }
    .stop-leg-connector .leg-line {
      width: 2px;
      height: 100%;
      background-color: rgba(0,0,0,0.12);
      position: absolute;
      left: 51px;
      top: 0;
      z-index: 1;
    }
    .stop-leg-connector .leg-badge {
      font-size: 9px;
      font-weight: 700;
      color: #444746;
      background: #f0f4f9;
      border: 1px solid rgba(0,0,0,0.12);
      padding: 1px 8px;
      border-radius: 10px;
      margin-left: 28px;
      z-index: 2;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
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
      <span class="title"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg> Trip Planner</span>
      <button class="expand-y" title="Expand height">${SVG_EXPAND}</button>
      <button class="collapse" title="Collapse">–</button>
    </div>
    <div class="body">
      <!-- Segmented Navigation Tabs -->
      <div class="tabs">
        <button class="tab-btn active" data-tab="stops"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg> Stops</button>
        <button class="tab-btn" data-tab="library"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> Library</button>
        <button class="tab-btn" data-tab="selection" id="selection-tab-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Selection <span class="badge-dot hidden" id="selection-badge-dot"></span></button>
      </div>

      <div class="tab-content">
        <!-- Stops View -->
        <div class="pane" id="pane-stops">
          <div class="section-title">Trip</div>
          <div class="trip-bar">
            <select class="trip-select"></select>
            <button class="rowbtn newtrip" title="New trip"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
            <button class="rowbtn edittrip" title="Edit trip details"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
            <button class="rowbtn deltrip" title="Delete trip"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
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
          
          <div class="section-title toggle prefs-toggle"><span class="caret">▸</span> Preferences</div>
          <div class="prefs-panel hidden" style="padding: 8px; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; background: rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span class="hint" style="margin: 0; font-weight: 500;">Travel Mode:</span>
              <select class="pref-mode" style="width: 120px; padding: 4px; margin-bottom: 0; font-size: 11px;">
                <option value="DRIVING">🚗 Driving</option>
                <option value="WALKING">🚶 Walking</option>
                <option value="BICYCLING">🚲 Bicycling</option>
                <option value="TRANSIT">🚇 Transit</option>
              </select>
            </div>
            <div style="display: flex; gap: 12px; align-items: center; justify-content: space-between; padding-top: 2px;">
              <label class="hint" style="display: inline-flex; align-items: center; gap: 4px; margin: 0; cursor: pointer; font-size: 11px; user-select: none;">
                <input type="checkbox" class="pref-tolls" style="width: auto; margin-bottom: 0; cursor: pointer;" /> Avoid Tolls
              </label>
              <label class="hint" style="display: inline-flex; align-items: center; gap: 4px; margin: 0; cursor: pointer; font-size: 11px; user-select: none;">
                <input type="checkbox" class="pref-highways" style="width: auto; margin-bottom: 0; cursor: pointer;" /> Avoid Highways
              </label>
            </div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; margin: 6px 0 4px;">
            <div class="section-title" style="margin-bottom: 0;">Stops</div>
            <label class="m3-switch" title="Toggle detailed stops view">
              Detailed View
              <input type="checkbox" class="toggle-detailed-stops" />
              <span class="m3-switch-track">
                <span class="m3-switch-thumb"></span>
              </span>
            </label>
          </div>
          <div class="list triplist"></div>
          <div class="actions" style="margin-top:8px;">
            <button class="act clear">Clear stops</button>
            <button class="act primary route" disabled>Show route on map</button>
          </div>
          <button class="act details">Trip Dashboard</button>
        </div>

        <!-- Library View -->
        <div class="pane hidden" id="pane-library">
          <button class="act primary scrape"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Scrape saved list on this page</button>
          <input class="search" type="search" placeholder="Search saved places…" />
          <div class="section-title toggle lib-toggle"><span class="caret">▾</span> Saved places</div>
          <div class="list library"></div>
        </div>

        <!-- Selection View -->
        <div class="pane hidden" id="pane-selection">
          <div id="selection-placeholder" style="padding:20px 10px; text-align:center; color:#5f6368; font-size:12px;">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5; margin-bottom:6px; display:inline-block;"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
            <p>Click any place on the map to inspect or add it.</p>
          </div>
          
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
        </div>
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
  const selCard = $(".selected");
  const tripSelect = $(".trip-select");
  const tripForm = $(".trip-form");
  const tripMeta = $(".trip-meta");
  const prefsToggle = $(".prefs-toggle");
  const prefsPanel = $(".prefs-panel");
  const prefMode = $(".pref-mode");
  const prefTolls = $(".pref-tolls");
  const prefHighways = $(".pref-highways");
  let prefsCollapsed = true;

  // Tab switching logic
  const tabBtns = shadow.querySelectorAll(".tab-btn");
  const panes = shadow.querySelectorAll(".pane");
  const selectionBadgeDot = shadow.getElementById("selection-badge-dot");

  function switchTab(tabName) {
    tabBtns.forEach(btn => {
      if (btn.getAttribute("data-tab") === tabName) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    panes.forEach(pane => {
      if (pane.id === `pane-${tabName}`) {
        pane.classList.remove("hidden");
      } else {
        pane.classList.add("hidden");
      }
    });

    if (tabName === "selection" && selectionBadgeDot) {
      selectionBadgeDot.classList.add("hidden");
    }
  }

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      switchTab(btn.getAttribute("data-tab"));
    });
  });

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
  let lastSelName = "";
  function renderSelected() {
    if (!selected) {
      selCard.classList.add("hidden");
      const placeholder = shadow.getElementById("selection-placeholder");
      if (placeholder) placeholder.classList.remove("hidden");
      return;
    }
    selCard.classList.remove("hidden");
    const placeholder = shadow.getElementById("selection-placeholder");
    if (placeholder) placeholder.classList.add("hidden");

    // Auto-switch to selection tab if name changes to a new place
    if (selected.name !== lastSelName) {
      lastSelName = selected.name;
      switchTab("selection");
    }

    const match = scrapedMatch(selected.name);
    selCard.classList.toggle("sel-in-data", !!match);
    shadow.querySelector(".sel-name").textContent = selected.name;
    shadow.querySelector(".sel-sub").textContent =
      selected.lat != null ? `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}` : "";
    shadow.querySelector(".sel-badge").classList.toggle("hidden", !match);
    const addSaved = shadow.querySelector(".add-saved");
    addSaved.disabled = !!match;
    addSaved.innerHTML = match ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg> In saved places' : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> Save Place';
    shadow.querySelector(".add-trip").disabled = inActiveTrip(selected.name);
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
        const already = inActiveTrip(place.name);
        const addBtn = document.createElement("button");
        addBtn.className = "rowbtn";
        addBtn.innerHTML = already ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#0b57d0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
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

    if (t) {
      const prefs = t.preferences || { travelMode: "DRIVING", avoidTolls: false, avoidHighways: false };
      prefMode.value = prefs.travelMode || "DRIVING";
      prefTolls.checked = !!prefs.avoidTolls;
      prefHighways.checked = !!prefs.avoidHighways;
      
      prefsToggle.querySelector(".caret").textContent = prefsCollapsed ? "▸" : "▾";
      prefsPanel.classList.toggle("hidden", prefsCollapsed);
      prefsToggle.classList.remove("hidden");
    } else {
      prefsToggle.classList.add("hidden");
      prefsPanel.classList.add("hidden");
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
    activeLegs = null;
    expandedStops.clear();
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
          const result = await route.fetchDirectionsLegs(t.stops, apiKey, t.preferences);
          t.legs = result.legs;
          t.measuredTotal = { distanceText: result.totalMiles + " mi", durationText: result.totalHours + " hr" };
          await storage.updateTrip(t.id, { legs: t.legs, measuredTotal: t.measuredTotal });
          
          trips = await storage.getTrips();
          renderStops();
        } catch (err) {
          console.warn("Failed to auto-refresh directions legs:", err);
        }
      }
    }
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
    
    if (t.legs) {
      activeLegs = t.legs;
    } else {
      activeLegs = null;
    }
    
    refreshLegsIfMismatched(t);

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
          await persistTrips();
          renderStops();
        }
      });

      const handle = document.createElement("div");
      handle.className = "drag-handle";
      handle.style.display = "flex";
      handle.style.alignItems = "center";
      handle.style.marginRight = "4px";
      handle.style.cursor = "grab";
      handle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#747775;"><circle cx="9" cy="5" r="1.5"></circle><circle cx="9" cy="12" r="1.5"></circle><circle cx="9" cy="19" r="1.5"></circle><circle cx="15" cy="5" r="1.5"></circle><circle cx="15" cy="12" r="1.5"></circle><circle cx="15" cy="19" r="1.5"></circle></svg>`;

      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = String(i + 1);
      const info = document.createElement("div");
      info.className = "grow";
      let dateStr = stop.date || "";
      if (stop.date && stop.endDate && stop.endDate !== stop.date) {
        dateStr = `${stop.date} → ${stop.endDate}`;
      }
      const sched = [dateStr, stop.time].filter(Boolean).join(" ");
      
      const agenda = stop.agenda || [];
      let agendaSummaryHtml = "";
      if (detailedStopsView && !expandedStops.has(i) && agenda.length > 0) {
        agendaSummaryHtml += `<div class="compact-agenda-summary" style="display: flex; flex-direction: column; gap: 3px; margin-top: 4px; border-left: 2px solid #0b57d0; padding-left: 6px; font-size: 10px;">`;
        agenda.forEach(item => {
          const time = item.startTime ? `<span style="color:#0b57d0; font-weight:600;">${escapeHtml(item.startTime)}</span>` : "";
          const loc = item.location && item.location.name ? `@ ${item.location.name}` : "";
          agendaSummaryHtml += `
            <div style="color: #444746; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25;">
              ${time ? time + " " : ""}<strong>${escapeHtml(item.title)}</strong> ${escapeHtml(loc)}
            </div>
          `;
        });
        agendaSummaryHtml += `</div>`;
      }

      info.innerHTML =
        `<div class="name">${escapeHtml(stop.name)}</div>` +
        (sched || stop.notes
          ? `<div class="stop-sub">${escapeHtml([sched, stop.notes].filter(Boolean).join(" · "))}</div>`
          : "") +
        agendaSummaryHtml;
      info.style.cursor = "pointer";
      info.title = "Click to expand/collapse details";
      info.addEventListener("click", () => {
        if (expandedStops.has(i)) {
          expandedStops.delete(i);
        } else {
          expandedStops.add(i);
        }
        renderStops();
      });

      const up = document.createElement("button");
      up.className = "rowbtn";
      up.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;
      up.disabled = i === 0;
      up.addEventListener("click", () => moveStop(i, -1));
      const down = document.createElement("button");
      down.className = "rowbtn";
      down.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;
      down.disabled = i === t.stops.length - 1;
      down.addEventListener("click", () => moveStop(i, 1));
      const edit = document.createElement("button");
      edit.className = "rowbtn";
      edit.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
      edit.title = "Edit stop";
      edit.addEventListener("click", () => { editingStop = i; renderStops(); });

      const locBtn = document.createElement("button");
      locBtn.className = "rowbtn";
      locBtn.title = "map-location stop";
      locBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#1f1f1f"><path d="M536.5-503.5Q560-527 560-560t-23.5-56.5Q513-640 480-640t-56.5 23.5Q400-593 400-560t23.5 56.5Q447-480 480-480t56.5-23.5ZM480-186q122-112 181-203.5T720-552q0-109-69.5-178.5T480-800q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186Zm0 106Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 100-79.5 217.5T480-80Zm0-480Z"></path></svg>`;
      locBtn.addEventListener("click", () => {
        let url;
        if (stop.lat != null && stop.lng != null && stop.lat !== "" && stop.lng !== "") {
          const query = stop.addressHint ? `${stop.name}, ${stop.addressHint}` : stop.name;
          url = `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${stop.lat},${stop.lng},16z`;
        } else {
          const query = stop.addressHint ? `${stop.name}, ${stop.addressHint}` : stop.name;
          url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        }
        window.location.assign(url);
      });

      const rm = document.createElement("button");
      rm.className = "rowbtn";
      rm.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      rm.addEventListener("click", () => removeStop(i));
 
      const stopMain = document.createElement("div");
      stopMain.style.display = "flex";
      stopMain.style.alignItems = "center";
      stopMain.style.width = "100%";
      stopMain.style.gap = "8px";
      stopMain.append(handle, idx, info, up, down, locBtn, edit, rm);
      row.style.flexDirection = "column";
      row.style.alignItems = "flex-start";
      row.style.gap = "0";
      row.append(stopMain);
      tripEl.appendChild(row);

      if (expandedStops.has(i)) {
        row.classList.add("expanded");
        
        const expandedDiv = document.createElement("div");
        expandedDiv.className = "stop-expanded-details";
        expandedDiv.style.width = "100%";
        expandedDiv.style.display = "flex";
        expandedDiv.style.flexDirection = "column";
        expandedDiv.style.gap = "6px";
        
        let html = `<div style="padding: 6px 8px 8px 30px; background: rgba(0,0,0,0.02); border-top: 1px solid rgba(0,0,0,0.05); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; display: flex; flex-direction: column; gap: 6px; width: 100%;">`;
        
        if (stop.notes) {
          html += `<div style="font-size: 11px; color: #1f1f1f;"><span style="font-weight:700;">Notes:</span> ${escapeHtml(stop.notes)}</div>`;
        }
        
        // Day Plan Agenda Section
        html += `<div class="agenda-section" style="margin-top: 4px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 6px;">`;
        
        const agenda = stop.agenda || [];
        const validMapItems = agenda.filter(item => item.location && (item.location.name || item.location.lat != null));
        
        html += `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <div style="font-size: 10px; font-weight: 700; color: #444746; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0;">Day Plan Agenda</div>
            <button class="act btn-view-agenda-map hidden" style="width: auto; height: 18px; padding: 0 5px; font-size: 8px; border-radius: 9px; margin-bottom: 0; display: inline-flex; align-items: center; gap: 2px;" title="Show day plan agenda on the map">🗺️ Show on Map</button>
          </div>
        `;
        
        if (agenda.length === 0) {
          html += `<div class="hint" style="margin-bottom: 6px; font-size: 10px;">No agenda items planned.</div>`;
        } else {
          html += `<div class="agenda-items" style="display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px;">`;
          agenda.forEach((item, itemIdx) => {
            const timeText = [item.startTime, item.endTime].filter(Boolean).join(" - ");
            const locText = item.location && item.location.name ? `@ ${item.location.name}` : "";
            html += `
              <div class="agenda-item-row" style="display: flex; align-items: flex-start; justify-content: space-between; background: #ffffff; border: 1px solid rgba(0,0,0,0.06); border-radius: 6px; padding: 4px 6px; gap: 6px;">
                <div class="agenda-item-info" style="flex: 1; min-width: 0; font-size: 11px; line-height: 1.3;">
                  <div style="font-weight: 600; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                    ${timeText ? `<span style="color: #0b57d0; background: #d3e3fd; padding: 0px 4px; border-radius: 3px; font-size: 9px; font-weight: 700;">${escapeHtml(timeText)}</span>` : ""}
                    <span>${escapeHtml(item.title)}</span>
                    ${locText ? `<span style="font-size: 10px; color: #00639b; font-weight: 500;">${escapeHtml(locText)}</span>` : ""}
                  </div>
                  ${item.summary ? `<div style="font-size: 10px; color: #444746; margin-top: 1px; font-style: italic;">${escapeHtml(item.summary)}</div>` : ""}
                </div>
                <div class="agenda-item-actions" style="display: flex; gap: 2.5px; flex-shrink: 0; align-self: center;">
                  <button class="agenda-item-btn btn-edit-agenda" data-item-idx="${itemIdx}" title="Edit item"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                  <button class="agenda-item-btn delete-btn btn-delete-agenda" data-item-idx="${itemIdx}" title="Delete item"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                </div>
              </div>
            `;
            
            // Distance/Time between agenda items in overlay stops view
            if (itemIdx < agenda.length - 1) {
              const nextItem = agenda[itemIdx + 1];
              if (item.location && item.location.lat != null && nextItem.location && nextItem.location.lat != null) {
                const dist = route.getHaversineDistance(item.location.lat, item.location.lng, nextItem.location.lat, nextItem.location.lng);
                if (dist != null) {
                  let avgSpeed = 40;
                  const mode = (t.preferences && t.preferences.travelMode || "DRIVING").toUpperCase();
                  if (mode === "WALKING") avgSpeed = 3;
                  else if (mode === "BICYCLING") avgSpeed = 12;
                  else if (mode === "TRANSIT") avgSpeed = 15;
                  
                  const estHours = dist / avgSpeed;
                  const estMins = Math.round(estHours * 60);
                  let durationText = estMins >= 60 ? `${Math.floor(estMins/60)}h ${estMins%60}m` : `${estMins}m`;
                  let emoji = "🚗";
                  if (mode === "WALKING") emoji = "🚶";
                  else if (mode === "BICYCLING") emoji = "🚲";
                  else if (mode === "TRANSIT") emoji = "🚇";
                  
                  html += `
                    <div class="agenda-leg-connector" style="display: flex; align-items: center; padding: 2px 0 2px 20px; position: relative; min-height: 16px;">
                      <div class="agenda-leg-line" style="width: 1px; height: 100%; background: rgba(0,0,0,0.08); position: absolute; left: 30px; top: 0; z-index: 1;"></div>
                      <div class="agenda-leg-badge" style="font-size: 8px; font-weight: 700; color: #444746; background: #f0f4f9; border: 1px solid rgba(0,0,0,0.08); padding: 1px 6px; border-radius: 8px; margin-left: 20px; z-index: 2;">
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
          <div class="agenda-form-container" style="background: rgba(0,0,0,0.02); border-radius: 6px; padding: 6px; border: 1px dashed rgba(0,0,0,0.1); margin-bottom: 2px;">
            <div style="font-size: 10px; font-weight: 700; color: #444746; margin-bottom: 4px;" class="agenda-form-title">Add Agenda Item</div>
            <input type="hidden" class="ag-edit-idx" value="" />
            <input type="hidden" class="ag-location-lat" value="" />
            <input type="hidden" class="ag-location-lng" value="" />
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <input class="ag-title" type="text" placeholder="Title (e.g. Lunch)" style="font-size: 11px; padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.15); outline: none; margin-bottom: 0; width: 100%; box-sizing: border-box; background:#fff; color:#1f1f1f;" />
              <div style="display: flex; gap: 4px;">
                <label style="flex: 1; font-size: 9px; color: #444746; display: flex; flex-direction: column; gap: 1px;">Start <input class="ag-start" type="time" style="font-size: 10px; padding: 2px 4px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.15); outline: none; box-sizing: border-box; width: 100%; background:#fff; color:#1f1f1f;" /></label>
                <label style="flex: 1; font-size: 9px; color: #444746; display: flex; flex-direction: column; gap: 1px;">End <input class="ag-end" type="time" style="font-size: 10px; padding: 2px 4px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.15); outline: none; box-sizing: border-box; width: 100%; background:#fff; color:#1f1f1f;" /></label>
              </div>
              <div style="display: flex; gap: 4px; align-items: center;">
                <input class="ag-location" type="text" placeholder="Location name (optional)" style="font-size: 11px; padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.15); outline: none; margin-bottom: 0; flex: 1; box-sizing: border-box; background:#fff; color:#1f1f1f;" />
                <button class="act btn-use-selected" style="width: auto; height: 22px; padding: 0 6px; font-size: 9px; border-radius: 11px; margin-bottom: 0; white-space: nowrap; flex-shrink: 0;" title="Fill from map selection">📍 Use Selected</button>
              </div>
              <input class="ag-summary" type="text" placeholder="Notes (optional)" style="font-size: 11px; padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.15); outline: none; margin-bottom: 0; width: 100%; box-sizing: border-box; background:#fff; color:#1f1f1f;" />
              <div style="display: flex; justify-content: flex-end; gap: 4px; margin-top: 2px;">
                <button class="act btn-cancel-agenda hidden" style="width: auto; height: 22px; padding: 0 8px; font-size: 9px; border-radius: 11px; margin-bottom: 0;">Cancel</button>
                <button class="act primary btn-save-agenda" style="width: auto; height: 22px; padding: 0 8px; font-size: 9px; border-radius: 11px; margin-bottom: 0;">Add to agenda</button>
              </div>
            </div>
          </div>
        </div>`;
        
        html += `<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 4px;">`;
        
        if (stop.url) {
          html += `<a href="${escapeHtml(stop.url)}" target="_blank" rel="noopener" class="stop-detail-btn website-btn">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            Website
          </a>`;
        }
        
        if (stop.lat != null) {
          const mapsLink = `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
          html += `<a href="${mapsLink}" target="_blank" rel="noopener" class="stop-detail-btn maps-btn">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            Maps
          </a>`;
        }
        
        html += `<button class="stop-detail-btn btn-edit-inline">
          Edit details
        </button>`;
        
        html += `</div></div>`;
        expandedDiv.innerHTML = html;
        
        // Wire Agenda Form buttons & inputs
        const agTitleInput = expandedDiv.querySelector(".ag-title");
        const agStartInput = expandedDiv.querySelector(".ag-start");
        const agEndInput = expandedDiv.querySelector(".ag-end");
        const agLocInput = expandedDiv.querySelector(".ag-location");
        const agSumInput = expandedDiv.querySelector(".ag-summary");
        const agEditIdx = expandedDiv.querySelector(".ag-edit-idx");
        const btnSaveAgenda = expandedDiv.querySelector(".btn-save-agenda");
        const btnCancelAgenda = expandedDiv.querySelector(".btn-cancel-agenda");
        const formTitle = expandedDiv.querySelector(".agenda-form-title");
        
        btnSaveAgenda.addEventListener("click", async (e) => {
          e.stopPropagation();
          const title = agTitleInput.value.trim();
          if (!title) return;
          
          const currentAgenda = [...(stop.agenda || [])];
          const editIdxVal = agEditIdx.value;
          const latVal = expandedDiv.querySelector(".ag-location-lat").value;
          const lngVal = expandedDiv.querySelector(".ag-location-lng").value;
          
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
          
          trips = await storage.updateStopInTrip(activeId, i, { agenda: currentAgenda });
          renderStops();
        });
        
        btnCancelAgenda.addEventListener("click", (e) => {
          e.stopPropagation();
          agTitleInput.value = "";
          agStartInput.value = "";
          agEndInput.value = "";
          agLocInput.value = "";
          agSumInput.value = "";
          agEditIdx.value = "";
          expandedDiv.querySelector(".ag-location-lat").value = "";
          expandedDiv.querySelector(".ag-location-lng").value = "";
          
          formTitle.textContent = "Add Agenda Item";
          btnSaveAgenda.textContent = "Add to agenda";
          btnCancelAgenda.classList.add("hidden");
        });
        
        // Delete buttons
        expandedDiv.querySelectorAll(".btn-delete-agenda").forEach(btn => {
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute("data-item-idx"), 10);
            const currentAgenda = [...(stop.agenda || [])];
            currentAgenda.splice(idx, 1);
            trips = await storage.updateStopInTrip(activeId, i, { agenda: currentAgenda });
            renderStops();
          });
        });
        
        // Edit buttons
        expandedDiv.querySelectorAll(".btn-edit-agenda").forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute("data-item-idx"), 10);
            const item = stop.agenda[idx];
            
            agTitleInput.value = item.title || "";
            agStartInput.value = item.startTime || "";
            agEndInput.value = item.endTime || "";
            agLocInput.value = (item.location && item.location.name) || "";
            expandedDiv.querySelector(".ag-location-lat").value = (item.location && item.location.lat != null) ? String(item.location.lat) : "";
            expandedDiv.querySelector(".ag-location-lng").value = (item.location && item.location.lng != null) ? String(item.location.lng) : "";
            agSumInput.value = item.summary || "";
            agEditIdx.value = String(idx);
            
            formTitle.textContent = "Edit Agenda Item";
            btnSaveAgenda.textContent = "Save item";
            btnCancelAgenda.classList.remove("hidden");
          });
        });
        
        // Use Map Selection button
        const btnUseSelected = expandedDiv.querySelector(".btn-use-selected");
        btnUseSelected.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!selected) {
            alert("No place selected on map. Click a place on the map first.");
            return;
          }
          agLocInput.value = selected.name;
          expandedDiv.querySelector(".ag-location-lat").value = selected.lat != null ? String(selected.lat) : "";
          expandedDiv.querySelector(".ag-location-lng").value = selected.lng != null ? String(selected.lng) : "";
        });
        
        // Show on Map button
        const showOnMapBtn = expandedDiv.querySelector(".btn-view-agenda-map");
        if (validMapItems.length >= 2) {
          showOnMapBtn.classList.remove("hidden");
          showOnMapBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const url = buildAgendaDirectionsUrl(agenda, t.preferences);
            if (url) {
              setStatus("Opening agenda on the map…");
              window.location.assign(url);
            }
          });
        }
        
        expandedDiv.querySelector(".btn-edit-inline").addEventListener("click", (e) => {
          e.stopPropagation();
          editingStop = i;
          renderStops();
        });
        
        row.appendChild(expandedDiv);
      }

      if (i < t.stops.length - 1) {
        const legDiv = document.createElement("div");
        legDiv.className = "stop-leg-connector";
        
        let labelText = "";
        if (activeLegs && activeLegs[i]) {
          labelText = `${activeLegs[i].distanceText} · ${activeLegs[i].durationText}`;
        } else {
          const nextStop = t.stops[i + 1];
          const dist = route.getHaversineDistance(stop.lat, stop.lng, nextStop.lat, nextStop.lng);
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
                durationText = `${estMins}m`;
              }
              
              let emoji = "🚗";
              if (mode === "WALKING") emoji = "🚶";
              else if (mode === "BICYCLING") emoji = "🚲";
              else if (mode === "TRANSIT") emoji = "🚇";

              labelText = `${dist.toFixed(1)} mi · ${emoji} ~${durationText}`;
            }
          }
        }
        
        legDiv.innerHTML = `<div class="leg-line"></div>` + 
                           (labelText ? `<div class="leg-badge">${labelText}</div>` : "");
        tripEl.appendChild(legDiv);
      }
    });
  }

  function buildStopEditor(stop, i) {
    const box = document.createElement("div");
    box.className = "stop-edit";
    box.innerHTML = `
      <input class="se-name" type="text" value="${escapeHtml(stop.name)}" placeholder="Stop name" />
      
      <div class="se-date-type-container" style="display: flex; gap: 12px; margin-bottom: 4px;">
        <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: #444746;">
          <input type="radio" name="date-type-${i}" class="se-type-single" ${!stop.endDate || stop.endDate === stop.date ? 'checked' : ''} style="margin-bottom: 0; width: auto;" /> One day
        </label>
        <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: #444746;">
          <input type="radio" name="date-type-${i}" class="se-type-range" ${stop.endDate && stop.endDate !== stop.date ? 'checked' : ''} style="margin-bottom: 0; width: auto;" /> Date range
        </label>
      </div>

      <!-- Single Date Input Field -->
      <div class="two se-single-date-row ${stop.endDate && stop.endDate !== stop.date ? 'hidden' : ''}">
        <input class="se-date" type="date" value="${escapeHtml(stop.date || "")}" title="Date" style="flex: 1;" />
      </div>

      <!-- Date Range Input Fields -->
      <div class="two se-range-date-row ${stop.endDate && stop.endDate !== stop.date ? '' : 'hidden'}">
        <input class="se-start-date" type="date" value="${escapeHtml(stop.date || "")}" title="Start date" style="flex: 1; min-width: 0;" />
        <input class="se-end-date" type="date" value="${escapeHtml(stop.endDate || "")}" title="End date" style="flex: 1; min-width: 0;" />
      </div>

      <div class="two">
        <input class="se-time" type="time" value="${escapeHtml(stop.time || "")}" title="Time" style="flex: 1;" />
      </div>

      <input class="se-notes" type="text" value="${escapeHtml(stop.notes || "")}" placeholder="Notes (optional)" />
      <div class="actions">
        <button class="act se-done primary btn btn-primary">Done</button>
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
    updateVisibility();

    const save = async () => {
      const isRange = typeRange.checked;
      const date = isRange ? box.querySelector(".se-start-date").value : box.querySelector(".se-date").value;
      const endDate = isRange ? box.querySelector(".se-end-date").value : "";

      trips = await storage.updateStopInTrip(activeId, i, {
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
    const m = location.pathname.match(/\/maps\/place\/([^/@]+)/);
    if (!m) return null;
    let name = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    // The place's REAL coordinates are in the data segment as !3d<lat>!4d<lng>.
    // The /@lat,lng that also appears in the URL is only the map viewport
    // center, so we must not use that as the place location.
    let lat = null,
      lng = null;
    const d = location.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (d) {
      lat = parseFloat(d[1]);
      lng = parseFloat(d[2]);
    }
    if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(name)) name = "Dropped pin";
    
    let url = "";
    const websiteEl = document.querySelector('a[data-item-id="authority"]') || 
                      document.querySelector('a[aria-label^="Website:"]') ||
                      document.querySelector('a[aria-label*="website"]') ||
                      document.querySelector('a[data-attribution-url]');
    if (websiteEl && websiteEl.href) {
      url = websiteEl.href;
    }
    
    return { name, lat, lng, url };
  }

  // ---- Reading Google's own route totals off the /maps/dir/ page ---------
  // After "Show route on map" navigates the tab to Google's directions view,
  // Google has already computed the trip's distance and time. We're running
  // on that page, so we read those numbers straight from the DOM instead of
  // needing the Directions API. Best-effort: Google's markup is unofficial.
  const DUR_RE = /(\d+\s*days?|\d+\s*hr(?:\s*\d+\s*min)?|\d+\s*min)/i;
  const DIST_RE = /([\d.,]+)\s*(miles|mi|km)\b/i;

  function parseRouteTotalsFromDom() {
    if (!/\/maps\/dir\//.test(location.pathname)) return null;
    // Prefer a route-option aria-label that carries both a duration and a
    // distance (e.g. "13 hr 15 min, 827 miles, This route has tolls").
    const labels = Array.from(document.querySelectorAll("[aria-label]")).map(
      (e) => e.getAttribute("aria-label") || ""
    );
    for (const l of labels) {
      if (DUR_RE.test(l) && DIST_RE.test(l)) {
        return { durationText: l.match(DUR_RE)[1].trim(), distanceText: l.match(DIST_RE)[0].trim() };
      }
    }
    // Fallback: scan the panel's visible text for the first duration+distance.
    const text = document.body.innerText || "";
    const d = text.match(DUR_RE);
    const s = text.match(DIST_RE);
    if (d && s) return { durationText: d[1].trim(), distanceText: s[0].trim() };
    return null;
  }

  // Exposed for automated testing of the parser.
  window.__mtpParseTotals = parseRouteTotalsFromDom;

  async function captureRouteTotals() {
    if (!/\/maps\/dir\//.test(location.pathname)) return;
    for (let i = 0; i < 16; i++) {
      const totals = parseRouteTotalsFromDom();
      if (totals) {
        const allTrips = await storage.getTrips();
        const id = await storage.getActiveTripId();
        const t = allTrips.find((x) => x.id === id);
        if (t) {
          t.measuredTotal = { ...totals, at: Date.now() };
          await storage.saveTrips(allTrips);
          trips = allTrips;
          setStatus(`Route: ${totals.distanceText} · ${totals.durationText}`);
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  let lastSelKey = "";
  async function checkSelection() {
    const p = parseSelectedPlace();
    const key = p ? `${p.name}|${p.lat}|${p.lng}` : "";
    if (key === lastSelKey) return;
    lastSelKey = key;
    selected = p;
    await chrome.storage.local.set({ mapSelection: selected });
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
  // A content script can't open an extension page itself, so ask the
  // service worker to do it.
  $(".details").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "openPlanner", query: "?view=detail" });
  });

  tripSelect.addEventListener("change", async () => {
    activeId = tripSelect.value;
    editingStop = null;
    activeLegs = null;
    expandedStops.clear();
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

  $(".toggle-detailed-stops").addEventListener("change", (e) => {
    detailedStopsView = e.target.checked;
    renderStops();
  });

  prefsToggle.addEventListener("click", () => {
    prefsCollapsed = !prefsCollapsed;
    prefsToggle.querySelector(".caret").textContent = prefsCollapsed ? "▸" : "▾";
    prefsPanel.classList.toggle("hidden", prefsCollapsed);
  });

  async function savePrefs(patch) {
    const t = activeTrip();
    if (!t) return;
    const current = t.preferences || { travelMode: "DRIVING", avoidTolls: false, avoidHighways: false };
    const updated = { ...current, ...patch };
    await storage.updateTrip(activeId, { preferences: updated });
    t.preferences = updated;
    setStatus("Route preferences saved.");
  }

  prefMode.addEventListener("change", (e) => savePrefs({ travelMode: e.target.value }));
  prefTolls.addEventListener("change", (e) => savePrefs({ avoidTolls: e.target.checked }));
  prefHighways.addEventListener("change", (e) => savePrefs({ avoidHighways: e.target.checked }));

  // "Drive the real map": navigate this Maps tab to the directions URL scheme.
  // Google's own /maps/dir/ URL loads the route on the real map, so we don't
  // poke Google's internal DOM (which would be the brittle way).
  routeBtn.addEventListener("click", () => {
    const t = activeTrip();
    if (!t) return;
    const url = route.buildDirectionsUrl(t.stops, t.preferences);
    if (!url) return;
    window.__mtpLastRouteUrl = url; // test hook; harmless in production
    setStatus("Opening route on the map…");
    window.location.assign(url);
  });

  $(".expand-y").addEventListener("click", () => {
    const expanded = panel.classList.toggle("expanded-y");
    const expandBtn = $(".expand-y");
    expandBtn.innerHTML = expanded ? SVG_CONTRACT : SVG_EXPAND;
    expandBtn.title = expanded ? "Contract height" : "Expand height";
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
      if (e.target.closest(".collapse") || e.target.closest(".expand-y")) return;
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
    if (changes.googleMapsApiKey) { apiKey = changes.googleMapsApiKey.newValue || ""; reloadTrips(); }
    if (changes.trips || changes.activeTripId) {
      const newVal = changes.trips ? changes.trips.newValue : undefined;
      const newIdVal = changes.activeTripId ? changes.activeTripId.newValue : undefined;
      
      const hasIdChanged = newIdVal !== undefined && newIdVal !== activeId;
      const hasTripsChanged = newVal !== undefined && JSON.stringify(newVal) !== JSON.stringify(trips);
      
      if (hasIdChanged || hasTripsChanged) {
        reloadTrips();
      }
    }
  });

  // Poll for map selection changes.
  setInterval(checkSelection, 800);
  window.addEventListener("popstate", checkSelection);

  async function init() {
    locations = await storage.getLocations();
    apiKey = await storage.getApiKey();
    await reloadTrips();
    checkSelection();
    // If we've just landed on a directions page (e.g. from "Show route on
    // map"), read Google's computed distance/time for the active trip.
    captureRouteTotals();
  }

  await init();
})();
