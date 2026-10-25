/**
 * JobPhoto Controller (Module 11) — photo proof evidence.
 * No measurements / signatures / verification (other modules).
 *
 * Authz (always from JWT identity, never request bodies):
 *   - upload: jobs.photo.upload + (global viewer OR ACTIVE assignee of
 *     the job) + visit in an uploadable state + job not terminal
 *   - reads: visits.view.all (global) vs visits.view.own (assignment /
 *     client scoped), foreign rows 404
 *   - delete: SUPER_ADMIN only, audited, files removed best-effort
 *
 * Storage: uploads/job_photos/job_<id>/visit_<vid>/<uuid>.<ext>.
 * Original filenames are records only — never stored names, never
 * served. /uploads/job_photos is walled off from the public static
 * mount in app.js; reads go through the authenticated view endpoint.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");

const db = require("../config/db");
const JobPhoto = require("../models/jobPhotoModel");
const { hasPermission } = require("../services/rbacService");

const UPLOAD_TYPES = [
  "BEFORE_INSTALLATION",
  "AFTER_INSTALLATION",
  "CLOSEUP",
  "FAR_VIEW",
  "MEASUREMENT_ITEM"
];
const UPLOADABLE_VISIT_STATUSES = ["OPEN", "REACHED", "WORK_IN_PROGRESS", "SIGNATURE_PENDING"];
const TERMINAL_JOB_STATUSES = ["CANCELLED", "COMPLETED", "APPROVED"];
const MAX_BYTES = 10 * 1024 * 1024; // consistent with OCR/measurement uploads
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const EXT_BY_MIME = { "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

// ---- multer (memory -> sharp validates -> final file written) ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(String(file.originalname || "").toLowerCase());
    if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.includes(ext)) {
      return cb(null, true);
    }
    cb(new Error("Only JPG, JPEG, PNG and WEBP images up to 10 MB are allowed."));
  }
});

// Wrap multer so type/size errors surface as clean 400s (never stack traces).
function uploadSingle(req, res, next) {
  upload.single("photo")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || "Invalid image upload." });
    }
    next();
  });
}

function audit(req, conn, { action, entityType, entityId, oldValues, newValues }) {
  const ip = (req.ip || "").slice(0, 45);
  const ua = (req.headers["user-agent"] || "").slice(0, 255);
  const q = (conn || db).query.bind(conn || db);
  return q(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id, action, entityType, entityId ?? null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ip || null, ua || null
    ]
  );
}

function validId(value) {
  return /^\d+$/.test(String(value));
}

// The caller's ACTIVE assignment on this job (or null). Forged ids ignored.
async function activeAssignmentFor(jobId, userId, conn) {
  const q = (conn || db).query.bind(conn || db);
  const [rows] = await q(
    `SELECT a.id AS assignment_id, a.employee_id
       FROM job_assignments a
       JOIN users u ON u.employee_id = a.employee_id
      WHERE a.job_id = ? AND a.status = 'ACTIVE' AND u.id = ? LIMIT 1`,
    [jobId, userId]
  );
  return rows[0] || null;
}

// Read scope: { global } | { employeeId } | { clientId } | { denied }.
async function photoReadScope(req) {
  if (await hasPermission(req.user, "visits.view.all")) return { global: true };
  if (!(await hasPermission(req.user, "visits.view.own"))) return { denied: true };
  const [[row]] = await db.query("SELECT employee_id, client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  if (!row) return { denied: true };
  if (row.employee_id !== null) return { employeeId: Number(row.employee_id) };
  if (row.client_id !== null) return { clientId: Number(row.client_id) };
  return { denied: true };
}

// Scope predicate for one photo row (already joined with job/visit).
// Returns true when visible, false when it must 404.
async function photoVisible(scope, photo) {
  if (scope.global) return true;
  if (scope.employeeId !== undefined) {
    const [rows] = await db.query(
      "SELECT 1 AS ok FROM job_assignments WHERE job_id = ? AND employee_id = ? AND status IN ('ACTIVE','COMPLETED') LIMIT 1",
      [photo.job_id, scope.employeeId]
    );
    return !!rows[0];
  }
  if (scope.clientId !== undefined) {
    return Number(photo.client_id) === scope.clientId;
  }
  return false;
}

// Client-safe shape: no filesystem paths, no uploader internals.
function shapePhoto(row, { forClient }) {
  const out = {
    id: row.id,
    job_id: row.job_id,
    visit_id: row.visit_id,
    visit_number: row.visit_number ?? null,
    measurement_item_id: row.measurement_item_id,
    item_sequence_no: row.item_sequence_no ?? null,
    photo_type: row.photo_type,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes,
    original_filename: row.original_filename,
    latitude: row.latitude,
    longitude: row.longitude,
    captured_at: row.captured_at,
    created_at: row.created_at,
    watermark_applied: Number(row.watermark_applied) === 1,
    is_live_camera: Number(row.is_live_camera) === 1,
    view_url: `/api/job-photos/${row.id}/view`
  };
  if (!forClient) {
    out.uploaded_by = row.uploaded_by;
    out.uploader_name = row.uploader_name || null;
  }
  return out;
}

function validateOptionalGps(latitude, longitude) {
  if ((latitude === undefined || latitude === null || String(latitude).trim() === "") &&
      (longitude === undefined || longitude === null || String(longitude).trim() === "")) {
    return { errors: [], lat: null, lng: null };
  }
  const errors = [];
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push("Latitude must be between -90 and 90.");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push("Longitude must be between -180 and 180.");
  return { errors, lat: errors.length ? null : lat, lng: errors.length ? null : lng };
}

function validateOptionalCapturedAt(value) {
  if (value === undefined || value === null || String(value).trim() === "") return { ok: true, value: null };
  const d = new Date(String(value).trim());
  if (Number.isNaN(d.getTime())) return { ok: false, message: "captured_at must be a valid ISO timestamp." };
  if (d.getTime() - Date.now() > 5 * 60 * 1000) return { ok: false, message: "captured_at cannot be in the future." };
  return { ok: true, value: d.toISOString().slice(0, 19).replace("T", " ") };
}

// POST /api/job-photos/upload (multipart: photo + job_id + visit_id +
// photo_type [+ measurement_item_id] [+ latitude/longitude/captured_at])
exports.uploadPhoto = [
  uploadSingle,
  async (req, res) => {
    const conn = await db.getConnection();
    try {
      if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        conn.release();
        return res.status(400).json({ success: false, message: "Photo file is required (field 'photo')." });
      }
      const { job_id, visit_id, photo_type, measurement_item_id } = req.body || {};
      if (!validId(job_id) || !validId(visit_id)) {
        conn.release();
        return res.status(400).json({ success: false, message: "Valid job_id and visit_id are required." });
      }
      if (!UPLOAD_TYPES.includes(photo_type)) {
        conn.release();
        return res.status(400).json({
          success: false,
          message: "photo_type must be BEFORE_INSTALLATION, AFTER_INSTALLATION, CLOSEUP, FAR_VIEW or MEASUREMENT_ITEM."
        });
      }
      const jobId = Number(job_id);
      const visitId = Number(visit_id);

      // Job + visit existence and ownership (SQL-validated, never trusted).
      const [[job]] = await conn.query("SELECT id, job_number, status FROM jobs WHERE id = ? LIMIT 1", [jobId]);
      if (!job) {
        conn.release();
        return res.status(404).json({ success: false, message: "Job not found." });
      }
      const [[visit]] = await conn.query("SELECT id, job_id, visit_number, status FROM job_visits WHERE id = ? LIMIT 1", [visitId]);
      if (!visit || Number(visit.job_id) !== jobId) {
        conn.release();
        return res.status(404).json({ success: false, message: "Visit not found for this job." });
      }
      if (TERMINAL_JOB_STATUSES.includes(job.status)) {
        conn.release();
        return res.status(409).json({ success: false, message: `Photos cannot be added while the job is ${job.status}.` });
      }
      if (!UPLOADABLE_VISIT_STATUSES.includes(visit.status)) {
        conn.release();
        return res.status(409).json({
          success: false,
          message: `Photos can be added while the visit is OPEN, REACHED, WORK_IN_PROGRESS or SIGNATURE_PENDING (current: ${visit.status}).`,
          code: "VISIT_NOT_UPLOADABLE"
        });
      }

      // Uploader authorization: global viewers (ADMIN/SUPER_ADMIN) may
      // upload operationally; everyone else needs the ACTIVE assignment.
      const global = await hasPermission(req.user, "visits.view.all");
      let mine = null;
      if (!global) {
        mine = await activeAssignmentFor(jobId, req.user.id, conn);
        if (!mine) {
          conn.release();
          return res.status(403).json({ success: false, message: "Only the currently assigned Field Executive can upload photos for this job." });
        }
      }

      // Measurement-item ownership chain: item -> sheet -> same job+visit.
      let itemId = null;
      if (photo_type === "MEASUREMENT_ITEM") {
        if (!validId(measurement_item_id)) {
          conn.release();
          return res.status(400).json({ success: false, message: "measurement_item_id is required for MEASUREMENT_ITEM photos." });
        }
        const [[item]] = await conn.query(
          `SELECT mi.id, ms.job_id, ms.visit_id
             FROM measurement_items mi
             JOIN measurement_sheets ms ON ms.id = mi.measurement_sheet_id
            WHERE mi.id = ? LIMIT 1`,
          [Number(measurement_item_id)]
        );
        if (!item || Number(item.job_id) !== jobId ||
            (item.visit_id !== null && Number(item.visit_id) !== visitId)) {
          conn.release();
          return res.status(404).json({ success: false, message: "Measurement item not found for this job and visit." });
        }
        itemId = Number(measurement_item_id);
      }

      const gps = validateOptionalGps(req.body.latitude, req.body.longitude);
      if (gps.errors.length > 0) {
        conn.release();
        return res.status(400).json({ success: false, message: gps.errors.join(" ") });
      }
      const ts = validateOptionalCapturedAt(req.body.captured_at);
      if (!ts.ok) {
        conn.release();
        return res.status(400).json({ success: false, message: ts.message });
      }

      // Real image validation (never trust browser MIME alone): sharp
      // parses the actual bytes — malformed content throws here.
      let meta;
      try {
        meta = await sharp(req.file.buffer).metadata();
      } catch (_) {
        conn.release();
        return res.status(400).json({ success: false, message: "File is not a valid image." });
      }
      if (!meta || !meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
        conn.release();
        return res.status(400).json({ success: false, message: "Only JPG, JPEG, PNG and WEBP images are allowed." });
      }

      // Duplicate-tap guard: identical bytes for the same visit+type+item
      // within 2 minutes return the existing row (no duplicate stored).
      const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const dup = await JobPhoto.recentDuplicate({ visitId, photoType: photo_type, measurementItemId: itemId, sha256 }, conn);
      if (dup) {
        const existing = await JobPhoto.getById(dup.id, conn);
        conn.release();
        return res.status(200).json({ success: true, message: "Photo already uploaded.", duplicate: true, data: shapePhoto(existing, { forClient: false }) });
      }

      // Normalized display copy (EXIF-rotated, metadata stripped by
      // default, aspect preserved). The normalized file IS the evidence
      // file — no second copy, no content alteration beyond orientation.
      const ext = EXT_BY_MIME[req.file.mimetype] || ".jpg";
      const fileName = `${crypto.randomUUID()}${ext}`;
      const dir = path.join("uploads", "job_photos", `job_${jobId}`, `visit_${visitId}`);
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, fileName);
      let pipeline = sharp(req.file.buffer).rotate();
      if (ext === ".png") pipeline = pipeline.png({ compressionLevel: 8 });
      else if (ext === ".webp") pipeline = pipeline.webp({ quality: 82 });
      else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
      await pipeline.toFile(filePath);

      const originalName = path.basename(String(req.file.originalname || "photo")).slice(0, 255);
      await conn.beginTransaction();
      let photoId;
      try {
        photoId = await JobPhoto.insert({
          jobId, visitId, measurementItemId: itemId, photoType: photo_type,
          filePath, fileUrl: null, originalFilename: originalName, sha256,
          mimeType: req.file.mimetype, fileSize: req.file.buffer.length,
          uploadedBy: req.user.id,
          latitude: gps.lat, longitude: gps.lng, capturedAt: ts.value,
          isLiveCamera: req.body.is_live_camera === undefined ? true : String(req.body.is_live_camera) !== "0" && String(req.body.is_live_camera).toLowerCase() !== "false"
        }, conn);
        await audit(req, conn, {
          action: "JOB_PHOTO_UPLOADED", entityType: "JOB_PHOTO", entityId: photoId,
          oldValues: null,
          newValues: { job_id: jobId, visit_id: visitId, photo_type, measurement_item_id: itemId, mime_type: req.file.mimetype, file_size_bytes: req.file.buffer.length, original_filename: originalName }
        });
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        // Failed DB write must not leave an orphaned evidence file.
        await fs.promises.unlink(filePath).catch(() => {});
        throw err;
      }
      conn.release();

      const row = await JobPhoto.getById(photoId);
      return res.status(201).json({ success: true, message: "Photo uploaded.", data: shapePhoto(row, { forClient: false }) });
    } catch (error) {
      try { await conn.rollback(); } catch (_) { /* noop */ }
      conn.release();
      console.error("Error uploading job photo:", error.message);
      return res.status(500).json({ success: false, message: "Server error while uploading photo." });
    }
  }
];

