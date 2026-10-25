/**
 * Signature Controller (Module 12) — shopkeeper/client acknowledgement.
 *
 * Authz (always from JWT identity, never request bodies):
 *   - capture: visits.manage + STRICT active-assignee check (even ADMIN /
 *     SUPER_ADMIN cannot sign — only the assigned Field Executive)
 *   - reads: visits.view.all (global) vs visits.view.own (assignment /
 *     client scoped), foreign rows 404
 *   - no delete/replace: evidence is immutable after capture
 *
 * Storage: uploads/signatures/job_<id>/visit_<vid>/<uuid>.png.
 * /uploads/signatures is walled off from the public static mount in
 * app.js (Module 11 pattern); reads go through :id/view.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");

const db = require("../config/db");
const Signature = require("../models/signatureModel");
const { hasPermission } = require("../services/rbacService");

const MAX_BYTES = 10 * 1024 * 1024; // consistent with photo/OCR uploads
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const CAPTURABLE_VISIT_STATUSES = ["OPEN", "REACHED", "WORK_IN_PROGRESS", "SIGNATURE_PENDING"];
const TERMINAL_JOB_STATUSES = ["CANCELLED", "COMPLETED", "APPROVED"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(String(file.originalname || "").toLowerCase());
    if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.includes(ext)) {
      return cb(null, true);
    }
    cb(new Error("Only JPG, JPEG, PNG and WEBP signature images up to 10 MB are allowed."));
  }
});

// Multer errors surface as clean 400s (never stack traces).
function uploadSingle(req, res, next) {
  upload.single("signature")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || "Invalid signature upload." });
    }
    next();
  });
}

function isDuplicateEntry(err) {
  return err && err.code === "ER_DUP_ENTRY";
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

function notifyAdmins(req, conn, { title, message, jobId }) {
  return (async () => {
    try {
      const [rows] = await conn.query(
        "SELECT id FROM users WHERE status = 'Active' AND role IN ('super_admin','admin')"
      );
      for (const r of rows) {
        await conn.query(
          `INSERT INTO notifications (user_id, title, message, type, reference_type, reference_id)
           VALUES (?, ?, ?, 'SIGNATURE_CAPTURED', 'JOB', ?)`,
          [r.id, title, message, jobId]
        );
      }
    } catch (err) {
      console.error("Signature notification failed:", err.message);
    }
  })();
}

function validId(value) {
  return /^\d+$/.test(String(value));
}

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

async function readScope(req) {
  if (await hasPermission(req.user, "visits.view.all")) return { global: true };
  if (!(await hasPermission(req.user, "visits.view.own"))) return { denied: true };
  const [[row]] = await db.query("SELECT employee_id, client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  if (!row) return { denied: true };
  if (row.employee_id !== null) return { employeeId: Number(row.employee_id) };
  if (row.client_id !== null) return { clientId: Number(row.client_id) };
  return { denied: true };
}

async function signatureVisible(scope, sig) {
  if (scope.global) return true;
  if (scope.employeeId !== undefined) {
    const [rows] = await db.query(
      "SELECT 1 AS ok FROM job_assignments WHERE job_id = ? AND employee_id = ? AND status IN ('ACTIVE','COMPLETED') LIMIT 1",
      [sig.job_id, scope.employeeId]
    );
    return !!rows[0];
  }
  if (scope.clientId !== undefined) {
    return Number(sig.client_id) === scope.clientId;
  }
  return false;
}

// Client-safe shape: signer evidence stays, employee internals go.
function shapeSignature(row, { forClient }) {
  const out = {
    id: row.id,
    job_id: row.job_id,
    visit_id: row.visit_id,
    visit_number: row.visit_number ?? null,
    signer_name: row.signer_name,
    signer_mobile: row.signer_mobile,
    remarks: row.remarks || null,
    signed_at: row.signed_at,
    created_at: row.created_at,
    latitude: row.latitude,
    longitude: row.longitude,
    view_url: `/api/signatures/${row.id}/view`
  };
  if (!forClient) {
    out.captured_by = row.captured_by;
    out.captured_by_name = row.captured_by_name || null;
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

// POST /api/signatures (multipart: signature + visit_id + signer_name
// [+ signer_mobile/remarks/job_id/latitude/longitude])
exports.captureSignature = [
  uploadSingle,
  async (req, res) => {
    const conn = await db.getConnection();
    try {
      if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        conn.release();
        return res.status(400).json({ success: false, message: "Signature image is required (field 'signature')." });
      }
      const { visit_id, job_id, signer_name, signer_mobile, remarks } = req.body || {};
      if (!validId(visit_id)) {
        conn.release();
        return res.status(400).json({ success: false, message: "Valid visit_id is required." });
      }
      const visitId = Number(visit_id);
      const name = String(signer_name || "").trim();
      if (!name) {
        conn.release();
        return res.status(400).json({ success: false, message: "Signer name is required." });
      }
      if (name.length > 100) {
        conn.release();
        return res.status(400).json({ success: false, message: "Signer name must be within 100 characters." });
      }
      let mobile = null;
      if (signer_mobile !== undefined && signer_mobile !== null && String(signer_mobile).trim() !== "") {
        const digits = String(signer_mobile).replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 15) {
          conn.release();
          return res.status(400).json({ success: false, message: "Signer mobile must contain 10-15 digits when supplied." });
        }
        mobile = String(signer_mobile).trim().slice(0, 15);
      }

      const [[visit]] = await conn.query(
        "SELECT v.id, v.job_id, v.visit_number, v.status, j.job_number, j.store_id, j.status AS job_status FROM job_visits v JOIN jobs j ON j.id = v.job_id WHERE v.id = ? LIMIT 1",
        [visitId]
      );
      if (!visit) {
        conn.release();
        return res.status(404).json({ success: false, message: "Visit not found." });
      }
      // job_id is never trusted for authorization; a supplied value that
      // contradicts the visit is rejected instead of silently ignored.
      if (job_id !== undefined && job_id !== null && String(job_id).trim() !== "" && Number(job_id) !== Number(visit.job_id)) {
        conn.release();
        return res.status(400).json({ success: false, message: "job_id does not match the visit's job." });
      }
      const jobId = Number(visit.job_id);
      if (TERMINAL_JOB_STATUSES.includes(visit.job_status)) {
        conn.release();
        return res.status(409).json({ success: false, message: `Signatures cannot be captured while the job is ${visit.job_status}.` });
      }
      if (!CAPTURABLE_VISIT_STATUSES.includes(visit.status)) {
        conn.release();
        return res.status(409).json({
          success: false,
          message: `Signatures can be captured while the visit is OPEN, REACHED, WORK_IN_PROGRESS or SIGNATURE_PENDING (current: ${visit.status}).`,
          code: "VISIT_NOT_SIGNABLE"
        });
      }

      // Strict assignee-only: no global bypass, not even for admins.
      const mine = await activeAssignmentFor(jobId, req.user.id, conn);
      if (!mine) {
        conn.release();
        return res.status(403).json({ success: false, message: "Only the currently assigned Field Executive can capture the signature for this visit." });
      }

      const gps = validateOptionalGps(req.body.latitude, req.body.longitude);
      if (gps.errors.length > 0) {
        conn.release();
        return res.status(400).json({ success: false, message: gps.errors.join(" ") });
      }

      // Real image validation: sharp parses actual bytes. Then the blank
      // test — a stroke-less canvas is pixel-flat (every channel ~zero
      // variance; trim alone is not enough because it ignores empty
      // alpha margins). Flat in ALL channels => blank => 400.
      let normalized;
      try {
        const meta = await sharp(req.file.buffer).metadata();
        if (!meta || !meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
          conn.release();
          return res.status(400).json({ success: false, message: "Only JPG, JPEG, PNG and WEBP signature images are allowed." });
        }
        const trimmed = await sharp(req.file.buffer).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
        const stats = await sharp(req.file.buffer).stats();
        const pixelFlat = stats.channels.every((c) => c.stdev < 0.5);
        if ((!trimmed.info || trimmed.info.width < 8 || trimmed.info.height < 8) || pixelFlat) {
          conn.release();
          return res.status(400).json({ success: false, message: "Signature is blank. Ask the signer to sign inside the pad, then save again." });
        }
        // Normalized PNG evidence (orientation fixed, metadata stripped,
        // transparency preserved). Bounded so pad exports stay small.
        normalized = await sharp(req.file.buffer).rotate().resize({
          width: 1200, height: 600, fit: "inside", withoutEnlargement: true
        }).png({ compressionLevel: 8 }).toBuffer();
      } catch (err) {
        if (!res.headersSent && err.statusCode === undefined) {
          conn.release();
          return res.status(400).json({ success: false, message: "File is not a valid image." });
        }
        throw err;
      }

      const fileName = `${crypto.randomUUID()}.png`;
      const dir = path.join("uploads", "signatures", `job_${jobId}`, `visit_${visitId}`);
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, fileName);
      await fs.promises.writeFile(filePath, normalized);

      // Transaction with deadlock retry: two simultaneous captures can
      // deadlock on the unique key + visit row. The loser retries; by
      // then the winner has committed, so the retry lands on the
      // duplicate path (-> 409) instead of a 500. Audit/notify live
      // inside the transaction, so a retried attempt never double-writes.
      let duplicateOf = null;
      let committed = false;
      for (let attempt = 1; attempt <= 3 && !committed && !duplicateOf; attempt++) {
        await conn.beginTransaction();
        try {
          const signatureId = await Signature.insert({
            jobId, visitId, signerName: name, signerMobile: mobile,
            remarks: remarks ? String(remarks).trim().slice(0, 255) : null,
            filePath, latitude: gps.lat, longitude: gps.lng, capturedBy: req.user.id
          }, conn);
          await conn.query("UPDATE job_visits SET status = 'SIGNATURE_PENDING' WHERE id = ? AND status <> 'SIGNATURE_PENDING'", [visitId]);
          await audit(req, conn, {
            action: "JOB_SIGNATURE_CAPTURED", entityType: "SIGNATURE", entityId: signatureId,
            oldValues: null,
            newValues: { job_id: jobId, visit_id: visitId, signer_name: name, signer_mobile: mobile }
          });
          await notifyAdmins(req, conn, {
            title: `Signature captured: ${visit.job_number}`,
            message: `Field executive captured the shopkeeper signature for visit ${visit.visit_number}.`,
            jobId
          });
          await conn.commit();
          committed = true;
        } catch (err) {
          await conn.rollback();
          if (isDuplicateEntry(err)) {
            // Lost the race (or double tap): exactly one row exists.
            duplicateOf = await Signature.getByVisit(visitId);
          } else if ((err.code === "ER_LOCK_DEADLOCK" || err.code === "ER_LOCK_WAIT_TIMEOUT") && attempt < 3) {
            await new Promise((r) => setTimeout(r, 60 * attempt));
          } else {
            await fs.promises.unlink(filePath).catch(() => {});
            throw err;
          }
        }
      }
      if (duplicateOf || !committed) {
        // Our file is unneeded (duplicate evidence already stored).
        await fs.promises.unlink(filePath).catch(() => {});
        const existing = duplicateOf || await Signature.getByVisit(visitId);
        conn.release();
        return res.status(409).json({
          success: false,
          code: "SIGNATURE_ALREADY_EXISTS",
          message: "A signature already exists for this visit.",
          data: existing ? shapeSignature(existing, { forClient: false }) : null
        });
      }
      conn.release();

      const row = await Signature.getByVisit(visitId);
      return res.status(201).json({ success: true, message: "Signature captured.", data: shapeSignature(row, { forClient: false }) });
    } catch (error) {
      try { await conn.rollback(); } catch (_) { /* noop */ }
      conn.release();
      console.error("Error capturing signature:", error.message);
      return res.status(500).json({ success: false, message: "Server error while capturing signature." });
    }
  }
];

