/**
 * Location Master Routes
 * Dropdown data for State -> District selects. Any authenticated,
 * active user with a fresh password may read these (no granular
 * permission — states/districts are shared reference data).
 */
const express = require("express");
const router = express.Router();

const locationMasterController = require("../controllers/locationMasterController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

router.get("/states", ...authed, locationMasterController.getStates);
router.get("/districts", ...authed, locationMasterController.getDistricts);

module.exports = router;
