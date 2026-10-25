// Permission middleware .
// Usage (AFTER verifyToken + requireActiveUser):
//   router.post("/", verifyToken, requireActiveUser,
//     requirePermission("jobs.create"), createJob);
// Semantics: ALL listed codes required (AND). SUPER_ADMIN bypass lives
// in rbacService.hasPermission — never duplicated in controllers.
// 401 = no verified identity (miswired chain); 403 = authenticated but
// not authorized. Never leaks SQL or permission internals.
const { hasPermission } = require("../services/rbacService");

function requirePermission(...codes) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    try {
      for (const code of codes) {
        const ok = await hasPermission(req.user, code);
        if (!ok) {
          return res.status(403).json({ success: false, message: "Forbidden" });
        }
      }
      next();
    } catch (err) {
      console.error("Permission check error:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  };
}

module.exports = { requirePermission };
