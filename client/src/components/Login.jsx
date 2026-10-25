import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../css/login.css";

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "/dashboard";

  // Demo credentials (must match server/seed.js + server/seed_mindzteam.js)
  const DEMO_CREDENTIALS = {
    admin: { email: "admin@example.com", password: "admin123" },
    client: { email: "contour@example.com", password: "client123" },
    employee: { email: "employee@example.com", password: "emp123" },
  };

  const [demoRole, setDemoRole] = useState("");

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    rememberMe: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === "checkbox" ? checked : value,
    });
    setError("");
    // Manual edit clears the demo selection so it doesn't look stuck
    if ((name === "email" || name === "password") && demoRole) {
      setDemoRole("");
    }
  };

  const handleDemoChange = (e) => {
    const role = e.target.value;
    setDemoRole(role);
    setError("");
    if (role && DEMO_CREDENTIALS[role]) {
      setFormData((prev) => ({
        ...prev,
        email: DEMO_CREDENTIALS[role].email,
        password: DEMO_CREDENTIALS[role].password,
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!formData.password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const loggedInUser = await login(formData.email.trim(), formData.password);
      // Temporary-password accounts must change it before entering the app.
      if (loggedInUser?.must_change_password === true) {
        navigate("/change-password", { replace: true });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Left Section */}
        <div className="login-brand-section">
          <div className="brand-content">
            <div className="brand-logo">
              <i className="bi bi-grid-1x2-fill"></i>
            </div>
            <h1>Mindzteam</h1>
            <p>Enterprise Management System</p>
            <div className="brand-features">
              <div className="brand-feature">
                <i className="bi bi-shield-check"></i>
                <span>Secure & Reliable</span>
              </div>
              <div className="brand-feature">
                <i className="bi bi-speedometer2"></i>
                <span>Powerful Dashboard</span>
              </div>
              <div className="brand-feature">
                <i className="bi bi-phone"></i>
                <span>Fully Responsive</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Section */}
        <div className="login-form-section">
          <div className="login-card">
            <div className="login-header">
              <div className="mobile-logo">
                <div className="mobile-logo-icon">
                  <i className="bi bi-grid-1x2-fill"></i>
                </div>
              </div>
              <h2>Welcome Back!</h2>
              <p>Sign in to access your account</p>
            </div>

            {error && (
              <div className="alert alert-danger login-alert">
                <i className="bi bi-exclamation-circle me-2"></i>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* Demo role */}
              <div className="form-group">
                <label htmlFor="demoRole">Login As</label>
                <div className="input-wrapper">
                  <i className="bi bi-person-badge input-icon"></i>
                  <select
                    id="demoRole"
                    name="demoRole"
                    value={demoRole}
                    onChange={handleDemoChange}
                    className="form-control login-input login-select"
                  >
                    <option value="">Select Role</option>
                    <option value="admin">Admin</option>
                    <option value="client">Client</option>
                    <option value="employee">Employee</option>
                  </select>
                  <i className="bi bi-chevron-down select-arrow"></i>
                </div>
              </div>

              {/* Email */}
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <div className="input-wrapper">
                  <i className="bi bi-envelope input-icon"></i>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="form-control login-input"
                    placeholder="e.g. admin@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="form-group">
                <div className="password-label">
                  <label htmlFor="password">Password</label>
                  <a href="/change-password">Forgot Password?</a>
                </div>
                <div className="input-wrapper">
                  <i className="bi bi-lock input-icon"></i>
                  <input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="form-control login-input password-input"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <i className={showPassword ? "bi bi-eye-slash" : "bi bi-eye"}></i>
                  </button>
                </div>
              </div>

              {/* Remember Me */}
              <div className="login-options">
                <div className="form-check">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    name="rememberMe"
                    checked={formData.rememberMe}
                    onChange={handleChange}
                    className="form-check-input"
                  />
                  <label htmlFor="rememberMe" className="form-check-label">
                    Remember me
                  </label>
                </div>
              </div>

              {/* Login Button */}
              <button type="submit" className="btn login-button" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2"></span>
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <i className="bi bi-arrow-right ms-2"></i>
                  </>
                )}
              </button>
            </form>


            <div className="login-footer">
              <span>© {new Date().getFullYear()} Soumen</span>
              <span className="footer-separator">|</span>
              <a href="/login">Privacy Policy</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
