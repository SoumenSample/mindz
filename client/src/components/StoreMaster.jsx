/**
 * StoreMaster
 * Store master: list with search/client/status/city/state filters and
 * pagination, detail modal, create/edit modal, deactivate with
 * confirmation. Fields match the live `stores` schema. Client selector
 * loads active clients for ADMIN/SUPER_ADMIN; the backend stays
 * authoritative on ownership. Actions gated by hasPermission().
 *
 * The create/edit form follows the redesigned sectioned layout (same
 * design language as the Client/Employee forms):
 *   01 Store Information    (blue)   - client*(admin), name*, outlet,
 *                                      status (code is not shown — it
 *                                      auto-generates server-side as
 *                                      STR-<client>-###)
 *   02 Address Information  (green)  - address lines 1/2, building,
 *                                      floor, landmark, city, pincode,
 *                                      state, district
 *   03 Contact Details      (amber)  - shopkeeper name, mobile
 *   04 Reference GPS        (violet) - latitude, longitude + capture
 */
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import StoreService from "../services/StoreService";
import ClientService from "../services/ClientService";
import { StateSelect, DistrictSelect } from "./StateDistrictSelect";
import { getCurrentGps } from "../services/gps";
import { formatIST } from "../utils/datetime";

const emptyForm = {
  client_id: "",
  store_code: "",
  store_name: "",
  outlet_number: "",
  building_name: "",
  floor: "",
  address_line_1: "",
  address_line_2: "",
  landmark: "",
  city: "",
  district: "",
  state: "",
  pincode: "",
  latitude: "",
  longitude: "",
  shopkeeper_name: "",
  shopkeeper_mobile: "",
  status: "ACTIVE"
};

