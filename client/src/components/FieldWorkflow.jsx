/**
 * FieldWorkflow  — employee field actions for one job.
 * Shown only when the logged-in user is the ACTIVE assignee (derived
 * from the job's assignments + JWT employee id — never role alone).
 * Backend stays authoritative: every tap maps to one explicit API and
 * the UI refreshes server state afterwards (no optimistic transitions).
 * Later-module steps render locked; they perform nothing.
 */
import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import VisitService from "../services/VisitService";
import MeasurementService from "../services/MeasurementService";
import JobPhotoService from "../services/JobPhotoService";
import SignatureService from "../services/SignatureService";
import { getCurrentGps } from "../services/gps";
import { formatIST } from "../utils/datetime";

// Job progression order (backend: PENDING > ASSIGNED > EN_ROUTE >
// REACHED > WORK_STARTED > ... > SUBMITTED > ... > COMPLETED).
// A step is done once the job has moved past it, current only while
// the job sits exactly on its entry status.
const STATUS_ORDER = [
  "PENDING",
  "ASSIGNED",
  "EN_ROUTE",
  "REACHED",
  "WORK_STARTED",
  "WORK_IN_PROGRESS",
  "IN_PROGRESS",
  "SIGNATURE_PENDING",
  "VISIT_CLOSED",
  "SUBMITTED",
  "UNDER_VERIFICATION",
  "APPROVED",
  "RESUBMISSION_REQUIRED",
  "REJECTED",
  "COMPLETED",
  "CANCELLED"
];

const rankOf = (status) => {
  const i = STATUS_ORDER.indexOf(status);
  return i === -1 ? -1 : i;
};

