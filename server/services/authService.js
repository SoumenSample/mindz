// Auth user-context service.
// Single place for role normalization + authenticated-user resolution:
//   users.employee_id -> employees -> designations
//   users.client_id   -> clients
// Legacy DB value role='user' is normalized to 'CLIENT' here only;
// the stored value is never rewritten by this module.
const pool = require("../config/db");

const CANONICAL_ROLES = ["SUPER_ADMIN", "ADMIN", "EMPLOYEE", "CLIENT"];

// normalizeRole('user') === 'CLIENT'; unknown values pass through uppercased
// (they will fail authorization checks, which default to deny).
function normalizeRole(role) {
  if (role === null || role === undefined) return null;
  const upper = String(role).trim().toUpperCase();
  if (upper === "USER") return "CLIENT"; // legacy alias
  return upper;
}

// Existing DB convention: users.status is 'Active' / 'Inactive'.
function isActiveStatus(status) {
  return status === "Active";
}

// Full auth context for one user id. Returns null when the user is gone.
// Only queries employee/client joins when the links exist (cheap single query).
async function getUserAuthContext(userId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.username, u.email, u.role, u.status,
            u.must_change_password,
            e.id AS emp_id, d.code AS designation,
            c.id AS cli_id, c.client_name AS client_name, c.client_code AS client_code
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       LEFT JOIN designations d ON d.id = e.designation_id
       LEFT JOIN clients c ON c.id = u.client_id
      WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: normalizeRole(u.role),
    status: u.status,
    // First-login/temporary-password flag. Deliberately NOT embedded in
    // the JWT (identity-only tokens); read from context / DB instead.
    must_change_password: Number(u.must_change_password) === 1,
    employee: u.emp_id ? { id: u.emp_id, designation: u.designation } : null,
    client: u.cli_id ? { id: u.cli_id, name: u.client_name, code: u.client_code } : null
  };
}

module.exports = { CANONICAL_ROLES, normalizeRole, isActiveStatus, getUserAuthContext };
