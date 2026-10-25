/**
 * Signature Model (Module 12) — DB access for job_signatures (evidence).
 * Reuses the existing table untouched. One final CLIENT_SHOPKEEPER
 * signature per visit, enforced by the uq_js_visit UNIQUE key — the
 * duplicate-POST race serializes into ER_DUP_ENTRY, never twin rows.
 */
const db = require("../config/db");

// Public list shape. signature_file_path (server filesystem) is NEVER
// selected for API output — clients use the authenticated view endpoint.
const PUBLIC_SELECT = `
  SELECT s.id, s.job_id, s.visit_id, s.signer_name, s.signer_mobile,
         s.remarks, s.signed_at, s.latitude, s.longitude,
         s.captured_by, s.created_at,
         v.visit_number,
         u.name AS captured_by_name
    FROM job_signatures s
    JOIN job_visits v ON v.id = s.visit_id
    LEFT JOIN users u ON u.id = s.captured_by`;

const Signature = {
  insert: async ({ jobId, visitId, signerName, signerMobile, remarks, filePath, latitude, longitude, capturedBy }, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `INSERT INTO job_signatures
         (job_id, visit_id, signer_name, signer_mobile, remarks,
          signature_file_path, latitude, longitude, captured_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId, visitId, signerName, signerMobile || null, remarks || null,
        filePath, latitude ?? null, longitude ?? null, capturedBy
      ]
    );
    return result.insertId;
  },

  getByVisit: async (visitId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(`${PUBLIC_SELECT} WHERE s.visit_id = ? LIMIT 1`, [visitId]);
    return rows[0] || null;
  },

  listByJob: async (jobId) => {
    const [rows] = await db.query(
      `${PUBLIC_SELECT} WHERE s.job_id = ? ORDER BY v.visit_number ASC, s.created_at ASC, s.id ASC`,
      [jobId]
    );
    return rows;
  },

  getById: async (id, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(`${PUBLIC_SELECT} WHERE s.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  // Full row (internal): file path + client scoping, for the view endpoint.
  getInternalById: async (id, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(
      `SELECT s.*, j.client_id FROM job_signatures s
         JOIN jobs j ON j.id = s.job_id WHERE s.id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }
};

module.exports = Signature;
