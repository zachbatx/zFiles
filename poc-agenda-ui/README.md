# Stops & Day-Trip Agenda — UI redesign POC

A self-contained prototype (plain HTML/CSS/JS, no build, no deps) that rethinks
how the Trip Planner's **Stops** list is laid out. Open `index.html` in a
browser — it ships with the 2026 Colorado Trip as sample data.

## Problems in the current UI

1. **Titles get truncated.** The row actions (↑ ↓ 📍 ✎ ✕) share the same line
   as the stop title, so names collapse to `Palo Duro…`, `Piñon Flat…`,
   `United Ca…`. You can't read where you're going.
2. **Agenda sub-items lack context.** Under a stop like *Lizard Head Pass* the
   day-trip items show `08:00 Telluride` / `08:30 Gondola Ride` with no clear
   AM/PM and no visual grouping.
3. **Reordering and reading fight for the same controls.** Drag handles and
   up/down arrows clutter every card even when you're just reviewing the plan.

## What this POC changes

### 1. Titles get the full width
The number badge is absolutely positioned in a fixed left gutter, and the three
row actions collapse into a single **kebab (⋯) menu** pinned to a 32px column on
the right. The title claims all remaining width and **wraps** instead of
truncating — so `Piñon Flats Campground — Great Sand Dunes` is fully readable.
The kebab opens: *Show on map · Edit stop · Add agenda item · Remove stop*.

### 2. Day-trip agenda as a timeline with explicit AM/PM
Sub-items render on a vertical timeline. Each row is `time · node · title/place`,
and times are formatted to 12-hour with an explicit `AM`/`PM` tag
(`8:00 AM`, `8:30 AM`, `12:30 PM`). Times use tabular figures so they align.

### 3. Two independent view toggles in the Stops header
- **Detailed** — expands each card to show the date line + full agenda timeline.
  Off = compact cards (date hidden, agenda collapses to a `🗓 N-stop day agenda`
  badge) for scanning the whole route quickly.
- **Rearrange** — swaps the reading UI for reordering: a drag handle appears on
  the left, the number badge and **↑ / ↓** buttons move to the right, the leg
  chips and agenda hide to reduce noise, and a hint banner explains the mode.
  Reorder by **dragging the handle** or tapping the arrows. Editing (the kebab)
  is hidden while rearranging so the two modes never collide.

## Files
- `index.html` — markup for the panel, tabs, toggles, and stops list
- `styles.css` — all styling; light + dark (`prefers-color-scheme`) themes
- `app.js` — sample data, rendering, AM/PM time formatting, kebab menu,
  the two view toggles, and drag / up-down reordering

## Notes
This is a front-end prototype only — "Show on map" / "Edit" fire a toast, and
"Add agenda item" uses a quick prompt. State lives in memory (refresh resets).
The intent is to demonstrate the layout and interaction model, not to wire it
into the real routing/localStorage backend.
