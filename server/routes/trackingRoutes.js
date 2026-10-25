/**
 * Tracking Routes— polling only, no sockets.
 * GET /api/tracking/active requires tracking.view (SUPER_ADMIN/ADMIN);
 * CLIENT must never access live tracking (no grant, enforced here).
 * The self endpoints (state/enable/disable/location) are own-device
 * actions: any authenticated login linked to an Active employee may use
 * them; identity always derives from the JWT, never request bodies.
 */
const express = require("express");
const router = express.Router();

const visitController = require("../controllers/visitController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

router.get(
  "/active",
  ...authed,
  requirePermission("tracking.view"),
  visitController.getActiveTracking
);

router.get("/state", ...authed, visitController.getTrackingState);
router.post("/enable", ...authed, visitController.enableTracking);
router.post("/disable", ...authed, visitController.disableTracking);
router.post("/location", ...authed, visitController.postTrackingLocation);

module.exports = router;
