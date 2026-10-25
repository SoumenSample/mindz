/**
 * Verification (Module 13) — Admin review queue + per-visit evidence.
 * Queue lists only submitted-for-review jobs (VISIT_CLOSED / SUBMITTED /
 * UNDER_VERIFICATION). Review pins every evidence block to the exact
 * closed visit under review — old-visit evidence is shown under its own
 * visit in History, never as the current visit's.
 * Decisions call POST /api/jobs/:id/approve|reject (jobs.verify);
 * buttons hide without the grant, the backend stays authoritative.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import VerificationService from "../services/VerificationService";
import JobService from "../services/JobService";
import ClientService from "../services/ClientService";
import StoreService from "../services/StoreService";
import JobRequestService from "../services/JobRequestService";
import JobPhotoService from "../services/JobPhotoService";
import SignatureService from "../services/SignatureService";
import VisitReportButton from "./VisitReportButton";
import { formatIST } from "../utils/datetime";

const REVIEWABLE = ["VISIT_CLOSED", "SUBMITTED", "UNDER_VERIFICATION"];

const STATUS_BADGE = {
  VISIT_CLOSED: "bg-warning-subtle text-warning-emphasis border border-warning-subtle",
  SUBMITTED: "bg-info-subtle text-info-emphasis border border-info-subtle",
  UNDER_VERIFICATION: "bg-primary-subtle text-primary-emphasis border border-primary-subtle",
  APPROVED: "bg-success-subtle text-success-emphasis border border-success-subtle",
  REJECTED: "bg-danger-subtle text-danger-emphasis border border-danger-subtle",
  COMPLETED: "bg-success-subtle text-success-emphasis border border-success-subtle",
  ASSIGNED: "bg-info-subtle text-info-emphasis"
};

const PHOTO_LABEL = {
  BEFORE_INSTALLATION: "Before Installation",
  AFTER_INSTALLATION: "After Installation",
  CLOSEUP: "Closeup",
  FAR_VIEW: "Far View",
  MEASUREMENT_ITEM: "Measurement Item"
};

// Authenticated blob image (photo or signature view endpoint). One object
// URL per id, revoked on unmount — no binaries in React state.
function BlobImg({ loader, alt, thumb }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let url = null;
    loader()
      .then((u) => { if (alive) { url = u; setSrc(u); } else { URL.revokeObjectURL(u); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [loader]);
  if (failed) return <span className="badge bg-secondary">unavailable</span>;
  if (!src) return <span className="spinner-border spinner-border-sm text-secondary" role="status"></span>;
  if (thumb) {
    return <img src={src} alt={alt} style={{ width: 72, height: 72, objectFit: "cover" }} className="border rounded" />;
  }
  return <img src={src} alt={alt} className="img-fluid border rounded" style={{ maxHeight: 220 }} />;
}

const emptyFilters = {
  search: "", client_id: "", store_id: "", job_type_id: "",
  employee_id: "", verification_status: "", submitted_from: "", submitted_to: ""
};

const Verification = () => {
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const canView = hasPermission("jobs.verify");
  const canDecide = hasPermission("jobs.verify");

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState(emptyFilters);
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [alert, setAlert] = useState({ show: false, type: "", message: "" });

  const [clients, setClients] = useState([]);
  const [stores, setStores] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [executives, setExecutives] = useState([]);

  const [reviewId, setReviewId] = useState(null);

  // Deep link from job detail (?job=<id>): open the review directly so an
  // Admin looking at any job view lands on the decision screen.
  useEffect(() => {
    if (!canView) return;
    const deep = searchParams.get("job");
    if (deep && /^\d+$/.test(deep)) setReviewId(Number(deep));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const showAlert = (type, message) => {
    setAlert({ show: true, type, message });
    setTimeout(() => setAlert({ show: false, type: "", message: "" }), 6000);
  };

  const setF = (name) => (e) => {
    const v = e.target.value;
    setFilters((prev) => {
      // Changing client resets the store picker (stores belong to clients).
      if (name === "client_id") return { ...prev, client_id: v, store_id: "" };
      return { ...prev, [name]: v };
    });
  };

  const loadQueue = useCallback(async (page = 1, override = null) => {
    const f = override || filters;
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await VerificationService.getQueue({ ...f, page, limit: 20 });
      if (res.success) {
        setRows(res.data);
        setPagination(res.pagination);
      } else {
        setLoadError(res.message || "Failed to load verification queue.");
      }
    } catch (error) {
      setLoadError(error.response?.data?.message || "Unable to load verification queue.");
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (!canView) return;
    loadQueue(1);
    ClientService.getClients({ status: "Active", page: 1, limit: 100 })
      .then((res) => { if (res.success) setClients(res.data); }).catch(() => {});
    JobRequestService.getJobTypes()
      .then((res) => { if (res.success) setJobTypes(res.data); }).catch(() => {});
    // Eligible-executive source doubles as the Field Executive filter.
    JobService.getFieldExecutives()
      .then((res) => { if (res.success) setExecutives(res.data); }).catch(() => {});
  }, [canView, loadQueue]);

  // Store picker follows the chosen client (all stores when unfiltered).
  useEffect(() => {
    if (!canView) return;
    StoreService.getStores({ client_id: filters.client_id, status: "ACTIVE", page: 1, limit: 100 })
      .then((res) => { if (res.success) setStores(res.data); })
      .catch(() => setStores([]));
  }, [canView, filters.client_id]);

  const applyFilters = (e) => {
    e.preventDefault();
    const next = { ...filters, search: searchInput };
    setFilters(next);
    loadQueue(1, next);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setSearchInput("");
    loadQueue(1, emptyFilters);
  };

  const goPage = (page) => {
    if (page >= 1 && page <= Math.max(pagination.totalPages, 1)) loadQueue(page);
  };

  const handleDecided = (message) => {
    setReviewId(null);
    showAlert("success", message);
    loadQueue(pagination.page);
  };

  if (!canView) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">
          <i className="bi bi-shield-lock me-2"></i>
          Access denied. This page requires permission <strong>jobs.verify</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>Verification</h4>
          <p>Jobs awaiting review — {pagination.total} record(s). Closing a visit submits it; approval or rejection happens here.</p>
        </div>
        <button type="button" className="btn btn-outline-secondary" onClick={() => loadQueue(pagination.page)} disabled={isLoading}>
          <i className="bi bi-arrow-clockwise me-2"></i>Refresh
        </button>
      </div>

      {alert.show && (
        <div className={`alert alert-${alert.type} alert-dismissible fade show`} role="alert">
          {alert.message}
          <button type="button" className="btn-close" onClick={() => setAlert({ show: false, type: "", message: "" })}></button>
        </div>
      )}

      <div className="card shadow-sm border-0 mb-4">
        <div className="card-body">
          <form onSubmit={applyFilters}>
            <div className="row g-2 align-items-end">
              <div className="col-md-3">
                <label className="form-label">Job number</label>
                <input type="text" className="form-control" placeholder="JOB-000001, store, client..."
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
              </div>
              <div className="col-md-2">
                <label className="form-label">Client</label>
                <select className="form-select" value={filters.client_id} onChange={setF("client_id")}>
                  <option value="">All</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.client_name} ({c.client_code})</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Store</label>
                <select className="form-select" value={filters.store_id} onChange={setF("store_id")}>
                  <option value="">All</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Job type</label>
                <select className="form-select" value={filters.job_type_id} onChange={setF("job_type_id")}>
                  <option value="">All</option>
                  {jobTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">Field Executive</label>
                <select className="form-select" value={filters.employee_id} onChange={setF("employee_id")}>
                  <option value="">All</option>
                  {executives.map((x) => (
                    <option key={x.id} value={x.id}>{x.employee_name} ({x.employee_code})</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Verification status</label>
                <select className="form-select" value={filters.verification_status} onChange={setF("verification_status")}>
                  <option value="">All pending</option>
                  {REVIEWABLE.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Submitted from</label>
                <input type="date" className="form-control" value={filters.submitted_from} onChange={setF("submitted_from")} />
              </div>
              <div className="col-md-2">
                <label className="form-label">Submitted to</label>
                <input type="date" className="form-control" value={filters.submitted_to} onChange={setF("submitted_to")} />
              </div>
              <div className="col-md-2 d-flex gap-2">
                <button type="submit" className="btn btn-primary" disabled={isLoading}>
                  <i className="bi bi-search me-1"></i>Apply
                </button>
                <button type="button" className="btn btn-outline-secondary" onClick={clearFilters} title="Clear filters">
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className="card shadow-sm border-0">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th className="ps-3">Job</th>
                  <th>Client / Store</th>
                  <th>Type</th>
                  <th>Executive</th>
                  <th>Status</th>
                  <th>Visit</th>
                  <th>Submitted</th>
                  <th className="text-end pe-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-4"><div className="spinner-border text-primary" role="status"></div></td></tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={8} className="text-center py-4">
                      <div className="alert alert-danger d-inline-block mb-2">{loadError}</div>
                      <div><button type="button" className="btn btn-sm btn-outline-primary" onClick={() => loadQueue(pagination.page)}>Retry</button></div>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-4 text-muted">
                    <i className="bi bi-patch-check fs-3 d-block mb-2"></i>
                    No jobs awaiting verification.
                  </td></tr>
                ) : (
                  rows.map((j) => (
                    <tr key={j.id}>
                      <td className="ps-3"><span className="badge bg-light text-dark border font-monospace">{j.job_number}</span></td>
                      <td className="small">{j.client_name}<br /><span className="text-muted">{j.store_name} ({j.store_code})</span></td>
                      <td className="small">{j.job_type_name || "—"}</td>
                      <td className="small">{j.assigned_name || <span className="text-muted fst-italic">—</span>}</td>
                      <td><span className={`badge ${STATUS_BADGE[j.status] || "bg-secondary"}`}>{j.status}</span></td>
                      <td className="small">{j.latest_closed_visit_number ? `#${j.latest_closed_visit_number}` : "—"}</td>
                      <td className="small">{j.submitted_at ? formatIST(j.submitted_at) : "—"}</td>
                      <td className="text-end pe-3">
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => setReviewId(j.id)}>
                          <i className="bi bi-eye me-1"></i>Review
                        </button>
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
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={pagination.page <= 1} onClick={() => goPage(pagination.page - 1)}>‹ Prev</button>
            <span className="align-self-center text-muted small">Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => goPage(pagination.page + 1)}>Next ›</button>
          </div>
        )}
      </div>

      {reviewId && (
        <VerificationReview
          jobId={reviewId}
          canDecide={canDecide}
          onClose={() => setReviewId(null)}
          onDecided={handleDecided}
        />
      )}
    </div>
  );
};

function VerificationReview({ jobId, canDecide, onClose, onDecided }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null); // 'approve' | 'reject' | null
  const [remark, setRemark] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await VerificationService.getDetail(jobId);
      if (res.success) setDetail(res.data);
      else setError(res.message || "Could not load review.");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load review.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const openConfirm = (kind) => {
    setRemark("");
    setDecisionError("");
    setConfirm(kind);
  };

  const submitDecision = async (e) => {
    e.preventDefault();
    if (deciding) return;
    const trimmed = remark.trim();
    if (confirm === "reject" && trimmed === "") {
      setDecisionError("Rejection remark is required.");
      return;
    }
    if (trimmed.length > 255) {
      setDecisionError("Remark must be 255 characters or fewer.");
      return;
    }
    setDeciding(true);
    setDecisionError("");
    try {
      const payload = {};
      if (trimmed !== "") payload.remark = trimmed;
      if (detail?.review_visit) payload.visit_id = detail.review_visit.id;
      const res = confirm === "approve"
        ? await VerificationService.approve(jobId, payload)
        : await VerificationService.reject(jobId, { ...payload, remark: trimmed });
      if (res.success) {
        onDecided(res.message || (confirm === "approve" ? "Job approved." : "Job rejected."));
      } else {
        setDecisionError(res.message || "Decision failed.");
      }
    } catch (err) {
      setDecisionError(err.response?.data?.message || "Decision failed.");
    } finally {
      setDeciding(false);
    }
  };

  const ev = detail?.evidence || null;
  const photosByType = (ev?.photos || []).reduce((acc, p) => {
    (acc[p.photo_type] = acc[p.photo_type] || []).push(p);
    return acc;
  }, {});

  return (
    <div tabIndex="-1" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1050, background: "rgba(0,0,0,0.5)", overflowY: "auto", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 1020, width: "100%", margin: "0 auto", background: "#fff", borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.5rem", borderBottom: "1px solid #e9ecef" }}>
          <h5 style={{ margin: 0 }}>
            Review {detail?.job?.job_number || `#${jobId}`}{" "}
            {detail?.job && <span className={`badge ${STATUS_BADGE[detail.job.status] || "bg-secondary"} ms-1`}>{detail.job.status}</span>}
          </h5>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close review"></button>
        </div>

        <div style={{ padding: "1.5rem" }}>
          {loading && <div className="text-center py-4"><div className="spinner-border text-primary" role="status"></div></div>}
          {!loading && error && (
            <div className="text-center py-3">
              <div className="alert alert-danger">{error}</div>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={load}>Retry</button>
            </div>
          )}
          {!loading && !error && detail && (
            <>
              {!detail.review_visit && (
                <div className="alert alert-warning">
                  No closed visit is currently awaiting review for this job (it may have been decided already).
                </div>
              )}

              <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Job and Store</h6>
              <dl className="row mb-3 small">
                <dt className="col-4">Job</dt><dd className="col-8">{detail.job.job_number} · {detail.job.job_type_name || "—"} · {detail.job.priority}</dd>
                <dt className="col-4">Client</dt><dd className="col-8">{detail.job.client_name} ({detail.job.client_code})</dd>
                <dt className="col-4">Store</dt><dd className="col-8">{detail.job.store_name} ({detail.job.store_code})</dd>
                <dt className="col-4">Executive</dt><dd className="col-8">{(detail.assignments.find((a) => a.status === "ACTIVE") || {}).employee_name || "—"}</dd>
                <dt className="col-4">Description</dt><dd className="col-8">{detail.job.description || "—"}</dd>
              </dl>

              {ev && (
                <>
                  <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>
                    Visit #{ev.visit.visit_number} under review <span className={`badge ${STATUS_BADGE[ev.visit.status] || "bg-secondary"} ms-1`}>{ev.visit.status}</span>
                  </h6>
                  <dl className="row mb-3 small">
                    <dt className="col-4">Started</dt><dd className="col-8">{ev.visit.started_at ? formatIST(ev.visit.started_at) : "—"}</dd>
                    <dt className="col-4">Reached</dt><dd className="col-8">{ev.visit.reached_at ? formatIST(ev.visit.reached_at) : "—"}</dd>
                    <dt className="col-4">Closed</dt><dd className="col-8">{ev.visit.closed_at ? formatIST(ev.visit.closed_at) : "—"}</dd>
                    <dt className="col-4">Reach GPS</dt><dd className="col-8">{ev.visit.reach_latitude ? `${ev.visit.reach_latitude}, ${ev.visit.reach_longitude}` : "—"}</dd>
                    <dt className="col-4">GPS meta</dt><dd className="col-8">
                      {[
                        ev.visit.reach_accuracy !== null && ev.visit.reach_accuracy !== undefined ? `±${ev.visit.reach_accuracy} m` : null,
                        ev.visit.distance_meters !== null && ev.visit.distance_meters !== undefined ? `${ev.visit.distance_meters} m from store` : null
                      ].filter(Boolean).join(" · ") || "—"}
                    </dd>
                  </dl>

                  <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>
                    Measurements {ev.measurement_sheet ? `(FINAL v${ev.measurement_sheet.version_no})` : "(none finalized)"}
                    {ev.visit.status === "VISIT_CLOSED" && <span className="ms-2"><VisitReportButton visitId={ev.visit.id} /></span>}
                  </h6>
                  {ev.measurement_items.length === 0 ? (
                    <p className="small text-muted">No finalized measurement items for this visit.</p>
                  ) : (
                    <div className="table-responsive mb-3">
                      <table className="table table-sm table-bordered align-middle mb-0">
                        <thead className="table-light"><tr><th>#</th><th>Width</th><th>Height</th><th>Qty</th><th>Media</th><th>Remarks</th></tr></thead>
                        <tbody>
                          {ev.measurement_items.map((it) => (
                            <tr key={it.sequence_no}>
                              <td>{it.sequence_no}</td><td>{it.width_ft}</td><td>{it.height_ft}</td>
                              <td>{it.quantity}</td><td>{it.media_type || "—"}</td><td>{it.remarks || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Photos (this visit only)</h6>
                  {ev.photos.length === 0 ? (
                    <p className="small text-muted">No photos captured for this visit. Photos are optional evidence and do not block approval.</p>
                  ) : (
                    Object.entries(photosByType).map(([type, list]) => (
                      <div key={type} className="mb-2">
                        <div className="small fw-semibold mb-1">{PHOTO_LABEL[type] || type} ({list.length})</div>
                        <div className="d-flex flex-wrap gap-2">
                          {list.map((p) => (
                            <span key={p.id} title={`${PHOTO_LABEL[p.photo_type] || p.photo_type}${p.item_sequence_no ? ` · item #${p.item_sequence_no}` : ""} · ${p.captured_at ? formatIST(p.captured_at) : "—"}`}>
                              <BlobImg loader={() => JobPhotoService.viewObjectUrl(p.id)} alt={PHOTO_LABEL[p.photo_type] || "photo"} thumb />
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}

                  <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Shopkeeper Signature</h6>
                  {!ev.signature ? (
                    <p className="small text-muted">No signature found for this visit.</p>
                  ) : (
                    <div className="border rounded p-2 mb-3 bg-light" style={{ maxWidth: 420 }}>
                      <BlobImg loader={() => SignatureService.viewObjectUrl(ev.signature.id)} alt="Shopkeeper signature" />
                      <div className="small mt-2">
                        <strong>{ev.signature.signer_name}</strong>
                        {ev.signature.signer_mobile ? ` · ${ev.signature.signer_mobile}` : ""}
                        <div className="text-muted">
                          Signed {ev.signature.signed_at ? formatIST(ev.signature.signed_at) : "—"}
                          {ev.signature.remarks ? ` · ${ev.signature.remarks}` : ""}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Decision History</h6>
              {(detail.verifications || []).length === 0
                ? <p className="small text-muted">No verification decisions recorded yet.</p>
                : (detail.verifications || []).map((v) => (
                  <div key={v.id} className="small py-1 border-bottom">
                    <span className={`badge ${v.action === "APPROVE" ? "bg-success-subtle text-success-emphasis border" : "bg-danger-subtle text-danger-emphasis border"}`}>{v.action}</span>{" "}
                    <span className="text-muted">
                      visit #{v.visit_number ?? "?"} · by {v.verifier_name || "?"} · {v.verified_at ? formatIST(v.verified_at) : "—"}
                      {v.remark ? ` · “${v.remark}”` : ""}
                    </span>
                  </div>
                ))}

              <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>All Visits</h6>
              {(detail.visits || []).map((v) => (
                <div key={v.id} className="small py-1 border-bottom">
                  <strong>Visit #{v.visit_number}</strong>{" "}
                  <span className={`badge ${STATUS_BADGE[v.status] || "bg-secondary"} ms-1`}>{v.status}</span>
                  {detail.review_visit && v.id === detail.review_visit.id && (
                    <span className="badge bg-primary ms-2">under review</span>
                  )}
                  <div className="text-muted">
                    Started {v.started_at ? formatIST(v.started_at) : "—"}
                    {v.closed_at ? ` · Closed ${formatIST(v.closed_at)}` : ""}
                    {v.reach_latitude ? ` · GPS ${v.reach_latitude}, ${v.reach_longitude}` : ""}
                  </div>
                </div>
              ))}

              <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Status History</h6>
              {(detail.status_history || []).map((h) => (
                <div key={h.id} className="small py-1 border-bottom">
                  <code>{h.from_status || "—"} → {h.to_status}</code>{" "}
                  <span className="text-muted">by {h.changed_by_username || "?"} · {formatIST(h.created_at)}{h.remark ? ` · ${h.remark}` : ""}</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "1rem 1.5rem", borderTop: "1px solid #e9ecef" }}>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Close</button>
          {canDecide && detail?.review_visit && (
            <>
              <button type="button" className="btn btn-outline-danger" onClick={() => openConfirm("reject")} disabled={deciding}>
                <i className="bi bi-x-circle me-1"></i>Reject
              </button>
              <button type="button" className="btn btn-success" onClick={() => openConfirm("approve")} disabled={deciding}>
                <i className="bi bi-check-circle me-1"></i>Approve
              </button>
            </>
          )}
        </div>
      </div>

      {confirm && (
        <div tabIndex="-1" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1060, background: "rgba(0,0,0,0.5)", overflowY: "auto", padding: "2rem 1rem" }}>
          <div style={{ maxWidth: 520, width: "100%", margin: "0 auto", background: "#fff", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid #e9ecef" }}>
              <h5 style={{ margin: 0 }}>{confirm === "approve" ? "Approve job" : "Reject job"}</h5>
            </div>
            <form onSubmit={submitDecision}>
              <div style={{ padding: "1.5rem" }}>
                {confirm === "approve" ? (
                  <p className="mb-3">
                    Approve <strong>{detail?.job?.job_number}</strong> (visit #{detail?.review_visit?.visit_number})?
                    This moves the job to <code>APPROVED</code> and cannot be undone from here.
                  </p>
                ) : (
                  <p className="mb-3">
                    Reject visit #{detail?.review_visit?.visit_number} of <strong>{detail?.job?.job_number}</strong>?
                    All evidence is preserved and a new visit opens for rework with the same executive.
                  </p>
                )}
                <label className="form-label">
                  {confirm === "approve" ? "Remark (optional)" : <>Remark <span className="text-danger">*</span></>}
                </label>
                <textarea
                  className={`form-control ${decisionError ? "is-invalid" : ""}`}
                  rows={3}
                  maxLength={255}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder={confirm === "approve" ? "Optional approval note..." : "Why is this being sent back? (required)"}
                />
                <div className="d-flex justify-content-between">
                  <small className="text-muted">{remark.trim().length}/255</small>
                  {confirm === "reject" && <small className="text-muted">Required — shown to the executive and client.</small>}
                </div>
                {decisionError && <div className="invalid-feedback d-block">{decisionError}</div>}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "1rem 1.5rem", borderTop: "1px solid #e9ecef" }}>
                <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirm(null)} disabled={deciding}>Cancel</button>
                <button type="submit" className={`btn ${confirm === "approve" ? "btn-success" : "btn-danger"}`} disabled={deciding}>
                  {deciding ? "Saving..." : confirm === "approve" ? "Confirm approval" : "Confirm rejection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Verification;
