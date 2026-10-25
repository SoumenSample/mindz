import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

/**
 * Access Control — SUPER_ADMIN only (route-guarded).
 * Three tabs: Roles & Permissions | User Overrides | Menu Access.
 * All data comes from /api/admin/rbac/*; every write is transactional
 * server-side and audited. SUPER_ADMIN's own access is global by code
 * bypass and shown read-only so it can never lock itself out.
 */
const TABS = [
  { key: "roles", label: "Roles & Permissions", icon: "bi-key" },
  { key: "users", label: "User Overrides", icon: "bi-person-gear" },
  { key: "menus", label: "Menu Access", icon: "bi-menu-button" }
];

const MANAGEABLE_ROLES = ["ADMIN", "EMPLOYEE", "CLIENT"];

/* ---------------------------------------------------------------------
 * Plain-language permission dictionary.
 * Keyed by the technical permission code; every row in the UI shows the
 * human meaning ("Add new clients") instead of raw codes ("clients.create").
 * Unknown / future codes fall back to the DB name + prettified code.
 * ------------------------------------------------------------------- */
const PERMISSION_LABELS = {
  // USERS
  "users.view":           { label: "See user accounts",       hint: "View the list of staff & client logins" },
  "users.create":         { label: "Create user logins",      hint: "Add new staff or client login accounts" },
  "users.update":         { label: "Edit user accounts",      hint: "Change user details, role or active status" },
  "users.password.reset": { label: "Reset user passwords",    hint: "Issue a temporary password (changed on next login)" },

  // RBAC
  "roles.manage":         { label: "Manage roles",            hint: "Create and administer user roles" },
  "permissions.manage":   { label: "Manage permissions",      hint: "Grant or revoke what each role can do" },
  "menus.manage":         { label: "Manage menu access",      hint: "Control which menu items each role sees" },

  // SYSTEM
  "audit.view":           { label: "See audit logs",          hint: "Read-only trail of who did what, and when" },
  "notifications.view":   { label: "Receive notifications",   hint: "See own notification inbox" },

  // EMPLOYEES
  "employees.view":       { label: "See employees",           hint: "View the employee master list" },
  "employees.create":     { label: "Add employees",           hint: "Add new employee records" },
  "employees.update":     { label: "Edit employees",          hint: "Update employee details" },
  "employees.delete":     { label: "Remove employees",        hint: "Mark employee INACTIVE (records & history kept)" },

  // CLIENTS
  "clients.view.all":     { label: "See all clients",         hint: "View every client's records (office use)" },
  "clients.view.own":     { label: "See own client record",   hint: "Client login sees only its own record" },
  "clients.create":       { label: "Add new clients",         hint: "Register brand / client records" },
  "clients.update":       { label: "Edit client details",     hint: "Change client records" },
  "clients.delete":       { label: "Remove clients",          hint: "Mark client INACTIVE (stores, jobs & history kept)" },

  // STORES
  "stores.view.all":      { label: "See all stores",          hint: "View stores of every client (office use)" },
  "stores.view.own":      { label: "See own stores",          hint: "View only own client's stores" },
  "stores.create":        { label: "Add stores",              hint: "Add store records under a client" },
  "stores.update":        { label: "Edit stores",             hint: "Change store records" },
  "stores.delete":        { label: "Remove stores",           hint: "Mark store INACTIVE (jobs & history kept)" },

  // REQUESTS
  "requests.create":      { label: "Raise job requests",      hint: "Request work for a store (client / office)" },
  "requests.view.all":    { label: "See all job requests",    hint: "Office queue across all clients" },
  "requests.view.own":    { label: "See own job requests",    hint: "View own client's requests" },
  "requests.update.own":  { label: "Edit own job requests",   hint: "Change own pending requests" },
  "requests.cancel.own":  { label: "Cancel own job requests", hint: "Withdraw own pending requests" },
  "requests.review":      { label: "Review job requests",     hint: "Accept / reject requests and convert them to jobs" },

  // JOBS
  "jobs.create":          { label: "Create jobs",             hint: "Open job sheets (incl. Excel import)" },
  "jobs.assign":          { label: "Assign jobs to staff",    hint: "Give jobs to field employees" },
  "jobs.reassign":        { label: "Reassign jobs",           hint: "Move a job to a different employee" },
  "jobs.update":          { label: "Edit jobs",               hint: "Change job fields before field work starts" },
  "jobs.cancel":          { label: "Cancel jobs",             hint: "Soft-close a job before field work starts" },
  "jobs.view.all":        { label: "See all jobs",            hint: "View jobs of every client (office use)" },
  "jobs.view.own":        { label: "See own jobs",            hint: "Jobs assigned to you (staff) / placed by you (client)" },
  "jobs.measure":         { label: "Enter measurements",      hint: "Fill the wall / window measurement form" },
  "jobs.photo.upload":    { label: "Upload job photos",       hint: "Add mandatory live-camera photo sets" },
  "jobs.submit":          { label: "Submit finished jobs",    hint: "Lock the job and send proof to office / client" },
  "jobs.verify":          { label: "Verify / approve jobs",   hint: "Approve or reject a job with a remark" },
  "jobs.report.export":   { label: "Export job reports",      hint: "Download photo-report PDF & billing Excel" },

  // VISITS
  "visits.manage":        { label: "Manage field visits",     hint: "Open / close own visit cycles" },
  "visits.view.all":      { label: "See all visits",          hint: "Office view of visits & tracking evidence" },
  "visits.view.own":      { label: "See own visits",          hint: "Employee: own assigned jobs · Client: own jobs" },

  // TRACKING
  "tracking.view":        { label: "See live tracking",       hint: "Live map of employee locations" },

  // MEASUREMENTS
  "sheets.manage":        { label: "Manage measurement sheets", hint: "Create / confirm measurement sheets & items" },

  // REPORTS
  "reports.view":         { label: "See reports",             hint: "Daily & client-wise report screens" }
};

