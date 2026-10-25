// Central RBAC service . Single place for permission lookup,
// role-menu resolution and the SUPER_ADMIN bypass. No JWT logic here,
// no permissions inside JWT — callers pass the verified req.user.
// Role strings are always normalized via authService (legacy 'user' OK).
const pool = require("../config/db");
const { normalizeRole } = require("./authService");

// All active permission codes granted to a normalized role.
async function getRolePermissions(role) {
  const normalized = normalizeRole(role);
  const [rows] = await pool.query(
    `SELECT p.code
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.code = ? AND r.is_active = 1 AND p.is_active = 1
      ORDER BY p.code`,
    [normalized]
  );
  return rows.map((r) => r.code);
}

// Effective permissions for a user object ({ id, role }).
// SUPER_ADMIN bypass is central here: allowed even when the grant row
// is absent. Per-user DENY overrides win over role grants.
async function getUserPermissions(user) {
  const role = normalizeRole(user && user.role);
  if (role === "SUPER_ADMIN") {
    const [rows] = await pool.query(
      "SELECT code FROM permissions WHERE is_active = 1 ORDER BY code"
    );
    return rows.map((r) => r.code);
  }
  const codes = await getRolePermissions(role);
  if (!user || user.id === undefined || user.id === null) return codes;
  const [over] = await pool.query(
    `SELECT p.code, o.effect
       FROM user_permission_overrides o
       JOIN permissions p ON p.id = o.permission_id
      WHERE o.user_id = ?`,
    [user.id]
  );
  const denied = new Set(over.filter((o) => o.effect === "DENY").map((o) => o.code));
  const allowed = over.filter((o) => o.effect === "ALLOW").map((o) => o.code);
  return [...new Set([...codes.filter((c) => !denied.has(c)), ...allowed])].sort();
}

// One-shot check used by requirePermission middleware (max 2 cheap,
// indexed queries; SUPER_ADMIN answers without touching the DB).
async function hasPermission(user, code) {
  const role = normalizeRole(user && user.role);
  if (!role || !code) return false;
  if (role === "SUPER_ADMIN") return true;
  if (user && user.id !== undefined && user.id !== null) {
    const [over] = await pool.query(
      `SELECT o.effect
         FROM user_permission_overrides o
         JOIN permissions p ON p.id = o.permission_id
        WHERE o.user_id = ? AND p.code = ? LIMIT 1`,
      [user.id, code]
    );
    if (over[0]) return over[0].effect === "ALLOW";
  }
  const [rows] = await pool.query(
    `SELECT 1 AS ok
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.code = ? AND p.code = ? AND r.is_active = 1 AND p.is_active = 1
      LIMIT 1`,
    [role, code]
  );
  return rows.length > 0;
}

// Menu tree for a normalized role, ordered by sort_order, parents first.
// Shape matches menu_items columns: { id, code, label, path, icon, order, children[] }.
async function getRoleMenuTree(role) {
  const normalized = normalizeRole(role);
  const [rows] = await pool.query(
    `SELECT m.id, m.parent_id AS parentId, m.code, m.label,
            m.route_path AS path, m.icon, m.sort_order AS sortOrder
       FROM role_menu_access a
       JOIN roles r ON r.id = a.role_id
       JOIN menu_items m ON m.id = a.menu_id
      WHERE r.code = ? AND a.can_view = 1 AND m.is_active = 1
      ORDER BY m.sort_order, m.id`,
    [normalized]
  );
  const byId = new Map();
  rows.forEach((m) => byId.set(m.id, { ...m, children: [] }));
  const roots = [];
  byId.forEach((m) => {
    if (m.parentId && byId.has(m.parentId)) byId.get(m.parentId).children.push(m);
    else roots.push(m);
  });
  return roots;
}

// Effective menu tree for a user: role tree plus per-user ALLOW/DENY
// overlays from user_menu_access (DENY prunes, ALLOW adds back).
// SUPER_ADMIN receives the full active tree without needing grant rows.
async function getUserMenuTree(user) {
  const role = normalizeRole(user && user.role);
  const [all] = await pool.query(
    `SELECT m.id, m.parent_id AS parentId, m.code, m.label,
            m.route_path AS path, m.icon, m.sort_order AS sortOrder
       FROM menu_items m WHERE m.is_active = 1 ORDER BY m.sort_order, m.id`
  );
  let visible;
  if (role === "SUPER_ADMIN") {
    visible = new Set(all.map((m) => m.code));
  } else {
    const [rows] = await pool.query(
      `SELECT m.code
         FROM role_menu_access a
         JOIN roles r ON r.id = a.role_id
         JOIN menu_items m ON m.id = a.menu_id
        WHERE r.code = ? AND a.can_view = 1 AND m.is_active = 1`,
      [role]
    );
    visible = new Set(rows.map((r) => r.code));
  }
  if (user && user.id !== undefined && user.id !== null) {
    const [over] = await pool.query(
      `SELECT m.code, o.effect
         FROM user_menu_access o
         JOIN menu_items m ON m.id = o.menu_id
        WHERE o.user_id = ?`,
      [user.id]
    );
    over.forEach((o) => {
      if (o.effect === "DENY") visible.delete(o.code);
      else visible.add(o.code);
    });
  }
  const byId = new Map();
  all.forEach((m) => {
    if (visible.has(m.code)) byId.set(m.id, { ...m, children: [] });
  });
  const roots = [];
  byId.forEach((m) => {
    if (m.parentId && byId.has(m.parentId)) byId.get(m.parentId).children.push(m);
    else roots.push(m);
  });
  return roots;
}

module.exports = {
  getRolePermissions,
  getUserPermissions,
  hasPermission,
  getRoleMenuTree,
  getUserMenuTree
};
