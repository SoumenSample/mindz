/**
 * Measurement Routes  — sheets/items/manual/OCR/finalize.
 * Field writes require jobs.measure + active-assignee ownership
 * (controller-enforced). Reads branch server-side (global / assigned /
 * FINAL-only client). Upload handling mirrors ocrRoutes conventions
 * (disk storage, 10MB, jpg/png); scan temp files are always cleaned.
 */
const express = require("express");
const multer = require("multer");

const router = express.Router();

const measurementController = require("../controllers/measurementController");
const { verifyToken, requireActiveUser, requireFreshPassword } = require("../middleware/auth");
const { requirePermission } = require("../middleware/requirePermission");

const authed = [verifyToken, requireActiveUser, requireFreshPassword];
const canMeasure = [...authed, requirePermission("jobs.measure")];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-mscan-" + file.originalname.replace(/\s+/g, "_");
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, JPEG and PNG images are allowed"));
    }
  }
});

router.get("/:id", ...authed, measurementController.getSheetById);
router.put("/:id", ...canMeasure, measurementController.updateSheet);
router.delete("/:id", ...canMeasure, measurementController.deleteSheet);
router.post("/:id/revise", ...canMeasure, measurementController.reviseSheet);
// Multer errors (wrong type, >10MB) surface as clean 400s here instead
// of the generic error handler (ocrRoutes legacy behavior untouched).
router.post("/:id/ocr", ...canMeasure, (req, res, next) => {
  upload.single("sheet")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || "Invalid image upload." });
    }
    next();
  });
}, measurementController.scanSheet);
router.post("/:id/finalize", ...canMeasure, measurementController.finalizeSheet);

module.exports = router;
