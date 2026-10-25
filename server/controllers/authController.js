const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { JWT_SECRET } = require("../middleware/auth");
const { isActiveStatus, getUserAuthContext } = require("../services/authService");
const { validateNewPassword } = require("../utils/passwordPolicy");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const GENERIC_AUTH_ERROR = "Invalid email or password.";

// POST /api/auth/login  { email, password } (username accepted for backward compat)
// Identity always comes from the DB row — never from request-supplied
// role/client_id/employee_id (those keys are ignored even if sent).
// Unknown email, wrong password and inactive account all return the SAME
// generic 401 so responses never reveal whether an account exists.
async function login(req, res) {
  try {
    const loginId = (req.body.email || req.body.username || "").trim();
    const { password } = req.body;

    if (!loginId || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const [rows] = await pool.query(
      "SELECT id, password_hash, status FROM users WHERE email = ? OR username = ? LIMIT 1",
      [loginId, loginId]
    );

    const ref = rows[0];
    let passwordOk = false;
    if (ref) {
      passwordOk = await bcrypt.compare(password, ref.password_hash);
    }
    if (!ref || !passwordOk || !isActiveStatus(ref.status)) {
      return res.status(401).json({ success: false, message: GENERIC_AUTH_ERROR });
    }

    const user = await getUserAuthContext(ref.id);
    if (!user) {
      return res.status(401).json({ success: false, message: GENERIC_AUTH_ERROR });
    }

    // Minimal JWT: identity only. Permissions/menus/context stay server-side
    // (resolved per request, never embedded in the token).
    const token = jwt.sign(
      { sub: user.id, role: user.role, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      success: true,
      message: "Login successful.",
      token,
      user,
      // Forced-change signal for the login flow. JWT stays identity-only;
      // the flag is read from user context, never embedded in the token.
      mustChangePassword: user.must_change_password === true
    });
  } catch (err) {
    console.error("Login error:", err.message);
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
}

// GET /api/auth/me  (verifyToken + requireActiveUser) — fresh context from DB.
async function getMe(req, res) {
  try {
    const user = await getUserAuthContext(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
}

// POST /api/auth/change-password  { currentPassword, newPassword, confirmPassword }
// Self-service change for forced (temporary-password) and normal cases.
// Guarded by verifyToken (+requireActiveUser) only — it must stay
// reachable while requireFreshPassword blocks everything else. Never
// logs or returns passwords/hashes.
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: "Current, new and confirm passwords are required." });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: "New password and confirmation do not match." });
    }
    const policyError = validateNewPassword(newPassword);
    if (policyError) {
      return res.status(400).json({ success: false, message: policyError });
    }

    const [rows] = await pool.query(
      "SELECT id, password_hash, status FROM users WHERE id = ? LIMIT 1",
      [req.user.id]
    );
    const account = rows[0];
    if (!account || !isActiveStatus(account.status)) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const currentOk = await bcrypt.compare(currentPassword, account.password_hash);
    if (!currentOk) {
      return res.status(400).json({ success: false, message: "Current password is incorrect." });
    }
    const sameAsOld = await bcrypt.compare(newPassword, account.password_hash);
    if (sameAsOld) {
      return res.status(400).json({ success: false, message: "New password must be different from the current password." });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
      [newHash, req.user.id]
    );
    await pool.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id)
       VALUES (?, 'PASSWORD_CHANGED', 'USER', ?)`,
      [req.user.id, req.user.id]
    );

    // Stateless JWT architecture: no server-side session store exists, so
    // no tokens are revoked here. Already-issued tokens keep working, which
    // is safe: the flag is now FALSE, so access is legitimate again. (For
    // admin resets the reverse holds — flag TRUE blocks old tokens via
    // requireFreshPassword immediately.)
    return res.json({ success: true, message: "Password changed successfully." });
  } catch (err) {
    console.error("Change password error:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
}

// GET /api/auth/users (super_admin only, for future access-control screen)
async function listUsers(req, res) {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, username, email, role, status, created_at FROM users ORDER BY id ASC"
    );
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
}

module.exports = { login, getMe, listUsers, changePassword };
