/**
 * Admin user account routes (account hardening).
 * verifyToken -> requireActiveUser -> requirePermission(users.password.reset)
 */
const express = require("express");
const router = express.Router();

const { resetUserPassword } = require("../controllers/userAdminController");
const { verifyToken, requireActiveUser } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

router.post(
  "/users/:id/reset-password",
  verifyToken,
  requireActiveUser,
  requirePermission("users.password.reset"),
  resetUserPassword
);

module.exports = router;
