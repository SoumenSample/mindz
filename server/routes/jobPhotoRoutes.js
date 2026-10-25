/**
 * JobPhoto Routes (Module 11) — photo proof evidence.
 * Upload carries jobs.photo.upload; reads branch server-side on
 * visits.view.all (global) vs visits.view.own (assignment/client
 * scoped); delete is SUPER_ADMIN-only inside the controller.
 * Every chain is verifyToken -> requireActiveUser -> requireFreshPassword.
 */
const express = require("express");
const router = express.Router();

const jobPhotoController = require("../controllers/jobPhotoController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

// Scoped collection reads (registered before /:id so they are not swallowed).
router.get("/job/:jobId", ...authed, jobPhotoController.listByJob);
router.get("/visit/:visitId", ...authed, jobPhotoController.listByVisit);
router.post("/upload", ...authed, requirePermission("jobs.photo.upload"), ...jobPhotoController.uploadPhoto);
router.get("/:id/view", ...authed, jobPhotoController.viewPhoto);
router.get("/:id", ...authed, jobPhotoController.getPhoto);
router.delete("/:id", ...authed, jobPhotoController.deletePhoto);

module.exports = router;
