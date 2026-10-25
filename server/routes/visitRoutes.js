/**
 * Visit Routes .
 * GET /api/visits            -> visits.view.all (office monitoring)
 * GET /api/visits/mine       -> scoped self view (controller branches on
 *                               view.all / view.own, mirroring job reads)
 * GET /api/visits/:id        -> scoped detail (foreign rows 404)
 * Every chain is verifyToken -> requireActiveUser -> requireFreshPassword.
 */
const express = require("express");
const router = express.Router();

const visitController = require("../controllers/visitController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

router.get("/", ...authed, requirePermission("visits.view.all"), visitController.getAllVisits);
// Scoped self view (registered before /:id so it is not swallowed).
router.get("/mine", ...authed, visitController.getMyVisits);
router.get("/:id", ...authed, visitController.getVisitById);

module.exports = router;