const FieldWorkflow = ({ job, onChanged }) => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [sheets, setSheets] = useState([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [signature, setSignature] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const jobId = job?.id;
  const jobStatus = job?.status;
  const visits = [...(job?.visits || [])].sort((a, b) => b.visit_number - a.visit_number);
  const latestVisit = visits[0] || null;
  const latestVisitId = latestVisit?.id ?? null;
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    MeasurementService.getSheetsByJob(jobId)
      .then((res) => { if (!cancelled && res.success) setSheets(res.data || []); })
      .catch(() => {});
    // Photo + signature state for the latest visit (drives the Photos /
    // Signature / Close rows below). Failures keep the locked display —
    // the sections themselves stay authoritative.
    JobPhotoService.listByJob(jobId)
      .then((res) => {
        if (cancelled || !res.success) return;
        const rows = res.data || [];
        setPhotoCount(latestVisitId ? rows.filter((p) => Number(p.visit_id) === Number(latestVisitId)).length : rows.length);
      })
      .catch(() => {});
    if (latestVisitId) {
      SignatureService.getByVisit(latestVisitId)
        .then((res) => { if (!cancelled && res.success) setSignature(res.data); })
        .catch(() => { if (!cancelled) setSignature(null); });
    } else {
      setSignature(null);
    }
    return () => { cancelled = true; };
  }, [jobId, jobStatus, latestVisitId]);

  if (!job) return null;

  const activeAssign = (job.assignments || []).find((a) => a.status === "ACTIVE") || null;
  const myEmployeeId = user?.employee?.id;
  const isAssignee = !!(
    myEmployeeId &&
    activeAssign &&
    Number(activeAssign.employee_id) === Number(myEmployeeId)
  );

  if (!isAssignee) return null;

  const rank = rankOf(job.status);
  const reachedDone = rank >= rankOf("REACHED") || !!latestVisit?.reached_at;
  const workStartedAt = (job.status_history || []).find((h) => h.to_status === "WORK_STARTED")?.created_at || null;
  const startWorkDone = rank >= rankOf("WORK_STARTED") || !!workStartedAt;

  // Measurements state comes from the sheets API (job detail carries no
  // sheet list). FINAL => done, DRAFT => current, none yet => current
  // once work has started, locked before that.
  const finalSheet = sheets.find((s) => s.status === "FINAL") || null;
  const draftSheet = sheets.find((s) => s.status === "DRAFT") || null;
  const measurementDone = !!finalSheet;
  const measurementCurrent = !measurementDone && (job.status === "WORK_STARTED" || job.status === "REACHED" || !!draftSheet);

  const travelDone = rank > rankOf("ASSIGNED");
  const travelCurrent = job.status === "ASSIGNED";
  const reachCurrent = job.status === "EN_ROUTE";
  const startCurrent = job.status === "REACHED";
  const photosDone = photoCount > 0;
  const signatureDone = !!signature;
  const closeDone = rank >= rankOf("VISIT_CLOSED");
  const submittedDone = rank >= rankOf("SUBMITTED");

  const currentStep = travelCurrent ? "Travel to Store"
    : reachCurrent ? "Reach Store"
    : startCurrent ? "Start Work"
    : measurementCurrent ? "Measurements"
    : !photosDone ? "Photos"
    : !signatureDone ? "Signature"
    : !closeDone ? "Close Visit"
    : submittedDone ? "Submitted"
    : "Visit Closed";

  const doneCount = [true, travelDone, reachedDone, startWorkDone, measurementDone,
    photosDone, signatureDone, closeDone, submittedDone].filter(Boolean).length;

  const finish = async (message) => {
    setNote(message);
    setTimeout(() => setNote(""), 8000);
    if (onChanged) await onChanged();
  };

  const handleStartTravel = async () => {
    setBusy("travel");
    setError("");
    try {
      // Fresh GPS fix first so the permission prompt has context; the
      // contract itself carries no coordinates (identity/state server-side).
      await getCurrentGps();
    } catch (err) {
      setError(err.message || "GPS unavailable.");
      setBusy(null);
      return;
    }
    try {
      const out = await VisitService.startTravel(job.id);
      await finish(`Travel started — Visit #${out.data?.visit_number} opened, GPS tracking active.`);
    } catch (err) {
      const data = err.response?.data;
      setError(data?.message || "Could not start travel.");
      if (onChanged) await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const handleReach = async () => {
    setBusy("reach");
    setError("");
    let gps;
    try {
      gps = await getCurrentGps();
    } catch (err) {
      setError(err.message || "GPS unavailable.");
      setBusy(null);
      return;
    }
    try {
      const out = await VisitService.reachStore(job.id, {
        latitude: gps.latitude,
        longitude: gps.longitude,
        accuracy: gps.accuracy,
        device_info: navigator.userAgent.slice(0, 100)
      });
      const d = out.data?.reach_distance;
      await finish(`Store reached recorded${d !== null && d !== undefined ? ` (${d} m from reference)` : ""}. Tracking stopped.`);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === "OUTSIDE_REACH_RADIUS") {
        setError(`You are approximately ${data.data?.distance_meters} m from the store. You must be within ${data.data?.radius_meters} m to mark the store as reached.`);
      } else {
        setError(data?.message || "Could not record reach. Not marked — safe to retry.");
      }
    } finally {
      setBusy(null);
    }
  };

  const stepRow = (done, current, label, sub) => (
    <div className="d-flex align-items-start gap-2 py-1" key={label}>
      <span className={`badge ${done ? "bg-success" : current ? "bg-primary" : "bg-secondary"}`}>
        {done ? <i className="bi bi-check-lg"></i> : current ? <i className="bi bi-arrow-right"></i> : <i className="bi bi-lock"></i>}
      </span>
      <div>
        <div className={done || current ? "fw-semibold" : "text-muted"}>{label}</div>
        {sub && <small className="text-muted">{sub}</small>}
      </div>
    </div>
  );

  return (
    <div className="border rounded p-3 mb-3 bg-light">
      <div className="d-flex align-items-center gap-2 mb-2">
        <h6 className="text-muted text-uppercase mb-0" style={{ fontSize: 12 }}>Job Workflow</h6>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary ms-auto"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse job workflow" : "Expand job workflow"}
          onClick={() => setExpanded((v) => !v)}
        >
          <i className={`bi ${expanded ? "bi-chevron-up" : "bi-chevron-down"}`}></i>
          <span className="ms-1">{expanded ? "Collapse" : "Expand"}</span>
        </button>
      </div>

      {!expanded && (
        <div className="d-flex align-items-center gap-2 flex-wrap small">
          <span className="badge bg-secondary">{job.status}</span>
          <span className="text-muted">{doneCount}/9 done</span>
          <span className="fw-semibold">Current: {currentStep}</span>
        </div>
      )}

      {expanded && (
        <>
          {stepRow(true, false, "Job Assigned", activeAssign ? `${activeAssign.employee_name}` : "")}
          {stepRow(travelDone, travelCurrent, "Travel to Store",
            latestVisit ? `Visit #${latestVisit.visit_number} opened ${latestVisit.started_at ? formatIST(latestVisit.started_at) : ""}` : "")}
          {stepRow(reachedDone, reachCurrent, "Reach Store",
            latestVisit?.reached_at ? `Reached ${formatIST(latestVisit.reached_at)}` : "")}
          {stepRow(startWorkDone, startCurrent, "Start Work",
            workStartedAt ? `Started ${formatIST(workStartedAt)}` : "")}
          {stepRow(measurementDone, measurementCurrent, "Measurements",
            finalSheet ? `Version ${finalSheet.version_no} FINAL` : draftSheet ? `Version ${draftSheet.version_no} DRAFT` : "")}
          {stepRow(photosDone, !photosDone && !measurementCurrent && !travelCurrent && !reachCurrent && !startCurrent, "Photos",
            photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"}${latestVisit ? ` · Visit #${latestVisit.visit_number}` : ""}` : "")}
          {stepRow(signatureDone, photosDone && !signatureDone, "Signature",
            signature ? `${signature.signer_name}${signature.created_at ? ` · ${formatIST(signature.created_at)}` : ""}` : "")}
          {stepRow(closeDone, signatureDone && !closeDone, "Visit Closed",
            latestVisit?.status === "VISIT_CLOSED" ? `Visit #${latestVisit.visit_number} closed${latestVisit.closed_at ? ` ${formatIST(latestVisit.closed_at)}` : ""}` : "")}
          {stepRow(submittedDone, false, "Submit", "")}
        </>
      )}

      {error && <div className="alert alert-danger py-2 mt-2 mb-0 small">{error}</div>}
      {note && <div className="alert alert-success py-2 mt-2 mb-0 small">{note}</div>}

      {job.status === "ASSIGNED" && (
        <div className="mt-3">
          <div className="small text-muted mb-1">Current step: Travel to Store</div>
          <button className="btn btn-primary" disabled={busy === "travel"} onClick={handleStartTravel}>
            {busy === "travel" ? (<><span className="spinner-border spinner-border-sm me-2"></span>Starting...</>) : (<><i className="bi bi-truck me-2"></i>Start Travel</>)}
          </button>
        </div>
      )}

      {job.status === "EN_ROUTE" && (
        <div className="mt-3">
          <div className="alert alert-info py-2 small mb-2">
            <i className="bi bi-geo-alt me-2"></i>
            Traveling to store{latestVisit ? ` — Visit #${latestVisit.visit_number}, started ${latestVisit.started_at ? formatIST(latestVisit.started_at) : "—"}` : ""}.
            GPS tracking: Active.
          </div>
          <div className="small text-muted mb-1">Current step: Reach Store</div>
          <button className="btn btn-success" disabled={busy === "reach"} onClick={handleReach}>
            {busy === "reach" ? (<><span className="spinner-border spinner-border-sm me-2"></span>Locating...</>) : (<><i className="bi bi-geo-alt me-2"></i>Reach Store</>)}
          </button>
        </div>
      )}

      {job.status === "REACHED" && (
        <div className="mt-3">
          <div className="alert alert-success py-2 small mb-0">
            <i className="bi bi-check-circle me-2"></i>
            Store Reached{latestVisit ? ` — Visit #${latestVisit.visit_number}` : ""}
            {latestVisit?.reached_at ? ` at ${formatIST(latestVisit.reached_at)}` : ""}
            {latestVisit?.distance_meters !== null && latestVisit?.distance_meters !== undefined ? ` (${latestVisit.distance_meters} m)` : ""}.
          </div>
        </div>
      )}
    </div>
  );
};

export default FieldWorkflow;
