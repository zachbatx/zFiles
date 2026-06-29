/* RV Trip Planner — personal, single-user, no backend.
 * State lives in localStorage. Map/routing via Google Maps JS API.
 */
(function () {
  "use strict";

  var KEY_LS = "rvtp.gmapsKey";
  var STATE_LS = "rvtp.state";

  // ---- Persistent state -------------------------------------------------
  var state = loadState();

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(STATE_LS));
      if (s && s.trips) return s;
    } catch (e) {}
    return { trips: [newTrip("My first trip")], activeId: null, rig: defaultRig() };
  }
  function saveState() { localStorage.setItem(STATE_LS, JSON.stringify(state)); }
  function defaultRig() { return { mpg: 9, tank: 55, fuelPrice: 3.75, reserve: 20, maxDay: 330, rule330: true }; }
  function newTrip(name) {
    return { id: "t" + Date.now() + Math.floor(Math.random() * 1e4), name: name, stops: [] };
  }
  function activeTrip() {
    var t = state.trips.find(function (x) { return x.id === state.activeId; });
    if (!t) { t = state.trips[0]; state.activeId = t ? t.id : null; }
    return t;
  }
  if (!state.activeId && state.trips[0]) state.activeId = state.trips[0].id;
  if (!state.rig) state.rig = defaultRig();

  // ---- API key gate -----------------------------------------------------
  var keyGate = document.getElementById("key-gate");
  var appEl = document.getElementById("app");
  var apiKey = localStorage.getItem(KEY_LS);

  document.getElementById("key-save").addEventListener("click", function () {
    var v = document.getElementById("key-input").value.trim();
    if (!v) return;
    localStorage.setItem(KEY_LS, v);
    location.reload();
  });
  document.getElementById("change-key").addEventListener("click", function () {
    localStorage.removeItem(KEY_LS);
    location.reload();
  });

  if (!apiKey) {
    keyGate.classList.remove("hidden");
    return; // wait for key
  }

  // Load Google Maps with libraries we need, then boot.
  window.__rvBoot = boot;
  var s = document.createElement("script");
  s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey) +
          "&libraries=places,geometry&callback=__rvBoot";
  s.async = true;
  s.onerror = function () { alert("Failed to load Google Maps. Check your API key / network."); };
  document.head.appendChild(s);

  // ---- Map + services ---------------------------------------------------
  var map, geocoder, placesSvc, directionsSvc, directionsRenderer;
  var geocodeCache = {}; // name -> {lat,lng,address}
  var markers = [];

  function boot() {
    appEl.classList.remove("hidden");

    map = new google.maps.Map(document.getElementById("map"), {
      center: { lat: 34.5, lng: -95 }, zoom: 4, mapTypeControl: true, streetViewControl: false
    });
    geocoder = new google.maps.Geocoder();
    placesSvc = new google.maps.places.PlacesService(map);
    directionsSvc = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true });

    bindUI();
    renderRigForm();
    renderTripSelect();
    renderLibrary();
    renderItinerary();
  }

  // ---- Geocoding (cached) ----------------------------------------------
  function geocode(name, hint) {
    if (geocodeCache[name]) return Promise.resolve(geocodeCache[name]);
    var query = name + (hint ? " " + hint : "");
    return new Promise(function (resolve) {
      placesSvc.findPlaceFromQuery(
        { query: query, fields: ["geometry", "formatted_address", "name"] },
        function (results, status) {
          if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) {
            var r = results[0];
            var loc = {
              lat: r.geometry.location.lat(), lng: r.geometry.location.lng(),
              address: r.formatted_address || name
            };
            geocodeCache[name] = loc;
            resolve(loc);
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  // ---- UI wiring --------------------------------------------------------
  function bindUI() {
    ["mpg", "tank", "fuelPrice", "reserve", "maxDay"].forEach(function (k) {
      var id = { mpg: "rig-mpg", tank: "rig-tank", fuelPrice: "fuel-price", reserve: "fuel-reserve", maxDay: "max-day-mi" }[k];
      document.getElementById(id).addEventListener("change", function (e) {
        state.rig[k] = parseFloat(e.target.value) || 0; saveState(); recomputeRoute();
      });
    });
    document.getElementById("rule-330").addEventListener("change", function (e) {
      state.rig.rule330 = e.target.checked; saveState(); recomputeRoute();
    });

    document.getElementById("trip-select").addEventListener("change", function (e) {
      state.activeId = e.target.value; saveState(); renderTripName(); renderItinerary();
    });
    document.getElementById("trip-new").addEventListener("click", function () {
      var t = newTrip("Trip " + (state.trips.length + 1));
      state.trips.push(t); state.activeId = t.id; saveState();
      renderTripSelect(); renderTripName(); renderItinerary();
    });
    document.getElementById("trip-del").addEventListener("click", function () {
      if (state.trips.length <= 1) { alert("Keep at least one trip."); return; }
      if (!confirm("Delete this trip?")) return;
      state.trips = state.trips.filter(function (t) { return t.id !== state.activeId; });
      state.activeId = state.trips[0].id; saveState();
      renderTripSelect(); renderTripName(); renderItinerary();
    });
    document.getElementById("trip-name").addEventListener("input", function (e) {
      activeTrip().name = e.target.value; saveState();
      var opt = document.querySelector('#trip-select option[value="' + state.activeId + '"]');
      if (opt) opt.textContent = e.target.value;
    });

    document.getElementById("trip-export").addEventListener("click", exportTrip);
    document.getElementById("trip-import").addEventListener("click", function () {
      document.getElementById("import-file").click();
    });
    document.getElementById("import-file").addEventListener("change", importTrip);
    document.getElementById("trip-print").addEventListener("click", function () { window.print(); });

    document.getElementById("list-filter").addEventListener("change", renderLibrary);
    document.getElementById("lib-search").addEventListener("input", renderLibrary);
  }

  function renderRigForm() {
    var r = state.rig;
    document.getElementById("rig-mpg").value = r.mpg;
    document.getElementById("rig-tank").value = r.tank;
    document.getElementById("fuel-price").value = r.fuelPrice;
    document.getElementById("fuel-reserve").value = r.reserve;
    document.getElementById("max-day-mi").value = r.maxDay;
    document.getElementById("rule-330").checked = !!r.rule330;
  }

  function renderTripSelect() {
    var sel = document.getElementById("trip-select");
    sel.innerHTML = "";
    state.trips.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.id; o.textContent = t.name;
      sel.appendChild(o);
    });
    sel.value = state.activeId;
    renderTripName();
  }
  function renderTripName() {
    document.getElementById("trip-name").value = activeTrip().name;
  }

  // ---- Library ----------------------------------------------------------
  function renderLibrary() {
    var filter = document.getElementById("list-filter").value;
    var q = document.getElementById("lib-search").value.toLowerCase();
    var ul = document.getElementById("library");
    ul.innerHTML = "";
    window.CAMPGROUNDS
      .filter(function (c) { return filter === "all" || c.list === filter; })
      .filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) >= 0; })
      .forEach(function (c) {
        var li = document.createElement("li");
        li.className = "lib-item";
        li.innerHTML = '<span><div>' + esc(c.name) + '</div><div class="meta">' +
          esc(c.type || "") + ' · ' + esc(c.list) + '</div></span>' +
          '<button class="lib-add" title="Add to itinerary">+</button>';
        li.querySelector(".lib-add").addEventListener("click", function (ev) {
          ev.stopPropagation();
          addStop(c);
        });
        li.addEventListener("click", function () { focusCampground(c); });
        ul.appendChild(li);
      });
  }

  function focusCampground(c) {
    geocode(c.name, c.address_hint).then(function (loc) {
      if (loc) { map.panTo(loc); map.setZoom(11); }
    });
  }

  // ---- Itinerary --------------------------------------------------------
  function addStop(c) {
    activeTrip().stops.push({ name: c.name, type: c.type, hint: c.address_hint, date: "" });
    saveState(); renderItinerary();
  }
  function removeStop(i) { activeTrip().stops.splice(i, 1); saveState(); renderItinerary(); }
  function moveStop(i, dir) {
    var s = activeTrip().stops, j = i + dir;
    if (j < 0 || j >= s.length) return;
    var tmp = s[i]; s[i] = s[j]; s[j] = tmp;
    saveState(); renderItinerary();
  }

  function renderItinerary() {
    var ol = document.getElementById("itinerary");
    ol.innerHTML = "";
    var stops = activeTrip().stops;
    stops.forEach(function (st, i) {
      var li = document.createElement("li");
      li.className = "itin-item";
      li.innerHTML =
        '<div class="itin-top"><span class="itin-name">' + esc(st.name) + '</span>' +
        '<span class="itin-type">' + esc(st.type || "") + '</span></div>' +
        '<input class="itin-date" type="date" value="' + (st.date || "") + '" />' +
        '<div class="itin-actions">' +
          '<button data-act="up">↑</button>' +
          '<button data-act="down">↓</button>' +
          '<button data-act="del">remove</button>' +
        '</div>' +
        '<div class="leg-info hidden" data-leg="' + i + '"></div>';
      li.querySelector(".itin-date").addEventListener("change", function (e) {
        st.date = e.target.value; saveState();
      });
      li.querySelector('[data-act=up]').addEventListener("click", function () { moveStop(i, -1); });
      li.querySelector('[data-act=down]').addEventListener("click", function () { moveStop(i, 1); });
      li.querySelector('[data-act=del]').addEventListener("click", function () { removeStop(i); });
      ol.appendChild(li);
    });
    recomputeRoute();
  }

  // ---- Routing + per-leg math ------------------------------------------
  function recomputeRoute() {
    clearMarkers();
    document.getElementById("trip-totals").textContent = "";
    var stops = activeTrip().stops;
    if (stops.length < 1) { directionsRenderer.set("directions", null); return; }

    // Geocode all stops first, then place markers + route.
    Promise.all(stops.map(function (s) { return geocode(s.name, s.hint); }))
      .then(function (locs) {
        var bounds = new google.maps.LatLngBounds();
        locs.forEach(function (loc, i) {
          if (!loc) return;
          var m = new google.maps.Marker({
            position: loc, map: map, label: String(i + 1), title: stops[i].name
          });
          markers.push(m);
          bounds.extend(loc);
        });
        if (!bounds.isEmpty()) map.fitBounds(bounds);

        if (stops.length < 2) { directionsRenderer.set("directions", null); return; }

        var valid = locs.filter(Boolean);
        if (valid.length < 2) return;

        directionsSvc.route({
          origin: valid[0],
          destination: valid[valid.length - 1],
          waypoints: valid.slice(1, -1).map(function (l) { return { location: l, stopover: true }; }),
          travelMode: google.maps.TravelMode.DRIVING
        }, function (res, status) {
          if (status !== "OK") { return; }
          directionsRenderer.setDirections(res);
          annotateLegs(res.routes[0].legs);
        });
      });
  }

  function annotateLegs(legs) {
    var rig = state.rig;
    var range = rig.tank * rig.mpg * (1 - (rig.reserve || 0) / 100); // usable miles per tank
    var totMi = 0, totSec = 0, totFuel = 0;

    legs.forEach(function (leg, i) {
      var mi = leg.distance.value / 1609.34;
      var sec = leg.duration.value;
      totMi += mi; totSec += sec;
      var gal = rig.mpg > 0 ? mi / rig.mpg : 0;
      totFuel += gal;
      var avg = sec > 0 ? mi / (sec / 3600) : 0;

      var warn = [];
      if (rig.rule330 && mi > rig.maxDay) warn.push("exceeds " + rig.maxDay + " mi/day");
      if (range > 0 && mi > range) warn.push("⛽ beyond one tank (" + Math.round(range) + " mi) — plan a fuel stop");

      // Leg banner sits under the DESTINATION stop (index i+1).
      var box = document.querySelector('[data-leg="' + (i + 1) + '"]');
      if (box) {
        box.classList.remove("hidden");
        box.classList.toggle("warn", warn.length > 0);
        box.innerHTML =
          '<b>' + fmtMi(mi) + ' mi</b> · ' + fmtDur(sec) + ' · ~' + Math.round(avg) + ' mph<br>' +
          '⛽ ' + gal.toFixed(1) + ' gal · ~$' + (gal * rig.fuelPrice).toFixed(0) +
          (warn.length ? '<br>⚠️ ' + warn.join(" · ") : "");
      }
    });

    document.getElementById("trip-totals").textContent =
      "· " + fmtMi(totMi) + " mi · " + fmtDur(totSec) +
      " · ~$" + (totFuel * rig.fuelPrice).toFixed(0) + " fuel";
  }

  function clearMarkers() { markers.forEach(function (m) { m.setMap(null); }); markers = []; }

  // ---- Import / export --------------------------------------------------
  function exportTrip() {
    var t = activeTrip();
    var blob = new Blob([JSON.stringify(t, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (t.name || "trip").replace(/[^a-z0-9]+/gi, "_") + ".json";
    a.click();
  }
  function importTrip(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var t = JSON.parse(reader.result);
        if (!t.stops) throw new Error("not a trip file");
        t.id = newTrip().id;
        state.trips.push(t); state.activeId = t.id; saveState();
        renderTripSelect(); renderTripName(); renderItinerary();
      } catch (err) { alert("Could not import: " + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ---- Helpers ----------------------------------------------------------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  }); }
  function fmtMi(mi) { return Math.round(mi).toLocaleString(); }
  function fmtDur(sec) {
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return (h ? h + "h " : "") + m + "m";
  }
})();
