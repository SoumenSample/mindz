/**
 * LiveTracking (Module 9.3) — Employee Live Tracking board.
 * Polling only (30s, replace-only state, no sockets). OpenStreetMap +
 * Leaflet views (see TrackingMap); table, single-employee map modal, and
 * all-employees map share GET /api/tracking/active data — no second API.
 * No map API key required.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import VisitService from "../services/VisitService";
import { parseDbTimestamp, formatIST } from "../utils/datetime";
import {
  AllEmployeesMap,
  EmployeeMap
} from "./TrackingMap";

const POLL_MS = 30000;

const FRESHNESS_BADGE = {
  fresh: "bg-success",
  recent: "bg-info text-dark",
  stale: "bg-warning text-dark",
  offline: "bg-secondary",
  no_location: "bg-light text-dark border"
};

const FRESHNESS_LABEL = {
  fresh: "ONLINE",
  recent: "RECENT",
  stale: "STALE",
  offline: "OFFLINE",
  no_location: "NO LOCATION"
};

function ageLabel(capturedAt) {
  const dt = parseDbTimestamp(capturedAt);
  if (!dt) return "—";
  const secs = Math.max(0, Math.round((Date.now() - dt.getTime()) / 1000));
  if (secs < 60) return `${secs} sec ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function BoardRows({ isLoading, rows, navigate, setMapRow }) {
  if (isLoading) {
    return (
      <tr><td colSpan="6" className="text-center py-4"><div className="spinner-border text-primary" role="status"></div></td></tr>
    );
  }
  if (rows.length === 0) {
    return (
      <tr><td colSpan="6" className="text-center py-4 text-muted">No tracked employees right now.</td></tr>
    );
  }
  return (
    <>
      {rows.map((r) => (
        <tr key={r.employee_id}>
          <td className="ps-3 fw-semibold">
            {r.employee_name} <small className="text-muted d-block">{r.employee_code}{r.designation ? ` · ${r.designation}` : ""}</small>
          </td>
          <td><span className={`badge ${FRESHNESS_BADGE[r.freshness] || "bg-secondary"}`}>{FRESHNESS_LABEL[r.freshness] || r.freshness}</span></td>
          <td><small className="text-muted">{r.captured_at ? `${formatIST(r.captured_at)} (${ageLabel(r.captured_at)})` : "—"}</small></td>
          <td>{r.job_number ? (<span>{r.job_number} <small className="text-muted d-block">{r.job_status}</small></span>) : (<span className="text-muted fst-italic">No active job</span>)}</td>
          <td className="font-monospace small">
            {r.latitude !== null && r.latitude !== undefined
              ? `${r.latitude}, ${r.longitude}`
              : <span className="text-muted fst-italic">—</span>}
          </td>
          <td className="text-end pe-3">
            <div className="btn-group btn-group-sm">
              {r.job_id && (
                <button className="btn btn-outline-secondary" onClick={() => navigate(`/jobs/${r.job_id}`)}>Job</button>
              )}
              {r.latitude !== null && r.latitude !== undefined && (
                <button className="btn btn-outline-primary" onClick={() => setMapRow(r)}>View Map</button>
              )}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

const LiveTracking = () => {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("table"); // table | map
  const [mapRow, setMapRow] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async (silent) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await VisitService.getActiveTracking();
      if (res.success) {
        setRows(res.data);
        setUpdatedAt(new Date());
        setError("");
      }
    } catch (err) {
      if (!silent) setError(err.response?.data?.message || "Unable to load tracking.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    timer.current = setInterval(() => load(true), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  if (!hasPermission("tracking.view")) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">
          <i className="bi bi-shield-lock me-2"></i>
          Access denied. This page requires permission <strong>tracking.view</strong>.
        </div>
      </div>
    );
  }

  const board = (
    <>
      {error && <div className="alert alert-danger">{error}</div>}

      {view === "map" && (
        <AllEmployeesMap rows={rows} />
      )}

      {view === "table" && (
          <div className="card shadow-sm border-0">
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">Employee</th>
                      <th>Tracking</th>
                      <th>Last Update</th>
                      <th>Job</th>
                      <th>Position</th>
                      <th className="text-end pe-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <BoardRows isLoading={isLoading} rows={rows} navigate={navigate} setMapRow={setMapRow} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {mapRow && (
          <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.4)" }}>
            <div className="modal-dialog modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{mapRow.employee_name} — live position</h5>
                  <button type="button" className="btn-close" onClick={() => setMapRow(null)}></button>
                </div>
                <div className="modal-body">
                  <EmployeeMap row={(mapRow && rows.find((r) => r.employee_id === mapRow.employee_id)) || mapRow} />
                </div>
              </div>
            </div>
          </div>
        )}
    </>
  );

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>Employee Live Tracking</h4>
          <p>
            Latest known location per trackable employee.{" "}
            {updatedAt && <small className="text-muted">Refreshed {updatedAt.toLocaleTimeString()} · auto every 30s</small>}
          </p>
        </div>
        <div className="d-flex gap-2">
          <div className="btn-group" role="group">
            <button className={`btn btn-sm ${view === "table" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setView("table")}>
              <i className="bi bi-table me-1"></i>Table
            </button>
            <button className={`btn btn-sm ${view === "map" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setView("map")}>
              <i className="bi bi-map me-1"></i>Map
            </button>
          </div>
          <button className="btn btn-sm btn-outline-primary" onClick={() => load(false)}>
            <i className="bi bi-arrow-clockwise me-1"></i>Refresh now
          </button>
        </div>
      </div>

      {board}
    </div>
  );
};

export default LiveTracking;
