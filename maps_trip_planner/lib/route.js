// Builds Google Maps URLs/requests from an ordered list of stops.
// Stops are plain place names (+ optional address hint) — Google resolves
// them server-side, so no client-side geocoding is needed.

function stopQuery(stop) {
  return stop.addressHint ? `${stop.name}, ${stop.addressHint}` : stop.name;
}

// A directions link that opens in Google Maps itself. Works with no API key.
export function buildDirectionsUrl(stops) {
  if (stops.length < 2) return null;
  const origin = encodeURIComponent(stopQuery(stops[0]));
  const destination = encodeURIComponent(stopQuery(stops[stops.length - 1]));
  const waypoints = stops
    .slice(1, -1)
    .map((s) => encodeURIComponent(stopQuery(s)))
    .join("|");
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

// Requires an API key with the "Maps Embed API" enabled. Renders an
// interactive map with the route drawn, entirely inside an <iframe> —
// this avoids loading any remote script into the extension page, which
// Manifest V3's content security policy disallows.
export function buildEmbedUrl(stops, apiKey) {
  if (stops.length < 2) return null;
  const origin = encodeURIComponent(stopQuery(stops[0]));
  const destination = encodeURIComponent(stopQuery(stops[stops.length - 1]));
  const waypoints = stops
    .slice(1, -1)
    .map((s) => encodeURIComponent(stopQuery(s)))
    .join("|");
  let url = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(apiKey)}&origin=${origin}&destination=${destination}&mode=driving`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

// Requires an API key with the "Directions API" enabled. Returns per-leg
// distance/duration plus trip totals. Throws if the request or the API
// itself reports an error (bad key, no CORS, over quota, etc).
export async function fetchDirectionsLegs(stops, apiKey) {
  if (stops.length < 2) return null;
  const origin = encodeURIComponent(stopQuery(stops[0]));
  const destination = encodeURIComponent(stopQuery(stops[stops.length - 1]));
  const waypoints = stops
    .slice(1, -1)
    .map((s) => encodeURIComponent(stopQuery(s)))
    .join("|");
  let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${encodeURIComponent(apiKey)}`;
  if (waypoints) url += `&waypoints=${waypoints}`;

  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== "OK") {
    throw new Error(data.error_message || `Directions API returned ${data.status}`);
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
  };
}