// GET /api/job-photos/job/:jobId
exports.listByJob = async (req, res) => {
  try {
    if (!validId(req.params.jobId)) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const scope = await photoReadScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const jobId = Number(req.params.jobId);
    const [[job]] = await db.query("SELECT id, client_id FROM jobs WHERE id = ? LIMIT 1", [jobId]);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    if (scope.employeeId !== undefined) {
      const [rows] = await db.query(
        "SELECT 1 AS ok FROM job_assignments WHERE job_id = ? AND employee_id = ? AND status IN ('ACTIVE','COMPLETED') LIMIT 1",
        [jobId, scope.employeeId]
      );
      if (!rows[0]) {
        return res.status(404).json({ success: false, message: "Job not found." });
      }
    } else if (scope.clientId !== undefined && Number(job.client_id) !== scope.clientId) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const rows = await JobPhoto.listByJob(jobId);
    const forClient = scope.clientId !== undefined;
    return res.status(200).json({ success: true, data: rows.map((r) => shapePhoto(r, { forClient })) });
  } catch (error) {
    console.error("Error listing job photos:", error.message);
    return res.status(500).json({ success: false, message: "Server error while listing photos." });
  }
};

// GET /api/job-photos/visit/:visitId
exports.listByVisit = async (req, res) => {
  try {
    if (!validId(req.params.visitId)) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }
    const scope = await photoReadScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const visitId = Number(req.params.visitId);
    const [[visit]] = await db.query(
      "SELECT v.id, v.job_id, j.client_id FROM job_visits v JOIN jobs j ON j.id = v.job_id WHERE v.id = ? LIMIT 1",
      [visitId]
    );
    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }
    if (scope.employeeId !== undefined) {
      const [rows] = await db.query(
        "SELECT 1 AS ok FROM job_assignments WHERE job_id = ? AND employee_id = ? AND status IN ('ACTIVE','COMPLETED') LIMIT 1",
        [visit.job_id, scope.employeeId]
      );
      if (!rows[0]) {
        return res.status(404).json({ success: false, message: "Visit not found." });
      }
    } else if (scope.clientId !== undefined && Number(visit.client_id) !== scope.clientId) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }
    const rows = await JobPhoto.listByVisit(visitId);
    const forClient = scope.clientId !== undefined;
    return res.status(200).json({ success: true, data: rows.map((r) => shapePhoto(r, { forClient })) });
  } catch (error) {
    console.error("Error listing visit photos:", error.message);
    return res.status(500).json({ success: false, message: "Server error while listing photos." });
  }
};

