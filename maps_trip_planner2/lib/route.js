// Builds Google Maps URLs/requests from an ordered list of stops.
// Stops are plain place names (+ optional address hint) — Google resolves
// them server-side, so no client-side geocoding is needed.

function stopQuery(stop) {
  // If coordinates are available, prefer them to guarantee precise routing.
  // Otherwise, fall back to place name + address hint.
  if (stop.lat != null && stop.lng != null && stop.lat !== "" && stop.lng !== "") {
    return `${stop.lat},${stop.lng}`;
  }
  return stop.addressHint ? `${stop.name}, ${stop.addressHint}` : stop.name;
}

// A directions link that opens in Google Maps itself. Works with no API key.
export function buildDirectionsUrl(stops, prefs = {}) {
  if (stops.length < 2) return null;
  const origin = encodeURIComponent(stopQuery(stops[0]));
  const destination = encodeURIComponent(stopQuery(stops[stops.length - 1]));
  const waypoints = stops
    .slice(1, -1)
    .map((s) => encodeURIComponent(stopQuery(s)))
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

// Requires an API key with the "Maps Embed API" enabled. Renders an
// interactive map with the route drawn, entirely inside an <iframe> —
// this avoids loading any remote script into the extension page, which
// Manifest V3's content security policy disallows.
export function buildEmbedUrl(stops, apiKey, prefs = {}) {
  if (stops.length < 2) return null;
  const origin = encodeURIComponent(stopQuery(stops[0]));
  const destination = encodeURIComponent(stopQuery(stops[stops.length - 1]));
  const waypoints = stops
    .slice(1, -1)
    .map((s) => encodeURIComponent(stopQuery(s)))
    .join("|");
  
  const mode = (prefs.travelMode || "DRIVING").toLowerCase();
  let url = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(apiKey)}&origin=${origin}&destination=${destination}&mode=${mode}`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  
  const avoid = [];
  if (prefs.avoidTolls) avoid.push("tolls");
  if (prefs.avoidHighways) avoid.push("highways");
  if (avoid.length) url += `&avoid=${avoid.join("|")}`;
  
  return url;
}

// Builds a classic Google Maps directions embed URL (works for free with no API key).
export function buildFreeEmbedUrl(stops, prefs = {}) {
  if (stops.length < 2) return null;
  const start = stopQuery(stops[0]);
  
  let daddr = "";
  for (let i = 1; i < stops.length; i++) {
    const q = stopQuery(stops[i]);
    if (daddr) daddr += "+to:";
    daddr += encodeURIComponent(q);
  }
  
  const origin = encodeURIComponent(start);
  let url = `https://maps.google.com/maps?saddr=${origin}&daddr=${daddr}`;
  
  const mode = (prefs.travelMode || "DRIVING").toUpperCase();
  if (mode === "WALKING") url += "&dirflg=w";
  else if (mode === "BICYCLING") url += "&dirflg=b";
  else if (mode === "TRANSIT") url += "&dirflg=r";
  
  url += "&output=embed";
  return url;
}

// Requires an API key with the "Directions API" enabled. Returns per-leg
// distance/duration plus trip totals. Throws if the request or the API
// itself reports an error (bad key, no CORS, over quota, etc).
export async function fetchDirectionsLegsDirect(stops, apiKey, prefs = {}) {
  if (stops.length < 2) return null;
  const origin = encodeURIComponent(stopQuery(stops[0]));
  const destination = encodeURIComponent(stopQuery(stops[stops.length - 1]));
  const waypoints = stops
    .slice(1, -1)
    .map((s) => encodeURIComponent(stopQuery(s)))
    .join("|");
  
  const mode = (prefs.travelMode || "DRIVING").toLowerCase();
  let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${encodeURIComponent(apiKey)}&mode=${mode}`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  
  const avoid = [];
  if (prefs.avoidTolls) avoid.push("tolls");
  if (prefs.avoidHighways) avoid.push("highways");
  if (avoid.length) url += `&avoid=${avoid.join("|")}`;

  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== "OK") {
    throw new Error(data.error_message || `Directions API returned ${data.status}`);
  }

  // Check if we have routes and legs
  if (!data.routes || !data.routes[0] || !data.routes[0].legs) {
    throw new Error("No route found between the specified locations.");
  }

  const legs = data.routes[0].legs.map((leg, i) => ({
    from: stops[i].name,
    to: stops[i + 1].name,
    distanceText: leg.distance.text,
    durationText: leg.duration.text,
    distanceMeters: leg.distance.value,
    durationSeconds: leg.duration.value,
  }));
  const totalMeters = legs.reduce((sum, l) => sum + l.distanceMeters, 0);
  const totalSeconds = legs.reduce((sum, l) => sum + l.durationSeconds, 0);

  return {
    legs,
    totalMiles: (totalMeters / 1609.34).toFixed(1),
    totalHours: (totalSeconds / 3600).toFixed(1),
    alternativeRoutes: data.routes.map((route, index) => ({
      index,
      summary: route.summary || `Route ${index + 1}`,
      legsCount: route.legs.length,
      totalMiles: (route.legs.reduce((s, l) => s + l.distance.value, 0) / 1609.34).toFixed(1),
      totalHours: (route.legs.reduce((s, l) => s + l.duration.value, 0) / 3600).toFixed(1),
    }))
  };
}

export async function fetchDirectionsLegs(stops, apiKey, prefs = {}) {
  // If we are in the content script or extension page context, delegate to background script
  // to bypass CORS blocks on maps.googleapis.com
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "fetchDirections", stops, apiKey, prefs },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else if (response && response.result) {
            resolve(response.result);
          } else {
            reject(new Error("No response from background script"));
          }
        }
      );
    });
  }
  return fetchDirectionsLegsDirect(stops, apiKey, prefs);
}

// Local helper to calculate straight-line (Haversine) distance as a local fallback
export function getHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 3958.8; // Radius of the Earth in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance; // Returns distance in miles
}
