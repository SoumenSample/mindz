/**
 * Report Model (Module 12.1) — read-only snapshot for the closed-visit
 * Measurement Sheet PDF. No new tables; a handful of indexed queries,
 * no N+1. Never mutates data.
 */
const db = require("../config/db");

const Report = {
  // Visit + job + store + client + field executive in ONE query. The
  // store join also predicates s.client_id = j.client_id, so a
  // client/store mismatch yields no row (integrity failure, not a report).
  getVisitSnapshot: async (visitId) => {
    const [rows] = await db.query(
      `SELECT v.id AS visit_id, v.visit_number, v.status AS visit_status,
              v.started_at, v.closed_at,
              j.id AS job_id, j.job_number, j.status AS job_status,
              j.description AS job_description,
              s.store_code, s.store_name, s.building_name,
              s.address_line_1, s.address_line_2, s.landmark,
              s.city AS store_city, s.state AS store_state, s.pincode,
              s.shopkeeper_name, s.shopkeeper_mobile,
              c.client_code, c.client_name, c.phone AS client_phone,
              c.address AS client_address, c.city AS client_city,
              c.state AS client_state,
              e.employee_code, e.employee_name
         FROM job_visits v
         JOIN jobs j ON j.id = v.job_id
         JOIN stores s ON s.id = j.store_id AND s.client_id = j.client_id
         JOIN clients c ON c.id = j.client_id
         LEFT JOIN job_assignments a ON a.id = v.assignment_id
         LEFT JOIN employees e ON e.id = a.employee_id
        WHERE v.id = ? LIMIT 1`,
      [visitId]
    );
    return rows[0] || null;
  },

  // Latest FINAL sheet for the visit + its items in sequence order.
  getFinalSheet: async (jobId, visitId) => {
    const [sheets] = await db.query(
      `SELECT id, version_no FROM measurement_sheets
        WHERE job_id = ? AND visit_id = ? AND status = 'FINAL'
        ORDER BY version_no DESC LIMIT 1`,
      [jobId, visitId]
    );
    if (!sheets[0]) return null;
    const [items] = await db.query(
      `SELECT sequence_no, width_ft, height_ft, quantity, media_type, remarks
         FROM measurement_items WHERE measurement_sheet_id = ?
         ORDER BY sequence_no ASC`,
      [sheets[0].id]
    );
    return { sheet: sheets[0], items };
  },

  getSignature: async (visitId) => {
    const [rows] = await db.query(
      `SELECT id, signer_name, signer_mobile, remarks, signed_at,
              signature_file_path
         FROM job_signatures WHERE visit_id = ? LIMIT 1`,
      [visitId]
    );
    return rows[0] || null;
  },

  // Latest verification for the job, if Module 13 (or later flow) ran.
  getVerification: async (jobId) => {
    const [rows] = await db.query(
      `SELECT jv.action, jv.remark, jv.verified_at, u.name AS verifier_name
         FROM job_verifications jv
         LEFT JOIN users u ON u.id = jv.verifier_id
        WHERE jv.job_id = ? ORDER BY jv.verified_at DESC, jv.id DESC LIMIT 1`,
      [jobId]
    );
    return rows[0] || null;
  }
};

module.exports = Report;