// GET /api/job-photos/:id (metadata; image itself via :id/view)
exports.getPhoto = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    const scope = await photoReadScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const internal = await JobPhoto.getInternalById(Number(req.params.id));
    if (!internal || !(await photoVisible(scope, internal))) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    const row = await JobPhoto.getById(Number(req.params.id));
    return res.status(200).json({ success: true, data: shapePhoto(row, { forClient: scope.clientId !== undefined }) });
  } catch (error) {
    console.error("Error fetching job photo:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching photo." });
  }
};

// GET /api/job-photos/:id/view — authenticated image bytes (same checks).
exports.viewPhoto = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    const scope = await photoReadScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const internal = await JobPhoto.getInternalById(Number(req.params.id));
    if (!internal || !(await photoVisible(scope, internal))) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    const abs = path.resolve(String(internal.file_path));
    const root = path.resolve("uploads", "job_photos");
    if (!abs.startsWith(root + path.sep)) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    return res.sendFile(abs, { headers: { "Content-Type": internal.mime_type || "image/jpeg" } }, (err) => {
      if (err && !res.headersSent) {
        return res.status(404).json({ success: false, message: "Photo file unavailable." });
      }
    });
  } catch (error) {
    console.error("Error viewing job photo:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: "Server error while viewing photo." });
    }
  }
};

