/**
 * RBAC Administration Controller — SUPER_ADMIN only.
 * All routes using this controller MUST be guarded by:
 *   verifyToken -> requireActiveUser -> authorizeRoles("super_admin")
 * (route-level, see rbacAdminRoutes.js). Role is always taken from the
 * verified JWT identity — never from request bodies.
 *
 * Writes use transactions (all-or-nothing) and append to the existing
 * audit_logs table. SUPER_ADMIN's own effective access is global by
 * code bypass and can never be edited here (read-only).
 */
const db = require("../config/db");
const { normalizeRole } = require("../services/authService");
const { getUserPermissions } = require("../services/rbacService");

const SUPER_ADMIN = "SUPER_ADMIN";

async function findRole(code) {
  const normalized = normalizeRole(code);
  const [rows] = await db.query(
    "SELECT id, code, name, description, is_system, is_active FROM roles WHERE code = ? LIMIT 1",
    [normalized]
  );
  return rows[0] || null;
}

async function findPermissionsByCode(codes) {
  if (!codes.length) return [];
  const [rows] = await db.query(
    `SELECT id, code, name, module, description FROM permissions WHERE code IN (${codes.map(() => "?").join(",")})`,
    codes
  );
  return rows;
}

async function findMenusByCode(codes) {
  if (!codes.length) return [];
  const [rows] = await db.query(
    `SELECT id, code, label FROM menu_items WHERE code IN (${codes.map(() => "?").join(",")})`,
    codes
  );
  return rows;
}

function audit(req, conn, { action, entityType, entityId, oldValues, newValues }) {
  const ip = (req.ip || req.connection?.remoteAddress || "").slice(0, 45);
  const ua = (req.headers["user-agent"] || "").slice(0, 255);
  return conn.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id, action, entityType, entityId ?? null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ip || null, ua || null
    ]
  );
}

