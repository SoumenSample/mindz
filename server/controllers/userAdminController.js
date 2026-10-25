/**
 * Admin user-password management (account hardening).
 * POST /api/admin/users/:id/reset-password — SUPER_ADMIN/ADMIN reset an
 * Employee/Client login to a temporary password (flag forced TRUE).
 * Server-controlled: only the password state changes. Role, links,
 * status and permissions are never touched by this endpoint, so it
 * cannot be used for privilege escalation.
 */
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { normalizeRole } = require("../services/authService");
const { validateNewPassword } = require("../utils/passwordPolicy");

// Only Employee/Client logins may be reset through this endpoint.
const RESETTABLE_ROLES = ["EMPLOYEE", "CLIENT"];

exports.resetUserPassword = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { newTemporaryPassword, confirmPassword } = req.body || {};
    if (!newTemporaryPassword || !confirmPassword) {
      conn.release();
      return res.status(400).json({ success: false, message: "New temporary password and confirmation are required." });
    }
    if (newTemporaryPassword !== confirmPassword) {
      conn.release();
      return res.status(400).json({ success: false, message: "Passwords do not match." });
    }
    const policyError = validateNewPassword(newTemporaryPassword);
    if (policyError) {
      conn.release();
      return res.status(400).json({ success: false, message: policyError });
    }

    const [rows] = await conn.query(
      "SELECT id, username, role, status FROM users WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    const target = rows[0];
    if (!target) {
      conn.release();
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (!RESETTABLE_ROLES.includes(normalizeRole(target.role))) {
      conn.release();
      return res.status(403).json({ success: false, message: "Only Employee or Client logins can be reset through this endpoint." });
    }

    const newHash = await bcrypt.hash(newTemporaryPassword, 10);
    await conn.beginTransaction();
    await conn.query(
      "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
      [newHash, target.id]
    );
    const ip = (req.ip || "").slice(0, 45);
    const ua = (req.headers["user-agent"] || "").slice(0, 255);
    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address, user_agent)
       VALUES (?, 'PASSWORD_RESET', 'USER', ?, ?, ?)`,
      [req.user.id, target.id, ip || null, ua || null]
    );
    await conn.commit();
    conn.release();

    // Existing tokens of the target keep verifying, but requireFreshPassword
    // now blocks them from every business API until the temp password is
    // changed — no token store required.
    return res.json({ success: true, message: `Temporary password set for ${target.username}. They must change it on next login.` });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Reset password error:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
