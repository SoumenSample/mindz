/**
 * JobRequests  — request queue only, no operational Jobs.
 * Admin mode: all requests + client/store/type/status filters +
 * accept/reject on PENDING. Client mode (My Job Requests): own stores
 * selector, create/edit/cancel own PENDING requests. Ownership is
 * backend-enforced; the UI only shapes what is offered.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import JobRequestService from "../services/JobRequestService";
import { formatIST } from "../utils/datetime";
import JobService from "../services/JobService";
import StoreService from "../services/StoreService";
import ClientService from "../services/ClientService";

const STATUS_BADGE = {
  PENDING: "bg-warning-subtle text-warning-emphasis",
  ACCEPTED: "bg-info-subtle text-info-emphasis",
  REJECTED: "bg-danger-subtle text-danger-emphasis",
  CANCELLED: "bg-secondary-subtle text-secondary-emphasis",
  CONVERTED: "bg-success-subtle text-success-emphasis"
};

const emptyForm = { store_id: "", job_type_id: "", description: "", preferred_date: "", remarks: "" };

const JobRequests = ({ clientMode = false }) => {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const viewPerm = clientMode ? "requests.view.own" : "requests.view.all";
  const canView = hasPermission(viewPerm);
  const canCreate = hasPermission("requests.create");
  const canEdit = hasPermission("requests.update.own");
  const canCancel = hasPermission("requests.cancel.own");
  const canReview = hasPermission("requests.review");

  const [requests, setRequests] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({ search: "", client_id: "", store_id: "", job_type_id: "", status: "" });
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [alert, setAlert] = useState({ show: false, type: "", message: "" });

  const [clients, setClients] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [formStores, setFormStores] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [detail, setDetail] = useState(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const canConvert = !clientMode && hasPermission("jobs.create");

  const showAlert = (type, message) => {
    setAlert({ show: true, type, message });
    setTimeout(() => setAlert({ show: false, type: "", message: "" }), 5000);
  };

  const loadRequests = useCallback(
    async (page = 1, overrideFilters = null) => {
      const f = overrideFilters || filters;
      setIsLoading(true);
      try {
        const res = await JobRequestService.getRequests({ ...f, page, limit: 20 });
        if (res.success) {
          setRequests(res.data);
          setPagination(res.pagination);
        } else {
          showAlert("danger", res.message || "Failed to load requests.");
        }
      } catch (error) {
        showAlert("danger", error.response?.data?.message || "Unable to load requests.");
      } finally {
        setIsLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    if (canView) {
      loadRequests(1);
      JobRequestService.getJobTypes()
        .then((res) => { if (res.success) setJobTypes(res.data); })
        .catch(() => setJobTypes([]));
      if (!clientMode) {
        ClientService.getClients({ status: "Active", page: 1, limit: 100 })
          .then((res) => { if (res.success) setClients(res.data); })
          .catch(() => setClients([]));
      } else {
        StoreService.getStores({ status: "ACTIVE", page: 1, limit: 100 })
          .then((res) => { if (res.success) setFormStores(res.data); })
          .catch(() => setFormStores([]));
      }
    }
  }, [canView, clientMode, loadRequests]);

  const loadStoresForClient = async (clientId) => {
    if (!clientId) {
      setFormStores([]);
      return;
    }
    try {
      const res = await StoreService.getStores({ client_id: clientId, status: "ACTIVE", page: 1, limit: 100 });
      if (res.success) setFormStores(res.data);
    } catch {
      setFormStores([]);
    }
  };

  const applyFilters = (e) => {
    e.preventDefault();
    loadRequests(1, { ...filters, search: searchInput });
    setFilters((prev) => ({ ...prev, search: searchInput }));
  };

  const clearFilters = () => {
    const cleared = { search: "", client_id: "", store_id: "", job_type_id: "", status: "" };
    setFilters(cleared);
    setSearchInput("");
    loadRequests(1, cleared);
  };

  const openCreate = () => {
    setEditing(null);
    setFormData({ ...emptyForm, adminClient: "" });
    setFormErrors({});
    setFormStores(clientMode ? formStores : []);
    setShowForm(true);
  };

  const openEdit = async (req) => {
    // Load this request's client stores so the current store is selectable.
    if (!clientMode && req.client_id) {
      await loadStoresForClient(req.client_id);
    }
    setEditing(req);
    setFormData({
      store_id: req.store_id || "",
      job_type_id: req.job_type_id || "",
      description: req.description || "",
      preferred_date: req.preferred_date || "",
      remarks: req.remarks || ""
    });
    setFormErrors({});
    setShowForm(true);
  };

  const validateForm = () => {
    const errs = {};
    if (!formData.store_id) errs.store_id = "Store is required.";
    if (!formData.job_type_id) errs.job_type_id = "Job type is required.";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const payload = {
        store_id: Number(formData.store_id),
        job_type_id: Number(formData.job_type_id),
        description: formData.description.trim() === "" ? null : formData.description.trim(),
        preferred_date: formData.preferred_date === "" ? null : formData.preferred_date,
        remarks: formData.remarks.trim() === "" ? null : formData.remarks.trim()
      };
      // Admin create selects the owning client explicitly (server verifies
      // store parity). Client self-service omits it: forced server-side.
      if (!clientMode && !editing && formData.adminClient) {
        payload.client_id = Number(formData.adminClient);
      }
      if (editing) {
        const res = await JobRequestService.updateRequest(editing.id, payload);
        showAlert("success", res.message || "Request updated.");
      } else {
        const res = await JobRequestService.createRequest(payload);
        showAlert("success", res.message || "Request submitted.");
      }
      setShowForm(false);
      loadRequests(pagination.page);
      if (detail && editing && detail.id === editing.id) {
        const refreshed = await JobRequestService.getRequestById(editing.id);
        if (refreshed.success) setDetail(refreshed.data);
      }
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Save failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDetail = async (req) => {
    try {
      const res = await JobRequestService.getRequestById(req.id);
      if (res.success) setDetail(res.data);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Could not load details.");
    }
  };

  const handleAccept = async (req) => {
    if (!window.confirm(`Accept request ${req.request_number}? It will queue for operational processing (no employee assigned here).`)) return;
    setIsReviewing(true);
    try {
      const res = await JobRequestService.acceptRequest(req.id);
      showAlert("success", res.message || "Accepted.");
      setDetail(res.data || null);
      loadRequests(pagination.page);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Accept failed.");
    } finally {
      setIsReviewing(false);
    }
  };

  const handleReject = async (e) => {
    e.preventDefault();
    if (!rejectReason.trim()) {
      showAlert("danger", "Rejection reason is required.");
      return;
    }
    setIsReviewing(true);
    try {
      const res = await JobRequestService.rejectRequest(detail.id, rejectReason.trim());
      showAlert("success", res.message || "Rejected.");
      setShowReject(false);
      setRejectReason("");
      setDetail(res.data || null);
      loadRequests(pagination.page);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Reject failed.");
    } finally {
      setIsReviewing(false);
    }
  };

  const handleCancel = async (req) => {    if (!window.confirm(`Cancel request ${req.request_number}? Cancelled requests stay in history.`)) return;
    try {
      const res = await JobRequestService.cancelRequest(req.id);
      showAlert("success", res.message || "Cancelled.");
      setDetail(null);
      loadRequests(pagination.page);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Cancel failed.");
    }
  };

  // integration: convert an ACCEPTED, unconverted request.
  // Duplicate conversion is blocked server-side (409); converted rows
  // show View Job instead.
  const handleConvert = async (req) => {
    if (!window.confirm(`Create operational job from request ${req.request_number}?`)) return;
    setIsConverting(true);
    try {
      const res = await JobService.convertRequest(req.id);
      showAlert("success", `${res.message || "Converted."} (${res.data?.job_number})`);
      const refreshed = await JobRequestService.getRequestById(req.id);
      if (refreshed.success) setDetail(refreshed.data);
      loadRequests(pagination.page);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Conversion failed.");
    } finally {
      setIsConverting(false);
    }
  };

  const goPage = (page) => {
    if (page >= 1 && page <= Math.max(pagination.totalPages, 1)) loadRequests(page);
  };

  const handleAdminClient = (e) => {
    const value = e.target.value;
    setFormData((prev) => ({ ...prev, adminClient: value, store_id: "" }));
    loadStoresForClient(value);
  };

  if (!canView) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">
          <i className="bi bi-shield-lock me-2"></i>
          Access denied. This page requires permission <strong>{clientMode ? "requests.view.own" : "requests.view.all"}</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>{clientMode ? "My Job Requests" : "Job Requests"}</h4>
          <p>{clientMode
            ? `Requests for your stores — ${pagination.total} record(s). New requests start PENDING.`
            : `Client work queue — ${pagination.total} record(s). Accept queues for processing; reject needs a reason.`}</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => openCreate()}>
            <i className="bi bi-plus-lg me-2"></i>{clientMode ? "New Request" : "New Request"}
          </button>
        )}
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
                <label className="form-label">Search</label>
                <input type="text" className="form-control" placeholder="Request/store/client/type..."
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
              </div>
              {!clientMode && (
                <div className="col-md-2">
                  <label className="form-label">Client</label>
                  <select className="form-select" value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}>
                    <option value="">All</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.client_name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="col-md-2">
                <label className="form-label">Job Type</label>
                <select className="form-select" value={filters.job_type_id} onChange={(e) => setFilters({ ...filters, job_type_id: e.target.value })}>
                  <option value="">All</option>
                  {jobTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Status</label>
                <select className="form-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="PENDING">Pending</option>
                  <option value="ACCEPTED">Accepted</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
              <div className="col-md-2 d-flex gap-2">
                <button type="submit" className="btn btn-primary"><i className="bi bi-search"></i></button>
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
                  <th className="ps-3">Request</th>
                  {!clientMode && <th>Client</th>}
                  <th>Store</th>
                  <th>Job Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-end pe-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={clientMode ? 6 : 7} className="text-center py-4"><div className="spinner-border text-primary" role="status"></div></td></tr>
                ) : requests.length === 0 ? (
                  <tr><td colSpan={clientMode ? 6 : 7} className="text-center py-4 text-muted">No requests found.</td></tr>
                ) : (
                  requests.map((req) => (
                    <tr key={req.id}>
                      <td className="ps-3"><span className="badge bg-light text-dark border font-monospace">{req.request_number}</span></td>
                      {!clientMode && <td>{req.client_name} <small className="text-muted">({req.client_code})</small></td>}
                      <td>{req.store_name} <small className="text-muted">({req.store_code})</small></td>
                      <td>{req.job_type_name || <span className="text-muted fst-italic">—</span>}</td>
                      <td><span className={`badge ${STATUS_BADGE[req.status] || "bg-secondary"} border`}>{req.status}</span></td>
                      <td><small className="text-muted">{req.created_at ? formatIST(req.created_at) : "—"}</small></td>
                      <td className="text-end pe-3">
                        <div className="btn-group btn-group-sm">
                          <button className="btn btn-outline-secondary" onClick={() => openDetail(req)} title="View">
                            <i className="bi bi-eye"></i>
                          </button>
                          {canReview && req.status === "PENDING" && (
                            <>
                              <button className="btn btn-outline-success" onClick={() => handleAccept(req)} title="Accept">
                                <i className="bi bi-check-lg"></i>
                              </button>
                              <button className="btn btn-outline-danger" onClick={() => { openDetail(req); setShowReject(true); }} title="Reject">
                                <i className="bi bi-x-lg"></i>
                              </button>
                            </>
                          )}
                          {clientMode && req.status === "PENDING" && (
                            <>
                              {canEdit && (
                                <button className="btn btn-outline-primary" onClick={() => openEdit(req)} title="Edit">
                                  <i className="bi bi-pencil"></i>
                                </button>
                              )}
                              {canCancel && (
                                <button className="btn btn-outline-warning" onClick={() => handleCancel(req)} title="Cancel">
                                  <i className="bi bi-slash-circle"></i>
                                </button>
                              )}
                            </>
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

      {showForm && (
        <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{editing ? "Edit Request (PENDING only)" : "New Job Request"}</h5>
                <button type="button" className="btn-close" onClick={() => setShowForm(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body">
                  {!clientMode && !editing && (
                    <div className="mb-3">
                      <label className="form-label">Client <span className="text-danger">*</span></label>
                      <select className="form-select" value={formData.adminClient || ""} onChange={handleAdminClient}>
                        <option value="">— Select client —</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>{c.client_name} ({c.client_code})</option>
                        ))}
                      </select>
                      <small className="text-muted">Store list follows the chosen client (ownership verified server-side).</small>
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label">Store <span className="text-danger">*</span></label>
                    {clientMode || editing ? (
                      <select className={`form-select ${formErrors.store_id ? "is-invalid" : ""}`}
                        value={formData.store_id} onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}>
                        <option value="">— Select store —</option>
                        {formStores.map((s) => (
                          <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                        ))}
                      </select>
                    ) : (
                      <select className={`form-select ${formErrors.store_id ? "is-invalid" : ""}`}
                        value={formData.store_id} onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}>
                        <option value="">— Select a client first —</option>
                        {formStores.map((s) => (
                          <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                        ))}
                      </select>
                    )}
                    {formErrors.store_id && <div className="invalid-feedback">{formErrors.store_id}</div>}
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Job Type <span className="text-danger">*</span></label>
                    <select className={`form-select ${formErrors.job_type_id ? "is-invalid" : ""}`}
                      value={formData.job_type_id} onChange={(e) => setFormData({ ...formData, job_type_id: e.target.value })}>
                      <option value="">— Select job type —</option>
                      {jobTypes.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {formErrors.job_type_id && <div className="invalid-feedback">{formErrors.job_type_id}</div>}
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Description</label>
                    <textarea className="form-control" rows="3" value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="What work is needed at this store?" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">Preferred Date</label>
                      <input type="date" className="form-control" value={formData.preferred_date}
                        onChange={(e) => setFormData({ ...formData, preferred_date: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Remarks</label>
                      <input type="text" className="form-control" value={formData.remarks}
                        onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : editing ? "Update" : "Submit Request"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{detail.request_number} — <span className={`badge ${STATUS_BADGE[detail.status]}`}>{detail.status}</span></h5>
                <button type="button" className="btn-close" onClick={() => { setDetail(null); setShowReject(false); }}></button>
              </div>
              <div className="modal-body">
                <div className="row">
                  <div className="col-md-6">
                    <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Client & Store</h6>
                    <dl className="row mb-0 small">
                      <dt className="col-4">Client</dt><dd className="col-8">{detail.client_name} ({detail.client_code})</dd>
                      <dt className="col-4">Store</dt><dd className="col-8">{detail.store_name} ({detail.store_code})</dd>
                      <dt className="col-4">City</dt><dd className="col-8">{detail.store_city || "—"}</dd>
                    </dl>
                  </div>
                  <div className="col-md-6">
                    <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Request</h6>
                    <dl className="row mb-0 small">
                      <dt className="col-4">Job Type</dt><dd className="col-8">{detail.job_type_name || "—"}</dd>
                      <dt className="col-4">By</dt><dd className="col-8">{detail.requested_by_name || detail.requested_by_username || "—"}</dd>
                      <dt className="col-4">Created</dt><dd className="col-8">{detail.created_at ? formatIST(detail.created_at) : "—"}</dd>
                      <dt className="col-4">Preferred</dt><dd className="col-8">{detail.preferred_date || "—"}</dd>
                    </dl>
                  </div>
                </div>
                <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Description</h6>
                <p className="small">{detail.description || <span className="text-muted">—</span>}</p>
                {detail.remarks && <p className="small text-muted">Remarks: {detail.remarks}</p>}
                <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Review</h6>
                <dl className="row mb-0 small">
                  <dt className="col-4">Reviewed By</dt><dd className="col-8">{detail.reviewer_name || detail.reviewer_username || "—"}</dd>
                  <dt className="col-4">Reviewed At</dt><dd className="col-8">{detail.reviewed_at ? formatIST(detail.reviewed_at) : "—"}</dd>
                  <dt className="col-4">Reason/Remark</dt><dd className="col-8">{detail.admin_remark || "—"}</dd>
                </dl>

                {showReject && (
                  <form onSubmit={handleReject} className="border rounded p-3 bg-light mt-3">
                    <label className="form-label">Rejection Reason <span className="text-danger">*</span></label>
                    <textarea className="form-control" rows="2" value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)} placeholder="Required — sent to the client." />
                    <div className="d-flex gap-2 mt-2">
                      <button type="submit" className="btn btn-sm btn-danger" disabled={isReviewing}>
                        {isReviewing ? "Rejecting..." : "Confirm Reject"}
                      </button>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowReject(false)}>Cancel</button>
                    </div>
                  </form>
                )}
              </div>
              <div className="modal-footer">
                {canReview && detail.status === "PENDING" && !showReject && (
                  <>
                    <button className="btn btn-success" disabled={isReviewing} onClick={() => handleAccept(detail)}>Accept</button>
                    <button className="btn btn-outline-danger" onClick={() => setShowReject(true)}>Reject</button>
                  </>
                )}
                {canConvert && detail.status === "ACCEPTED" && !detail.converted_job_id && (
                  <button className="btn btn-primary" disabled={isConverting} onClick={() => handleConvert(detail)}>
                    {isConverting ? "Converting..." : "Convert to Job"}
                  </button>
                )}
                {canConvert && detail.status === "ACCEPTED" && detail.converted_job_id && (
                  <button className="btn btn-outline-primary" onClick={() => { setDetail(null); navigate(`/jobs/${detail.converted_job_id}`); }}>
                    View Job
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => { setDetail(null); setShowReject(false); }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobRequests;
