import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const roleLabel = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Administrator",
  EMPLOYEE: "Employee",
  CLIENT: "Client",
  USER: "Client"
};

const initials = (name = "?") =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const Header = ({ sidebarOpen, setSidebarOpen }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="admin-header">
      {/* Left Section */}
      <div className="header-left">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <i className="bi bi-list"></i>
        </button>
        <div className="brand">
          <div className="brand-icon">
            <i className="bi bi-grid-1x2-fill"></i>
          </div>
          <span>Mindzteam</span>
        </div>
      </div>

      {/* Search */}
      <div className="header-search">
        <i className="bi bi-search"></i>
        <input type="text" placeholder="Search..." />
        <span className="search-shortcut">Ctrl K</span>
      </div>

      {/* Right Section */}
      <div className="header-right">
        <button className="header-icon">
          <i className="bi bi-bell"></i>
          <span className="notification-badge">4</span>
        </button>
        <button className="header-icon">
          <i className="bi bi-chat-left-text"></i>
        </button>
        <button className="header-icon desktop-only">
          <i className="bi bi-fullscreen"></i>
        </button>

        {/* User */}
        <div className="user-profile dropdown">
          <button
            className="user-button dropdown-toggle"
            data-bs-toggle="dropdown"
          >
            <div className="user-avatar">{initials(user?.name)}</div>
            <div className="user-info">
              <strong>{user?.name || "Guest"}</strong>
              <small>{roleLabel[user?.role] || user?.role}</small>
            </div>
          </button>
          <ul className="dropdown-menu dropdown-menu-end">
            <li>
              <span className="dropdown-item-text dropdown-item text-muted" style={{ fontSize: 12 }}>
                @{user?.username} · {user?.role}
              </span>
            </li>
            <li>
              <button type="button" className="dropdown-item">
                <i className="bi bi-person me-2"></i>
                Profile
              </button>
            </li>
            <li>
              <button type="button" className="dropdown-item">
                <i className="bi bi-gear me-2"></i>
                Settings
              </button>
            </li>
            <li>
              <a className="dropdown-item" href="/change-password">
                <i className="bi bi-key me-2"></i>
                Change Password
              </a>
            </li>
            <li>
              <hr className="dropdown-divider" />
            </li>
            <li>
              <button className="dropdown-item text-danger" onClick={handleLogout}>
                <i className="bi bi-box-arrow-right me-2"></i>
                Logout
              </button>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
};

export default Header;
