import React from "react";
import { useAuth } from "../context/AuthContext";

// clean role-aware placeholder dashboard. Zero-state cards
// only (0 / empty states); NO fabricated statistics, NO business APIs
// (those arrive with their modules). HR mock content removed.
const PLACEHOLDERS = {
  SUPER_ADMIN: [
    { label: "Employees", icon: "bi-people", color: "icon-blue" },
    { label: "Clients", icon: "bi-building", color: "icon-green" },
    { label: "Stores", icon: "bi-shop", color: "icon-orange" },
    { label: "Jobs", icon: "bi-briefcase", color: "icon-purple" },
    { label: "Pending Requests", icon: "bi-inbox", color: "icon-blue" },
    { label: "Verification Queue", icon: "bi-patch-check", color: "icon-green" }
  ],
  ADMIN: [
    { label: "Employees", icon: "bi-people", color: "icon-blue" },
    { label: "Clients", icon: "bi-building", color: "icon-green" },
    { label: "Stores", icon: "bi-shop", color: "icon-orange" },
    { label: "Pending Job Requests", icon: "bi-inbox", color: "icon-purple" },
    { label: "Active Jobs", icon: "bi-briefcase", color: "icon-blue" },
    { label: "Awaiting Verification", icon: "bi-patch-check", color: "icon-green" }
  ],
  EMPLOYEE: [
    { label: "Today's Jobs", icon: "bi-calendar-check", color: "icon-blue" },
    { label: "Assigned Jobs", icon: "bi-list-task", color: "icon-green" },
    { label: "In Progress", icon: "bi-hourglass-split", color: "icon-orange" },
    { label: "Submitted", icon: "bi-send-check", color: "icon-purple" }
  ],
  CLIENT: [
    { label: "My Stores", icon: "bi-shop", color: "icon-blue" },
    { label: "Pending Requests", icon: "bi-inbox", color: "icon-green" },
    { label: "Active Jobs", icon: "bi-briefcase", color: "icon-orange" },
    { label: "Completed Jobs", icon: "bi-check-circle", color: "icon-purple" }
  ]
};

const Content = () => {
  const { user } = useAuth();
  const role = user?.role === "USER" ? "CLIENT" : user?.role || "CLIENT";
  const cards = PLACEHOLDERS[role] || PLACEHOLDERS.CLIENT;

  return (
    <div className="dashboard-content">
      <div className="page-header">
        <div>
          <h4>
            Dashboard{" "}
            <span className="badge bg-primary-subtle text-primary border ms-2" style={{ fontSize: 11 }}>
              {String(role).replace("_", " ").toUpperCase()}
            </span>
          </h4>
          <p>
            Welcome back, {user?.name || "User"}! You are logged in as <strong>{role}</strong>.
          </p>
        </div>
      </div>

      <div className="row g-4">
        {cards.map((c) => (
          <div className="col-xl-3 col-md-6" key={c.label}>
            <div className="stat-card">
              <div className={`stat-icon ${c.color}`}>
                <i className={`bi ${c.icon}`}></i>
              </div>
              <div>
                <span>{c.label}</span>
                <h3>0</h3>
                <small className="text-muted">Live counts arrive with the business modules.</small>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-4 mt-1">
        <div className="col-12">
          <div className="dashboard-card">
            <div className="card-header-custom">
              <div>
                <h5>Getting started</h5>
                <p>Use the sidebar to navigate your workspace.</p>
              </div>
            </div>
            <div className="p-3 text-muted" style={{ fontSize: 14 }}>
              <i className="bi bi-info-circle me-2"></i>
              Job lists, visits, tracking, reports and verification screens will appear here.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Content;
