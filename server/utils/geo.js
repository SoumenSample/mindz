// Geographic helpers . The reach radius is a backend-owned
// constant with an env override — no magic numbers in controllers,
// and the frontend NEVER decides geofence acceptance.
const STORE_REACH_RADIUS_METERS =
  Number(process.env.STORE_REACH_RADIUS_METERS) > 0
    ? Number(process.env.STORE_REACH_RADIUS_METERS)
    : 200;

function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

// Great-circle distance via Haversine. Returns meters, or null when any
// coordinate is missing/non-finite (caller treats null as unevaluatable).
function haversineMeters(lat1, lon1, lat2, lon2) {
  const aLat = Number(lat1);
  const aLon = Number(lon1);
  const bLat = Number(lat2);
  const bLon = Number(lon2);
  if (![aLat, aLon, bLat, bLon].every(Number.isFinite)) return null;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c * 100) / 100;
}

module.exports = { STORE_REACH_RADIUS_METERS, haversineMeters };
