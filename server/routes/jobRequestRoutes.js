/**
 * Job Request Routes  — requests only, no operational Jobs.
 * Reads branch on view.all (global) vs view.own (forced own client).
 * Writes: create (requests.create), client edit/cancel (update.own /
 * cancel.own), admin accept/reject (requests.review). Every chain is
 * verifyToken -> requireActiveUser -> requireFreshPassword.
 */
const express = require("express");
const router = express.Router();

const jobRequestController = require("../controllers/jobRequestController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

router.get("/", ...authed, jobRequestController.getAllRequests);
// Master dropdown source (registered before /:id so it is not swallowed).
router.get("/meta/job-types", ...authed, jobRequestController.getActiveJobTypes);
router.get("/:id", ...authed, jobRequestController.getRequestById);
router.post("/", ...authed, requirePermission("requests.create"), jobRequestController.createRequest);
router.put("/:id", ...authed, requirePermission("requests.update.own"), jobRequestController.updateRequest);
router.patch("/:id/cancel", ...authed, requirePermission("requests.cancel.own"), jobRequestController.cancelRequest);
router.patch("/:id/accept", ...authed, requirePermission("requests.review"), jobRequestController.acceptRequest);
router.patch("/:id/reject", ...authed, requirePermission("requests.review"), jobRequestController.rejectRequest);

module.exports = router;
