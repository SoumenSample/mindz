// RBAC self-read APIs . Every endpoint returns ONLY the
// caller's own effective data; the backend stays authoritative —
// frontend state derived from these responses is UX only.
const { getUserPermissions, getUserMenuTree } = require("../services/rbacService");

// GET /api/auth/permissions -> { success, permissions: [codes] }
async function getMyPermissions(req, res) {
  try {
    const permissions = await getUserPermissions(req.user);
    return res.json({ success: true, permissions });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
}

// GET /api/auth/menu -> { success, menus: [tree] }
async function getMyMenu(req, res) {
  try {
    const menus = await getUserMenuTree(req.user);
    return res.json({ success: true, menus });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
}

module.exports = { getMyPermissions, getMyMenu };
