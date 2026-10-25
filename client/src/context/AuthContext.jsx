import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../services/api";

const AuthContext = createContext(null);

// Mirror of backend normalizeRole: legacy 'user' -> 'CLIENT'.
// Keeps every role comparison in the app on the canonical uppercase form.
function normalizeRole(role) {
  if (role === null || role === undefined) return null;
  const upper = String(role).trim().toUpperCase();
  return upper === "USER" ? "CLIENT" : upper;
}

function withNormalizedRole(user) {
  if (!user) return null;
  return { ...user, role: normalizeRole(user.role) };
}

export function AuthProvider({ children }) {
  // Start logged OUT. Only trust localStorage after token is validated
  // with the backend (prevents stale user opening dashboard directly).
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // authorization state: null = not loaded yet (deny-safe:
  // hasPermission/hasMenuAccess return false until loaded).
  const [permissions, setPermissions] = useState(null);
  const [menus, setMenus] = useState(null);

  // Backend is authoritative; this only caches its answers for UX.
  const loadAuthz = useCallback(async () => {
    try {
      const [pm, mn] = await Promise.all([
        api.get("/auth/permissions"),
        api.get("/auth/menu")
      ]);
      setPermissions(pm.data?.permissions || []);
      setMenus(mn.data?.menus || []);
    } catch {
      setPermissions([]);
      setMenus([]);
    }
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    setPermissions(null);
    setMenus(null);
  }, []);

  // On refresh: validate stored token with backend
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      clearAuth();
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((res) => {
        if (res.data?.success) {
          setUser(withNormalizedRole(res.data.user));
          return loadAuthz();
        }
        clearAuth();
      })
      .catch(() => {
        clearAuth();
      })
      .finally(() => setLoading(false));
  }, [clearAuth, loadAuthz]);

  const login = useCallback(async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    if (res.data?.success) {
      const user = withNormalizedRole(res.data.user);
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(user));
      setUser(user);
      await loadAuthz();
      return user;
    }
    throw new Error(res.data?.message || "Login failed");
  }, [loadAuthz]);

  const logout = useCallback(() => {
    clearAuth();
  }, [clearAuth]);

  // Temporary-password state comes from the user context (never the JWT).
  const mustChangePassword = user?.must_change_password === true;

  // Flip the flag locally after a successful self change (backend is
  // already FALSE; avoids a refetch round-trip before entering the app).
  const markPasswordFresh = useCallback(() => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, must_change_password: false };
      try {
        localStorage.setItem("user", JSON.stringify(next));
      } catch { /* storage best-effort */ }
      return next;
    });
  }, []);

  const hasRole = useCallback(
    (...roles) => (user ? roles.map(normalizeRole).includes(user.role) : false),
    [user]
  );

  // Centralized UX helpers (backend permission checks stay mandatory).
  const hasPermission = useCallback(
    (code) => (permissions ? permissions.includes(code) : false),
    [permissions]
  );

  const menuCodes = React.useMemo(() => {
    if (!menus) return null;
    const codes = [];
    const walk = (nodes) => {
      (nodes || []).forEach((m) => {
        codes.push(m.code);
        if (m.children) walk(m.children);
      });
    };
    walk(menus);
    return codes;
  }, [menus]);

  const hasMenuAccess = useCallback(
    (code) => (menuCodes ? menuCodes.includes(code) : false),
    [menuCodes]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasRole, isAuthenticated: !!user, permissions, menus, authzLoading: permissions === null, hasPermission, hasMenuAccess, refreshAuthz: loadAuthz, mustChangePassword, markPasswordFresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
