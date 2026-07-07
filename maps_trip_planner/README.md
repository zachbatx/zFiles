# Maps Trip Planner

A personal Chrome extension (Manifest V3) that turns your **Google Maps saved
lists** into **routed, multi-stop trips**. Pull in your saved places, group
them into named trips, reorder the stops, and open the finished route on
Google's real map — with an optional API key for an embedded map and per-leg
distance/time.

No backend, no accounts, no analytics. Everything lives in `chrome.storage.local`
on your own machine.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Install (unpacked)](#install-unpacked)
- [Quick start](#quick-start)
- [Getting your saved places in](#getting-your-saved-places-in)
- [The on-map overlay](#the-on-map-overlay)
- [Working with trips](#working-with-trips)
- [Building a route](#building-a-route)
- [Optional Google Maps API key](#optional-google-maps-api-key)
- [Three surfaces, one store](#three-surfaces-one-store)
- [Project structure](#project-structure)
- [Data model](#data-model)
- [Privacy & permissions](#privacy--permissions)
- [Known limitations](#known-limitations)
- [Development notes](#development-notes)

---

## Why this exists

Google Maps lets you save places into lists (Want to go, Favorites, custom
lists), but it doesn't let you turn a whole list into an ordered, multi-stop
trip you can plan and re-plan. There's also no public API for your personal
saved lists. This extension bridges that gap entirely client-side: it reads the
places you've already saved and gives you a proper trip planner on top of them.

## Features

- **Two ways to load places** — scrape a saved list live from the Google Maps
  page, or import an HTML/JSON export.
- **Floating overlay on Google Maps** — a draggable, collapsible Trip Planner
  panel injected right onto `google.com/maps`.
- **Click-to-capture** — click any place on the map and it appears in the
  panel, ready to save or add to a trip. If it's already in your data, it's
  highlighted.
- **Multiple named trips** — each with a title, summary, and start/end dates,
  plus its own ordered list of stops.
- **Route building with no API key** — generates a Google Maps multi-stop
  directions link (and, from the overlay, loads the route onto the real map).
- **Optional embedded map + distances** — add a Google Maps API key to see the
  route drawn in-app with per-leg distance/time and trip totals.
- **One shared store** — the popup, the full-tab planner, and the on-map
  overlay all read and write the same data and stay in sync.

## Install (unpacked)

This is a personal/unpacked extension — it isn't on the Chrome Web Store.

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `maps_trip_planner/` folder.
4. Pin it from the toolbar's puzzle-piece menu if you want quick access.

After an update, click the **↻ reload** icon on the extension's card, and
**refresh any open Google Maps tab** (content scripts only inject on load).

## Quick start

1. Open [google.com/maps](https://www.google.com/maps), go to **Saved**, and
   open one of your lists so its places show in the side panel.
2. In the floating **Trip Planner** panel, click **Scrape saved list on this
   page**.
3. Click **＋** to create a trip; give it a title and dates.
4. Click **Add** next to a few places (or click places on the map and use
   **Add to trip**).
5. Reorder with ↑ / ↓, then click **Show route on map**.

## Getting your saved places in

Google doesn't expose an API for personal saved lists, so there are two paths.

### Live scrape (primary)

On `google.com/maps`, open a saved list in the side panel, then click **Scrape
saved list on this page** — in the overlay panel or in the extension popup. It
auto-scrolls the list to load every item, then reads each place's name and
category.

### Import HTML or JSON (fallback)

Google's markup is unofficial and can change; when the live scrape misbehaves,
use **Import HTML or JSON export** in the popup:

- **HTML** — save the saved-list panel's HTML to a file (or reuse an export
  like the ones under `../rv_routing/google_maps/`).
- **JSON** — an array of `{ name, list, type, address_hint }` objects (the same
  shape as `rv_routing/data/campgrounds.json`).

Both paths land in the same store, de-duped by (list name, place name), so
re-scraping or re-importing refreshes existing entries instead of duplicating
them.

## The on-map overlay

While you're on `google.com/maps`, a **Trip Planner** panel floats in the
top-right corner. Drag its header to move it; click **–** to collapse it. It's
rendered inside a Shadow DOM so Google's page styles can't interfere with it
(and vice versa).

### Clicking places on the map

When you click any place on Google Maps, the overlay detects it by reading
Google's own `/maps/place/...` URL (not its internal DOM) and shows a
**Selected on map** card:

- If the place is **already in your saved data**, the card shows an *"Already in
  saved places"* badge and the matching row in the saved-places list is
  highlighted.
- **Add to saved places** stores it in a **"Map picks"** list, kept separate
  from your scraped Google lists.
- **Add to trip** drops it into the active trip as a stop. Map-clicked places
  carry exact coordinates, so they're routed by lat/lng — more precise than a
  name lookup.

## Working with trips

Both the overlay and the full-tab planner manage **multiple named trips**:

- The **trip dropdown** switches between trips.
- **＋** creates a trip, **✎** edits its details, **🗑** deletes it.
- A trip's details are a **title, summary, start date, and end date**.
- Each trip keeps its own ordered list of stops. **Add** always adds to the
  currently selected trip.
- Reorder stops with ↑ / ↓, remove with ✕, or **Clear stops** to empty the
  trip.

### Editing stops

Each stop has an **✎ edit** button that opens inline fields for:

- **Name** (e.g. correct an ambiguous saved-list name so it routes right)
- **Date** and **Time**
- **Notes**

The date/time/notes show under the stop name and flow into the detailed
itinerary. Edits save immediately.

### Collapsible saved places

The **Saved places** container collapses/expands as a whole (click its
heading), and each list group within it collapses independently (click the
group title) — handy when you've scraped several long lists.

### Detailed view (itinerary)

**Detailed view** (in the planner tab; the overlay has a button that opens it)
shows a stop-by-stop **itinerary**: each stop with its date/time/notes, the
driving **distance and time to the next stop**, and **overall distance and
driving time** for the trip. Per-leg distances/times need a Google Maps API
key (see below); without one, the itinerary still lists the stops and their
schedule.

## Building a route

With at least two stops in the active trip:

- **No API key needed** — the planner produces an **Open route in Google Maps**
  link, and the overlay's **Show route on map** button loads the route directly
  onto Google's real map by navigating the tab to Google's own `/maps/dir/`
  directions URL. (This uses the documented URL scheme rather than manipulating
  Google's internal DOM, so it's robust against UI changes.)
- **With an API key** — the full-tab planner also embeds an interactive map with
  the route drawn and lists per-leg distance/time plus trip totals.

## Optional Google Maps API key

Paste a key into **API key settings** in the planner tab to unlock the embedded
map and distances. The key needs these APIs enabled in
[Google Cloud Console](https://console.cloud.google.com/):

- **Maps Embed API** — the in-app map with the route drawn.
- **Directions API** — per-leg distance/time and totals.

It's stored locally in plain text, so restrict it (e.g. HTTP referrer
`chrome-extension://<your-extension-id>/*`). Without a key, everything except
the embedded map and distances still works.

## Three surfaces, one store

| Surface | Where | Best for |
|---|---|---|
| **Popup** | Toolbar icon | Scraping/importing, quick counts, opening the planner |
| **Overlay** | Floating panel on `google.com/maps` | Capturing map clicks, quick trip edits without leaving the map |
| **Planner tab** | `planner.html` full page | Focused planning, the embedded map, per-leg distances |

All three read and write the same `chrome.storage.local`, and the overlay
listens for storage changes, so edits in one surface show up in the others.

## Project structure

```
maps_trip_planner/
├── manifest.json         MV3 manifest (permissions, popup, content script)
├── popup.html/js/css     Toolbar popup: scrape / import / open planner
├── planner.html/js/css   Full-tab planner: trips, stops, embedded map
├── content/
│   └── overlay.js        Content script: the floating on-map panel
├── lib/
│   ├── storage.js        chrome.storage helpers: locations + trips model
│   ├── scraper.js        Saved-list DOM scrape + HTML/JSON import parsing
│   └── route.js          Google Maps directions / embed URLs + Directions API
├── icons/                Generated pin icons (16/48/128)
└── scripts/
    └── gen_icons.py      Regenerates the icons (no external deps)
```

The `lib/` modules are shared by all three surfaces. The overlay is a classic
content script, so it dynamically `import()`s those modules (they're listed in
`web_accessible_resources`) rather than duplicating the logic.

## Data model

Stored in `chrome.storage.local`:

- **`locations`** — flat array of saved places:
  `{ name, type, addressHint, listName, lat?, lng? }`
- **`trips`** — array of trips:
  `{ id, title, summary, startDate, endDate, stops: [stop, …] }`
  where a stop is `{ name, listName, addressHint, lat?, lng?, date?, time?, notes? }`
- **`activeTripId`** — id of the currently selected trip.
- **`googleMapsApiKey`** — the optional API key.

An earlier single-trip format (`currentTrip`) is migrated into the trips model
automatically the first time trips are read, so no data is lost on upgrade.

## Privacy & permissions

- **No servers.** All data stays in your browser's local storage. Nothing is
  sent anywhere except direct calls to Google (opening a directions URL, the
  embedded map, and — only if you add a key — the Directions API).
- **Permissions requested:**
  - `storage` — save your places, trips, and API key locally.
  - `scripting` + `activeTab` — run the scrape on the active Maps tab.
  - `host_permissions` / `content_scripts` for `https://www.google.com/maps/*`
    — inject the overlay and read the open saved list.

## Known limitations

- **Scraper fragility.** The saved-list scrape depends on Google's current
  (unofficial, hashed) markup. It anchors on the more-stable typography classes
  (`fontHeadlineSmall`, `fontHeadlineLarge`) and a rating-badge (`role="img"`)
  skip rule to find each place's category — if Google reshuffles the panel it
  can silently start missing fields. HTML/JSON import is the fallback.
- **No coordinates from saved lists.** Saved lists expose names/categories but
  not coordinates or place IDs, so routing relies on Google resolving those
  names server-side; an ambiguous name can resolve to the wrong location. (Map-
  clicked places *do* carry coordinates and route precisely.)
- **Map-click coverage.** The "Selected on map" card is populated from the
  `/maps/place/<name>/@lat,lng` URL Google sets on a place click. That scheme
  has been stable for years, but selections that don't produce a `/maps/place/`
  URL (some transit/area selections) won't populate the card.
- **Directions API CORS.** The per-leg distance/time fetch needs the API to
  return CORS headers for browser requests. If your key/project doesn't allow
  that, the embedded map still renders — you just lose the distance breakdown,
  with a message saying so.

## Development notes

- It's a static, build-step-free extension — edit the files and hit reload in
  `chrome://extensions`.
- Icons are generated with `python3 scripts/gen_icons.py` (pure standard
  library, no Pillow needed).
- The three surfaces share `lib/`, so fixes to scrape/route/storage logic apply
  everywhere at once.