const StoreMaster = ({ clientMode = false }) => {
  const { hasPermission } = useAuth();
  // Admin module uses the granular stores.view.all (no generic
  // stores.view exists by design — see 012 migration). The CLIENT
  // self-service screen (clientMode, route /stores/mine) gates on
  // stores.view.own instead. No role literals anywhere.
  const viewPerm = clientMode ? "stores.view.own" : "stores.view.all";
  const canView = hasPermission(viewPerm);
  const canCreate = hasPermission("stores.create");
  const canUpdate = hasPermission("stores.update");
  const canDeactivate = hasPermission("stores.delete");

  const [stores, setStores] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({ search: "", client_id: "", status: "", city: "", state: "" });
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [alert, setAlert] = useState({ show: false, type: "", message: "" });

  const [clients, setClients] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCapturingGps, setIsCapturingGps] = useState(false);
  const [gpsNote, setGpsNote] = useState("");
  const [gpsNoteOk, setGpsNoteOk] = useState(false);

  const [detail, setDetail] = useState(null);

  const showAlert = (type, message) => {
    setAlert({ show: true, type, message });
    setTimeout(() => setAlert({ show: false, type: "", message: "" }), 5000);
  };

  const loadStores = useCallback(
    async (page = 1, overrideFilters = null) => {
      const f = overrideFilters || filters;
      setIsLoading(true);
      try {
        const res = await StoreService.getStores({ ...f, page, limit: 20 });
        if (res.success) {
          setStores(res.data);
          setPagination(res.pagination);
        } else {
          showAlert("danger", res.message || "Failed to load stores.");
        }
      } catch (error) {
        showAlert("danger", error.response?.data?.message || "Unable to load stores.");
      } finally {
        setIsLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    if (canView) {
      loadStores(1);
      // Admin mode needs the client list for selector/filter; client
      // self-service never sees other clients (backend forces scope).
      if (!clientMode) {
        ClientService.getClients({ status: "Active", page: 1, limit: 100 })
          .then((res) => {
            if (res.success) setClients(res.data);
          })
          .catch(() => setClients([]));
      }
    }
  }, [canView, clientMode, loadStores]);

  const applyFilters = (e) => {
    e.preventDefault();
    loadStores(1, { ...filters, search: searchInput });
    setFilters((prev) => ({ ...prev, search: searchInput }));
  };

  const clearFilters = () => {
    const cleared = { search: "", client_id: "", status: "", city: "", state: "" };
    setFilters(cleared);
    setSearchInput("");
    loadStores(1, cleared);
  };

  const openCreate = () => {
    setEditing(null);
    setFormData(emptyForm);
    setFormErrors({});
    setGpsNote("");
    setShowForm(true);
  };

  const openEdit = (store) => {
    setEditing(store);
    setFormData({
      client_id: store.client_id || "",
      store_code: store.store_code || "",
      store_name: store.store_name || "",
      outlet_number: store.outlet_number || "",
      building_name: store.building_name || "",
      floor: store.floor || "",
      address_line_1: store.address_line_1 || "",
      address_line_2: store.address_line_2 || "",
      landmark: store.landmark || "",
      city: store.city || "",
      district: store.district || "",
      state: store.state || "",
      pincode: store.pincode || "",
      latitude: store.latitude ?? "",
      longitude: store.longitude ?? "",
      shopkeeper_name: store.shopkeeper_name || "",
      shopkeeper_mobile: store.shopkeeper_mobile || "",
      status: store.status || "ACTIVE"
    });
    setFormErrors({});
    setGpsNote("");
    setShowForm(true);
  };

  const validateForm = () => {
    const errs = {};
    // Client is chosen server-side for self-service (no selector shown),
    // and the store code is generated server-side from the client name.
    if (!clientMode && !formData.client_id) errs.client_id = "Client is required.";
    if (!formData.store_name.trim()) errs.store_name = "Store Name is required.";
    const hasLat = String(formData.latitude).trim() !== "";
    const hasLng = String(formData.longitude).trim() !== "";
    if (hasLat !== hasLng) {
      errs.latitude = "Latitude and longitude go together.";
    } else if (hasLat) {
      const lat = Number(formData.latitude);
      const lng = Number(formData.longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) errs.latitude = "Latitude must be -90 to 90.";
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) errs.longitude = "Longitude must be -180 to 180.";
    }
    if (formData.shopkeeper_mobile && formData.shopkeeper_mobile.trim() !== "") {
      const digits = formData.shopkeeper_mobile.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 13) errs.shopkeeper_mobile = "Must be a valid 10-digit number.";
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Fill lat/lng from this device's GPS (store reference location).
  // Manual typing still works; capture just fills both fields at once.
  const handleCaptureGps = async () => {
    setIsCapturingGps(true);
    setGpsNote("");
    try {
      const gps = await getCurrentGps();
      setFormData((prev) => ({
        ...prev,
        latitude: String(Math.round(gps.latitude * 1e7) / 1e7),
        longitude: String(Math.round(gps.longitude * 1e7) / 1e7)
      }));
      setFormErrors((prev) => ({ ...prev, latitude: "", longitude: "" }));
      const acc = gps.accuracy !== null && gps.accuracy !== undefined
        ? ` (±${Math.round(gps.accuracy)} m)`
        : "";
      setGpsNote(`Captured current location${acc}. Verify on the map before saving.`);
      setGpsNoteOk(true);
    } catch (err) {
      setGpsNote(err.message || "GPS unavailable.");
      setGpsNoteOk(false);
    } finally {
      setIsCapturingGps(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const payload = {
        ...formData,
        // Self-service omits client_id entirely: the backend assigns the
        // authenticated organization and ignores any forged value.
        ...(clientMode ? { client_id: undefined } : { client_id: Number(formData.client_id) }),
        store_code: formData.store_code.trim(),
        store_name: formData.store_name.trim()
      };
      if (editing) {
        const res = await StoreService.updateStore(editing.id, payload);
        showAlert("success", res.message || "Store updated.");
      } else {
        const res = await StoreService.createStore(payload);
        showAlert("success", res.message || "Store created.");
      }
      setShowForm(false);
      loadStores(pagination.page);
      if (detail && editing && detail.id === editing.id) {
        const refreshed = await StoreService.getStoreById(editing.id);
        if (refreshed.success) setDetail(refreshed.data);
      }
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Save failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDetail = async (store) => {
    try {
      const res = await StoreService.getStoreById(store.id);
      if (res.success) setDetail(res.data);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Could not load details.");
    }
  };

  const handleDeactivate = async (store) => {
    if (!window.confirm(`Deactivate store "${store.store_name}" (${store.store_code})? Jobs and history stay intact.`)) return;
    try {
      const res = await StoreService.deactivateStore(store.id);
      showAlert("success", res.message || "Deactivated.");
      setDetail(null);
      loadStores(pagination.page);
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Deactivation failed.");
    }
  };

  const goPage = (page) => {
    if (page >= 1 && page <= Math.max(pagination.totalPages, 1)) loadStores(page);
  };

  const set = (name) => (e) => setFormData({ ...formData, [name]: e.target.value });

  if (!canView) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">
          <i className="bi bi-shield-lock me-2"></i>
          Access denied. This page requires permission <strong>{viewPerm}</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>{clientMode ? "My Stores" : "Stores"}</h4>
          <p>{clientMode
            ? `Stores of your organization — ${pagination.total} record(s).`
            : `Store/outlet master — ${pagination.total} record(s). Each store belongs to exactly one client.`}</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={openCreate}>
            <i className="bi bi-plus-lg me-2"></i>Add Store
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
                <input
                  type="text" className="form-control" placeholder="Code, name, outlet, city, keeper..."
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">Client</label>
                {clientMode ? (
                  <input type="text" className="form-control" value="My organization" disabled />
                ) : (
                  <select className="form-select" value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}>
                    <option value="">All</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.client_name} ({c.client_code})</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="col-md-2">
                <label className="form-label">Status</label>
                <select className="form-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">All</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">City</label>
                <input type="text" className="form-control" placeholder="City"
                  value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} />
              </div>
              <div className="col-md-2">
                <label className="form-label">State</label>
                <StateSelect
                  value={filters.state}
                  includeAll
                  allLabel="All"
                  onChange={(v) => setFilters({ ...filters, state: v })}
                />
              </div>
              <div className="col-md-1 d-flex gap-2">
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
                  <th>Store Name</th>
                  {!clientMode && <th>Client</th>}
                  <th>City</th>
                  <th>Shopkeeper</th>
                  <th>Mobile</th>
                  <th>Status</th>
                  <th className="text-end pe-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={clientMode ? 7 : 8} className="text-center py-4"><div className="spinner-border text-primary" role="status"></div></td></tr>
                ) : stores.length === 0 ? (
                  <tr><td colSpan={clientMode ? 7 : 8} className="text-center py-4 text-muted">No stores found.</td></tr>
                ) : (
                  stores.map((store) => (
                    <tr key={store.id}>
                      <td className="ps-3"><span className="badge bg-light text-dark border font-monospace">{store.store_code}</span></td>
                      <td className="fw-semibold">{store.store_name}</td>
                      {!clientMode && <td>{store.client_name} <small className="text-muted">({store.client_code})</small></td>}
                      <td>{store.city || <span className="text-muted fst-italic">N/A</span>}</td>
                      <td>{store.shopkeeper_name || <span className="text-muted fst-italic">N/A</span>}</td>
                      <td>{store.shopkeeper_mobile || <span className="text-muted fst-italic">N/A</span>}</td>
                      <td>
                        {store.status === "ACTIVE"
                          ? <span className="badge-status-active"><i className="bi bi-check-circle-fill me-1"></i>Active</span>
                          : <span className="badge-status-inactive"><i className="bi bi-x-circle-fill me-1"></i>Inactive</span>}
                      </td>
                      <td className="text-end pe-3">
                        <div className="btn-group btn-group-sm">
                          <button className="btn btn-outline-secondary" onClick={() => openDetail(store)} title="View">
                            <i className="bi bi-eye"></i>
                          </button>
                          {canUpdate && (
                            <button className="btn btn-outline-primary" onClick={() => openEdit(store)} title="Edit">
                              <i className="bi bi-pencil"></i>
                            </button>
                          )}
                          {canDeactivate && store.status === "ACTIVE" && (
                            <button className="btn btn-outline-danger" onClick={() => handleDeactivate(store)} title="Deactivate">
                              <i className="bi bi-shop-window"></i>
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
                  <h5 className="client-form-title">{editing ? "Edit Store" : "Store Registration"}</h5>
                  <p className="client-form-subtitle mb-0">Create and manage store/outlet records.</p>
                </div>
                <button type="button" className="btn-close" onClick={() => setShowForm(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body client-form-body">

                  {/* ---- 01 Store Information ----------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-blue">
                      <span className="cs-chip"><i className="bi bi-shop"></i></span>
                      <div>
                        <div className="cs-title">Store Information</div>
                        <div className="cs-subtitle">Basic details of the outlet</div>
                      </div>
                      <span className="cs-number">01</span>
                    </div>
                    <div className="row g-3">
                      {!clientMode && (
                        <div className="col-12">
                          <label className="form-label">Client <span className="text-danger">*</span></label>
                          <select className={`form-select ${formErrors.client_id ? "is-invalid" : ""}`}
                            value={formData.client_id} onChange={set("client_id")} disabled={!!editing}>
                            <option value="">— Select client —</option>
                            {clients.map((c) => (
                              <option key={c.id} value={c.id}>{c.client_name} ({c.client_code})</option>
                            ))}
                          </select>
                          {formErrors.client_id && <div className="invalid-feedback">{formErrors.client_id}</div>}
                          {clients.length === 0 && <small className="text-muted">No active clients available.</small>}
                        </div>
                      )}
                      <div className="col-md-4">
                        <label className="form-label">Store Name <span className="text-danger">*</span></label>
                        <input type="text" className={`form-control ${formErrors.store_name ? "is-invalid" : ""}`}
                          value={formData.store_name} onChange={set("store_name")} placeholder="e.g. Apollo Kolkata #001" />
                        {formErrors.store_name && <div className="invalid-feedback">{formErrors.store_name}</div>}
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Outlet Number</label>
                        <input type="text" className="form-control" value={formData.outlet_number} onChange={set("outlet_number")} placeholder="e.g. 001" />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Status</label>
                        <select className="form-select" value={formData.status} onChange={set("status")}>
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  {/* ---- 02 Address Information --------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-green">
                      <span className="cs-chip"><i className="bi bi-geo-alt"></i></span>
                      <div>
                        <div className="cs-title">Address Information</div>
                        <div className="cs-subtitle">Postal address of the outlet</div>
                      </div>
                      <span className="cs-number">02</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Address Line 1</label>
                        <input type="text" className="form-control" value={formData.address_line_1} onChange={set("address_line_1")} placeholder="Shop no, street, area" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Address Line 2</label>
                        <input type="text" className="form-control" value={formData.address_line_2} onChange={set("address_line_2")} placeholder="Block, locality" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Building</label>
                        <input type="text" className="form-control" value={formData.building_name} onChange={set("building_name")} placeholder="Building / mall name" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Floor</label>
                        <input type="text" className="form-control" value={formData.floor} onChange={set("floor")} placeholder="e.g. Ground / 1st" />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Landmark</label>
                        <input type="text" className="form-control" value={formData.landmark} onChange={set("landmark")} placeholder="Nearest known place" />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">City</label>
                        <input type="text" className="form-control" value={formData.city} onChange={set("city")} placeholder="Enter city" />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">PIN Code</label>
                        <input type="text" className="form-control" value={formData.pincode} onChange={set("pincode")} placeholder="6-digit pincode" maxLength={6} />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">State</label>
                        <StateSelect
                          value={formData.state}
                          placeholder="Select state"
                          onChange={(v) => setFormData({ ...formData, state: v, district: "" })}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">District</label>
                        <DistrictSelect
                          stateName={formData.state}
                          value={formData.district}
                          placeholder="Select district"
                          freeTextPlaceholder="Type district..."
                          onChange={(v) => setFormData({ ...formData, district: v })}
                        />
                      </div>
                    </div>
                  </section>

                  {/* ---- 03 Contact Details ------------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-amber">
                      <span className="cs-chip"><i className="bi bi-person-lines-fill"></i></span>
                      <div>
                        <div className="cs-title">Contact Details</div>
                        <div className="cs-subtitle">Shopkeeper / point of contact</div>
                      </div>
                      <span className="cs-number">03</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Shopkeeper Name</label>
                        <input type="text" className="form-control" value={formData.shopkeeper_name} onChange={set("shopkeeper_name")} placeholder="Enter contact person name" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Mobile</label>
                        <input type="text" inputMode="numeric" className={`form-control ${formErrors.shopkeeper_mobile ? "is-invalid" : ""}`}
                          value={formData.shopkeeper_mobile} onChange={set("shopkeeper_mobile")} maxLength={13} placeholder="Enter 10-digit mobile number" />
                        {formErrors.shopkeeper_mobile && <div className="invalid-feedback">{formErrors.shopkeeper_mobile}</div>}
                      </div>
                    </div>
                  </section>

                  {/* ---- 04 Reference GPS --------------------------------------- */}
                  <section className="client-section">
                    <div className="client-section-header cs-violet">
                      <span className="cs-chip"><i className="bi bi-crosshair"></i></span>
                      <div>
                        <div className="cs-title">Reference GPS Location</div>
                        <div className="cs-subtitle">Coordinates used to validate field visits</div>
                      </div>
                      <span className="cs-number">04</span>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Latitude (-90 to 90)</label>
                        <input type="text" className={`form-control ${formErrors.latitude ? "is-invalid" : ""}`}
                          value={formData.latitude} onChange={set("latitude")} placeholder="e.g. 22.5726000" />
                        {formErrors.latitude && <div className="invalid-feedback">{formErrors.latitude}</div>}
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Longitude (-180 to 180)</label>
                        <input type="text" className={`form-control ${formErrors.longitude ? "is-invalid" : ""}`}
                          value={formData.longitude} onChange={set("longitude")} placeholder="e.g. 88.3639000" />
                        {formErrors.longitude && <div className="invalid-feedback">{formErrors.longitude}</div>}
                      </div>
                      <div className="col-12">
                        <button type="button" className="btn btn-sm btn-outline-primary" disabled={isCapturingGps} onClick={handleCaptureGps}>
                          {isCapturingGps
                            ? (<><span className="spinner-border spinner-border-sm me-2"></span>Locating...</>)
                            : (<><i className="bi bi-geo-alt me-2"></i>Use current location</>)}
                        </button>
                        {gpsNote && <small className={`ms-2 ${gpsNoteOk ? "text-success" : "text-danger"}`}>{gpsNote}</small>}
                        {!gpsNote && <small className="text-muted ms-2">Fills both fields from this device's GPS.</small>}
                      </div>
                    </div>
                  </section>

                </div>
                <div className="client-form-footer">
                  <button type="button" className="btn btn-outline-secondary px-4" onClick={() => setShowForm(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary px-4" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : editing ? "Update Store" : "Save Store"}
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

              {/* Colored header band: title only */}
              <div className="client-form-header">
                <div>
                  <h5 className="client-form-title">Store Details</h5>
                </div>
                <button type="button" className="btn-close" onClick={() => setDetail(null)}></button>
              </div>

              <div className="client-detail-body">

                {/* Identity banner: icon, name, code, status */}
                <div className="client-identity-banner">
                  <div className="client-identity-logo" title="Store">
                    <i className="bi bi-shop"></i>
                  </div>
                  <div className="flex-grow-1 min-width-0">
                    <div className="client-identity-name">{detail.store_name}</div>
                    <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
                      <span className="badge bg-light text-dark border font-monospace">{detail.store_code}</span>
                      {detail.status === "ACTIVE"
                        ? <span className="badge-status-active"><i className="bi bi-check-circle-fill me-1"></i>Active</span>
                        : <span className="badge-status-inactive"><i className="bi bi-x-circle-fill me-1"></i>Inactive</span>}
                    </div>
                  </div>
                </div>

                {/* 01 Store Information */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip blue"><i className="bi bi-shop"></i></span>Store Information</div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="client-detail-label">Client</div>
                      <div className="client-detail-value">{detail.client_name ? `${detail.client_name} (${detail.client_code})` : "—"}</div>
                    </div>
                    <div className="col-md-6">
                      <div className="client-detail-label">Outlet No.</div>
                      <div className="client-detail-value">{detail.outlet_number || "—"}</div>
                    </div>
                  </div>
                </div>

                {/* 02 Address Information */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip green"><i className="bi bi-geo-alt"></i></span>Address Information</div>
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="client-detail-label">Address Line 1</div>
                      <div className="client-detail-value">{detail.address_line_1 || "—"}</div>
                    </div>
                    <div className="col-12">
                      <div className="client-detail-label">Address Line 2</div>
                      <div className="client-detail-value">{detail.address_line_2 || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Building Name</div>
                      <div className="client-detail-value">{detail.building_name || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Floor</div>
                      <div className="client-detail-value">{detail.floor || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Landmark</div>
                      <div className="client-detail-value">{detail.landmark || "—"}</div>
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
                      <div className="client-detail-label">Pincode</div>
                      <div className="client-detail-value">{detail.pincode || "—"}</div>
                    </div>
                    <div className="col-12">
                      <div className="client-detail-label">State</div>
                      <div className="client-detail-value">{detail.state || "—"}</div>
                    </div>
                  </div>
                </div>

                {/* 03 Contact Details */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip amber"><i className="bi bi-person"></i></span>Contact Details</div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="client-detail-label">Shopkeeper Name</div>
                      <div className="client-detail-value">{detail.shopkeeper_name || "—"}</div>
                    </div>
                    <div className="col-md-6">
                      <div className="client-detail-label">Shopkeeper Mobile</div>
                      <div className="client-detail-value">{detail.shopkeeper_mobile || "—"}</div>
                    </div>
                  </div>
                </div>

                {/* 04 Reference GPS */}
                <div className="client-detail-block">
                  <div className="client-detail-block-title"><span className="detail-chip teal"><i className="bi bi-geo"></i></span>Reference GPS</div>
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div className="client-detail-label">Latitude</div>
                      <div className="client-detail-value">{detail.latitude || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Longitude</div>
                      <div className="client-detail-value">{detail.longitude || "—"}</div>
                    </div>
                    <div className="col-md-4">
                      <div className="client-detail-label">Map</div>
                      <div className="client-detail-value">
                        {detail.latitude && detail.longitude
                          ? <a href={`https://www.google.com/maps?q=${detail.latitude},${detail.longitude}`} target="_blank" rel="noreferrer">Open in Google Maps</a>
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-muted small">
                  Created {detail.created_at ? formatIST(detail.created_at) : "—"} · Updated {detail.updated_at ? formatIST(detail.updated_at) : "—"}
                </div>

              </div>
              <div className="client-form-footer">
                <button className="btn btn-outline-secondary px-4" onClick={() => setDetail(null)}>Close</button>
                {canDeactivate && detail.status === "ACTIVE" && (
                  <button className="btn btn-outline-danger px-4" onClick={() => handleDeactivate(detail)}>Deactivate</button>
                )}
                {canUpdate && <button className="btn btn-primary px-4" onClick={() => { setDetail(null); openEdit(detail); }}>Edit</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoreMaster;
