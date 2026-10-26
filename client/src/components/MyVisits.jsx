/**
 * MyVisits (Modules 9 + 9.2) — visits in the viewer's scope with the two
 * field actions of this scope: Start Travel (ASSIGNED job) and Store
 * Reached (EN_ROUTE + live GPS). Continuous location sharing is owned
 * by the TrackingCard (explicit ON/OFF) and runs independently of
 * visits — reaching a store no longer stops it.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import VisitService from "../services/VisitService";
import TrackingCard from "./TrackingCard";
import VisitReportButton from "./VisitReportButton";
import { getCurrentGps } from "../services/gps";
import { formatIST } from "../utils/datetime";

const VISIT_BADGE = {
  OPEN: "bg-info-subtle text-info-emphasis",
  REACHED: "bg-success-subtle text-success-emphasis",
  WORK_IN_PROGRESS: "bg-warning-subtle text-warning-emphasis",
  SIGNATURE_PENDING: "bg-warning-subtle text-warning-emphasis",
  VISIT_CLOSED: "bg-secondary-subtle text-secondary-emphasis",
  CANCELLED: "bg-danger-subtle text-danger-emphasis"
};

const MyVisits = () => {
  const { hasPermission } = useAuth();
  const canAct = hasPermission("visits.manage");
  const [visits, setVisits] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [alert, setAlert] = useState({ show: false, type: "", message: "" });
  const [busy, setBusy] = useState(null);

  const showAlert = (type, message) => {
    setAlert({ show: true, type, message });
    setTimeout(() => setAlert({ show: false, type: "", message: "" }), 6000);
  };

  const loadVisits = useCallback(
    async (page = 1, statusFilter = status) => {
      setIsLoading(true);
      try {
        const res = await VisitService.getMyVisits({ page, limit: 20, status: statusFilter });
        if (res.success) {
          setVisits(res.data);
          setPagination(res.pagination);
        }
      } catch (error) {
        showAlert("danger", error.response?.data?.message || "Unable to load visits.");
      } finally {
        setIsLoading(false);
      }
    },
    [status]
  );

  useEffect(() => {
    loadVisits(1);
  }, [loadVisits]);

  const refresh = () => loadVisits(pagination.page);

  const handleStartTravel = async (jobId) => {
    setBusy(`travel-${jobId}`);
    try {
      // Fresh GPS fix first so the permission prompt has context; the
      // start-travel contract itself carries no coordinates.
      await getCurrentGps();
    } catch (err) {
      showAlert("danger", err.message || "GPS unavailable.");
      setBusy(null);
      return;
    }
    try {
      const out = await VisitService.startTravel(jobId);
      showAlert("success", out.message || `Travel started (visit ${out.data?.visit_number}).`);
      refresh();
    } catch (error) {
      const data = error.response?.data;
      showAlert("danger", data?.message || "Could not start travel.");
    } finally {
      setBusy(null);
    }
  };

  const handleReach = async (jobId) => {
    setBusy(`reach-${jobId}`);
    // GPS is best-effort (geofence bypassed for now): a failed fix must
    // not block the reach — coordinates are simply omitted from the call.
    let gps = null;
    try {
      gps = await getCurrentGps();
    } catch (err) {
      gps = null;
    }
    try {
      const out = await VisitService.reachStore(jobId, {
        ...(gps ? { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy } : {}),
        device_info: navigator.userAgent.slice(0, 100)
      });
      const d = out.data?.reach_distance;
      showAlert("success", `Store reached recorded${d !== null && d !== undefined ? ` (${d} m from reference)` : ""}.`);
      refresh();
    } catch (error) {
      const data = error.response?.data;
      if (data?.code === "OUTSIDE_REACH_RADIUS") {
        showAlert("danger", `Store too far (${data.data?.distance_meters} m; allowed ${data.data?.radius_meters} m). Move closer and retry.`);
      } else if (data?.code === "STORE_GPS_MISSING") {
        showAlert("danger", data.message);
      } else {
        showAlert("danger", data?.message || "Could not record reach. Not marked — safe to retry.");
      }
    } finally {
      setBusy(null);
    }
  };

  const goPage = (page) => {
    if (page >= 1 && page <= Math.max(pagination.totalPages, 1)) loadVisits(page);
  };

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>My Visits</h4>
          <p>Visits in your scope — {pagination.total} record(s).</p>
        </div>
      </div>

      <TrackingCard />

      {alert.show && (
        <div className={`alert alert-${alert.type} alert-dismissible fade show`} role="alert">
          {alert.message}
          <button type="button" className="btn-close" onClick={() => setAlert({ show: false, type: "", message: "" })}></button>
        </div>
      )}

      <div className="card shadow-sm border-0 mb-4">
        <div className="card-body d-flex gap-2 align-items-end">
          <div>
            <label className="form-label">Status</label>
            <select className="form-select" value={status} onChange={(e) => { setStatus(e.target.value); loadVisits(1, e.target.value); }}>
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="REACHED">Reached</option>
              <option value="WORK_IN_PROGRESS">Work in progress</option>
              <option value="VISIT_CLOSED">Closed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card shadow-sm border-0">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th className="ps-3">Visit #</th>
                  <th>Job #</th>
                  <th>Store</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Reached</th>
                  <th>Measurement</th>
                  <th className="text-end pe-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan="8" className="text-center py-4"><div className="spinner-border text-primary" role="status"></div></td></tr>
                ) : visits.length === 0 ? (
                  <tr><td colSpan="8" className="text-center py-4 text-muted">No visits yet. Start travel from an assigned job to open one.</td></tr>
                ) : (
                  visits.map((v) => (
                    <tr key={v.id}>
                      <td className="ps-3"><span className="badge bg-light text-dark border">#{v.visit_number}</span></td>
                      <td><Link to={`/jobs/${v.job_id}`} className="font-monospace">{v.job_number}</Link></td>
                      <td>{v.store_name} <small className="text-muted">({v.store_code})</small></td>
                      <td><span className={`badge ${VISIT_BADGE[v.status] || "bg-secondary"} border`}>{v.status}</span></td>
                      <td><small className="text-muted">{v.started_at ? formatIST(v.started_at) : "—"}</small></td>
                      <td><small className="text-muted">{v.reached_at ? formatIST(v.reached_at) : "—"}</small></td>
                      <td>
                        {v.measurement_status === "FINAL" && <span className="badge bg-success-subtle text-success-emphasis border">✓ FINAL</span>}
                        {v.measurement_status === "DRAFT" && <span className="badge bg-warning-subtle text-warning-emphasis border">● DRAFT</span>}
                        {!v.measurement_status && <span className="text-muted">—</span>}
                      </td>
                      <td className="text-end pe-3">
                        <div className="btn-group btn-group-sm">
                          {canAct && v.job_status === "ASSIGNED" && (
                            <button className="btn btn-outline-primary" disabled={busy === `travel-${v.job_id}`}
                              onClick={() => handleStartTravel(v.job_id)} title="Start Travel">
                              <i className="bi bi-truck"></i> Travel
                            </button>
                          )}
                          {canAct && v.job_status === "EN_ROUTE" && v.status === "OPEN" && (
                            <button className="btn btn-outline-success" disabled={busy === `reach-${v.job_id}`}
                              onClick={() => handleReach(v.job_id)} title="Store Reached">
                              <i className="bi bi-geo-alt"></i> Reached
                            </button>
                          )}
                          {v.status === "VISIT_CLOSED" && (
                            <VisitReportButton visitId={v.id} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        {pagination.totalPages > 1 && (
          <div className="card-footer d-flex justify-content-center gap-2 bg-white">
            <button className="btn btn-sm btn-outline-secondary" disabled={pagination.page <= 1} onClick={() => goPage(pagination.page - 1)}>‹ Prev</button>
            <span className="align-self-center text-muted small">Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
            <button className="btn btn-sm btn-outline-secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => goPage(pagination.page + 1)}>Next ›</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyVisits;
