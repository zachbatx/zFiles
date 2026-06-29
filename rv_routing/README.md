# RV Trip Planner

A personal, single-user web app for planning RV trip routes on Google Maps.
No backend, no accounts — everything is stored in your browser (localStorage),
with JSON export/import for backup.

## What it does today (v1)

- **Map view** of your route with each stop pinned and numbered.
- **Campground library** loaded from your Google Maps saved lists
  (Florida route + West parks), searchable and filterable.
- **Build & save trips**: add stops in order, assign a date to each.
- **Per-leg stats**: distance, drive time, and average speed.
- **Fuel planning**: based on your rig's MPG, tank size, and reserve %, it
  computes your usable range and flags any leg that goes *beyond one tank* so
  you know to plan a fuel stop. Shows gallons + estimated cost per leg.
- **The "330 rule"**: warns when a leg exceeds your max miles/day.
- **Trip totals**: total miles, drive time, and estimated fuel cost.
- **Export / import** a trip as JSON, and a **printable itinerary**.

## Running it

It's a static site — no build step.

- **Locally**: `cd rv_routing && python3 -m http.server 8000` then open
  <http://localhost:8000>. (Serving over http avoids browser quirks with the
  Maps API vs. opening the file directly.)
- **GitHub Pages**: enable Pages on this repo and point it at `/rv_routing`.

On first load you'll be asked for a **Google Maps API key**. It's stored only
in your browser. You need a key with these APIs enabled in
[Google Cloud Console](https://console.cloud.google.com/):
*Maps JavaScript API*, *Directions API*, *Places API*, *Geocoding API*.

## Data

`google_maps/*.html` are the raw saved-list exports from Google Maps.
`data/campgrounds.json` is the cleaned dataset (name, list, type, address hint),
and `data.js` embeds it for the app. To refresh after updating the source lists,
re-run the extraction (see commit history) to regenerate both files.

## Known limitation

Google's standard Directions API routes like a **car**, not an RV — it does not
avoid low bridges or weight-restricted roads by your rig's dimensions. Use the
route for distances/time/fuel and stay aware of clearances. True RV-safe routing
needs a truck-routing provider (HERE, etc.) — a candidate for a later version.

## Ideas for later versions

- Elevation / grade profile per leg (mountain passes).
- Weather along the route and at each stop for your dates.
- Overnight alternates (Harvest Hosts, Boondockers Welcome, Walmart, rest areas).
- Service stops: propane, dump stations, fresh water.
- Campground details: hookups (30/50 amp), max rig length, reservation # + dates.
- Toll estimates; per-day cost rollup.
- Multiple rig profiles.
- True RV-safe (dimension-aware) routing.