// GET /api/signatures/visit/:visitId — the visit's signature or 404
// (lets the employee UI show Pending vs Captured).
exports.getByVisit = async (req, res) => {
  try {
    if (!validId(req.params.visitId)) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }
    const scope = await readScope(req);
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
    const fake = { job_id: visit.job_id, client_id: visit.client_id };
    if (!(await signatureVisible(scope, fake))) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }
    const row = await Signature.getByVisit(visitId);
    if (!row) {
      return res.status(404).json({ success: false, message: "No signature captured for this visit yet.", code: "SIGNATURE_PENDING" });
    }
    return res.status(200).json({ success: true, data: shapeSignature(row, { forClient: scope.clientId !== undefined }) });
  } catch (error) {
    console.error("Error fetching signature:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching signature." });
  }
};

// GET /api/signatures/job/:jobId
exports.listByJob = async (req, res) => {
  try {
    if (!validId(req.params.jobId)) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const scope = await readScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const jobId = Number(req.params.jobId);
    const [[job]] = await db.query("SELECT id, client_id FROM jobs WHERE id = ? LIMIT 1", [jobId]);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    if (!(await signatureVisible(scope, { job_id: jobId, client_id: job.client_id }))) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const rows = await Signature.listByJob(jobId);
    const forClient = scope.clientId !== undefined;
    return res.status(200).json({ success: true, data: rows.map((r) => shapeSignature(r, { forClient })) });
  } catch (error) {
    console.error("Error listing signatures:", error.message);
    return res.status(500).json({ success: false, message: "Server error while listing signatures." });
  }
};