// GET /api/admin/rbac/roles
exports.listRoles = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, code, name, description, is_system, is_active FROM roles ORDER BY id"
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("RBAC admin listRoles:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/admin/rbac/permissions — full catalog for the matrix UI.
exports.listPermissions = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, code, name, module, description, is_active FROM permissions ORDER BY module, code"
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("RBAC admin listPermissions:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/admin/rbac/roles/:role/permissions
exports.getRolePermissions = async (req, res) => {
  try {
    const role = await findRole(req.params.role);
    if (!role) return res.status(404).json({ success: false, message: "Role not found." });
    if (role.code === SUPER_ADMIN) {
      const [all] = await db.query("SELECT code FROM permissions WHERE is_active = 1 ORDER BY code");
      return res.json({ success: true, role: role.code, readOnly: true, globalAccess: true, granted: all.map((r) => r.code) });
    }
    const [rows] = await db.query(
      `SELECT p.code FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ? ORDER BY p.code`,
      [role.id]
    );
    return res.json({ success: true, role: role.code, readOnly: false, granted: rows.map((r) => r.code) });
  } catch (error) {
    console.error("RBAC admin getRolePermissions:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// PUT /api/admin/rbac/roles/:role/permissions { permissions: [codes] }
exports.setRolePermissions = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const role = await findRole(req.params.role);
    if (!role) { conn.release(); return res.status(404).json({ success: false, message: "Role not found." }); }
    if (role.code === SUPER_ADMIN) {
      conn.release();
      return res.status(400).json({ success: false, message: "SUPER_ADMIN access is global and read-only." });
    }
    const codes = Array.isArray(req.body?.permissions) ? [...new Set(req.body.permissions.map(String))] : null;
    if (!codes) { conn.release(); return res.status(400).json({ success: false, message: "permissions must be an array of permission codes." }); }

    const found = await findPermissionsByCode(codes);
    const unknown = codes.filter((c) => !found.some((f) => f.code === c));
    if (unknown.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: `Unknown permission codes: ${unknown.join(", ")}` });
    }

    const [before] = await conn.query(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.code`,
      [role.id]
    );
    await conn.beginTransaction();
    await conn.query("DELETE FROM role_permissions WHERE role_id = ?", [role.id]);
    for (const p of found) {
      await conn.query("INSERT INTO role_permissions (role_id, permission_id, granted_by) VALUES (?, ?, ?)", [role.id, p.id, req.user.id]);
    }
    await audit(req, conn, {
      action: "RBAC_ROLE_PERMS_UPDATED", entityType: "ROLE", entityId: role.id,
      oldValues: { permissions: before.map((r) => r.code) }, newValues: { permissions: codes.slice().sort() }
    });
    await conn.commit();
    conn.release();
    return res.json({ success: true, message: `Permissions updated for ${role.code}.`, role: role.code, granted: codes.slice().sort() });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("RBAC admin setRolePermissions:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/admin/rbac/users/search?q=
exports.searchUsers = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.status(400).json({ success: false, message: "Search query must be at least 2 characters." });
    const like = `%${q}%`;
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.username, u.email, u.role, u.status,
              d.code AS designation, c.client_name AS client_name
         FROM users u
         LEFT JOIN employees e ON e.id = u.employee_id
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN clients c ON c.id = u.client_id
        WHERE u.username LIKE ? OR u.name LIKE ? OR u.email LIKE ?
        ORDER BY u.id LIMIT 20`,
      [like, like, like]
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("RBAC admin searchUsers:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/admin/rbac/users/:id/context — role + inherited + overrides + effective.
exports.getUserContext = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.username, u.email, u.role, u.status,
              d.code AS designation, c.client_name AS client_name
         FROM users u
         LEFT JOIN employees e ON e.id = u.employee_id
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN clients c ON c.id = u.client_id
        WHERE u.id = ? LIMIT 1`,
      [req.params.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const [inherited] = await db.query(
      `SELECT p.code FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.code = ? ORDER BY p.code`,
      [normalizeRole(user.role)]
    );
    const [overrides] = await db.query(
      `SELECT p.code, o.effect FROM user_permission_overrides o
         JOIN permissions p ON p.id = o.permission_id
        WHERE o.user_id = ? ORDER BY p.code`,
      [user.id]
    );
    const effective = await getUserPermissions({ id: user.id, role: user.role });
    return res.json({
      success: true,
      user,
      inherited: inherited.map((r) => r.code),
      overrides,
      effective
    });
  } catch (error) {
    console.error("RBAC admin getUserContext:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

async function findUser(id) {
  const [rows] = await db.query("SELECT id, name, username, role FROM users WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

// PUT /api/admin/rbac/users/:id/overrides { overrides: [{ permission, effect }] }
exports.setUserOverrides = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const user = await findUser(req.params.id);
    if (!user) { conn.release(); return res.status(404).json({ success: false, message: "User not found." }); }
    if (normalizeRole(user.role) === SUPER_ADMIN) {
      conn.release();
      return res.status(400).json({ success: false, message: "Overrides cannot be managed for SUPER_ADMIN accounts." });
    }
    const list = Array.isArray(req.body?.overrides) ? req.body.overrides : null;
    if (!list) { conn.release(); return res.status(400).json({ success: false, message: "overrides must be an array." }); }
    for (const o of list) {
      if (!o || typeof o.permission !== "string" || !["ALLOW", "DENY"].includes(o.effect)) {
        conn.release();
        return res.status(400).json({ success: false, message: "Each override needs { permission, effect: ALLOW|DENY }." });
      }
    }
    const codes = [...new Set(list.map((o) => o.permission))];
    const found = await findPermissionsByCode(codes);
    const unknown = codes.filter((c) => !found.some((f) => f.code === c));
    if (unknown.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: `Unknown permission codes: ${unknown.join(", ")}` });
    }

    const [before] = await conn.query(
      `SELECT p.code, o.effect FROM user_permission_overrides o
         JOIN permissions p ON p.id = o.permission_id WHERE o.user_id = ? ORDER BY p.code`,
      [user.id]
    );
    await conn.beginTransaction();
    await conn.query("DELETE FROM user_permission_overrides WHERE user_id = ?", [user.id]);
    for (const o of list) {
      const perm = found.find((f) => f.code === o.permission);
      await conn.query(
        "INSERT INTO user_permission_overrides (user_id, permission_id, effect, reason, created_by) VALUES (?, ?, ?, ?, ?)",
        [user.id, perm.id, o.effect, "Managed via Access Control", req.user.id]
      );
    }
    await audit(req, conn, {
      action: "RBAC_OVERRIDE_SET", entityType: "USER", entityId: user.id,
      oldValues: { overrides: before }, newValues: { overrides: list }
    });
    await conn.commit();
    conn.release();
    return res.json({ success: true, message: `Overrides updated for ${user.username}.`, overrides: list });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("RBAC admin setUserOverrides:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// DELETE /api/admin/rbac/users/:id/overrides/:code
exports.deleteUserOverride = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const user = await findUser(req.params.id);
    if (!user) { conn.release(); return res.status(404).json({ success: false, message: "User not found." }); }
    const [perm] = await conn.query("SELECT id, code FROM permissions WHERE code = ? LIMIT 1", [req.params.code]);
    if (!perm[0]) { conn.release(); return res.status(404).json({ success: false, message: "Permission not found." }); }
    await conn.beginTransaction();
    const [result] = await conn.query(
      "DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_id = ?",
      [user.id, perm[0].id]
    );
    await audit(req, conn, {
      action: "RBAC_OVERRIDE_REMOVED", entityType: "USER", entityId: user.id,
      oldValues: { permission: perm[0].code }, newValues: null
    });
    await conn.commit();
    conn.release();
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Override not found." });
    }
    return res.json({ success: true, message: "Override removed." });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("RBAC admin deleteUserOverride:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/admin/rbac/menu — full active tree (ordering/parentage intact).
exports.getFullMenu = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, parent_id AS parentId, code, label, route_path AS path, icon, sort_order AS sortOrder
         FROM menu_items WHERE is_active = 1 ORDER BY sort_order, id`
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("RBAC admin getFullMenu:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/admin/rbac/roles/:role/menu — granted codes (+ readOnly for SA).
exports.getRoleMenu = async (req, res) => {
  try {
    const role = await findRole(req.params.role);
    if (!role) return res.status(404).json({ success: false, message: "Role not found." });
    const [rows] = await db.query(
      `SELECT m.code FROM role_menu_access a
         JOIN menu_items m ON m.id = a.menu_id
        WHERE a.role_id = ? AND a.can_view = 1 AND m.is_active = 1`,
      [role.id]
    );
    return res.json({
      success: true, role: role.code,
      readOnly: role.code === SUPER_ADMIN,
      granted: rows.map((r) => r.code)
    });
  } catch (error) {
    console.error("RBAC admin getRoleMenu:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// PUT /api/admin/rbac/roles/:role/menu { menus: [codes] }
exports.setRoleMenu = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const role = await findRole(req.params.role);
    if (!role) { conn.release(); return res.status(404).json({ success: false, message: "Role not found." }); }
    if (role.code === SUPER_ADMIN) {
      conn.release();
      return res.status(400).json({ success: false, message: "SUPER_ADMIN menu access is global and read-only." });
    }
    const codes = Array.isArray(req.body?.menus) ? [...new Set(req.body.menus.map(String))] : null;
    if (!codes) { conn.release(); return res.status(400).json({ success: false, message: "menus must be an array of menu codes." }); }

    const found = await findMenusByCode(codes);
    const unknown = codes.filter((c) => !found.some((f) => f.code === c));
    if (unknown.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: `Unknown menu codes: ${unknown.join(", ")}` });
    }

    const [before] = await conn.query(
      `SELECT m.code FROM role_menu_access a JOIN menu_items m ON m.id = a.menu_id
        WHERE a.role_id = ? AND a.can_view = 1 ORDER BY m.code`,
      [role.id]
    );
    await conn.beginTransaction();
    await conn.query("DELETE FROM role_menu_access WHERE role_id = ?", [role.id]);
    for (const m of found) {
      await conn.query("INSERT INTO role_menu_access (role_id, menu_id, can_view) VALUES (?, ?, 1)", [role.id, m.id]);
    }
    await audit(req, conn, {
      action: "RBAC_MENU_UPDATED", entityType: "ROLE", entityId: role.id,
      oldValues: { menus: before.map((r) => r.code) }, newValues: { menus: codes.slice().sort() }
    });
    await conn.commit();
    conn.release();
    return res.json({ success: true, message: `Menu access updated for ${role.code}.`, role: role.code, granted: codes.slice().sort() });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("RBAC admin setRoleMenu:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// All handlers are exported inline above (exports.*); module.exports
// already references that same object — nothing more to attach here.
