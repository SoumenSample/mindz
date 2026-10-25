/**
 * RBAC Administration Routes — SUPER_ADMIN only.
 * Chain: verifyToken -> requireActiveUser -> authorizeRoles("super_admin").
 * Role comes from the verified JWT identity; request bodies can never
 * escalate (no role field is trusted anywhere here).
 */
const express = require("express");
const router = express.Router();

const c = require("../controllers/rbacAdminController");
const { verifyToken, requireActiveUser, requireFreshPassword, authorizeRoles } = require("../middleware/auth");

const saOnly = [verifyToken, requireActiveUser, requireFreshPassword, authorizeRoles("super_admin")];

router.get("/roles", ...saOnly, c.listRoles);
router.get("/permissions", ...saOnly, c.listPermissions);
router.get("/roles/:role/permissions", ...saOnly, c.getRolePermissions);
router.put("/roles/:role/permissions", ...saOnly, c.setRolePermissions);

router.get("/users/search", ...saOnly, c.searchUsers);
router.get("/users/:id/context", ...saOnly, c.getUserContext);
router.put("/users/:id/overrides", ...saOnly, c.setUserOverrides);
router.delete("/users/:id/overrides/:code", ...saOnly, c.deleteUserOverride);

router.get("/menu", ...saOnly, c.getFullMenu);
router.get("/roles/:role/menu", ...saOnly, c.getRoleMenu);
router.put("/roles/:role/menu", ...saOnly, c.setRoleMenu);

module.exports = router;