// GET /api/signatures/:id (metadata; image via :id/view)
exports.getSignature = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Signature not found." });
    }
    const scope = await readScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const internal = await Signature.getInternalById(Number(req.params.id));
    if (!internal || !(await signatureVisible(scope, internal))) {
      return res.status(404).json({ success: false, message: "Signature not found." });
    }
    const row = await Signature.getById(Number(req.params.id));
    return res.status(200).json({ success: true, data: shapeSignature(row, { forClient: scope.clientId !== undefined }) });
  } catch (error) {
    console.error("Error fetching signature:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching signature." });
  }
};

// GET /api/signatures/:id/view — authenticated image bytes.
exports.viewSignature = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Signature not found." });
    }
    const scope = await readScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const internal = await Signature.getInternalById(Number(req.params.id));
    if (!internal || !(await signatureVisible(scope, internal))) {
      return res.status(404).json({ success: false, message: "Signature not found." });
    }
    const abs = path.resolve(String(internal.signature_file_path));
    const root = path.resolve("uploads", "signatures");
    if (!abs.startsWith(root + path.sep)) {
      return res.status(404).json({ success: false, message: "Signature not found." });
    }
    return res.sendFile(abs, { headers: { "Content-Type": "image/png" } }, (err) => {
      if (err && !res.headersSent) {
        return res.status(404).json({ success: false, message: "Signature file unavailable." });
      }
    });
  } catch (error) {
    console.error("Error viewing signature:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: "Server error while viewing signature." });
    }
  }
};
