/**
 * Job Routes  — operational jobs + assignment only.
 * No visits / GPS / measurements / photos / signatures / verification.
 * Reads branch on view.all (global) vs view.own (assignment/client
 * scoped); writes carry their manage permission. Every chain is
 * verifyToken -> requireActiveUser -> requireFreshPassword.
 */
const express = require("express");
const router = express.Router();

const jobController = require("../controllers/jobController");
const measurementController = require("../controllers/measurementController");
const visitController = require("../controllers/visitController");
const verificationController = require("../controllers/verificationController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

router.get("/", ...authed, jobController.getAllJobs);
// Eligible-assignee source (registered before /:id so it is not swallowed).
router.get("/meta/field-executives", ...authed, jobController.getEligibleExecutives);
// Module 13 verification (jobs.verify; static path before /:id).
router.get("/verification-queue", ...authed, requirePermission("jobs.verify"), verificationController.getQueue);
router.get("/:id/verification", ...authed, requirePermission("jobs.verify"), verificationController.getDetail);
router.post("/:id/approve", ...authed, requirePermission("jobs.verify"), verificationController.approveJob);
router.post("/:id/reject", ...authed, requirePermission("jobs.verify"), verificationController.rejectJob);
router.get("/:id", ...authed, jobController.getJobById);
router.get("/:id/visits", ...authed, visitController.getJobVisits);
router.post("/", ...authed, requirePermission("jobs.create"), jobController.createJob);
router.post("/from-request/:requestId", ...authed, requirePermission("jobs.create"), jobController.convertRequest);
router.put("/:id", ...authed, requirePermission("jobs.update"), jobController.updateJob);
router.patch("/:id/assign", ...authed, requirePermission("jobs.assign"), jobController.assignJob);
router.patch("/:id/reassign", ...authed, requirePermission("jobs.reassign"), jobController.reassignJob);
router.patch("/:id/cancel", ...authed, requirePermission("jobs.cancel"), jobController.cancelJob);

//  field actions (visits.manage + active-assignee ownership).
router.post("/:id/start-travel", ...authed, requirePermission("visits.manage"), visitController.startTravel);
router.post("/:id/reach-store", ...authed, requirePermission("visits.manage"), visitController.reachStore);
router.post("/:id/location", ...authed, requirePermission("visits.manage"), visitController.postLocation);

// measurements (jobs.measure + active-assignee ownership;
// reads branch server-side for office/assignee/FINAL-only client).
router.post("/:id/start-work", ...authed, requirePermission("visits.manage"), measurementController.startWork);
router.post("/:id/measurement-sheets", ...authed, requirePermission("jobs.measure"), measurementController.createSheet);
router.get("/:id/measurement-sheets", ...authed, measurementController.listSheetsByJob);

// visit closure (visits.manage + active-assignee ownership; the Module 11
// required-photo gate runs inside closeVisit — the only closure path).
router.post("/:id/close-visit", ...authed, requirePermission("visits.manage"), visitController.closeVisit);

module.exports = router;
