/**
 * Signature Routes (Module 12) — shopkeeper/client acknowledgement.
 * Capture carries visits.manage + a strict active-assignee check inside
 * the controller (no global bypass, not even for admins). Reads branch
 * server-side on visits.view.all (global) vs visits.view.own
 * (assignment/client scoped). No delete/replace routes: evidence is
 * immutable after capture. Every chain is verifyToken ->
 * requireActiveUser -> requireFreshPassword.
 */
const express = require("express");
const router = express.Router();

const signatureController = require("../controllers/signatureController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

// Scoped collection reads (registered before /:id so they are not swallowed).
router.get("/visit/:visitId", ...authed, signatureController.getByVisit);
router.get("/job/:jobId", ...authed, signatureController.listByJob);
router.post("/", ...authed, requirePermission("visits.manage"), ...signatureController.captureSignature);
router.get("/:id/view", ...authed, signatureController.viewSignature);
router.get("/:id", ...authed, signatureController.getSignature);

module.exports = router;
