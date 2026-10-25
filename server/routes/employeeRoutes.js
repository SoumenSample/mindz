/**
 * Employee Routes 
 * verifyToken -> requireActiveUser -> requirePermission -> controller.
 */
const express = require("express");
const router = express.Router();

const employeeController = require("../controllers/employeeController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const canView = [verifyToken, requireActiveUser, requireFreshPassword, requirePermission("employees.view")];
const canCreate = [verifyToken, requireActiveUser, requireFreshPassword, requirePermission("employees.create")];
const canUpdate = [verifyToken, requireActiveUser, requireFreshPassword, requirePermission("employees.update")];
const canDeactivate = [verifyToken, requireActiveUser, requireFreshPassword, requirePermission("employees.delete")];

router.get("/", ...canView, employeeController.getAllEmployees);
// Master dropdown source (registered before /:id so it is not swallowed).
router.get("/meta/departments", ...canView, employeeController.getDepartments);
router.get("/:id", ...canView, employeeController.getEmployeeById);
router.post("/", ...canCreate, ...[].concat(employeeController.createEmployee));
router.put("/:id", ...canUpdate, ...[].concat(employeeController.updateEmployee));
router.patch("/:id/deactivate", ...canDeactivate, employeeController.deactivateEmployee);
router.post("/:id/login", ...canCreate, employeeController.createEmployeeLogin);

module.exports = router;
