# Maps Trip Planner

A personal Chrome extension (Manifest V3) that turns your Google Maps saved
lists into a routed trip. No backend, no account — everything lives in
`chrome.storage.local` on your machine.

## Install (unpacked)

1. Go to `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select this `maps_trip_planner/` folder.

## Getting your saved places in

**Live scrape (primary):** open [google.com/maps](https://www.google.com/maps),
go to *Saved* and open one of your lists so its places are showing in the side
panel, then click the extension icon and hit **Scrape saved list from this
tab**. It auto-scrolls the panel to load every item before reading it.

**Import (fallback):** if the live scraper breaks — Google's markup is
unofficial and can change — save the list panel's HTML to a file (or reuse
exports like the ones in `../rv_routing/google_maps/`) and use **Import
HTML or JSON export** in the popup. JSON in the same shape as
`rv_routing/data/campgrounds.json` (`{name, list, type, address_hint}`) works
too.

Both paths land in the same store, keyed by (list name, place name), so
re-scraping or re-importing just refreshes existing entries instead of
duplicating them.

## Planning a trip

Click **Open Trip Planner** in the popup. Search/select saved places on the
left, add them to the trip in the middle, reorder with the ↑/↓ buttons, then
**Build route**.

- **No API key needed:** you get an **Open route in Google Maps** link built
  from your stops' names — Google resolves everything when you open it.
- **Optional Google Maps API key:** paste one into *API key settings* to also
  get an embedded map with the route drawn, plus real per-leg distance/time
  and trip totals. The key needs the **Maps Embed API** and **Directions
  API** enabled in Google Cloud Console, and should be restricted (HTTP
  referrer `chrome-extension://<your-extension-id>/*`) since it's stored
  locally in plain text.

## Known limitations

- The saved-list scraper depends on Google's current (unofficial, hashed)
  class names for the panel. It anchors on the more-stable typography
  classes (`fontHeadlineSmall`, `fontHeadlineLarge`) and a rating-badge
  (`role="img"`) skip rule to find each place's category text — if Google
  reshuffles the panel this can silently start missing fields. The HTML
  import path is the fallback when that happens.
- Saved lists don't expose coordinates or place IDs, only names/categories —
  routing relies on Google resolving names/addresses server-side, so oddly
  named or ambiguous saved places may resolve to the wrong location. There's
  no per-stop override yet; edit the place name before scraping/importing if
  a specific one is ambiguous.
- The Directions API's per-leg distance/time fetch requires the API to
  respond with CORS headers for browser-side requests. If your key/project
  doesn't allow that, the embedded map still renders — you just lose the
  distance/time breakdown, with a message saying so.
