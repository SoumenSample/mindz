/**
 * EmployeeMaster
 * Employee Master screen: list with search/filter/pagination, view
 * detail, create/edit modal, deactivate with confirmation, optional
 * login provisioning. All actions gated by hasPermission(); the
 * backend requirePermission middleware stays authoritative.
 *
 * The create/edit form matches the redesigned employee form (same
 * design language as the Client form). The Employee Code is NOT part
 * of the form — the backend always auto-generates it on save
 * (EMP-FE-###, derived from the designation):
 *   01 Employee Information      (blue)   - profile photo, name*,
 *                                           designation*, department*
 *   02 Address Information       (green)  - address line 1*, address
 *                                           line 2, city, state*,
 *                                           district*, landmark
 *   03 Contact Details           (amber)  - phone, email
 *   04 Emergency Contact Details (rose)   - phone, person name, relation
 *   05 Employment Details        (violet) - joining date, type of
 *                                           employment, status
 *   06 Identity Documents        (teal)   - ID type (select with an
 *                                           "Other" inline input),
 *                                           ID number, ID document
 * Identity uploads stay optional; the backend requirePermission
 * middleware remains authoritative.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import EmployeeService from "../services/EmployeeService";
import ResetPasswordModal from "./ResetPasswordModal";
import { StateSelect, DistrictSelect } from "./StateDistrictSelect";

const emptyForm = {
  employee_name: "",
  mobile: "",
  email: "",
  address: "",
  address_line_2: "",
  city: "",
  state: "",
  district: "",
  landmark: "",
  designation: "FIELD_EXECUTIVE",
  department: "",
  join_date: "",
  employment_type: "Permanent",
  status: "Active",
  id_type: "",
  photo_id_number: "",
  emergency_contact_name: "",
  emergency_phone: "",
  emergency_relation: ""
};

// Type of employment options (allow-list mirrors the backend).
const EMPLOYMENT_TYPES = ["Permanent", "Contractual", "Probation", "Intern"];

// Standard ID types. Picking "Other" reveals a free-text input whose
// value is stored as the ID type itself (so any custom document fits).
const ID_TYPES = ["Aadhaar Card", "PAN Card", "Voter ID", "Driving License", "Passport"];

// Resolve a stored "uploads/..." path to a loadable URL (uploads are served
// from the server root; the api client points at /api).
const uploadUrl = (rel) => {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  const base = (process.env.REACT_APP_API_URL
    || (typeof window !== "undefined" && window.location
      ? `http://${window.location.hostname}:${process.env.REACT_APP_API_PORT || "5000"}/api`
      : "http://localhost:5000/api")).replace(/\/api\/?$/, "");
  return `${base}/${String(rel).replace(/^\//, "")}`;
};

const EmployeeMaster = () => {
  const { hasPermission } = useAuth();
  const canView = hasPermission("employees.view");
  const canCreate = hasPermission("employees.create");
  const canUpdate = hasPermission("employees.update");
  const canDeactivate = hasPermission("employees.delete");
  const canResetPassword = hasPermission("users.password.reset");

  const [employees, setEmployees] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({ search: "", status: "", designation: "", department: "" });
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [alert, setAlert] = useState({ show: false, type: "", message: "" });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [detail, setDetail] = useState(null);

  // Optional identity uploads (never mandatory): new File objects + previews.
  const [profileFile, setProfileFile] = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);
  const [idDocFile, setIdDocFile] = useState(null);
  const [existingIdDoc, setExistingIdDoc] = useState(null);
  // Dropdown choice for ID type: "" | standard type | "Other". Kept separate
  // from formData.id_type (the stored value) so selecting "Other" sticks in
  // the select even before the custom name is typed. A stored custom ID type
  // (anything outside the standard list) renders as "Other" on edit.
  const [idTypeSelect, setIdTypeSelect] = useState("");

  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginData, setLoginData] = useState({ username: "", email: "", password: "" });
  const [isCreatingLogin, setIsCreatingLogin] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);

  // Department master for dropdowns (null = not loaded yet -> text fallback).
  const [departments, setDepartments] = useState(null);

  const showAlert = (type, message) => {
    setAlert({ show: true, type, message });
    setTimeout(() => setAlert({ show: false, type: "", message: "" }), 5000);
  };

  const loadEmployees = useCallback(
    async (page = 1, overrideFilters = null) => {
      const f = overrideFilters || filters;
      setIsLoading(true);
      try {
        const res = await EmployeeService.getEmployees({ ...f, page, limit: 20 });
        if (res.success) {
          setEmployees(res.data);
          setPagination(res.pagination);
        } else {
          showAlert("danger", res.message || "Failed to load employees.");
        }
      } catch (error) {
        showAlert("danger", error.response?.data?.message || "Unable to load employees.");
      } finally {
        setIsLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    if (canView) {
      loadEmployees(1);
      EmployeeService.getDepartments()
        .then((res) => {
          if (res.success) setDepartments(res.data);
          else setDepartments([]);
        })
        .catch(() => setDepartments([]));
    }
  }, [canView, loadEmployees]);

  const applyFilters = (e) => {
    e.preventDefault();
    loadEmployees(1, { ...filters, search: searchInput });
    setFilters((prev) => ({ ...prev, search: searchInput }));
  };

  const clearFilters = () => {
    const cleared = { search: "", status: "", designation: "", department: "" };
    setFilters(cleared);
    setSearchInput("");
    loadEmployees(1, cleared);
  };

  const openCreate = () => {
    setEditing(null);
    setFormData(emptyForm);
    setFormErrors({});
    setProfileFile(null);
    setProfilePreview(null);
    setIdDocFile(null);
    setExistingIdDoc(null);
    setIdTypeSelect("");
    setShowForm(true);
  };

  const openEdit = (emp) => {
    setEditing(emp);
    setFormData({
      employee_name: emp.employee_name || "",
      mobile: emp.mobile || "",
      email: emp.email || "",
      address: emp.address || "",
      address_line_2: emp.address_line_2 || "",
      city: emp.city || "",
      state: emp.state || "",
      district: emp.district || "",
      landmark: emp.landmark || "",
      designation: emp.designation?.code || "FIELD_EXECUTIVE",
      department: emp.department?.code || "",
      join_date: emp.join_date || "",
      employment_type: emp.employment_type || "Permanent",
      status: emp.status || "Active",
      id_type: emp.id_type || "",
      photo_id_number: emp.photo_id_number || "",
      emergency_contact_name: emp.emergency_contact_name || "",
      emergency_phone: emp.emergency_phone || "",
      emergency_relation: emp.emergency_relation || ""
    });
    const storedIdType = emp.id_type || "";
    setIdTypeSelect(ID_TYPES.includes(storedIdType) ? storedIdType : (storedIdType ? "Other" : ""));
    setFormErrors({});
    setProfileFile(null);
    setProfilePreview(uploadUrl(emp.profile_photo_path));
    setIdDocFile(null);
    setExistingIdDoc(emp.photo_id_doc_path || null);
    setShowForm(true);
  };

  const validateForm = () => {
    const errs = {};
    if (!formData.employee_name.trim()) errs.employee_name = "Employee Name is required.";
    if (!formData.department.trim()) errs.department = "Department is required.";
    if (!formData.address.trim()) errs.address = "Address Line 1 is required.";
    if (!formData.state) errs.state = "State is required.";
    if (!formData.district) errs.district = "District is required.";
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errs.email = "Invalid email format.";
    }
    if (formData.mobile && formData.mobile.trim() !== "") {
      const digits = formData.mobile.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 13) errs.mobile = "Mobile must be a valid 10-digit number.";
    }
    if (formData.emergency_phone && formData.emergency_phone.trim() !== "") {
      const digits = formData.emergency_phone.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 13) errs.emergency_phone = "Emergency phone must be a valid 10-digit number.";
    }
    // Identity uploads stay optional — only type/size guarded when chosen.
    if (profileFile) {
      if (!["image/jpeg", "image/png", "image/webp", "image/jpg"].includes(profileFile.type)) {
        errs.profile_photo = "Profile photo must be JPG, PNG or WEBP.";
      } else if (profileFile.size > 5 * 1024 * 1024) {
        errs.profile_photo = "Profile photo must be under 5 MB.";
      }
    }
    if (idDocFile) {
      const okType = ["image/jpeg", "image/png", "image/webp", "image/jpg", "application/pdf"].includes(idDocFile.type);
      if (!okType) {
        errs.id_document = "ID document must be JPG, PNG, WEBP or PDF.";
      } else if (idDocFile.size > 5 * 1024 * 1024) {
        errs.id_document = "ID document must be under 5 MB.";
      }
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleProfileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setProfileFile(f);
    if (f) {
      setProfilePreview(URL.createObjectURL(f));
    } else {
      setProfilePreview(editing ? uploadUrl(editing.profile_photo_path) : null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      // Multipart FormData so optional files ride along with the text
      // fields. The Employee Code is never sent — the backend generates it.
      const fd = new FormData();
      fd.append("employee_name", formData.employee_name.trim());
      fd.append("mobile", formData.mobile || "");
      fd.append("email", formData.email || "");
      fd.append("address", formData.address.trim());
      fd.append("address_line_2", formData.address_line_2 || "");
      fd.append("city", formData.city || "");
      fd.append("state", formData.state || "");
      fd.append("district", formData.district || "");
      fd.append("landmark", formData.landmark || "");
      fd.append("designation", formData.designation || "FIELD_EXECUTIVE");
      fd.append("department", formData.department.trim());
      fd.append("join_date", formData.join_date || "");
      fd.append("employment_type", EMPLOYMENT_TYPES.includes(formData.employment_type) ? formData.employment_type : "Permanent");
      fd.append("status", formData.status || "Active");
      fd.append("id_type", formData.id_type || "");
      fd.append("photo_id_number", formData.photo_id_number || "");
      fd.append("emergency_contact_name", formData.emergency_contact_name || "");
      fd.append("emergency_phone", formData.emergency_phone || "");
      fd.append("emergency_relation", formData.emergency_relation || "");
      if (profileFile) fd.append("profile_photo", profileFile);
      if (idDocFile) fd.append("id_document", idDocFile);
      if (editing) {
        const res = await EmployeeService.updateEmployee(editing.id, fd);
        showAlert("success", res.message || "Employee updated.");
      } else {
        const res = await EmployeeService.createEmployee(fd);
        showAlert("success", res.message || "Employee created.");
      }
      setShowForm(false);
      loadEmployees(pagination.page);
      if (detail && editing && detail.id === editing.id) {
        const refreshed = await EmployeeService.getEmployeeById(editing.id);
        if (refreshed.success) setDetail(refreshed.data);
      }
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Save failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDetail = async (emp) => {
    try {
      const res = await EmployeeService.getEmployeeById(emp.id);
      if (res.success) {
        setDetail(res.data);
        setShowLoginForm(false);
        setLoginData({ username: "", email: res.data.email || "", password: "" });
      }
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Could not load details.");
    }
  };

  const handleDeactivate = async (emp) => {
    if (!window.confirm(`Deactivate employee "${emp.employee_name}" (${emp.employee_code})? Historical job records stay intact, and any linked login will be locked.`)) return;
    try {
      const res = await EmployeeService.deactivateEmployee(emp.id);
      showAlert("success", res.message || "Deactivated.");
      setDetail(null);
      loadEmployees(pagination.page);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Deactivation failed.");
    }
  };

  const handleCreateLogin = async (e) => {
    e.preventDefault();
    if (!loginData.username.trim() || loginData.username.trim().length < 3) {
      showAlert("danger", "Username required (min 3 characters).");
      return;
    }
    if (!loginData.password || loginData.password.length < 6) {
      showAlert("danger", "Password required (min 6 characters).");
      return;
    }
    setIsCreatingLogin(true);
    try {
      const res = await EmployeeService.createEmployeeLogin(detail.id, loginData);
      showAlert("success", res.message || "Login created.");
      if (res.success) {
        setDetail(res.data);
        setShowLoginForm(false);
      }
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Login creation failed.");
    } finally {
      setIsCreatingLogin(false);
    }
  };

  const goPage = (page) => {
    if (page >= 1 && page <= Math.max(pagination.totalPages, 1)) loadEmployees(page);
  };

  if (!canView) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">
          <i className="bi bi-shield-lock me-2"></i>
          Access denied. This page requires permission <strong>employees.view</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>Employees</h4>
          <p>Field executive master — {pagination.total} record(s). Deactivation preserves history.</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={openCreate}>
            <i className="bi bi-plus-lg me-2"></i>Add Employee
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
              <div className="col-md-4">
                <label className="form-label">Search</label>
                <input
                  type="text" className="form-control" placeholder="Code, name, phone, email..."
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">Status</label>
                <select className="form-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Designation</label>
                <select className="form-select" value={filters.designation} onChange={(e) => setFilters({ ...filters, designation: e.target.value })}>
                  <option value="">All</option>
                  <option value="FIELD_EXECUTIVE">Field Executive</option>
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Department</label>
                {departments === null || departments.length === 0 ? (
                  <input
                    type="text" className="form-control" placeholder="e.g. INSTALLATION"
                    value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}
                  />
                ) : (
                  <select className="form-select" value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
                    <option value="">All</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.code}>{d.name} ({d.code})</option>
                    ))}
                  </select>
                )}
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
            <table className="table table-hover align-middle mb-0 client-table">
              <thead>
                <tr>
                  <th className="ps-3">Code</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Designation</th>
                  <th>Status</th>
                  <th className="text-end pe-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan="6" className="text-center py-4"><div className="spinner-border text-primary" role="status"></div></td></tr>
                ) : employees.length === 0 ? (
                  <tr><td colSpan="6" className="text-center py-4 text-muted">No employees found.</td></tr>
                ) : (
                  employees.map((emp) => (
                    <tr key={emp.id}>
                      <td className="ps-3"><span className="badge bg-light text-dark border font-monospace">{emp.employee_code}</span></td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          {emp.profile_photo_path ? (
                            <img src={uploadUrl(emp.profile_photo_path)} alt="" className="rounded-circle border"
                              style={{ width: 32, height: 32, objectFit: "cover" }} />
                          ) : (
                            <span className="rounded-circle bg-light border d-inline-flex align-items-center justify-content-center text-muted"
                              style={{ width: 32, height: 32 }}>
                              <i className="bi bi-person"></i>
                            </span>
                          )}
                          <span className="fw-semibold">{emp.employee_name}</span>
                        </div>
                      </td>
                      <td>{emp.mobile || <span className="text-muted fst-italic">N/A</span>}</td>
                      <td><span className="badge bg-info-subtle text-info-emphasis border">{emp.designation?.code || "—"}</span></td>
                      <td>
                        {emp.status === "Active"
                          ? <span className="badge-status-active"><i className="bi bi-check-circle-fill me-1"></i>Active</span>
                          : <span className="badge-status-inactive"><i className="bi bi-x-circle-fill me-1"></i>Inactive</span>}
                      </td>
                      <td className="text-end pe-3">
                        <div className="btn-group btn-group-sm">
                          <button className="btn btn-outline-secondary" onClick={() => openDetail(emp)} title="View">
                            <i className="bi bi-eye"></i>
                          </button>
                          {canUpdate && (
                            <button className="btn btn-outline-primary" onClick={() => openEdit(emp)} title="Edit">
                              <i className="bi bi-pencil"></i>
                            </button>
                          )}
                          {canDeactivate && emp.status === "Active" && (
                            <button className="btn btn-outline-danger" onClick={() => handleDeactivate(emp)} title="Deactivate">
                              <i className="bi bi-person-x"></i>
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
        <div className="modal d-block client-form-backdrop" tabIndex="-1">
          <div className="modal-dialog client-form-dialog">
            <div className="modal-content">
              <div className="client-form-header">
                <div>
                  <h5 className="client-form-title">{editing ? "Edit Employee" : "Employee Registration"}</h5>
                  <p className="client-form-subtitle mb-0">Create and manage employee records.</p>
                </div>
                <button type="button" className="btn-close" onClick={() => setShowForm(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body client-form-body">

                  {/* ---- 01 Employee Information -------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-blue">
                      <span className="cs-chip"><i className="bi bi-person-vcard"></i></span>
                      <div>
                        <div className="cs-title">Employee Information</div>
                        <div className="cs-subtitle">Basic identity of the employee</div>
                      </div>
                      <span className="cs-number">01</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-4">
                        <label className="form-label">Employee Name <span className="text-danger">*</span></label>
                        <input type="text" className={`form-control ${formErrors.employee_name ? "is-invalid" : ""}`}
                          value={formData.employee_name} onChange={(e) => setFormData({ ...formData, employee_name: e.target.value })} placeholder="Enter full name" />
                        {formErrors.employee_name && <div className="invalid-feedback">{formErrors.employee_name}</div>}
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Designation <span className="text-danger">*</span></label>
                        <select className="form-select" value={formData.designation} onChange={(e) => setFormData({ ...formData, designation: e.target.value })}>
                          <option value="FIELD_EXECUTIVE">Field Executive</option>
                        </select>
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Department <span className="text-danger">*</span></label>
                        {departments === null || departments.length === 0 ? (
                          <>
                            <input type="text" className={`form-control ${formErrors.department ? "is-invalid" : ""}`}
                              value={formData.department}
                              onChange={(e) => setFormData({ ...formData, department: e.target.value.toUpperCase() })}
                              placeholder="Enter department (required)" />
                            {formErrors.department && <div className="invalid-feedback">{formErrors.department}</div>}
                          </>
                        ) : (
                          <>
                            <select className={`form-select ${formErrors.department ? "is-invalid" : ""}`}
                              value={formData.department}
                              onChange={(e) => setFormData({ ...formData, department: e.target.value })}>
                              <option value="">Select department *</option>
                              {departments.map((d) => (
                                <option key={d.id} value={d.code}>{d.name} ({d.code})</option>
                              ))}
                            </select>
                            {formErrors.department && <div className="invalid-feedback">{formErrors.department}</div>}
                          </>
                        )}
                      </div>
                      <div className="col-12">
                        <label className="form-label">Profile Photo <span className="text-muted fw-normal">(optional)</span></label>
                        <div className="d-flex align-items-center gap-3">
                          <div className="client-logo-preview">
                            {profilePreview
                              ? <img src={profilePreview} alt="Profile preview" />
                              : <i className="bi bi-person"></i>}
                          </div>
                          <div className="flex-grow-1">
                            <input type="file" accept="image/jpeg,image/png,image/webp"
                              className={`form-control ${formErrors.profile_photo ? "is-invalid" : ""}`}
                              onChange={handleProfileChange} />
                            <div className="client-logo-hint">JPG, PNG or WEBP • Maximum 5 MB</div>
                            {editing?.profile_photo_path && !profileFile && (
                              <div className="client-logo-hint">Existing photo is kept unless a new one is chosen.</div>
                            )}
                          </div>
                        </div>
                        {formErrors.profile_photo && <div className="invalid-feedback d-block">{formErrors.profile_photo}</div>}
                      </div>
                    </div>
                  </section>

                  {/* ---- 02 Address Information --------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-green">
                      <span className="cs-chip"><i className="bi bi-geo-alt"></i></span>
                      <div>
                        <div className="cs-title">Address Information</div>
                        <div className="cs-subtitle">Residential address of the employee</div>
                      </div>
                      <span className="cs-number">02</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Address Line 1 <span className="text-danger">*</span></label>
                        <input type="text" className={`form-control ${formErrors.address ? "is-invalid" : ""}`}
                          value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="House no, street, area" />
                        {formErrors.address && <div className="invalid-feedback">{formErrors.address}</div>}
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Address Line 2 <span className="text-muted fw-normal">(optional)</span></label>
                        <input type="text" className="form-control"
                          value={formData.address_line_2} onChange={(e) => setFormData({ ...formData, address_line_2: e.target.value })} placeholder="Apartment, block, locality" />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">City</label>
                        <input type="text" className="form-control"
                          value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="Enter city" />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">State <span className="text-danger">*</span></label>
                        <StateSelect
                          value={formData.state}
                          placeholder="Select state"
                          onChange={(v) => setFormData({ ...formData, state: v, district: "" })}
                        />
                        {formErrors.state && <div className="text-danger small mt-1">{formErrors.state}</div>}
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">District <span className="text-danger">*</span></label>
                        <DistrictSelect
                          stateName={formData.state}
                          value={formData.district}
                          placeholder="Select district"
                          onChange={(v) => setFormData({ ...formData, district: v })}
                        />
                        {formErrors.district && <div className="text-danger small mt-1">{formErrors.district}</div>}
                      </div>
                      <div className="col-12">
                        <label className="form-label">Landmark <span className="text-muted fw-normal">(optional)</span></label>
                        <input type="text" className="form-control"
                          value={formData.landmark} onChange={(e) => setFormData({ ...formData, landmark: e.target.value })} placeholder="Nearest known place for quick reach" />
                      </div>
                    </div>
                  </section>

                  {/* ---- 03 Contact Details ------------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-amber">
                      <span className="cs-chip"><i className="bi bi-telephone"></i></span>
                      <div>
                        <div className="cs-title">Contact Details</div>
                        <div className="cs-subtitle">Phone and email of the employee</div>
                      </div>
                      <span className="cs-number">03</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Phone Number</label>
                        <input type="text" inputMode="numeric" className={`form-control ${formErrors.mobile ? "is-invalid" : ""}`}
                          value={formData.mobile}
                          onChange={(e) => setFormData({ ...formData, mobile: e.target.value.replace(/\D/g, "").slice(0, 13) })}
                          placeholder="Enter 10-digit phone number" maxLength={13} />
                        {formErrors.mobile && <div className="invalid-feedback">{formErrors.mobile}</div>}
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Email ID</label>
                        <input type="email" className={`form-control ${formErrors.email ? "is-invalid" : ""}`}
                          value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="Enter email id" />
                        {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
                      </div>
                    </div>
                  </section>

                  {/* ---- 04 Emergency Contact Details --------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-rose">
                      <span className="cs-chip"><i className="bi bi-heart-pulse"></i></span>
                      <div>
                        <div className="cs-title">Emergency Contact Details</div>
                        <div className="cs-subtitle">Who to reach when the employee is unavailable</div>
                      </div>
                      <span className="cs-number">04</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-4">
                        <label className="form-label">Phone No.</label>
                        <input type="text" inputMode="numeric" className={`form-control ${formErrors.emergency_phone ? "is-invalid" : ""}`}
                          value={formData.emergency_phone}
                          onChange={(e) => setFormData({ ...formData, emergency_phone: e.target.value.replace(/\D/g, "").slice(0, 13) })}
                          placeholder="Enter 10-digit phone number" maxLength={13} />
                        {formErrors.emergency_phone && <div className="invalid-feedback">{formErrors.emergency_phone}</div>}
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Contact Person Name</label>
                        <input type="text" className="form-control"
                          value={formData.emergency_contact_name}
                          onChange={(e) => setFormData({ ...formData, emergency_contact_name: e.target.value })}
                          placeholder="Enter contact person name" maxLength={100} />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Relation</label>
                        <input type="text" className="form-control"
                          value={formData.emergency_relation}
                          onChange={(e) => setFormData({ ...formData, emergency_relation: e.target.value })}
                          placeholder="e.g. Father / Spouse / Sibling" maxLength={50} />
                      </div>
                    </div>
                  </section>

                  {/* ---- 05 Employment Details ---------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-violet">
                      <span className="cs-chip"><i className="bi bi-briefcase"></i></span>
                      <div>
                        <div className="cs-title">Employment Details</div>
                        <div className="cs-subtitle">Joining, type of employment and status</div>
                      </div>
                      <span className="cs-number">05</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-4">
                        <label className="form-label">Date of Joining</label>
                        <input type="date" className="form-control" value={formData.join_date} onChange={(e) => setFormData({ ...formData, join_date: e.target.value })} />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Type of Employment</label>
                        <select className="form-select" value={formData.employment_type}
                          onChange={(e) => setFormData({ ...formData, employment_type: e.target.value })}>
                          {EMPLOYMENT_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Status</label>
                        <select className="form-select" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                          <option value="Active">Active</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  {/* ---- 06 Identity Documents ---------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-teal">
                      <span className="cs-chip"><i className="bi bi-person-badge"></i></span>
                      <div>
                        <div className="cs-title">Identity Documents</div>
                        <div className="cs-subtitle">Government ID proof of the employee</div>
                      </div>
                      <span className="cs-number">06</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-4">
                        <label className="form-label">ID Type <span className="text-muted fw-normal">(optional)</span></label>
                        <select className="form-select" value={idTypeSelect}
                          onChange={(e) => {
                            const v = e.target.value;
                            setIdTypeSelect(v);
                            if (v === "Other") {
                              // Reveal the custom input: keep an already-custom
                              // value, otherwise start with an empty input.
                              setFormData((prev) => ({ ...prev, id_type: ID_TYPES.includes(prev.id_type) ? "" : prev.id_type }));
                            } else {
                              setFormData((prev) => ({ ...prev, id_type: v }));
                            }
                          }}>
                          <option value="">Select ID type</option>
                          {ID_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">ID Number</label>
                        <input type="text" className="form-control" value={formData.photo_id_number}
                          onChange={(e) => setFormData({ ...formData, photo_id_number: e.target.value })}
                          placeholder="Enter ID number" maxLength={100} />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">ID Document <span className="text-muted fw-normal">(optional)</span></label>
                        <input type="file" accept="image/jpeg,image/png,image/webp,.pdf"
                          className={`form-control ${formErrors.id_document ? "is-invalid" : ""}`}
                          onChange={(e) => setIdDocFile(e.target.files?.[0] || null)} />
                        {formErrors.id_document && <div className="invalid-feedback">{formErrors.id_document}</div>}
                        {idDocFile
                          ? <div className="client-logo-hint">Selected: {idDocFile.name}</div>
                          : existingIdDoc
                            ? <div className="client-logo-hint"><a href={uploadUrl(existingIdDoc)} target="_blank" rel="noreferrer">View existing ID document</a> <span className="text-muted">(kept unless replaced)</span></div>
                            : <div className="client-logo-hint">JPG, PNG, WEBP or PDF up to 5 MB.</div>}
                      </div>
                      {idTypeSelect === "Other" && (
                        <div className="col-12">
                          <label className="form-label">Other ID Type <span className="text-danger">*</span></label>
                          <input type="text" className="form-control" value={formData.id_type}
                            onChange={(e) => setFormData({ ...formData, id_type: e.target.value })}
                            placeholder="Specify the document type (e.g. Office ID Card)" maxLength={30} autoFocus />
                          {/* <div className="client-logo-hint">Typed here, the value is stored as the ID type itself.</div> */}
                        </div>
                      )}
                    </div>
                  </section>

                </div>
                <div className="client-form-footer">
                  <button type="button" className="btn btn-outline-secondary px-4" onClick={() => setShowForm(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary px-4" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : editing ? "Update Employee" : "Save Employee"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal d-block client-form-backdrop" tabIndex="-1">
          <div className="modal-dialog client-detail-dialog">
            <div className="modal-content client-detail-content">

              {/* Blue header band: title only */}
              <div className="client-form-header">
                <div>
                  <h5 className="client-form-title">Employee Details</h5>
                </div>
                <button type="button" className="btn-close" onClick={() => setDetail(null)}></button>
              </div>

              <div className="client-detail-body">

                {/* Centered profile head: avatar, name + status, code */}
                <div className="employee-profile-head">
                  <div className="employee-profile-avatar" title={detail.profile_photo_path ? "Profile photo" : "No photo uploaded"}>
                    {detail.profile_photo_path ? (
                      <img src={uploadUrl(detail.profile_photo_path)} alt="Profile" />
                    ) : (
                      <i className="bi bi-person"></i>
                    )}
                  </div>
                  <div className="employee-profile-name-row">
                    <span className="employee-profile-name">{detail.employee_name}</span>
                    {detail.status === "Active"
                      ? <span className="badge-status-active"><i className="bi bi-check-circle-fill me-1"></i>Active</span>
                      : <span className="badge-status-inactive"><i className="bi bi-x-circle-fill me-1"></i>Inactive</span>}
                  </div>
                  <div>
                    <span className="badge bg-light text-dark border font-monospace">{detail.employee_code}</span>
                  </div>
                </div>

                {/* 01 Employee Information */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip blue"><i className="bi bi-person-vcard"></i></span>Employee Information</div>
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div className="client-detail-label">Designation</div>
                      <div className="client-detail-value">{detail.designation?.code || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Department</div>
                      <div className="client-detail-value">{detail.department ? `${detail.department.name} (${detail.department.code})` : "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Type of Employment</div>
                      <div className="client-detail-value">{detail.employment_type || "—"}</div>
                    </div>
                  </div>
                </div>

                {/* 02 Address Information */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip green"><i className="bi bi-geo-alt"></i></span>Address Information</div>
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="client-detail-label">Residential Address</div>
                      <div className="client-detail-value">{[detail.address, detail.address_line_2].filter(Boolean).join(", ") || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">City</div>
                      <div className="client-detail-value">{detail.city || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">District</div>
                      <div className="client-detail-value">{detail.district || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">State</div>
                      <div className="client-detail-value">{detail.state || "—"}</div>
                    </div>
                    <div className="col-12">
                      <div className="client-detail-label">Landmark</div>
                      <div className="client-detail-value">{detail.landmark || "—"}</div>
                    </div>
                  </div>
                </div>

                {/* 03 Contact Details */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip amber"><i className="bi bi-telephone"></i></span>Contact Details</div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="client-detail-label">Phone Number</div>
                      <div className="client-detail-value">{detail.mobile || "—"}</div>
                    </div>
                    <div className="col-md-6">
                      <div className="client-detail-label">Email ID</div>
                      <div className="client-detail-value">{detail.email || "—"}</div>
                    </div>
                  </div>
                </div>

                {/* 04 Emergency Contact Details */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip rose"><i className="bi bi-heart-pulse"></i></span>Emergency Contact Details</div>
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div className="client-detail-label">Phone No.</div>
                      <div className="client-detail-value">{detail.emergency_phone || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Contact Person Name</div>
                      <div className="client-detail-value">{detail.emergency_contact_name || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Relation</div>
                      <div className="client-detail-value">{detail.emergency_relation || "—"}</div>
                    </div>
                  </div>
                </div>

                {/* 05 Employment Details */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip violet"><i className="bi bi-briefcase"></i></span>Employment Details</div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="client-detail-label">Date of Joining</div>
                      <div className="client-detail-value">{detail.join_date || "—"}</div>
                    </div>
                    <div className="col-md-6">
                      <div className="client-detail-label">Status</div>
                      <div className="client-detail-value">
                        {detail.status === "Active"
                          ? <span className="badge-status-active"><i className="bi bi-check-circle-fill me-1"></i>Active</span>
                          : <span className="badge-status-inactive"><i className="bi bi-x-circle-fill me-1"></i>Inactive</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 06 Identity Documents */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip teal"><i className="bi bi-person-badge"></i></span>Identity Documents</div>
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div className="client-detail-label">ID Type</div>
                      <div className="client-detail-value">{detail.id_type || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">ID Number</div>
                      <div className="client-detail-value">{detail.photo_id_number || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">ID Document</div>
                      <div className="client-detail-value">
                        {detail.photo_id_doc_path
                          ? <a href={uploadUrl(detail.photo_id_doc_path)} target="_blank" rel="noreferrer">View ID document</a>
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Login Account */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip slate"><i className="bi bi-people"></i></span>Login Account</div>
                  {detail.user
                    ? (
                      <div className="client-login-row">
                        <span className="badge bg-success-subtle text-success border">{detail.user.username} ({detail.user.status})</span>
                        {detail.user.must_change_password === true && (
                          <span className="badge bg-warning-subtle text-warning-emphasis border ms-1">Temporary password pending</span>
                        )}
                        {canResetPassword && (
                          <button className="btn btn-sm btn-link text-warning p-0 ms-1" title={`Reset password for ${detail.user.username}`}
                            onClick={() => setResetTarget(detail.user)}>
                            <i className="bi bi-key"></i> Reset Password
                          </button>
                        )}
                      </div>
                    )
                    : <div className="client-detail-value text-muted">No linked login</div>}
                  {!detail.user && canCreate && (
                    <div className="mt-2">
                      {!showLoginForm ? (
                        <button className="btn btn-sm btn-outline-primary" onClick={() => setShowLoginForm(true)}>
                          <i className="bi bi-key me-1"></i>Create Login Account
                        </button>
                      ) : (
                        <form onSubmit={handleCreateLogin} className="border rounded p-3 bg-light">
                          <div className="mb-2">
                            <label className="form-label">Username *</label>
                            <input type="text" className="form-control form-control-sm" value={loginData.username}
                              onChange={(e) => setLoginData({ ...loginData, username: e.target.value })} placeholder="min 3 characters" />
                          </div>
                          <div className="mb-2">
                            <label className="form-label">Email</label>
                            <input type="email" className="form-control form-control-sm" value={loginData.email}
                              onChange={(e) => setLoginData({ ...loginData, email: e.target.value })} />
                          </div>
                          <div className="mb-2">
                            <label className="form-label">Password *</label>
                            <input type="password" className="form-control form-control-sm" value={loginData.password}
                              onChange={(e) => setLoginData({ ...loginData, password: e.target.value })} placeholder="min 6 characters" />
                          </div>
                          <div className="d-flex gap-2">
                            <button type="submit" className="btn btn-sm btn-primary" disabled={isCreatingLogin}>
                              {isCreatingLogin ? "Creating..." : "Create (EMPLOYEE role)"}
                            </button>
                            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowLoginForm(false)}>Cancel</button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}
                </div>

              </div>
              <div className="client-form-footer">
                <button className="btn btn-outline-secondary px-4" onClick={() => setDetail(null)}>Close</button>
                {canDeactivate && detail.status === "Active" && (
                  <button className="btn btn-outline-danger px-4" onClick={() => handleDeactivate(detail)}>Deactivate</button>
                )}
                {canUpdate && <button className="btn btn-primary px-4" onClick={() => { setDetail(null); openEdit(detail); }}>Edit</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <ResetPasswordModal
          userId={resetTarget.id}
          username={resetTarget.username}
          onClose={() => setResetTarget(null)}
          onSuccess={async (message) => {
            setResetTarget(null);
            showAlert("success", message);
            if (detail) {
              const refreshed = await EmployeeService.getEmployeeById(detail.id);
              if (refreshed.success) setDetail(refreshed.data);
            }
          }}
          onError={(message) => showAlert("danger", message)}
        />
      )}
    </div>
  );
};

export default EmployeeMaster;