const MODULE_LABELS = {
  USERS: "Users",
  RBAC: "Roles & Security",
  SYSTEM: "System",
  EMPLOYEES: "Employees",
  CLIENTS: "Clients",
  STORES: "Stores",
  REQUESTS: "Job Requests",
  JOBS: "Jobs",
  VISITS: "Field Visits",
  TRACKING: "Live Tracking",
  MEASUREMENTS: "Measurements",
  REPORTS: "Reports"
};

/* ---------------------------------------------------------------------
 * Plain-language menu descriptions — what each sidebar item opens.
 * ------------------------------------------------------------------- */
const MENU_HINTS = {
  dashboard:      "Home screen with overview stats",
  employees:      "Employee master list",
  "client-list":  "Client master list",
  stores:         "Store master across all clients",
  "my-stores":    "Stores of own client only",
  "job-requests": "Incoming work-request queue",
  jobs:           "Jobs workspace for the office",
  "all-jobs":     "All jobs across clients",
  assignments:    "Assign jobs to field staff",
  verification:   "Approve / reject submitted jobs",
  "my-jobs":      "Own job pipeline for field staff",
  "my-assigned":  "Jobs newly assigned to you",
  "my-inprogress":"Jobs you are working on now",
  "my-submitted": "Jobs you submitted for verification",
  "my-completed": "Your finished jobs",
  "my-visits":    "Your visit calendar & history",
  "live-tracking":"Live map of employee locations",
  reports:        "Reports workspace",
  "daily-report": "Day-wise job activity report",
  "photo-reports":"Photo proof reports per job",
  "billing-export":"Billing / export worksheets",
  notifications:  "Notification inbox",
  system:         "Admin settings area",
  "access-control":"Roles, permissions & user overrides",
  roles:          "Role definitions",
  menus:          "Menu visibility per role",
  "audit-logs":   "Trail of every action in the app",
  masters:        "Master data screens",
  "job-types":    "Job type master",
  departments:    "Department master",
  profile:        "Your account details"
};

/** Plain "where it leads" text for a menu node. */
const menuHint = (n) =>
  MENU_HINTS[n.code] || n.routePath || n.route_path || "Sidebar menu item";

/** Plain label for a permission code (falls back to DB name / prettified code). */const permLabel = (code, cat) => {
  const dict = PERMISSION_LABELS[code];
  if (dict) return dict.label;
  const db = (cat || []).find((p) => p.code === code);
  if (db?.name) return db.name;
  const tail = String(code).split(".").pop().replace(/_/g, " ");
  return tail.charAt(0).toUpperCase() + tail.slice(1);
};

