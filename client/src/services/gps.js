/**
 * Shared browser-GPS helper . No Capacitor plugin exists in
 * this project, so the web Geolocation API is used — the same code path
 * a Capacitor shell would call. Errors are classified for distinct UI
 * messages; nothing here decides geofence acceptance (backend does).
 */
export function getCurrentGps({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject({ kind: "UNSUPPORTED", message: "Geolocation is not supported by this browser." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject({ kind: "DENIED", message: "GPS permission denied. Allow location access for this site and retry." });
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject({ kind: "UNAVAILABLE", message: "GPS unavailable. Move outdoors with a clear sky view and retry." });
        } else if (err.code === err.TIMEOUT) {
          reject({ kind: "TIMEOUT", message: "GPS timed out. Retry — it often locks on the second attempt." });
        } else {
          reject({ kind: "UNKNOWN", message: "Could not read GPS. Retry." });
        }
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}

// POSTs one point; resolves {ok:true} or {ok:false, message} — the UI
// never treats a network failure as a success (offline-safe).
export async function postGpsPoint(postFn, payload) {
  try {
    await postFn(payload);
    return { ok: true };
  } catch (err) {
    if (!err.response) {
      return { ok: false, message: "Network unavailable. Point NOT recorded — retry when online. Do not assume success." };
    }
    return { ok: false, message: err.response?.data?.message || "GPS point rejected." };
  }
}
