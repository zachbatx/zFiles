/* Trip Planner — Stops & Agenda redesign POC (vanilla JS, no deps).
 *
 * What this prototype proves out:
 *   • Stop titles/details use the full card width — the locate/edit/remove
 *     actions live behind a kebab (⋯) menu, so they never truncate the title.
 *   • Day-trip agenda sub-items render as a timeline with explicit AM/PM times.
 *   • "Detailed" toggle expands/collapses the per-stop detail + agenda.
 *   • "Rearrange" toggle swaps the reading UI for drag handles + up/down
 *     buttons and lets you reorder by dragging or tapping.
 */
(function () {
  "use strict";

  // ---- Sample data (2026 Colorado Trip) ---------------------------------
  // leg = drive INTO this stop from the previous one. agenda = day-trip items.
  var stops = [
    { id: "s1", name: "Home — Austin, TX", date: "2026-08-21", nights: 0, leg: null, agenda: [] },
    { id: "s2", name: "Palo Duro Canyon State Park", date: "2026-08-21", nights: 1,
      leg: { mi: 378.7, dur: "9h 28m" }, agenda: [] },
    { id: "s3", name: "Piñon Flats Campground — Great Sand Dunes", date: "2026-08-22", nights: 1,
      leg: { mi: 288.9, dur: "7h 13m" }, agenda: [] },
    { id: "s4", name: "United Campground of Durango", date: "2026-08-23", nights: 1,
      leg: { mi: 131.9, dur: "3h 18m" }, agenda: [] },
    { id: "s5", name: "4J+1+1 RV Park & Campground", date: "2026-08-24", endDate: "2026-08-25", nights: 2,
      leg: { mi: 31.3, dur: "47m" }, agenda: [] },
    { id: "s6", name: "Lizard Head Pass", date: "2026-08-26", nights: 1,
      leg: { mi: 12.9, dur: "19m" },
      agenda: [
        { time: "08:00", title: "Telluride", place: "@ Telluride, CO" },
        { time: "08:30", title: "Gondola Ride", place: "Mountain Village station" },
        { time: "12:30", title: "Lunch — Butcher & Baker", place: "217 E Colorado Ave" },
        { time: "15:00", title: "Bridal Veil Falls hike", place: "Trailhead — end of CO-145" }
      ] },
    { id: "s7", name: "Pa-Co-Chu-Puk Campground", date: "2026-08-27", nights: 1,
      leg: { mi: 31.1, dur: "47m" }, agenda: [] },
    { id: "s8", name: "Adrenaline Falls — Ouray Via Ferrata", date: "2026-08-27", nights: 0,
      leg: { mi: 11.9, dur: "18m" },
      agenda: [
        { time: "07:00", title: "Instructor meetup & gear fitting", place: "Ouray Via Ferrata lot" },
        { time: "07:45", title: "Guided via ferrata climb", place: "Uncompahgre Gorge" }
      ] },
    { id: "s9", name: "Crested Butte", date: "2026-08-26", nights: 1,
      leg: { mi: 57.1, dur: "1h 26m" }, agenda: [] }
  ];

  var listEl = document.getElementById("stops");
  var scrollEl = document.querySelector(".scroll");
  var openMenuId = null;

  // ---- Time formatting: "08:00" -> {h:"8:00", ampm:"AM"} -----------------
  function fmtTime(t) {
    var parts = String(t).split(":");
    var h = parseInt(parts[0], 10);
    var m = parts[1] != null ? parts[1] : "00";
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return { h: h12 + ":" + m, ampm: ampm };
  }

  function fmtDate(iso) {
    // "2026-08-21" -> "Fri, Aug 21" (no Date() needed for a fixed calendar).
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var p = iso.split("-");
    return months[parseInt(p[1], 10) - 1] + " " + parseInt(p[2], 10);
  }

  function dateSummary(st) {
    var s = fmtDate(st.date);
    if (st.endDate) s += " → " + fmtDate(st.endDate);
    if (st.nights > 0) s += '<span class="dot">·</span>' + st.nights + (st.nights > 1 ? " nights" : " night");
    else s += '<span class="dot">·</span>day stop';
    return s;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- Render -----------------------------------------------------------
  function render() {
    listEl.innerHTML = "";
    openMenuId = null;

    stops.forEach(function (st, i) {
      // Connecting leg chip (drive into this stop)
      if (st.leg) {
        var legLi = document.createElement("li");
        legLi.className = "leg";
        legLi.innerHTML =
          '<span class="leg-chip"><span>' + st.leg.mi.toFixed(1) + ' mi</span>' +
          '<span class="dot">·</span><span class="car">🚗</span><span>~' + esc(st.leg.dur) + '</span></span>';
        listEl.appendChild(legLi);
      }

      var li = document.createElement("li");
      li.className = "stop";
      li.dataset.id = st.id;
      li.dataset.index = i;

      var agendaCount = st.agenda.length;

      li.innerHTML =
        // drag handle (rearrange mode only, via CSS)
        '<span class="grip" title="Drag to reorder" aria-hidden="true">' +
          '<svg viewBox="0 0 10 16"><g fill="currentColor">' +
          '<circle cx="2" cy="2" r="1.4"/><circle cx="8" cy="2" r="1.4"/>' +
          '<circle cx="2" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/>' +
          '<circle cx="2" cy="14" r="1.4"/><circle cx="8" cy="14" r="1.4"/></g></svg>' +
        '</span>' +
        '<span class="stop-num">' + (i + 1) + '</span>' +
        '<div class="stop-head">' +
          '<div class="stop-title-wrap">' +
            '<div class="stop-title">' + esc(st.name) + '</div>' +
            '<div class="stop-sub">' + dateSummary(st) + '</div>' +
            (agendaCount ? '<span class="agenda-count">🗓 ' + agendaCount + '-stop day agenda</span>' : '') +
          '</div>' +
          '<button class="kebab" aria-label="Stop actions" title="Actions">⋯</button>' +
        '</div>' +
        agendaHTML(st) +
        // reorder up/down (rearrange mode only, via CSS)
        '<div class="reorder-btns">' +
          '<button data-act="up" title="Move up" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button data-act="down" title="Move down" ' + (i === stops.length - 1 ? 'disabled' : '') + '>↓</button>' +
        '</div>' +
        // kebab popover
        '<div class="menu" hidden>' +
          '<button data-act="locate"><span class="mi">📍</span> Show on map</button>' +
          '<button data-act="edit"><span class="mi">✎</span> Edit stop</button>' +
          '<button data-act="agenda"><span class="mi">🗓</span> Add agenda item</button>' +
          '<button data-act="remove" class="danger"><span class="mi">🗑</span> Remove stop</button>' +
        '</div>';

      wireCard(li, st, i);
      listEl.appendChild(li);
    });
  }

  function agendaHTML(st) {
    if (!st.agenda.length) return "";
    var items = st.agenda.map(function (a) {
      var t = fmtTime(a.time);
      return '<li class="ag-item">' +
        '<span class="ag-time">' + t.h + '<span class="ampm">' + t.ampm + '</span></span>' +
        '<span class="ag-node"></span>' +
        '<span class="ag-body">' +
          '<div class="ag-title">' + esc(a.title) + '</div>' +
          (a.place ? '<div class="ag-place">' + esc(a.place) + '</div>' : '') +
        '</span></li>';
    }).join("");
    return '<div class="agenda">' +
      '<div class="agenda-label">🗓 Day-trip agenda</div>' +
      '<ul class="agenda-list">' + items + '</ul>' +
      '<button class="agenda-add">＋ Add agenda item</button>' +
    '</div>';
  }

  // ---- Card wiring ------------------------------------------------------
  function wireCard(li, st, i) {
    var kebab = li.querySelector(".kebab");
    var menu = li.querySelector(".menu");

    kebab.addEventListener("click", function (e) {
      e.stopPropagation();
      var isOpen = !menu.hidden;
      closeMenus();
      if (!isOpen) { menu.hidden = false; openMenuId = st.id; }
    });

    menu.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        onAction(btn.dataset.act, st, i);
        closeMenus();
      });
    });

    li.querySelector('[data-act=up]').addEventListener("click", function () { move(i, -1); });
    li.querySelector('[data-act=down]').addEventListener("click", function () { move(i, 1); });

    var addBtn = li.querySelector(".agenda-add");
    if (addBtn) addBtn.addEventListener("click", function () { onAction("agenda", st, i); });

    setupDrag(li);
  }

  function onAction(act, st, i) {
    if (act === "remove") {
      if (confirm("Remove “" + st.name + "” from the trip?")) {
        stops.splice(i, 1); render();
      }
    } else if (act === "locate") {
      toast("📍 Would center the map on “" + st.name + "”");
    } else if (act === "edit") {
      toast("✎ Would open the editor for “" + st.name + "”");
    } else if (act === "agenda") {
      var time = prompt("Agenda time (24h, e.g. 09:30):", "09:00");
      if (time == null) return;
      var title = prompt("What's happening?", "");
      if (!title) return;
      st.agenda.push({ time: time, title: title, place: "" });
      st.agenda.sort(function (a, b) { return a.time.localeCompare(b.time); });
      render();
    }
  }

  function closeMenus() {
    listEl.querySelectorAll(".menu").forEach(function (m) { m.hidden = true; });
    openMenuId = null;
  }
  document.addEventListener("click", closeMenus);

  // ---- Reorder: buttons + drag ------------------------------------------
  function move(from, dir) {
    var to = from + dir;
    if (to < 0 || to >= stops.length) return;
    var tmp = stops[from]; stops[from] = stops[to]; stops[to] = tmp;
    render();
  }

  var dragId = null;
  function setupDrag(li) {
    var grip = li.querySelector(".grip");

    // Only allow dragging from the grip, and only in rearrange mode.
    grip.addEventListener("pointerdown", function () {
      if (!document.querySelector(".panel").classList.contains("reordering")) return;
      li.setAttribute("draggable", "true");
    });
    li.addEventListener("dragstart", function (e) {
      dragId = li.dataset.id;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    li.addEventListener("dragend", function () {
      li.classList.remove("dragging");
      li.removeAttribute("draggable");
      listEl.querySelectorAll(".drop-target").forEach(function (n) { n.classList.remove("drop-target"); });
      dragId = null;
    });
    li.addEventListener("dragover", function (e) {
      if (dragId == null || li.dataset.id === dragId) return;
      e.preventDefault();
      li.classList.add("drop-target");
    });
    li.addEventListener("dragleave", function () { li.classList.remove("drop-target"); });
    li.addEventListener("drop", function (e) {
      e.preventDefault();
      li.classList.remove("drop-target");
      if (dragId == null || li.dataset.id === dragId) return;
      var from = stops.findIndex(function (s) { return s.id === dragId; });
      var to = stops.findIndex(function (s) { return s.id === li.dataset.id; });
      if (from < 0 || to < 0) return;
      var moved = stops.splice(from, 1)[0];
      stops.splice(to, 0, moved);
      render();
    });
  }

  // ---- View toggles -----------------------------------------------------
  var panel = document.querySelector(".panel");
  var detailed = document.getElementById("detailed-toggle");
  var rearrange = document.getElementById("rearrange-toggle");
  var hint = document.getElementById("rearrange-hint");

  function applyDetailed() { panel.classList.toggle("compact", !detailed.checked); }
  function applyRearrange() {
    var on = rearrange.checked;
    panel.classList.toggle("reordering", on);
    hint.hidden = !on;
    if (on) closeMenus();
    // Rearranging is easier without the compact/detailed distinction; force
    // detailed off visually but remember the user's choice.
    detailed.disabled = on;
  }

  detailed.addEventListener("change", applyDetailed);
  rearrange.addEventListener("change", applyRearrange);

  // ---- Tiny toast -------------------------------------------------------
  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText =
      "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);" +
      "background:#16202a;color:#fff;padding:10px 16px;border-radius:10px;" +
      "font-size:13px;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:90vw;";
    document.body.appendChild(t);
    // fade without timers-that-persist; simple removal
    requestAnimationFrame(function () { t.style.transition = "opacity .3s 1.6s"; t.style.opacity = "0"; });
    t.addEventListener("transitionend", function () { t.remove(); });
  }

  // ---- Go ---------------------------------------------------------------
  render();
  applyDetailed();
  applyRearrange();
})();
