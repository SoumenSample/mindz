const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { normalizeRole, isActiveStatus } = require("../services/authService");

const JWT_SECRET = process.env.JWT_SECRET || "mySuperSecretKey_ChangeMeInProd_2026";

// Verify JWT from Authorization: Bearer <token>.
// Never throws: every failure path returns 401 with a safe message.
// On success attaches minimal identity: req.user = { id, role, email, name }.
// Role is normalized ('user' -> 'CLIENT'); legacy tokens carrying `id`
// instead of `sub` are still accepted (pre-Module-2 compatibility).
function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const parts = header.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  let decoded;
  try {
    decoded = jwt.verify(parts[1], JWT_SECRET);
  } catch (err) {
    if (err && err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Session expired. Please login again." });
    }
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  const id = decoded.sub !== undefined && decoded.sub !== null ? decoded.sub : decoded.id;
  const role = normalizeRole(decoded.role);

  if (!id || !role) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  req.user = { id, role, email: decoded.email, name: decoded.name };
  next();
}

// Forced-password gate: while must_change_password is set, only the
// password-change endpoint (which does NOT use this middleware) and
// logout (client-side) are available. Business APIs answer 403 with a
// machine-readable code. Checked live from the DB so an admin reset
// takes effect on existing tokens immediately (no token store needed).
async function requireFreshPassword(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const [rows] = await pool.query("SELECT must_change_password FROM users WHERE id = ? LIMIT 1", [req.user.id]);
    if (!rows[0]) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (Number(rows[0].must_change_password) === 1) {
      return res.status(403).json({
        success: false,
        message: "Password change required.",
        code: "PASSWORD_CHANGE_REQUIRED"
      });
    }
    next();
  } catch (err) {
    console.error("Fresh-password check error:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
}
async function requireActiveUser(req, res, next) {
  // Database-backed status gate: blocks users deactivated AFTER their
  // token was issued. Applied selectively (e.g. /me); NOT on every
  // request, so the hot path stays stateless.
  try {
    const [rows] = await pool.query("SELECT status FROM users WHERE id = ? LIMIT 1", [req.user.id]);
    if (!rows[0] || !isActiveStatus(rows[0].status)) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    next();
  } catch (err) {
    console.error("Active-user check error:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
}

// Role guard: authorizeRoles('ADMIN', 'SUPER_ADMIN').
// Roles are normalized on both sides; SUPER_ADMIN bypasses role gates.
// (Permission-level enforcement belongs, not here.)
function authorizeRoles(...allowedRoles) {
  const want = allowedRoles.map(normalizeRole);
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (req.user.role === "SUPER_ADMIN") {
      return next();
    }
    if (!want.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied for role '${req.user.role}'.`
      });
    }
    next();
  };
}

module.exports = { verifyToken, requireActiveUser, requireFreshPassword, authorizeRoles, JWT_SECRET };
