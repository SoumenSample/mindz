import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// database-driven sidebar. The ONLY navigation source is
// GET /api/auth/menu (menu_items + role_menu_access). No hardcoded
// role arrays: anything the backend omits never renders. Hiding is UX
// only; backend requirePermission stays mandatory.
const Sidebar = ({ sidebarOpen, setSidebarOpen, railMode = false }) => {
  const { user, menus } = useAuth();
  const [openMenu, setOpenMenu] = useState(null);
  const location = useLocation();
  const role = user?.role || "CLIENT";

  const toggleMenu = (code) => setOpenMenu(openMenu === code ? null : code);

  const isActive = (path) =>
    path && (location.pathname === path || location.pathname.startsWith(path + "/"));

  // Desktop collapsed state renders the icon-only rail (stateClass
  // "sidebar-rail"); mobile collapse hides the panel entirely.
  const stateClass = sidebarOpen ? "sidebar-open" : railMode ? "sidebar-rail" : "sidebar-closed";

  // Loading: skeleton only — never the old hardcoded menus (no flash
  // where a CLIENT briefly sees ADMIN entries).
  if (menus === null) {
    return (
      <aside className={`admin-sidebar ${stateClass}`}>
        <div className="sidebar-content">
          <div className="menu-title">LOADING MENU</div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="placeholder-glow mb-2"
              style={{ height: 40, borderRadius: 7, background: "#eef0f6" }}
            />
          ))}
        </div>
      </aside>
    );
  }

  // Empty: safe state (Header + Logout still available). Never invent nav.
  // Empty groups (a parent whose children were all revoked for this
  // role) render nothing — no dead expandable entries.
  const visibleRoots = (menus || []).filter(
    (m) => m.path || (m.children && m.children.length > 0)
  );

  if (!menus || menus.length === 0) {
    return (
      <aside className={`admin-sidebar ${stateClass}`}>
        <div className="sidebar-content">
          <div className="menu-title">MENU</div>
          <div className="alert alert-light border small text-muted mb-0">
            <i className="bi bi-info-circle me-1"></i>
            No navigation assigned to this account yet. Contact your administrator.
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`admin-sidebar ${stateClass}`}>
      <div className="sidebar-content">
        <div className="px-2 mb-2">
          <span className="badge bg-primary-subtle text-primary border" style={{ fontSize: 11 }}>
            <i className="bi bi-person-circle me-1"></i>
            {String(role).replace("_", " ").toUpperCase()} · {user?.name}
          </span>
        </div>

        <div className="menu-section">
          {visibleRoots.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            const childActive = hasChildren && item.children.some((c) => isActive(c.path));

            // Group parent (no route of its own): expandable section.
            if (!item.path) {
              const open = openMenu === item.code || childActive;
              return (
                <div key={item.code}>
                  <button
                    className={`menu-item menu-button ${open ? "menu-open" : ""} ${childActive ? "active" : ""}`}
                    title={item.label}
                    onClick={() => toggleMenu(item.code)}
                  >
                    <i className={`bi ${item.icon || "bi-folder"}`}></i>
                    <span>{item.label}</span>
                    <i className="bi bi-chevron-down menu-arrow"></i>
                  </button>
                  {open && (
                    <div className="submenu">
                      {item.children.map((c) => (
                        <Link
                          key={c.code}
                          to={c.path || "/dashboard"}
                          className={isActive(c.path) ? "fw-semibold text-primary" : ""}
                        >
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            // Leaf entry (children, if any, render nested below it).
            return (
              <div key={item.code}>
                <Link
                  to={item.path}
                  title={item.label}
                  className={`menu-item ${isActive(item.path) && item.path === "/dashboard" ? "active" : ""} ${childActive ? "active" : ""}`}
                >
                  <i className={`bi ${item.icon || "bi-circle"}`}></i>
                  <span>{item.label}</span>
                </Link>
                {hasChildren && (
                  <div className="submenu">
                    {item.children.map((c) => (
                      <Link
                        key={c.code}
                        to={c.path || "/dashboard"}
                        className={isActive(c.path) ? "fw-semibold text-primary" : ""}
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
