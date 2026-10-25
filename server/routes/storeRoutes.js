/**
 * Store Routes
 * verifyToken -> requireActiveUser -> requireFreshPassword -> controller.
 * Read endpoints branch internally on stores.view.all (global) vs
 * stores.view.own (forced own-client scope); writes require the manage
 * grants, so EMPLOYEE/CLIENT cannot reach them.
 */
const express = require("express");
const router = express.Router();

const storeController = require("../controllers/storeController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];

router.get("/", ...authed, storeController.getAllStores);
router.get("/:id", ...authed, storeController.getStoreById);
router.post("/", ...authed, requirePermission("stores.create"), storeController.createStore);
router.put("/:id", ...authed, requirePermission("stores.update"), storeController.updateStore);
router.patch("/:id/deactivate", ...authed, requirePermission("stores.delete"), storeController.deactivateStore);

module.exports = router;