// DELETE /api/job-photos/:id — SUPER_ADMIN evidence correction only.
// Employees can never delete; every deletion is audited and files are
// removed with the row (no orphaned/private leftovers).
exports.deletePhoto = async (req, res) => {
  const conn = await db.getConnection();
  try {
    if (!validId(req.params.id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    if (String(req.user.role || "").toLowerCase() !== "super_admin") {
      conn.release();
      return res.status(403).json({ success: false, message: "Only SUPER_ADMIN can delete photo evidence." });
    }
    const internal = await JobPhoto.getInternalById(Number(req.params.id), conn);
    if (!internal) {
      conn.release();
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    await conn.beginTransaction();
    const removed = await JobPhoto.deleteById(Number(req.params.id), conn);
    if (!removed) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    await audit(req, conn, {
      action: "JOB_PHOTO_DELETED", entityType: "JOB_PHOTO", entityId: Number(req.params.id),
      oldValues: { job_id: internal.job_id, visit_id: internal.visit_id, photo_type: internal.photo_type, measurement_item_id: internal.measurement_item_id, mime_type: internal.mime_type, file_size_bytes: internal.file_size_bytes, original_filename: internal.original_filename },
      newValues: null
    });
    await conn.commit();
    conn.release();
    // Physical cleanup is best-effort AFTER the commit (a failed unlink
    // never resurrects the DB row; the file is uuid-named and unwalled).
    const abs = path.resolve(String(internal.file_path));
    const root = path.resolve("uploads", "job_photos");
    if (abs.startsWith(root + path.sep)) {
      await fs.promises.unlink(abs).catch(() => {});
    }
    return res.status(200).json({ success: true, message: "Photo evidence deleted." });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error deleting job photo:", error.message);
    return res.status(500).json({ success: false, message: "Server error while deleting photo." });
  }
};
