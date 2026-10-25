/**
 * Jobs  — operational jobs + assignment, nothing further.
 * Admin mode (/jobs, /jobs/all, /jobs/assignments): global queue with
 * create/edit/assign/reassign/cancel on pre-field-work jobs.
 * My mode (/jobs/mine): permission-scoped list (assigned-to-me for
 * field staff, own-client for clients) with read-only detail.
 * Later-module actions (reach/measure/photos/verify) are absent here.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import JobService from "../services/JobService";
import { formatIST } from "../utils/datetime";
import FieldWorkflow from "./FieldWorkflow";
import MeasurementSection from "./MeasurementSection";
import SignatureSection from "./SignatureSection";
import JobPhotosSection from "./JobPhotosSection";
import VisitReportButton from "./VisitReportButton";
import StoreService from "../services/StoreService";
import ClientService from "../services/ClientService";
import JobRequestService from "../services/JobRequestService";

const STATUS_BADGE = {
  PENDING: "bg-secondary-subtle text-secondary-emphasis",
  ASSIGNED: "bg-info-subtle text-info-emphasis",
  CANCELLED: "bg-danger-subtle text-danger-emphasis"
};

const PRE_FIELD = ["PENDING", "ASSIGNED"];

// Module 13: jobs in these states are eligible for Admin review. The Jobs
// detail views never approve/reject themselves — they link to the
// Verification review screen, which owns the decision UI.
const REVIEWABLE = ["VISIT_CLOSED", "SUBMITTED", "UNDER_VERIFICATION"];

const Jobs = ({ mode = "admin", statusFilter = "" }) => {
  const mine = mode === "mine";
  const { hasPermission } = useAuth();
  // Mine views are reachable by anyone holding either job view grant
  // (admins keep full visibility; scoped users see their own slice).
  const canView = mine
    ? (hasPermission("jobs.view.all") || hasPermission("jobs.view.own"))
    : hasPermission("jobs.view.all");
  const canCreate = !mine && hasPermission("jobs.create");
  const canUpdate = !mine && hasPermission("jobs.update");
  const canAssign = !mine && hasPermission("jobs.assign");
  const canReassign = !mine && hasPermission("jobs.reassign");
  const canCancel = !mine && hasPermission("jobs.cancel");

  const [jobs, setJobs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({ search: "", status: statusFilter || "", client_id: "", store_id: "", job_type_id: "", employee_id: "" });
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [alert, setAlert] = useState({ show: false, type: "", message: "" });

  const [clients, setClients] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [formStores, setFormStores] = useState([]);
  const [executives, setExecutives] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({ client_id: "", store_id: "", job_type_id: "", description: "", scheduled_date: "", priority: "NORMAL", employee_id: "" });
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [detail, setDetail] = useState(null);

  const [assignTarget, setAssignTarget] = useState(null);
  const [assignEmployee, setAssignEmployee] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);

  const showAlert = (type, message) => {
    setAlert({ show: true, type, message });
    setTimeout(() => setAlert({ show: false, type: "", message: "" }), 5000);
  };

  const loadJobs = useCallback(
    async (page = 1, overrideFilters = null) => {
      const f = overrideFilters || filters;
      setIsLoading(true);
      try {
        const res = await JobService.getJobs({ ...f, page, limit: 20 });
        if (res.success) {
          setJobs(res.data);
          setPagination(res.pagination);
        } else {
          showAlert("danger", res.message || "Failed to load jobs.");
        }
      } catch (error) {
        showAlert("danger", error.response?.data?.message || "Unable to load jobs.");
      } finally {
        setIsLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    if (canView) {
      loadJobs(1);
      JobRequestService.getJobTypes().then((res) => { if (res.success) setJobTypes(res.data); }).catch(() => {});
      if (!mine) {
        ClientService.getClients({ status: "Active", page: 1, limit: 100 })
          .then((res) => { if (res.success) setClients(res.data); }).catch(() => {});
        JobService.getFieldExecutives()
          .then((res) => { if (res.success) setExecutives(res.data); }).catch(() => {});
      }
    }
  }, [canView, mine, loadJobs]);

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
    loadJobs(1, { ...filters, search: searchInput });
    setFilters((prev) => ({ ...prev, search: searchInput }));
  };

  const clearFilters = () => {
    const cleared = { search: "", status: "", client_id: "", store_id: "", job_type_id: "", employee_id: "" };
    setFilters(cleared);
    setSearchInput("");
    loadJobs(1, cleared);
  };

  const openCreate = () => {
    setEditing(null);
    setFormData({ client_id: "", store_id: "", job_type_id: "", description: "", scheduled_date: "", priority: "NORMAL", employee_id: "" });
    setFormErrors({});
    setFormStores([]);
    setShowForm(true);
  };

  const openEdit = (job) => {
    setEditing(job);
    setFormData({
      client_id: job.client_id || "",
      store_id: job.store_id || "",
      job_type_id: job.job_type_id || "",
      description: job.description || "",
      scheduled_date: job.scheduled_date || "",
      priority: job.priority || "NORMAL",
      employee_id: ""
    });
    setFormErrors({});
    loadStoresForClient(job.client_id);
    setShowForm(true);
  };

  const validateForm = () => {
    const errs = {};
    if (!editing && !formData.client_id) errs.client_id = "Client is required.";
    if (!formData.store_id) errs.store_id = "Store is required.";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const payload = {
        client_id: Number(formData.client_id),
        store_id: Number(formData.store_id),
        description: formData.description.trim() === "" ? null : formData.description.trim(),
        scheduled_date: formData.scheduled_date === "" ? null : formData.scheduled_date,
        priority: formData.priority || "NORMAL"
      };
      if (formData.job_type_id) payload.job_type_id = Number(formData.job_type_id);
      if (!editing && formData.employee_id) payload.employee_id = Number(formData.employee_id);
      if (editing) {
        const res = await JobService.updateJob(editing.id, payload);
        showAlert("success", res.message || "Job updated.");
      } else {
        const res = await JobService.createJob(payload);
        showAlert("success", `${res.message || "Job created."} (${res.data?.job_number})`);
      }
      setShowForm(false);
      loadJobs(pagination.page);
      if (detail && editing && detail.id === editing.id) {
        const refreshed = await JobService.getJobById(editing.id);
        if (refreshed.success) setDetail(refreshed.data);
      }
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Save failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDetail = async (job) => {
    try {
      const res = await JobService.getJobById(job.id);
      if (res.success) setDetail(res.data);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Could not load details.");
    }
  };

  const submitAssign = async (e, isReassign) => {
    e.preventDefault();
    if (!assignEmployee) {
      showAlert("danger", "Choose a field executive.");
      return;
    }
    setIsAssigning(true);
    try {
      const fn = isReassign ? JobService.reassignJob : JobService.assignJob;
      const res = await fn(assignTarget.id, { employee_id: Number(assignEmployee), reason: assignReason.trim() === "" ? null : assignReason.trim() });
      showAlert("success", res.message || "Saved.");
      setAssignTarget(null);
      setAssignEmployee("");
      setAssignReason("");
      loadJobs(pagination.page);
      const refreshed = await JobService.getJobById(assignTarget.id);
      if (refreshed.success) setDetail(refreshed.data);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Assignment failed.");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleCancel = async (job) => {
    const reason = window.prompt(`Cancel job ${job.job_number}? Optional reason:`, "") ?? null;
    if (reason === null && !window.confirm(`Cancel job ${job.job_number}?`)) return;
    try {
      const res = await JobService.cancelJob(job.id, reason ? { reason } : {});
      showAlert("success", res.message || "Cancelled.");
      setDetail(null);
      loadJobs(pagination.page);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Cancel failed.");
    }
  };

  const goPage = (page) => {
    if (page >= 1 && page <= Math.max(pagination.totalPages, 1)) loadJobs(page);
  };

  const colSpan = mine ? 7 : 9;

  if (!canView) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">
          <i className="bi bi-shield-lock me-2"></i>
          Access denied. This page requires permission <strong>{mine ? "jobs.view.all or jobs.view.own" : "jobs.view.all"}</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>{mine ? "My Jobs" : "Jobs"}</h4>
          <p>{mine
            ? `Jobs in your scope — ${pagination.total} record(s). Viewing only in this module.`
            : `Operational jobs — ${pagination.total} record(s). Assign before field work starts.`}</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={openCreate}>
            <i className="bi bi-plus-lg me-2"></i>New Job
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
                <input type="text" className="form-control" placeholder="Job #, shop, store, client..."
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
              </div>
              <div className="col-md-2">
                <label className="form-label">Status</label>
                <select className="form-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="PENDING">Pending</option>
                  <option value="ASSIGNED">Assigned</option>
                  <option value="EN_ROUTE,REACHED,WORK_STARTED,WORK_IN_PROGRESS,IN_PROGRESS,SIGNATURE_PENDING">In Progress</option>
                  <option value="VISIT_CLOSED,SUBMITTED,UNDER_VERIFICATION">Submitted</option>
                  <option value="COMPLETED,APPROVED">Completed</option>
                  <option value="REJECTED,RESUBMISSION_REQUIRED">Rework</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
              {!mine && (
                <>
                  <div className="col-md-2">
                    <label className="form-label">Client</label>
                    <select className="form-select" value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}>
                      <option value="">All</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>{c.client_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label">Job Type</label>
                    <select className="form-select" value={filters.job_type_id} onChange={(e) => setFilters({ ...filters, job_type_id: e.target.value })}>
                      <option value="">All</option>
                      {jobTypes.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
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
                  <th className="ps-3">Job #</th>
                  <th>Client</th>
                  <th>Store</th>
                  <th>Job Type</th>
                  {!mine && <th>Assigned</th>}
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-end pe-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={colSpan} className="text-center py-4"><div className="spinner-border text-primary" role="status"></div></td></tr>
                ) : jobs.length === 0 ? (
                  <tr><td colSpan={colSpan} className="text-center py-4 text-muted">No jobs found.</td></tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id}>
                      <td className="ps-3"><span className="badge bg-light text-dark border font-monospace">{job.job_number}</span></td>
                      <td>{job.client_name}</td>
                      <td>{job.store_name} <small className="text-muted">({job.store_code})</small></td>
                      <td>{job.job_type_name || <span className="text-muted fst-italic">—</span>}</td>
                      {!mine && <td>{job.assigned_name || <span className="text-muted fst-italic">Unassigned</span>}</td>}
                      <td><span className={`badge ${(STATUS_BADGE[job.status] || "bg-secondary")} border`}>{job.status}</span></td>
                      <td><small className="text-muted">{job.created_at ? formatIST(job.created_at) : "—"}</small></td>
                      <td className="text-end pe-3">
                        <div className="btn-group btn-group-sm">
                          <button className="btn btn-outline-secondary" onClick={() => openDetail(job)} title="View">
                            <i className="bi bi-eye"></i>
                          </button>
                          {!mine && canUpdate && PRE_FIELD.includes(job.status) && (
                            <button className="btn btn-outline-primary" onClick={() => openEdit(job)} title="Edit">
                              <i className="bi bi-pencil"></i>
                            </button>
                          )}
                          {!mine && canAssign && job.status === "PENDING" && (
                            <button className="btn btn-outline-success" onClick={() => { setAssignTarget({ ...job, isReassign: false }); setAssignEmployee(""); setAssignReason(""); }} title="Assign">
                              <i className="bi bi-person-check"></i>
                            </button>
                          )}
                          {!mine && canReassign && PRE_FIELD.includes(job.status) && job.status !== "PENDING" && (
                            <button className="btn btn-outline-warning" onClick={() => { setAssignTarget({ ...job, isReassign: true }); setAssignEmployee(""); setAssignReason(""); }} title="Reassign">
                              <i className="bi bi-arrow-repeat"></i>
                            </button>
                          )}
                          {!mine && canCancel && PRE_FIELD.includes(job.status) && (
                            <button className="btn btn-outline-danger" onClick={() => handleCancel(job)} title="Cancel">
                              <i className="bi bi-x-circle"></i>
                            </button>
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
                <h5 className="modal-title">{editing ? "Edit Job (pre-field-work only)" : "New Operational Job"}</h5>
                <button type="button" className="btn-close" onClick={() => setShowForm(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body">
                  {!editing && (
                    <div className="mb-3">
                      <label className="form-label">Client <span className="text-danger">*</span></label>
                      <select className={`form-select ${formErrors.client_id ? "is-invalid" : ""}`}
                        value={formData.client_id} onChange={(e) => { setFormData({ ...formData, client_id: e.target.value, store_id: "" }); loadStoresForClient(e.target.value); }}>
                        <option value="">— Select client —</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>{c.client_name} ({c.client_code})</option>
                        ))}
                      </select>
                      {formErrors.client_id && <div className="invalid-feedback">{formErrors.client_id}</div>}
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label">Store <span className="text-danger">*</span></label>
                    <select className={`form-select ${formErrors.store_id ? "is-invalid" : ""}`}
                      value={formData.store_id} onChange={(e) => setFormData({ ...formData, store_id: e.target.value })}>
                      <option value="">— Select store —</option>
                      {formStores.map((s) => (
                        <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                      ))}
                    </select>
                    {formErrors.store_id && <div className="invalid-feedback">{formErrors.store_id}</div>}
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">Job Type</label>
                      <select className="form-select" value={formData.job_type_id} onChange={(e) => setFormData({ ...formData, job_type_id: e.target.value })}>
                        <option value="">— Select type —</option>
                        {jobTypes.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Priority</label>
                      <select className="form-select" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value })}>
                        <option value="LOW">Low</option>
                        <option value="NORMAL">Normal</option>
                        <option value="HIGH">High</option>
                        <option value="URGENT">Urgent</option>
                      </select>
                    </div>
                  </div>
                  <div className="mb-3 mt-3">
                    <label className="form-label">Description</label>
                    <textarea className="form-control" rows="2" value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">Scheduled Date</label>
                      <input type="date" className="form-control" value={formData.scheduled_date}
                        onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })} />
                    </div>
                    {!editing && canAssign && (
                      <div className="col-md-6">
                        <label className="form-label">Assign Field Executive (optional)</label>
                        <select className="form-select" value={formData.employee_id} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}>
                          <option value="">— Leave unassigned —</option>
                          {executives.map((x) => (
                            <option key={x.id} value={x.id}>{x.employee_name} ({x.employee_code})</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : editing ? "Update" : "Create Job"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <JobDetailModal
          detail={detail} mine={mine}
          canAssign={canAssign} canReassign={canReassign} canCancel={canCancel} canUpdate={canUpdate}
          onClose={() => setDetail(null)}
          onEdit={(job) => { setDetail(null); openEdit(job); }}
          onAssign={(job, isReassign) => { setAssignTarget({ ...job, isReassign }); setAssignEmployee(""); setAssignReason(""); }}
          onCancel={handleCancel}
          onRefresh={() => openDetail(detail)}
        />
      )}

      {assignTarget && (
        <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{assignTarget.isReassign ? "Reassign" : "Assign"} {assignTarget.job_number}</h5>
                <button type="button" className="btn-close" onClick={() => setAssignTarget(null)}></button>
              </div>
              <form onSubmit={(e) => submitAssign(e, assignTarget.isReassign)}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">Field Executive <span className="text-danger">*</span></label>
                    <select className="form-select" value={assignEmployee} onChange={(e) => setAssignEmployee(e.target.value)}>
                      <option value="">— Select executive —</option>
                      {executives.length === 0 && <option value="" disabled>Loading eligible executives...</option>}
                      {executives.map((x) => (
                        <option key={x.id} value={x.id}>{x.employee_name} ({x.employee_code})</option>
                      ))}
                    </select>
                    <small className="text-muted">Only active Field Executives with active EMPLOYEE logins are listed.</small>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">{assignTarget.isReassign ? "Reason" : "Remarks"} (optional)</label>
                    <input type="text" className="form-control" value={assignReason}
                      onChange={(e) => setAssignReason(e.target.value)} placeholder={assignTarget.isReassign ? "e.g. workload redistribution" : ""} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setAssignTarget(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={isAssigning}>
                    {isAssigning ? "Saving..." : assignTarget.isReassign ? "Reassign" : "Assign"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function JobDetailModal({ detail, mine, canAssign, canReassign, canUpdate, canCancel, onClose, onEdit, onAssign, onCancel, onRefresh }) {
  const { hasPermission } = useAuth();
  const preField = PRE_FIELD.includes(detail.status);
  const reviewable = hasPermission("jobs.verify") && REVIEWABLE.includes(detail.status);
  const [infoExpanded, setInfoExpanded] = useState(true);
  const [assignExpanded, setAssignExpanded] = useState(true);
  return (
    <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{detail.job_number} — <span className={`badge ${STATUS_BADGE[detail.status] || "bg-secondary"}`}>{detail.status}</span></h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <FieldWorkflow job={detail} onChanged={onRefresh} />
            <div className="border rounded p-3 mb-3 bg-light">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <h6 className="text-muted text-uppercase mb-0" style={{ fontSize: 12 }}>Job Information</h6>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary ms-auto"
                    aria-expanded={infoExpanded}
                    aria-label={infoExpanded ? "Collapse job information" : "Expand job information"}
                    onClick={() => setInfoExpanded((v) => !v)}
                  >
                    <i className={`bi ${infoExpanded ? "bi-chevron-up" : "bi-chevron-down"}`}></i>
                  </button>
                </div>
                {!infoExpanded && (
                  <p className="small text-muted">{detail.job_type_name || "—"} · {detail.priority} · {detail.scheduled_date || "Unscheduled"}</p>
                )}
                {infoExpanded && (
                  <>
                    <dl className="row mb-0 small">
                      <dt className="col-4">Client</dt><dd className="col-8">{detail.client_name} ({detail.client_code})</dd>
                      <dt className="col-4">Store</dt><dd className="col-8">{detail.store_name || detail.shop_name || "—"}{detail.store_code ? ` (${detail.store_code})` : ""}</dd>
                      <dt className="col-4">Shopkeeper</dt><dd className="col-8">{detail.shopkeeper_name || "—"}</dd>
                      <dt className="col-4">Phone</dt><dd className="col-8">{detail.shopkeeper_mobile ? (<a href={`tel:${detail.shopkeeper_mobile}`}>{detail.shopkeeper_mobile}</a>) : "—"}</dd>
                      <dt className="col-4">Address</dt><dd className="col-8">{[detail.address, detail.city, detail.state, detail.pincode].filter(Boolean).join(", ") || "—"}</dd>
                      <dt className="col-4">Type</dt><dd className="col-8">{detail.job_type_name || "—"}</dd>
                      <dt className="col-4">Priority</dt><dd className="col-8">{detail.priority}</dd>
                      <dt className="col-4">Scheduled</dt><dd className="col-8">{detail.scheduled_date || "—"}</dd>
                      <dt className="col-4">Created</dt><dd className="col-8">{detail.created_at ? formatIST(detail.created_at) : "—"}</dd>
                    </dl>
                    <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Description</h6>
                    <p className="small">{detail.description || <span className="text-muted">—</span>}</p>
                    {detail.request && (
                      <>
                        <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Source</h6>
                        <p className="small">Converted from request <code>{detail.request.request_number}</code> ({detail.request.status})</p>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="border rounded p-3 mb-3 bg-light">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <h6 className="text-muted text-uppercase mb-0" style={{ fontSize: 12 }}>Assignment</h6>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary ms-auto"
                    aria-expanded={assignExpanded}
                    aria-label={assignExpanded ? "Collapse assignment" : "Expand assignment"}
                    onClick={() => setAssignExpanded((v) => !v)}
                  >
                    <i className={`bi ${assignExpanded ? "bi-chevron-up" : "bi-chevron-down"}`}></i>
                  </button>
                </div>
                {!assignExpanded && (
                  <p className="small text-muted">
                    {(detail.assignments || []).length === 0
                      ? "Not assigned yet."
                      : `${detail.assignments.find((a) => a.status === "ACTIVE")?.employee_name || detail.assignments[0]?.employee_name} · ${detail.assignments.find((a) => a.status === "ACTIVE")?.status || detail.assignments[0]?.status}`}
                  </p>
                )}
                {assignExpanded && (
                  <>
                    {(detail.assignments || []).length === 0 && <p className="small text-muted">Not assigned yet.</p>}
                    {(detail.assignments || []).map((a) => (
                      <div key={a.id} className="border rounded px-2 py-1 mb-1 bg-light small">
                        <strong>{a.employee_name}</strong> <span className="text-muted">({a.employee_code})</span>{" "}
                        <span className="badge bg-secondary ms-1">{a.status}</span>
                        <div className="text-muted">Assigned {a.assigned_at ? formatIST(a.assigned_at) : "—"}{a.unassigned_at ? ` · ended ${formatIST(a.unassigned_at)}` : ""}{a.remarks ? ` · ${a.remarks}` : ""}</div>
                      </div>
                    ))}
                    <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Status History</h6>
                    {(detail.status_history || []).length === 0 && <p className="small text-muted">No transitions recorded.</p>}
                    {(detail.status_history || []).map((h) => (
                      <div key={h.id} className="small py-1 border-bottom">
                        <code>{h.from_status || "—"} → {h.to_status}</code>{" "}
                        <span className="text-muted">by {h.changed_by_username || "?"} · {formatIST(h.created_at)}{h.remark ? ` · ${h.remark}` : ""}</span>
                      </div>
                    ))}
                    <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Verification</h6>
                    {(detail.verifications || []).length === 0 && <p className="small text-muted">No verification decisions recorded.</p>}
                    {(detail.verifications || []).map((v) => (
                      <div key={v.id} className="small py-1 border-bottom">
                        <span className={`badge ${v.action === "APPROVE" ? "bg-success-subtle text-success-emphasis border" : "bg-danger-subtle text-danger-emphasis border"}`}>{v.action}</span>{" "}
                        <span className="text-muted">
                          visit #{v.visit_number ?? "?"} · {formatIST(v.verified_at)}{v.verifier_name ? ` · by ${v.verifier_name}` : ""}{v.remark ? ` · “${v.remark}”` : ""}
                        </span>
                      </div>
                    ))}
                    <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Visits</h6>
                    {(detail.visits || []).length === 0 && <p className="small text-muted">No visits yet.</p>}
                    {(detail.visits || []).map((v) => (
                      <div key={v.id} className="small py-1 border-bottom">
                        <strong>Visit #{v.visit_number}</strong>{" "}
                        <span className="badge bg-secondary ms-1">{v.status}</span>
                        {v.status === "VISIT_CLOSED" && (
                          <span className="ms-2"><VisitReportButton visitId={v.id} /></span>
                        )}
                        <div className="text-muted">
                          Started {v.started_at ? formatIST(v.started_at) : "—"}
                          {v.reached_at ? ` · Reached ${formatIST(v.reached_at)}` : ""}
                          {v.distance_meters !== null && v.distance_meters !== undefined ? ` · ${v.distance_meters} m` : ""}
                        </div>
                      </div>
                    ))}
                    <MeasurementSection job={detail} onChanged={() => onRefresh(detail)} />
                    <JobPhotosSection job={detail} onChanged={() => onRefresh(detail)} />
                    <SignatureSection job={detail} onChanged={() => onRefresh(detail)} />
                  </>
                )}
              </div>
          </div>
          <div className="modal-footer">
            {!mine && canUpdate && preField && (
              <button className="btn btn-outline-primary" onClick={() => onEdit(detail)}>Edit</button>
            )}
            {!mine && canAssign && detail.status === "PENDING" && (
              <button className="btn btn-outline-success" onClick={() => onAssign(detail, false)}>Assign</button>
            )}
            {!mine && canReassign && preField && detail.status !== "PENDING" && (
              <button className="btn btn-outline-warning" onClick={() => onAssign(detail, true)}>Reassign</button>
            )}
            {!mine && canCancel && preField && (
              <button className="btn btn-outline-danger" onClick={() => onCancel(detail)}>Cancel</button>
            )}
            {reviewable && (
              <Link className="btn btn-success" to={`/jobs/verification?job=${detail.id}`}>
                <i className="bi bi-patch-check me-1"></i>Review in Verification
              </Link>
            )}
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Jobs;

// Standalone detail page for /jobs/:id (deep links, e.g. View Job from
// a converted request). Backend scoping applies identically.
export function JobDetailPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [infoExpanded, setInfoExpanded] = useState(true);
  const [assignExpanded, setAssignExpanded] = useState(true);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await JobService.getJobById(id);
      if (res.success) {
        setDetail(res.data);
        setError("");
      } else {
        setError(res.message || "Not found.");
      }
    } catch (err) {
      setError(err.response?.data?.message || "Not found.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  if (loading) {
    return (
      <div className="dashboard-content">
        <div className="text-center py-5"><div className="spinner-border text-primary" role="status"></div></div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="dashboard-content">
        <div className="container mt-4">
          <div className="alert alert-danger">{error || "Job not found."}</div>
          <Link to="/jobs" className="btn btn-primary">Back to Jobs</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>{detail.job_number} <span className={`badge ${STATUS_BADGE[detail.status] || "bg-secondary"} ms-2`}>{detail.status}</span></h4>
          <p>{detail.client_name} · {detail.store_name} ({detail.store_code})</p>
        </div>
        <div className="d-flex gap-2">
          {hasPermission("jobs.verify") && REVIEWABLE.includes(detail.status) && (
            <Link to={`/jobs/verification?job=${detail.id}`} className="btn btn-success">
              <i className="bi bi-patch-check me-1"></i>Review in Verification
            </Link>
          )}
          <Link to="/jobs" className="btn btn-outline-secondary">Back to Jobs</Link>
        </div>
      </div>
      <FieldWorkflow job={detail} onChanged={loadDetail} />
      <div className="dashboard-card p-4 mb-3">
        <div className="d-flex align-items-center gap-2 mb-2">
          <h6 className="text-muted text-uppercase mb-0" style={{ fontSize: 12 }}>Job Information</h6>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary ms-auto"
            aria-expanded={infoExpanded}
            aria-label={infoExpanded ? "Collapse job information" : "Expand job information"}
            onClick={() => setInfoExpanded((v) => !v)}
          >
            <i className={`bi ${infoExpanded ? "bi-chevron-up" : "bi-chevron-down"}`}></i>
            <span className="ms-1">{infoExpanded ? "Collapse" : "Expand"}</span>
          </button>
        </div>
        {!infoExpanded && (
          <div className="d-flex align-items-center gap-2 flex-wrap small">
            <span className="badge bg-secondary">{detail.priority || "—"}</span>
            <span className="fw-semibold">{detail.job_type_name || "—"}</span>
            <span className="text-muted">{detail.scheduled_date ? `Scheduled ${detail.scheduled_date}` : "Unscheduled"}</span>
          </div>
        )}
        {infoExpanded && (
          <>
            <dl className="row mb-0 small">
              <dt className="col-4">Type</dt><dd className="col-8">{detail.job_type_name || "—"}</dd>
              <dt className="col-4">Priority</dt><dd className="col-8">{detail.priority}</dd>
              <dt className="col-4">Scheduled</dt><dd className="col-8">{detail.scheduled_date || "—"}</dd>
              <dt className="col-4">Store</dt><dd className="col-8">{detail.store_name || detail.shop_name || "—"}{detail.store_code ? ` (${detail.store_code})` : ""}</dd>
              <dt className="col-4">Shopkeeper</dt><dd className="col-8">{detail.shopkeeper_name || "—"}</dd>
              <dt className="col-4">Phone</dt><dd className="col-8">{detail.shopkeeper_mobile ? (<a href={`tel:${detail.shopkeeper_mobile}`}>{detail.shopkeeper_mobile}</a>) : "—"}</dd>
              <dt className="col-4">Address</dt><dd className="col-8">{[detail.address, detail.city, detail.state, detail.pincode].filter(Boolean).join(", ") || "—"}</dd>
              <dt className="col-4">Description</dt><dd className="col-8">{detail.description || "—"}</dd>
              <dt className="col-4">Created</dt><dd className="col-8">{detail.created_at ? formatIST(detail.created_at) : "—"}</dd>
            </dl>
            {detail.request && (
              <p className="small mt-2">Source request <code>{detail.request.request_number}</code> ({detail.request.status})</p>
            )}
          </>
        )}
      </div>
      <div className="dashboard-card p-4 mb-3">
        <div className="d-flex align-items-center gap-2 mb-2">
          <h6 className="text-muted text-uppercase mb-0" style={{ fontSize: 12 }}>Assignment</h6>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary ms-auto"
            aria-expanded={assignExpanded}
            aria-label={assignExpanded ? "Collapse assignment" : "Expand assignment"}
            onClick={() => setAssignExpanded((v) => !v)}
          >
            <i className={`bi ${assignExpanded ? "bi-chevron-up" : "bi-chevron-down"}`}></i>
            <span className="ms-1">{assignExpanded ? "Collapse" : "Expand"}</span>
          </button>
        </div>
        {!assignExpanded && (
          <div className="d-flex align-items-center gap-2 flex-wrap small">
            {(detail.assignments || []).length === 0
              ? <span className="text-muted">Not assigned yet.</span>
              : (
                <>
                  <span className="fw-semibold">{detail.assignments.find((a) => a.status === "ACTIVE")?.employee_name || detail.assignments[0]?.employee_name}</span>
                  <span className="badge bg-secondary">{detail.assignments.find((a) => a.status === "ACTIVE")?.status || detail.assignments[0]?.status}</span>
                  <span className="text-muted">{(detail.status_history || []).length} updates · {(detail.visits || []).length} visits</span>
                </>
              )}
          </div>
        )}
        {assignExpanded && (
          <>
            {(detail.assignments || []).length === 0 && <p className="small text-muted">Not assigned yet.</p>}
            {(detail.assignments || []).map((a) => (
              <div key={a.id} className="border rounded px-2 py-1 mb-1 bg-light small">
                <strong>{a.employee_name}</strong> <span className="text-muted">({a.employee_code})</span>{" "}
                <span className="badge bg-secondary ms-1">{a.status}</span>
                <div className="text-muted">Assigned {a.assigned_at ? formatIST(a.assigned_at) : "—"}{a.unassigned_at ? ` · ended ${formatIST(a.unassigned_at)}` : ""}</div>
              </div>
            ))}
            <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Status History</h6>
            {(detail.status_history || []).map((h) => (
              <div key={h.id} className="small py-1 border-bottom">
                    <code>{h.from_status || "—"} → {h.to_status}</code>{" "}
                    <span className="text-muted">by {h.changed_by_username || "?"} · {formatIST(h.created_at)}</span>
                  </div>
                ))}
                <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Verification</h6>
                {(detail.verifications || []).length === 0 && <p className="small text-muted">No verification decisions recorded.</p>}
                {(detail.verifications || []).map((v) => (
                  <div key={v.id} className="small py-1 border-bottom">
                    <span className={`badge ${v.action === "APPROVE" ? "bg-success-subtle text-success-emphasis border" : "bg-danger-subtle text-danger-emphasis border"}`}>{v.action}</span>{" "}
                    <span className="text-muted">
                      visit #{v.visit_number ?? "?"} · {formatIST(v.verified_at)}{v.verifier_name ? ` · by ${v.verifier_name}` : ""}{v.remark ? ` · “${v.remark}”` : ""}
                    </span>
                  </div>
                ))}
                <h6 className="text-muted text-uppercase mt-3" style={{ fontSize: 12 }}>Visits</h6>
                {(detail.visits || []).length === 0 && <p className="small text-muted">No visits yet — travel has not started.</p>}
                {(detail.visits || []).map((v) => (
                  <div key={v.id} className="small py-1 border-bottom">
                    <strong>Visit #{v.visit_number}</strong>{" "}
                    <span className="badge bg-secondary ms-1">{v.status}</span>
                    {v.status === "VISIT_CLOSED" && (
                      <span className="ms-2"><VisitReportButton visitId={v.id} /></span>
                    )}
                    <div className="text-muted">
                      Started {v.started_at ? formatIST(v.started_at) : "—"}
                      {v.reached_at ? ` · Reached ${formatIST(v.reached_at)}` : ""}
                      {v.reach_latitude ? ` · GPS ${v.reach_latitude}, ${v.reach_longitude}` : ""}
                      {v.distance_meters !== null && v.distance_meters !== undefined ? ` · ${v.distance_meters} m` : ""}
                    </div>
                  </div>
                ))}
                <MeasurementSection job={detail} onChanged={loadDetail} />
                <JobPhotosSection job={detail} onChanged={loadDetail} />
                <SignatureSection job={detail} onChanged={loadDetail} />
              </>
            )}
      </div>
    </div>
  );
}
