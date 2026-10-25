/**
 * Report Routes (Module 12.1) — closed-visit Measurement Sheet PDF.
 * Read-only downloads; no mutations anywhere. Every chain is
 * verifyToken -> requireActiveUser -> requireFreshPassword, with
 * record-level scoping inside the controller (global / assigned /
 * own-client, foreign rows 404).
 */
const express = require("express");
const router = express.Router();

const reportController = require("../controllers/reportController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

router.get("/visits/:visitId/measurement-sheet", ...authed, reportController.downloadMeasurementSheet);
router.get("/visits/:visitId/measurement-sheet.xlsx", ...authed, reportController.downloadMeasurementExcel);

module.exports = router;
