/**
 * TrackingMap (Module 9.3) — OpenStreetMap + Leaflet views for the admin board.
 * Single MapContainer per view; markers/circles are keyed by employee_id so
 * React reconciliation adds/moves/removes them without recreating the map,
 * the tile layer, or leaking layers. Unmount cleans up with the library.
 * Only rows with valid coordinates become markers — NO_LOCATION employees
 * stay in the table but never produce a marker. No API key required.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// Fix default marker assets under bundlers (no bare /marker-icon.png assumption).
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { formatIST } from "../utils/datetime";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow
});

const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const KOLKATA_ZOOM = 11; // initial zoom when several markers exist (FitRoster then fits bounds)
const EMPLOYEE_ZOOM = 14;

function validRows(rows) {
  return (rows || []).filter(
    (r) => r.latitude !== null && r.latitude !== undefined &&
      r.longitude !== null && r.longitude !== undefined &&
      Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude))
  );
}

function accuracyOf(row) {
  const a = Number(row.accuracy_meters);
  return Number.isFinite(a) && a > 0 ? a : null;
}

function PopupBody({ row }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
      <strong>{row.employee_name}</strong>
      <span className="text-muted"> ({row.employee_code})</span>
      <br />
      {row.designation && <><span className="text-muted">{row.designation}</span><br /></>}
      Status: <strong>{row.freshness || "—"}</strong>
      <br />
      {row.job_number ? <>Job: <strong>{row.job_number}</strong><br /></> : <>Job: <span className="text-muted">No active job</span><br /></>}
      Lat: <span className="font-monospace">{row.latitude}</span><br />
      Lng: <span className="font-monospace">{row.longitude}</span><br />
      Accuracy: {accuracyOf(row) !== null ? `±${row.accuracy_meters} m` : "—"}<br />
      Last updated: {row.captured_at ? formatIST(row.captured_at) : "—"}
    </div>
  );
}

function EmployeeMarkers({ rows }) {
  const markers = useMemo(() => validRows(rows), [rows]);
  return (
    <>
      {markers.map((r) => {
        const pos = [Number(r.latitude), Number(r.longitude)];
        const acc = accuracyOf(r);
        return (
          <React.Fragment key={r.employee_id}>
            {acc !== null && (
              <Circle
                center={pos}
                radius={acc}
                pathOptions={{ color: "#0d6efd", weight: 1, opacity: 0.6, fillOpacity: 0.12 }}
              />
            )}
            <Marker position={pos} title={`${r.employee_name} (${r.freshness || "?"})`}>
              <Popup><PopupBody row={r} /></Popup>
            </Marker>
          </React.Fragment>
        );
      })}
    </>
  );
}

/**
 * Fits the view when the tracked roster changes (mount + join/leave),
 * but never on plain position updates — polling must not yank the user's
 * zoom/pan every 30s.
 */
function FitRoster({ markers }) {
  const map = useMap();
  const prevIds = useRef(null);
  useEffect(() => {
    const ids = markers.map((r) => r.employee_id).slice().sort((a, b) => a - b).join(",");
    if (ids === prevIds.current) return;
    prevIds.current = ids;
    if (markers.length > 1) {
      map.fitBounds(
        L.latLngBounds(markers.map((r) => [Number(r.latitude), Number(r.longitude)])),
        { padding: [40, 40] }
      );
    } else if (markers.length === 1) {
      map.setView([Number(markers[0].latitude), Number(markers[0].longitude)], EMPLOYEE_ZOOM);
    }
  }, [markers, map]);
  return null;
}

/**
 * All-employees map. One MapContainer; one tile layer; keyed markers.
 */
export function AllEmployeesMap({ rows, height = 420 }) {
  const markers = useMemo(() => validRows(rows), [rows]);
  if (markers.length === 0) {
    return (
      <div className="alert alert-light border text-muted small" style={{ minHeight: 120 }}>
        <i className="bi bi-geo-alt me-2"></i>
        No employee GPS locations available yet.
      </div>
    );
  }
  return (
    <div style={{ height, width: "100%" }} className="border rounded overflow-hidden">
      <MapContainer
        center={[Number(markers[0].latitude), Number(markers[0].longitude)]}
        zoom={markers.length === 1 ? EMPLOYEE_ZOOM : KOLKATA_ZOOM}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url={OSM_TILES} attribution={OSM_ATTRIBUTION} />
        <FitRoster markers={markers} />
        <EmployeeMarkers rows={rows} />
      </MapContainer>
    </div>
  );
}

/**
 * Single-employee map, centered on that employee.
 */
export function EmployeeMap({ row, height = 380 }) {
  const valid = row && validRows([row]).length === 1;
  if (!valid) {
    return (
      <div className="alert alert-light border text-muted small">
        <i className="bi bi-geo-alt me-2"></i>
        No GPS location available for this employee yet.
      </div>
    );
  }
  return (
    <div style={{ height, width: "100%" }} className="border rounded overflow-hidden">
      <MapContainer
        center={[Number(row.latitude), Number(row.longitude)]}
        zoom={EMPLOYEE_ZOOM}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url={OSM_TILES} attribution={OSM_ATTRIBUTION} />
        <EmployeeMarkers rows={[row]} />
      </MapContainer>
    </div>
  );
}
