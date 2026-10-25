import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import "../css/login.css";

/**
 * ChangePassword — serves both the forced first-login flow
 * (must_change_password, no skip allowed) and the normal
 * profile-area change. Same backend endpoint handles both.
 */
const ChangePassword = () => {
  const { user, mustChangePassword, markPasswordFresh } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [show, setShow] = useState({ current: false, next: false, confirm: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.currentPassword || !formData.newPassword || !formData.confirmPassword) {
      setError("All three fields are required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/change-password", {
        currentPassword: formData.currentPassword,
        newPassword: formData.newPassword,
        confirmPassword: formData.confirmPassword
      });
      if (res.data?.success) {
        markPasswordFresh();
        setDone(true);
        setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
      } else {
        setError(res.data?.message || "Password change failed.");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Password change failed.");
    } finally {
      setLoading(false);
    }
  };

  const field = (key, name, label, visible) => (
    <div className="form-group">
      <label htmlFor={name}>{label}</label>
      <div className="input-wrapper">
        <i className="bi bi-lock input-icon"></i>
        <input
          type={visible ? "text" : "password"}
          id={name} name={name} value={formData[name]} onChange={handleChange}
          className="form-control login-input password-input"
          placeholder={label} autoComplete="new-password"
        />
        <button
          type="button" className="password-toggle"
          onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          <i className={visible ? "bi bi-eye-slash" : "bi bi-eye"}></i>
        </button>
      </div>
    </div>
  );

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-brand-section">
          <div className="brand-content">
            <div className="brand-logo"><i className="bi bi-shield-lock"></i></div>
            <h1>Password Security</h1>
            <p>Keep your account protected with a strong password.</p>
            <div className="brand-features">
              <div className="brand-feature"><i className="bi bi-check-circle"></i><span>Minimum 8 characters</span></div>
              <div className="brand-feature"><i className="bi bi-check-circle"></i><span>At least one letter and one number</span></div>
              <div className="brand-feature"><i className="bi bi-check-circle"></i><span>Never share temporary passwords</span></div>
            </div>
          </div>
        </div>
        <div className="login-form-section">
          <div className="login-card">
            <div className="login-header">
              <h2>{mustChangePassword ? "Change Your Password" : "Update Password"}</h2>
              <p>
                {mustChangePassword
                  ? `Hi ${user?.name || ""} — your account has a temporary password. You must change it before continuing.`
                  : "Enter your current password and choose a new one."}
              </p>
            </div>

            {error && (
              <div className="alert alert-danger login-alert">
                <i className="bi bi-exclamation-circle me-2"></i>{error}
              </div>
            )}
            {done && (
              <div className="alert alert-success login-alert">
                <i className="bi bi-check-circle me-2"></i>Password changed. Taking you to the dashboard...
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {field("current", "currentPassword", "Current Password", show.current)}
              {field("next", "newPassword", "New Password", show.next)}
              {field("confirm", "confirmPassword", "Confirm New Password", show.confirm)}
              <button type="submit" className="btn login-button" disabled={loading || done}>
                {loading ? (
                  <span><span className="spinner-border spinner-border-sm me-2"></span>Changing...</span>
                ) : (
                  <span>Change Password<i className="bi bi-arrow-right ms-2"></i></span>
                )}
              </button>
            </form>

            <div className="login-footer">
              <span>Signed in as {user?.email}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChangePassword;
