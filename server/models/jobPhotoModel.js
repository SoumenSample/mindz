/**
 * JobPhoto Model (Module 11) — DB access for job_photos (evidence).
 * Reuses the existing table untouched. Photos are visit-aware; measurement
 * photos are additionally item-aware. Required-proof validation lives here
 * so every workflow gate shares one implementation.
 */
const db = require("../config/db");

const REQUIRED_TYPES = [
  "BEFORE_INSTALLATION",
  "AFTER_INSTALLATION",
  "CLOSEUP",
  "FAR_VIEW"
];

// Public list shape. file_path (server filesystem) is NEVER selected for
// API output — clients receive the authenticated view endpoint instead.
const PUBLIC_SELECT = `
  SELECT p.id, p.job_id, p.visit_id, p.measurement_item_id, p.photo_type,
         p.file_url, p.thumbnail_path, p.latitude, p.longitude, p.captured_at,
         p.watermark_applied, p.is_live_camera, p.uploaded_by,
         p.file_size_bytes, p.mime_type, p.original_filename, p.created_at,
         v.visit_number,
         mi.sequence_no AS item_sequence_no,
         u.name AS uploader_name
    FROM job_photos p
    JOIN job_visits v ON v.id = p.visit_id
    LEFT JOIN measurement_items mi ON mi.id = p.measurement_item_id
    LEFT JOIN users u ON u.id = p.uploaded_by`;

const JobPhoto = {
  REQUIRED_TYPES,

  insert: async ({
    jobId, visitId, measurementItemId, photoType, filePath, fileUrl,
    originalFilename, sha256, mimeType, fileSize, uploadedBy,
    latitude, longitude, capturedAt, isLiveCamera
  }, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `INSERT INTO job_photos
         (job_id, visit_id, measurement_item_id, photo_type, file_path, file_url,
          original_filename, sha256, mime_type, file_size_bytes, uploaded_by,
          latitude, longitude, captured_at, is_live_camera)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId, visitId, measurementItemId || null, photoType, filePath,
        fileUrl || null, originalFilename || null, sha256 || null,
        mimeType || null, fileSize || null, uploadedBy,
        latitude ?? null, longitude ?? null, capturedAt || null,
        isLiveCamera ? 1 : 0
      ]
    );
    return result.insertId;
  },

  getById: async (id, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(`${PUBLIC_SELECT} WHERE p.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  // Full row (internal): file_path needed only by the view endpoint.
  getInternalById: async (id, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(
      `SELECT p.*, j.client_id FROM job_photos p
         JOIN jobs j ON j.id = p.job_id WHERE p.id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  listByJob: async (jobId) => {
    const [rows] = await db.query(
      `${PUBLIC_SELECT} WHERE p.job_id = ? ORDER BY v.visit_number ASC, p.created_at ASC, p.id ASC`,
      [jobId]
    );
    return rows;
  },

  listByVisit: async (visitId) => {
    const [rows] = await db.query(
      `${PUBLIC_SELECT} WHERE p.visit_id = ? ORDER BY p.created_at ASC, p.id ASC`,
      [visitId]
    );
    return rows;
  },

  deleteById: async (id, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q("DELETE FROM job_photos WHERE id = ? LIMIT 1", [id]);
    return result.affectedRows > 0;
  },

  // Recent same-hash upload (double-tap guard): same visit+type+item
  // +content within the window returns the existing row instead of a
  // duplicate. The item participates NULL-safely — identical bytes aimed
  // at a DIFFERENT measurement item are distinct evidence, not a retry.
  recentDuplicate: async ({ visitId, photoType, measurementItemId = null, sha256, windowSeconds = 120 }, conn) => {
    if (!sha256) return null;
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(
      `SELECT id FROM job_photos
        WHERE visit_id = ? AND photo_type = ? AND measurement_item_id <=> ?
          AND sha256 = ?
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
        ORDER BY id DESC LIMIT 1`,
      [visitId, photoType, measurementItemId || null, sha256, windowSeconds]
    );
    return rows[0] || null;
  },

  /**
   * Required-proof gate for one visit. Returns:
   *   { ok:true }  — every required category present (+ every FINAL-sheet
   *                    item photographed, when FINAL items exist)
   *   { ok:false, code:'MISSING_REQUIRED_PHOTOS', missing:[types] }
   *   { ok:false, code:'MISSING_MEASUREMENT_PHOTOS', missingItems:[{id,sequence_no}] }
   * Counts come from one indexed query; FINAL items from one more.
   */
  validateRequired: async (jobId, visitId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [counts] = await q(
      `SELECT photo_type, COUNT(*) AS n FROM job_photos
        WHERE job_id = ? AND visit_id = ? AND photo_type IN (?, ?, ?, ?)
        GROUP BY photo_type`,
      [jobId, visitId, ...REQUIRED_TYPES]
    );
    const have = new Set(counts.filter((r) => Number(r.n) > 0).map((r) => r.photo_type));
    const missing = REQUIRED_TYPES.filter((t) => !have.has(t));
    if (missing.length > 0) {
      return { ok: false, code: "MISSING_REQUIRED_PHOTOS", missing };
    }
    // Measurement-item proof: enforced only when the visit actually has
    // FINAL measurement items (conditional per business rule — DRAFT-only
    // or item-less visits are not blocked).
    const [items] = await q(
      `SELECT mi.id, mi.sequence_no
         FROM measurement_items mi
         JOIN measurement_sheets ms ON ms.id = mi.measurement_sheet_id
        WHERE ms.job_id = ? AND ms.visit_id = ? AND ms.status = 'FINAL'
          AND NOT EXISTS (
            SELECT 1 FROM job_photos p
             WHERE p.job_id = ? AND p.visit_id = ?
               AND p.measurement_item_id = mi.id
               AND p.photo_type = 'MEASUREMENT_ITEM'
          )
        ORDER BY mi.sequence_no ASC`,
      [jobId, visitId, jobId, visitId]
    );
    if (items.length > 0) {
      return {
        ok: false,
        code: "MISSING_MEASUREMENT_PHOTOS",
        missingItems: items.map((r) => ({ id: Number(r.id), sequence_no: Number(r.sequence_no) }))
      };
    }
    return { ok: true };
  }
};

module.exports = JobPhoto;
