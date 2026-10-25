/**
 * Client Routes 
 * verifyToken -> requireActiveUser -> requirePermission -> controller.
 * Admin list/detail use the existing granular clients.view.all
 * (no generic clients.view exists by design — see 010 migration).
 */
const express = require("express");
const router = express.Router();

const clientController = require("../controllers/clientController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

// Optional client logo. Accepts multipart AND plain JSON bodies
// (multer passes non-multipart requests straight through), so the
// redesigned form can submit FormData (logo chosen) or JSON (none).
const uploadClientLogo = clientController.uploadClientLogo;

const canView = [verifyToken, requireActiveUser, requireFreshPassword, requirePermission("clients.view.all")];
const canCreate = [verifyToken, requireActiveUser, requireFreshPassword, requirePermission("clients.create")];
const canUpdate = [verifyToken, requireActiveUser, requireFreshPassword, requirePermission("clients.update")];
const canDeactivate = [verifyToken, requireActiveUser, requireFreshPassword, requirePermission("clients.delete")];

router.get("/", ...canView, clientController.getAllClients);
router.get("/:id", ...canView, clientController.getClientById);
router.post("/", ...canCreate, uploadClientLogo, clientController.createClient);
router.put("/:id", ...canUpdate, uploadClientLogo, clientController.updateClient);
router.patch("/:id/deactivate", ...canDeactivate, clientController.deactivateClient);
router.post("/:id/login", ...canCreate, clientController.createClientLogin);

module.exports = router;
