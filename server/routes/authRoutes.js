const express = require("express");
const router = express.Router();

const { login, getMe, listUsers, changePassword } = require("../controllers/authController");
const { getMyPermissions, getMyMenu } = require("../controllers/rbacController");
const { verifyToken, requireActiveUser, requireFreshPassword, authorizeRoles } = require("../middleware/auth");

// Public
router.post("/login", login);

// Protected (status re-checked against DB: deactivated users lose access)
router.get("/me", verifyToken, requireActiveUser, getMe);

// Self-service password change: reachable even while the forced-change
// flag is set (it is the only business-adjacent endpoint allowed then).
router.post("/change-password", verifyToken, requireActiveUser, changePassword);

//  self-read APIs: caller's own effective permissions + menu tree
router.get("/permissions", verifyToken, requireActiveUser, requireFreshPassword, getMyPermissions);
router.get("/menu", verifyToken, requireActiveUser, requireFreshPassword, getMyMenu);

// Super-admin only we will be using this later for contrlling users menu
router.get("/users", verifyToken, authorizeRoles("super_admin"), listUsers);

module.exports = router;
