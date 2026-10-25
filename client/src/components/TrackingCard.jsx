/**
 * TrackingCard — explicit employee tracking ON/OFF.
 * Company consent lives in the backend flag (enable/disable endpoints);
 * device capture lives in the central tracking service. The four states
 * stay distinct: company tracking, device permission, service running,
 * latest fix. Rendered only for employee-linked logins (no role literals).
 */
import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import VisitService from "../services/VisitService";
import { parseDbTimestamp } from "../utils/datetime";
import {
  subscribeTracking,
  startTracking,
  stopTracking,
  getTrackingSnapshot
} from "../services/tracking";

function ageLabel(capturedAt) {
  const dt = parseDbTimestamp(capturedAt);
  if (!dt) return "never reported";
  const secs = Math.max(0, Math.round((Date.now() - dt.getTime()) / 1000));
  if (secs < 60) return `${secs} seconds ago`;
  return `${Math.floor(secs / 60)} min ago`;
}

const TrackingCard = () => {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [lastPoint, setLastPoint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [service, setService] = useState(getTrackingSnapshot());

  useEffect(() => {
    VisitService.getTrackingState()
      .then((res) => {
        if (res.success) {
          const on = !!res.data?.tracking_enabled;
          setEnabled(on);
          if (res.data?.last_point) setLastPoint(res.data.last_point);
          if (on) {
            // Resume device capture for an already-enabled flag (e.g.
            // after app restart); failures only set the service message.
            startTracking();
          }
        }
      })
      .catch(() => setError("Could not load tracking state."))
      .finally(() => setLoading(false));
    return subscribeTracking(setService);
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      if (enabled) {
        await stopTracking();
        await VisitService.disableTracking();
        setEnabled(false);
      } else {
        await VisitService.enableTracking();
        const started = await startTracking();
        if (!started) {
          // Device capture refused: roll the backend flag back so the
          // board never implies live data that cannot arrive.
          await VisitService.disableTracking().catch(() => {});
          setError("Device location could not start. Backend flag left OFF — see message above.");
          return;
        }
        setEnabled(true);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not change tracking state.");
    } finally {
      setBusy(false);
    }
  };

  // Renders only for employee-linked logins (after all hooks — rules-of-hooks).
  if (!user?.employee?.id) return null;

  if (loading) {
    return (
      <div className="alert alert-light border py-2 small text-muted">Loading tracking state...</div>
    );
  }

  return (
    <div className="alert py-2 mb-3 border" style={{ background: "#f8fafc" }}>
      <div className="d-flex align-items-center gap-3">
        <span className={`badge ${enabled ? "bg-success" : "bg-secondary"}`}>
          {enabled ? "● Tracking ON" : "○ Tracking OFF"}
        </span>
        <span className="small text-muted">
          {lastPoint?.captured_at ? `Last update: ${ageLabel(lastPoint.captured_at)}` : "No fix sent yet"}
          {lastPoint?.accuracy_meters !== undefined && lastPoint?.accuracy_meters !== null
            ? ` · Accuracy: ±${Math.round(lastPoint.accuracy_meters)}m`
            : lastPoint?.accuracy !== undefined && lastPoint?.accuracy !== null
              ? ` · Accuracy: ±${Math.round(lastPoint.accuracy)}m` : ""}
        </span>
        <button className={`btn btn-sm ms-auto ${enabled ? "btn-outline-secondary" : "btn-primary"}`}
          disabled={busy} onClick={toggle}>
          {busy ? "Saving..." : enabled ? "Turn OFF" : "Turn ON"}
        </button>
      </div>
      <div className="small text-muted mt-1">
        Permission: {service.lastError ? "attention needed" : "allowed"} · Service: {service.running ? `running (${service.mode})` : "stopped"}
      </div>
      {(error || service.lastError) && (
        <div className="small text-danger mt-1">{error || service.lastError}</div>
      )}
      {!enabled && !error && !service.lastError && (
        <div className="small text-muted mt-1">Turn ON to share your latest position with operations. Tracking is visible to you here at all times.</div>
      )}
    </div>
  );
};

export default TrackingCard;