/** Plain "what it allows" text (falls back to DB description). */
const permHint = (code, cat) => {
  const dict = PERMISSION_LABELS[code];
  if (dict) return dict.hint;
  const db = (cat || []).find((p) => p.code === code);
  return db?.description || "";
};

export default function AccessControl() {
  const { refreshAuthz } = useAuth();
  const [tab, setTab] = useState("roles");
  const [notice, setNotice] = useState({ show: false, type: "", message: "" });

  const showNotice = (type, message) => {
    setNotice({ show: true, type, message });
    setTimeout(() => setNotice({ show: false, type: "", message: "" }), 6000);
  };

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>
            Access Control{" "}
            <span className="badge bg-success ms-2" style={{ fontSize: 11 }}>SUPER ADMIN ONLY</span>
          </h4>
          {/* <p>
            Logged in as <strong>{user?.name}</strong> ({user?.role}).
            Changes apply immediately to backend authorization.
          </p> */}
        </div>
      </div>

      {notice.show && (
        <div className={`alert alert-${notice.type} alert-dismissible fade show`} role="alert">
          {notice.message}
          <button type="button" className="btn-close" onClick={() => setNotice({ show: false, type: "", message: "" })}></button>
        </div>
      )}

      <ul className="nav nav-tabs mb-4">
        {TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button className={`nav-link ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
              <i className={`bi ${t.icon} me-2`}></i>{t.label}
            </button>
          </li>
        ))}
      </ul>

      {tab === "roles" && <RolePermissions showNotice={showNotice} refreshAuthz={refreshAuthz} />}
      {tab === "users" && <UserOverrides showNotice={showNotice} />}
      {tab === "menus" && <MenuAccess showNotice={showNotice} refreshAuthz={refreshAuthz} />}
    </div>
  );
}

/* ---------------- Roles & Permissions ---------------- */
function RolePermissions({ showNotice, refreshAuthz }) {
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [role, setRole] = useState("ADMIN");
  const [granted, setGranted] = useState([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.get("/admin/rbac/roles"), api.get("/admin/rbac/permissions")])
      .then(([r, p]) => {
        if (r.data?.success) setRoles(r.data.data);
        if (p.data?.success) setCatalog(p.data.data);
      })
      .catch((e) => showNotice("danger", e.response?.data?.message || "Failed to load RBAC data."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGrants = useCallback((code) => {
    setLoading(true);
    api.get(`/admin/rbac/roles/${code}/permissions`)
      .then((res) => {
        if (res.data?.success) {
          setGranted(res.data.granted);
          setReadOnly(!!res.data.readOnly);
        }
      })
      .catch((e) => showNotice("danger", e.response?.data?.message || "Failed to load grants."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadGrants(role); }, [role, loadGrants]);

  const toggle = (code) => {
    if (readOnly) return;
    setGranted((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/admin/rbac/roles/${role}/permissions`, { permissions: granted });
      showNotice("success", res.data?.message || "Saved.");
      await refreshAuthz();
    } catch (e) {
      showNotice("danger", e.response?.data?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const groups = {};
  catalog.forEach((p) => {
    (groups[p.module] = groups[p.module] || []).push(p);
  });
  const moduleKeys = Object.keys(groups).sort((a, b) =>
    (MODULE_LABELS[a] || a).localeCompare(MODULE_LABELS[b] || b)
  );

  const isOn = (code) => granted.includes(code);
  const moduleOnCount = (mod) => groups[mod].filter((p) => isOn(p.code)).length;
  const enabledCount = granted.length;

  // Snapshot of the server state to detect unsaved edits.
  const [savedSnapshot, setSavedSnapshot] = useState([]);
  useEffect(() => {
    if (!loading) setSavedSnapshot(granted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, role]);
  const dirty = [...granted].sort().join("|") !== [...savedSnapshot].sort().join("|");

  const toggleModule = (mod) => {
    if (readOnly) return;
    const codes = groups[mod].map((p) => p.code);
    const allOn = moduleOnCount(mod) === codes.length;
    setGranted((prev) => {
      const set = new Set(prev);
      codes.forEach((c) => (allOn ? set.delete(c) : set.add(c)));
      return [...set];
    });
  };

  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const matches = (p) =>
    !q ||
    p.code.toLowerCase().includes(q) ||
    permLabel(p.code, catalog).toLowerCase().includes(q) ||
    permHint(p.code, catalog).toLowerCase().includes(q);
  const visibleModules = moduleKeys.filter((mod) => groups[mod].some(matches));

  const discard = () => setGranted(savedSnapshot);

  if (loading && catalog.length === 0) {
    return <div className="text-center py-5"><div className="spinner-border text-primary" role="status"></div></div>;
  }

  return (
    <div className="dashboard-card p-4">
      <style>{`
        .perm-switch .form-check-input { width: 2.7em; height: 1.35em; cursor: pointer; box-shadow: none !important; }
        .perm-switch .form-check-input:checked { background-color: #6366f1; border-color: #6366f1; }
        .perm-switch .form-check-input:disabled { cursor: not-allowed; opacity: .5; }
        .perm-switch .form-check-input.perm-mixed { opacity: .55; }
        .perm-table td { padding-top: .55rem; padding-bottom: .55rem; }
        .perm-table tbody tr.perm-row:hover { background: rgba(99,102,241,.05); }
        .perm-table tr.module-row td {
          background: #f6f7fb; font-weight: 600; font-size: 12px; letter-spacing: .5px;
          text-transform: uppercase; color: #475569; padding: .5rem .75rem;
        }
        .perm-table thead th { background: #2563eb; color: #ffffff !important; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
        .perm-code { font-size: 11px; color: #94a3b8; }
        .perm-hint { font-size: 13px; color: #64748b; }
      `}</style>

      <div className="row g-3 mb-3 align-items-end">
        <div className="col-md-4">
          <label className="form-label">Select Role</label>
          <select className="form-select" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>{r.code}</option>
            ))}
          </select>
        </div>
        <div className="col-md-4">
          <label className="form-label">Filter</label>
          <input
            className="form-control" placeholder="Search permission…" value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="col-md-4 text-md-end">
          <span className="text-muted small">
            <strong className="text-dark">{enabledCount}</strong> of <strong className="text-dark">{catalog.length}</strong> enabled
          </span>{" "}
          {dirty && !readOnly && <span className="badge bg-warning text-dark ms-1">Unsaved changes</span>}
        </div>
      </div>

      {readOnly && (
        <div className="alert alert-info">
          <i className="bi bi-shield-check me-2"></i>
          SUPER_ADMIN has global access by system bypass — shown for reference, editing is disabled so it can never lock itself out.
        </div>
      )}

      <div className="table-responsive perm-table border rounded">
        <table className="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <th style={{ width: "30%" }}>Permission</th>
              <th>What it allows</th>
              <th className="text-center" style={{ width: "120px" }}>Access</th>
            </tr>
          </thead>
          {visibleModules.map((mod) => {
            const rows = groups[mod].filter(matches);
            const on = moduleOnCount(mod);
            const allOn = on === groups[mod].length;
            return (
              <tbody key={mod}>
                <tr className="module-row">
                  <td colSpan={2}>
                    <i className={`bi bi-folder2-open me-2`}></i>
                    {MODULE_LABELS[mod] || mod}
                    <small className="text-muted ms-2 text-lowercase">{on}/{groups[mod].length} on</small>
                  </td>
                  <td className="text-center">
                    <div className="form-check form-switch perm-switch d-inline-block m-0"
                      title={allOn ? "Turn all off in this section" : "Turn all on in this section"}>
                      <input
                        className={`form-check-input ${!allOn && on > 0 ? "perm-mixed" : ""}`}
                        type="checkbox" role="switch"
                        checked={allOn} disabled={readOnly || saving}
                        onChange={() => toggleModule(mod)}
                      />
                    </div>
                  </td>
                </tr>
                {rows.map((p) => (
                  <tr className="perm-row" key={p.code}>
                    <td>
                      <div className="fw-semibold" style={{ fontSize: 14 }}>{permLabel(p.code, catalog)}</div>
                      <code className="perm-code" title={p.code}>{p.code}</code>
                      {readOnly && <span className="badge bg-success-subtle text-success ms-2" style={{ fontSize: 10 }}>Global</span>}
                    </td>
                    <td className="perm-hint">{permHint(p.code, catalog)}</td>
                    <td className="text-center">
                      <div className="form-check form-switch perm-switch d-inline-block m-0">
                        <input
                          className="form-check-input" type="checkbox" role="switch"
                          id={`perm-${p.code}`} checked={isOn(p.code)}
                          disabled={readOnly || saving} onChange={() => toggle(p.code)}
                          title={isOn(p.code) ? "Click to deny" : "Click to allow"}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
          {visibleModules.length === 0 && (
            <tbody><tr><td colSpan={3} className="text-center text-muted py-4">No permissions match “{filter}”.</td></tr></tbody>
          )}
        </table>
      </div>

      {!MANAGEABLE_ROLES.includes(role) && !readOnly && (
        <div className="alert alert-warning mt-3">Only ADMIN, EMPLOYEE and CLIENT grants are manageable here.</div>
      )}
      {!readOnly && (
        <div className="d-flex gap-2 mt-3">
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
          {dirty && (
            <button className="btn btn-outline-secondary" onClick={discard} disabled={saving}>
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- User Overrides ---------------- */
function UserOverrides({ showNotice }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [newPerm, setNewPerm] = useState("");
  const [newEffect, setNewEffect] = useState("DENY");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/admin/rbac/permissions")
      .then((res) => { if (res.data?.success) setCatalog(res.data.data); })
      .catch(() => {});
  }, []);

  const search = async (e) => {
    e.preventDefault();
    if (query.trim().length < 2) {
      showNotice("danger", "Type at least 2 characters to search.");
      return;
    }
    setSearching(true);
    try {
      const res = await api.get(`/admin/rbac/users/search?q=${encodeURIComponent(query.trim())}`);
      if (res.data?.success) setResults(res.data.data);
    } catch (err) {
      showNotice("danger", err.response?.data?.message || "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const openUser = async (u) => {
    try {
      const res = await api.get(`/admin/rbac/users/${u.id}/context`);
      if (res.data?.success) setSelected(res.data);
    } catch (e) {
      showNotice("danger", e.response?.data?.message || "Could not load user.");
    }
  };

  const persist = async (overrides) => {
    setSaving(true);
    try {
      await api.put(`/admin/rbac/users/${selected.user.id}/overrides`, { overrides });
      const res = await api.get(`/admin/rbac/users/${selected.user.id}/context`);
      if (res.data?.success) setSelected(res.data);
      showNotice("success", "Overrides saved. Effective permissions update immediately.");
    } catch (e) {
      showNotice("danger", e.response?.data?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const addOverride = () => {
    if (!newPerm) {
      showNotice("danger", "Choose a permission first.");
      return;
    }
    const next = [...selected.overrides.filter((o) => o.code !== newPerm), { code: newPerm, effect: newEffect }];
    persist(next.map((o) => ({ permission: o.code, effect: o.effect })));
    setNewPerm("");
  };

  const removeOverride = async (code) => {
    setSaving(true);
    try {
      await api.delete(`/admin/rbac/users/${selected.user.id}/overrides/${code}`);
      const res = await api.get(`/admin/rbac/users/${selected.user.id}/context`);
      if (res.data?.success) setSelected(res.data);
      showNotice("success", `Override for “${permLabel(code, catalog)}” removed.`);
    } catch (e) {
      showNotice("danger", e.response?.data?.message || "Remove failed.");
    } finally {
      setSaving(false);
    }
  };

  const inheritedSet = new Set((selected?.inherited || []));
  const overrideMap = {};
  (selected?.overrides || []).forEach((o) => { overrideMap[o.code] = o.effect; });

  const permRowLabel = (code) => {
    const l = permLabel(code, catalog);
    return (
      <span>
        {l} <code className="perm-code ms-1">{code}</code>
      </span>
    );
  };

  return (
    <div className="row g-4">
      <style>{`
        .perm-switch .form-check-input { width: 2.7em; height: 1.35em; cursor: pointer; box-shadow: none !important; }
        .perm-switch .form-check-input:checked { background-color: #6366f1; border-color: #6366f1; }
        .perm-switch .form-check-input:disabled { cursor: not-allowed; opacity: .5; }
        .perm-code { font-size: 11px; color: #94a3b8; }
      `}</style>
      <div className="col-md-4">
        <div className="dashboard-card p-4">
          <h6>Find User</h6>
          <form onSubmit={search} className="d-flex gap-2">
            <input className="form-control" placeholder="name, username, email..." value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn btn-primary" disabled={searching}>{searching ? "..." : <i className="bi bi-search"></i>}</button>
          </form>
          <div className="list-group mt-3">
            {results.map((u) => (
              <button key={u.id} className={`list-group-item list-group-item-action ${selected?.user.id === u.id ? "active" : ""}`} onClick={() => openUser(u)}>
                <strong>{u.name}</strong> <small className="text-muted">@{u.username}</small>
                <span className="badge bg-secondary ms-2">{u.role}</span>
              </button>
            ))}
            {results.length === 0 && <small className="text-muted">No results yet.</small>}
          </div>
        </div>
      </div>
      <div className="col-md-8">
        {!selected ? (
          <div className="dashboard-card p-4 text-muted">Select a user to inspect inherited permissions, explicit overrides and the effective set.</div>
        ) : (
          <div className="dashboard-card p-4">
            <h5>{selected.user.name} <small className="text-muted">@{selected.user.username} · {selected.user.role}{selected.user.designation ? ` · ${selected.user.designation}` : ""}{selected.user.client_name ? ` · ${selected.user.client_name}` : ""}</small></h5>
            <div className="row mt-3">
              <div className="col-md-6">
                <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Explicit Overrides (Deny wins)</h6>
                {selected.overrides.length === 0 && <small className="text-muted">None.</small>}
                {selected.overrides.map((o) => (
                  <div key={o.code} className="d-flex justify-content-between align-items-center border rounded px-2 py-1 mb-1 bg-light">
                    <span><span className="small">{permRowLabel(o.code)}</span> <span className={`badge ${o.effect === "DENY" ? "bg-danger" : "bg-success"} ms-1`}>{o.effect === "DENY" ? "Blocked" : "Allowed"}</span></span>
                    <button className="btn btn-sm btn-link text-danger" disabled={saving} onClick={() => removeOverride(o.code)}><i className="bi bi-x-lg"></i></button>
                  </div>
                ))}
                <div className="d-flex gap-2 mt-3">
                  <select className="form-select form-select-sm" value={newPerm} onChange={(e) => setNewPerm(e.target.value)}>
                    <option value="">Choose permission...</option>
                    {catalog.map((p) => (
                      <option key={p.code} value={p.code}>{permLabel(p.code, catalog)} ({p.code})</option>
                    ))}
                  </select>
                  <select className="form-select form-select-sm" style={{ maxWidth: 110 }} value={newEffect} onChange={(e) => setNewEffect(e.target.value)}>
                    <option value="DENY">Block</option>
                    <option value="ALLOW">Allow</option>
                  </select>
                  <button className="btn btn-sm btn-primary" disabled={saving} onClick={addOverride}>Add</button>
                </div>
              </div>
              <div className="col-md-6">
                <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Effective Permissions ({selected.effective.length})</h6>
                <div style={{ maxHeight: 380, overflowY: "auto" }}>
                  {selected.effective.map((c) => (
                    <div key={c} className="small py-1 border-bottom">
                      {permLabel(c, catalog)}{" "}
                      {overrideMap[c] ? (
                        <span className={`badge ${overrideMap[c] === "DENY" ? "bg-danger" : "bg-success"}`}>{overrideMap[c] === "DENY" ? "blocked" : "allowed"}</span>
                      ) : (
                        <span className="badge bg-secondary">from role</span>
                      )}
                      {!inheritedSet.has(c) && !overrideMap[c] && <span className="badge bg-warning text-dark">global</span>}
                    </div>
                  ))}
                  {selected.effective.length === 0 && <small className="text-muted">No effective permissions.</small>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Menu Access ---------------- */
function MenuAccess({ showNotice, refreshAuthz }) {
  const [roles, setRoles] = useState([]);
  const [role, setRole] = useState("ADMIN");
  const [tree, setTree] = useState([]);
  const [granted, setGranted] = useState([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.get("/admin/rbac/roles"), api.get("/admin/rbac/menu")])
      .then(([r, m]) => {
        if (r.data?.success) setRoles(r.data.data);
        if (m.data?.success) {
          const byId = new Map();
          m.data.data.forEach((x) => byId.set(x.id, { ...x, children: [] }));
          const roots = [];
          byId.forEach((x) => {
            if (x.parentId && byId.has(x.parentId)) byId.get(x.parentId).children.push(x);
            else roots.push(x);
          });
          setTree(roots);
        }
      })
      .catch((e) => showNotice("danger", e.response?.data?.message || "Failed to load menus."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/admin/rbac/roles/${role}/menu`)
      .then((res) => {
        if (res.data?.success) {
          setGranted(res.data.granted);
          setReadOnly(!!res.data.readOnly);
        }
      })
      .catch((e) => showNotice("danger", e.response?.data?.message || "Failed to load role menu."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const toggle = (code, node) => {
    if (readOnly) return;
    // Toggling a parent toggles its whole subtree for speed.
    const codes = [code];
    const walk = (n) => (n.children || []).forEach((c) => { codes.push(c.code); walk(c); });
    walk(node);
    const has = granted.includes(code);
    setGranted((prev) => {
      const set = new Set(prev);
      codes.forEach((c) => (has ? set.delete(c) : set.add(c)));
      return [...set];
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/admin/rbac/roles/${role}/menu`, { menus: granted });
      showNotice("success", res.data?.message || "Saved. GET /api/auth/menu reflects it immediately.");
      await refreshAuthz();
    } catch (e) {
      showNotice("danger", e.response?.data?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const collectCodes = (node, acc = []) => {
    acc.push(node.code);
    (node.children || []).forEach((c) => collectCodes(c, acc));
    return acc;
  };
  const countTree = (nodes) => nodes.reduce((sum, n) => sum + collectCodes(n).length, 0);

  const subtreeOn = (node) => {
    const codes = collectCodes(node);
    return codes.filter((c) => granted.includes(c)).length;
  };

  // Snapshot of the server state to detect unsaved edits.
  const [savedSnapshot, setSavedSnapshot] = useState([]);
  useEffect(() => {
    if (!loading) setSavedSnapshot(granted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, role]);
  const dirty = [...granted].sort().join("|") !== [...savedSnapshot].sort().join("|");
  const discard = () => setGranted(savedSnapshot);

  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const nodeMatches = (n) =>
    !q ||
    n.code.toLowerCase().includes(q) ||
    (n.label || "").toLowerCase().includes(q) ||
    menuHint(n).toLowerCase().includes(q);
  const nodeVisible = (n) => nodeMatches(n) || (n.children || []).some(nodeVisible);

  const menuRow = (node, depth = 0) => (
    <tr className="perm-row" key={node.code}>
      <td>
        <div className="fw-semibold" style={{ fontSize: 14, paddingLeft: depth * 22 }}>
          <i className={`bi ${node.icon || "bi-circle"} me-2 text-primary`}></i>
          {node.label}
        </div>
        <code className="perm-code" style={{ marginLeft: depth * 22 + 26 }} title={node.code}>{node.code}</code>
      </td>
      <td className="perm-hint">
        {menuHint(node)}
        {(node.routePath || node.route_path) && (
          <code className="perm-code d-block" style={{ fontSize: 10.5 }}>{node.routePath || node.route_path}</code>
        )}
      </td>
      <td className="text-center">
        <div className="form-check form-switch perm-switch d-inline-block m-0">
          <input
            className="form-check-input" type="checkbox" role="switch"
            id={`menu-${node.code}`} checked={granted.includes(node.code)}
            disabled={readOnly || saving} onChange={() => toggle(node.code, node)}
            title={granted.includes(node.code) ? "Hide this menu for the role" : "Show this menu for the role"}
          />
        </div>
      </td>
    </tr>
  );

  // A node with children renders as a section header row + its child rows;
  // a leaf renders as a plain row. Mirrors the sidebar structure.
  const menuBlock = (node, depth = 0) => {
    const kids = (node.children || []).filter(nodeVisible);
    if (kids.length === 0 && depth > 0) return [menuRow(node, depth)];
    const on = subtreeOn(node);
    const total = collectCodes(node).length;
    const allOn = on === total;
    const rows = [
      <tr className="module-row" key={`h-${node.code}`}>
        <td>
          <span style={{ paddingLeft: depth * 22 }}>
            <i className={`bi ${node.icon || "bi-folder2-open"} me-2`}></i>
            {node.label}
            <small className="text-muted ms-2 text-lowercase">{on}/{total} on</small>
          </span>
        </td>
        <td className="perm-hint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{menuHint(node)}</td>
        <td className="text-center">
          <div className="form-check form-switch perm-switch d-inline-block m-0"
            title={allOn ? "Hide this menu and everything under it" : "Show this menu and everything under it"}>
            <input
              className={`form-check-input ${!allOn && on > 0 ? "perm-mixed" : ""}`}
              type="checkbox" role="switch"
              checked={allOn} disabled={readOnly || saving}
              onChange={() => toggle(node.code, node)}
            />
          </div>
        </td>
      </tr>
    ];
    kids.forEach((c) => rows.push(...menuBlock(c, depth + 1)));
    return rows;
  };

  if (loading && tree.length === 0) {
    return <div className="text-center py-5"><div className="spinner-border text-primary" role="status"></div></div>;
  }

  const totalMenus = countTree(tree);
  const visibleRoots = tree.filter(nodeVisible);

  return (
    <div className="dashboard-card p-4">
      <style>{`
        .perm-switch .form-check-input { width: 2.7em; height: 1.35em; cursor: pointer; box-shadow: none !important; }
        .perm-switch .form-check-input:checked { background-color: #6366f1; border-color: #6366f1; }
        .perm-switch .form-check-input:disabled { cursor: not-allowed; opacity: .5; }
        .perm-switch .form-check-input.perm-mixed { opacity: .55; }
        .perm-table td { padding-top: .55rem; padding-bottom: .55rem; }
        .perm-table tbody tr.perm-row:hover { background: rgba(99,102,241,.05); }
        .perm-table tr.module-row td {
          background: #f6f7fb; font-weight: 600; font-size: 12px; letter-spacing: .5px;
          text-transform: uppercase; color: #475569; padding: .5rem .75rem;
        }
        .perm-table thead th { background: #2563eb; color: #ffffff !important; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
        .perm-code { font-size: 11px; color: #94a3b8; }
        .perm-hint { font-size: 13px; color: #64748b; }
      `}</style>
      <div className="row g-3 mb-3 align-items-end">
        <div className="col-md-4">
          <label className="form-label">Select Role</label>
          <select className="form-select" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>{r.code}</option>
            ))}
          </select>
        </div>
        <div className="col-md-4">
          <label className="form-label">Filter</label>
          <input
            className="form-control" placeholder="Search menu…" value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="col-md-4 text-md-end">
          <span className="text-muted small">
            <strong className="text-dark">{granted.length}</strong> of <strong className="text-dark">{totalMenus}</strong> enabled
          </span>{" "}
          {dirty && !readOnly && <span className="badge bg-warning text-dark ms-1">Unsaved changes</span>}
        </div>
      </div>
      {readOnly && (
        <div className="alert alert-info">
          <i className="bi bi-shield-check me-2"></i>
          SUPER_ADMIN menu access is global and read-only.
        </div>
      )}
      <div className="table-responsive perm-table border rounded">
        <table className="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <th style={{ width: "38%" }}>Menu</th>
              <th>Where it leads</th>
              <th className="text-center" style={{ width: "120px" }}>Access</th>
            </tr>
          </thead>
          {visibleRoots.map((n) => menuBlock(n))}
          {visibleRoots.length === 0 && (
            <tbody><tr><td colSpan={3} className="text-center text-muted py-4">No menus match “{filter}”.</td></tr></tbody>
          )}
        </table>
      </div>
      {!readOnly && (
        <div className="d-flex gap-2 mt-3">
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
          {dirty && (
            <button className="btn btn-outline-secondary" onClick={discard} disabled={saving}>
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}
