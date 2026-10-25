import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Usage: <ProtectedRoute allowedRoles={["SUPER_ADMIN","ADMIN"]}><Dashboard/></ProtectedRoute>
// Roles are normalized (legacy 'user' -> 'CLIENT') so any case works.
function normalizeRole(role) {
  if (role === null || role === undefined) return null;
  const upper = String(role).trim().toUpperCase();
  return upper === "USER" ? "CLIENT" : upper;
}

export default function ProtectedRoute({ allowedRoles, permission, anyPermission, allowStalePassword, children }) {
  const { user, loading, authzLoading, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="d-flex vh-100 align-items-center justify-content-center">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Forced password change (account hardening): a flagged user can only
  // reach routes explicitly opting in (the change-password screen).
  if (user.must_change_password === true && !allowStalePassword) {
    return <Navigate to="/change-password" replace />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.map(normalizeRole).includes(normalizeRole(user.role))) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">
          <i className="bi bi-shield-lock me-2"></i>
          Access denied for role <strong>{user.role}</strong>. This page requires: {allowedRoles.join(", ")}.
        </div>
        <a href="/dashboard" className="btn btn-primary">Back to Dashboard</a>
      </div>
    );
  }

  // Optional any-of permission gate (e.g. view.all OR view.own).
  // Same loading discipline as the single-permission gate above.
  const required = permission ? [permission] : Array.isArray(anyPermission) ? anyPermission : [];
  if (required.length > 0) {
    if (authzLoading) {
      return (
        <div className="d-flex vh-100 align-items-center justify-content-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      );
    }
    if (!required.some((code) => hasPermission(code))) {
      return (
        <div className="container mt-5">
          <div className="alert alert-danger">
            <i className="bi bi-shield-lock me-2"></i>
            Access denied. This page requires one of: <strong>{required.join(", ")}</strong>.
          </div>
          <a href="/dashboard" className="btn btn-primary">Back to Dashboard</a>
        </div>
      );
    }
  }

  return children;
}
