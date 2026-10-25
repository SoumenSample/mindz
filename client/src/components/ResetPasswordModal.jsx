import React, { useState } from "react";
import api from "../services/api";

/**
 * ResetPasswordModal — shared by Employee Master and Client Master.
 * Admin sets a temporary password (never sees the current one).
 * Requires users.password.reset (backend-enforced); rendered only
 * when the caller already checked hasPermission().
 */
const ResetPasswordModal = ({ userId, username, onClose, onSuccess, onError }) => {
  const [temp, setTemp] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!temp || !confirm) {
      onError("Both password fields are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(`/admin/users/${userId}/reset-password`, {
        newTemporaryPassword: temp,
        confirmPassword: confirm
      });
      if (res.data?.success) {
        onSuccess(res.data.message || "Temporary password set. The user must change it on next login.");
      } else {
        onError(res.data?.message || "Reset failed.");
      }
    } catch (err) {
      onError(err.response?.data?.message || "Reset failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Reset Password — {username}</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <form onSubmit={submit}>
            <div className="modal-body">
              <div className="alert alert-warning py-2 small">
                The current password is never shown. The new temporary password (min 8 chars, letter + number) must be changed at next login.
              </div>
              <div className="mb-2">
                <label className="form-label">New Temporary Password *</label>
                <input type="password" className="form-control" value={temp}
                  onChange={(e) => setTemp(e.target.value)} placeholder="min 8 characters" autoComplete="new-password" />
              </div>
              <div className="mb-2">
                <label className="form-label">Confirm Temporary Password *</label>
                <input type="password" className="form-control" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} placeholder="repeat password" autoComplete="new-password" />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-warning" disabled={saving}>
                {saving ? "Resetting..." : "Reset Password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordModal;
