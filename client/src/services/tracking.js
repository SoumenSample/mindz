/**
 * Central tracking service (Module 9.3) — the SINGLE owner of device
 * location capture. Jobs.jsx, FieldWorkflow.jsx, MyVisits.jsx,
 * TrackingCard.jsx and LiveTracking.jsx must consume this service and
 * never implement their own watchers/intervals.
 *
 * Paths:
 * - Native (Capacitor + @capgo/background-geolocation): distance-based
 *   fixes (50 m) with a 30 s floor, foreground-service notification,
 *   delivery alive in background via the OS-held service.
 * - Web (browser/devtools): @capacitor/geolocation watchPosition.
 *
 * Policy (battery + server load):
 * - latest-only submission: each fix is POSTed once; failures are
 *   surfaced, never queued in bulk (no offline flood on reconnect).
 * - identity always derives from the shared axios JWT (fresh per
 *   request); the server ignores any forged employee_id.
 * - exactly one active capture loop at a time (start() is idempotent;
 *   stop() clears everything; no duplicates across remounts).
 */
import { Capacitor } from "@capacitor/core";
import api from "./api";

const MIN_INTERVAL_MS = 30000;
const DISTANCE_FILTER_M = 50;

const listeners = new Set();
let running = false;
let mode = null; // 'native' | 'web' | null
let nativeStarted = false;
let webWatchId = null;
let lastError = "";
let lastFixAt = null;

function snapshot() {
  return {
    running,
    mode,
    lastError,
    lastFixAt,
    isNative: Capacitor.isNativePlatform()
  };
}

function notify() {
  const snap = snapshot();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      // A broken subscriber must never kill the tracking loop.
    }
  });
}

export function subscribeTracking(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

function setError(message) {
  lastError = message || "";
  notify();
}

async function postFix({ latitude, longitude, accuracy }) {
  try {
    await api.post("/tracking/location", {
      latitude,
      longitude,
      accuracy: accuracy ?? null
    });
    lastFixAt = new Date().toISOString();
    setError("");
  } catch (err) {
    if (err.response?.status === 403 && err.response?.data?.code === "TRACKING_DISABLED") {
      // Server-side state flipped (toggled OFF elsewhere): stop locally
      // and let the UI resync instead of spamming a dead endpoint.
      await stopTracking();
      setError("Tracking was disabled server-side. State resynced.");
      return;
    }
    if (!err.response) {
      setError("Network unavailable. Will retry with a fresh fix — nothing is queued in bulk.");
    } else {
      setError(err.response?.data?.message || "Location rejected.");
    }
  }
  notify();
}

function toFix(coords) {
  if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
    return null;
  }
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? null
  };
}

async function startNative() {
  // Imported lazily so web bundles never load native bridges.
  const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
  const status = await BackgroundGeolocation.checkPermissions().catch(() => null);
  const loc = status?.location;
  if (loc === "denied") {
    setError("Location permission denied. Allow location access, then turn tracking ON again. (System Settings can reset a permanent denial.)");
    return false;
  }
  try {
    await BackgroundGeolocation.start(
      {
        backgroundMessage: "Your live position is shared with MiNDZTEAM operations while tracking is ON.",
        backgroundTitle: "MiNDZTEAM location tracking is active",
        requestPermissions: true,
        stale: false,
        distanceFilter: DISTANCE_FILTER_M,
        minIntervalMs: MIN_INTERVAL_MS
      },
      (location, error) => {
        if (error) {
          if (error.code === "NOT_AUTHORIZED") {
            setError("Location not authorized. Grant permission, then turn tracking ON again.");
          } else {
            setError("Location unavailable. Move outdoors with a clear sky view.");
          }
          return;
        }
        const fix = location ? toFix(location) : null;
        if (fix) {
          postFix(fix);
        }
      }
    );
    nativeStarted = true;
    mode = "native";
    return true;
  } catch (err) {
    setError("Could not start background tracking on this device. Using foreground mode if available.");
    return false;
  }
}

async function startWeb() {
  const { Geolocation } = await import("@capacitor/geolocation");
  try {
    const perm = await Geolocation.checkPermissions().catch(() => null);
    if (perm && perm.location !== "granted" && perm.coarseLocation !== "granted") {
      const req = await Geolocation.requestPermissions().catch(() => null);
      if (req && req.location !== "granted" && req.coarseLocation !== "granted") {
        setError("Location permission denied. Allow location access, then turn tracking ON again.");
        return false;
      }
    }
  } catch {
    // checkPermissions unavailable (plain browser) — watchPosition below
    // will surface the real permission error instead.
  }
  try {
    webWatchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      (position, err) => {
        if (err) {
          setError("Location unavailable in this browser right now.");
          return;
        }
        const fix = position ? toFix(position.coords) : null;
        if (fix) {
          postFix(fix);
        }
      }
    );
    mode = "web";
    return true;
  } catch (err) {
    setError("Could not start location watch in this browser.");
    return false;
  }
}

export async function startTracking() {
  if (running) return true;
  running = true;
  setError("");
  notify();
  let ok = false;
  if (Capacitor.isNativePlatform()) {
    ok = await startNative();
  }
  if (!ok && !Capacitor.isNativePlatform()) {
    ok = await startWeb();
  }
  if (!ok && Capacitor.isNativePlatform()) {
    // Native start failed (e.g. permission): fall back to web watch so
    // foreground use still works where the WebView allows it.
    ok = await startWeb();
  }
  if (!ok) {
    running = false;
    mode = null;
  }
  notify();
  return ok;
}

export async function stopTracking() {
  if (Capacitor.isNativePlatform() && nativeStarted) {
    try {
      const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
      await BackgroundGeolocation.stop();
    } catch {
      // Best-effort: the OS drops the service when the watcher is gone.
    }
    nativeStarted = false;
  }
  if (webWatchId !== null) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await Geolocation.clearWatch({ id: webWatchId });
    } catch {
      // Best-effort cleanup.
    }
    webWatchId = null;
  }
  running = false;
  mode = null;
  setError("");
  notify();
}

export async function openLocationSettings() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
    await BackgroundGeolocation.openSettings();
    return true;
  } catch {
    return false;
  }
}

export function getTrackingSnapshot() {
  return snapshot();
}
