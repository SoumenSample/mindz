/**
 * Measurement Model 
 * DB access for measurement_sheets + measurement_items 
 * canonical model). Legacy job_measurements is never touched here.
 * Version rule: at most one DRAFT per job; finalizing supersedes the
 * previous FINAL — history is append-only, never overwritten.
 */
const db = require("../config/db");

const SHEET_SELECT = `
    SELECT m.id, m.job_id, m.visit_id, m.version_no, m.status, m.source,
           m.created_by, m.updated_by, m.created_at, m.updated_at,
           j.job_number, j.client_id, j.status AS job_status,
           v.visit_number, v.status AS visit_status
      FROM measurement_sheets m
      JOIN jobs j ON j.id = m.job_id
      LEFT JOIN job_visits v ON v.id = m.visit_id
`;

const Measurement = {
  getSheetById: async (id, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(`${SHEET_SELECT} WHERE m.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  getItems: async (sheetId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(
      `SELECT id, measurement_sheet_id, sequence_no, width_ft, height_ft,
              quantity, media_type, remarks
         FROM measurement_items
        WHERE measurement_sheet_id = ? ORDER BY sequence_no ASC`,
      [sheetId]
    );
    return rows;
  },

  getSheetsByJob: async (jobId, conn, finalOnly = false) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(
      `${SHEET_SELECT} WHERE m.job_id = ? ${finalOnly ? "AND m.status = 'FINAL'" : ""}
        ORDER BY m.version_no DESC`,
      [jobId]
    );
    return rows;
  },

  getOpenDraft: async (jobId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(
      "SELECT * FROM measurement_sheets WHERE job_id = ? AND status = 'DRAFT' LIMIT 1",
      [jobId]
    );
    return rows[0] || null;
  },

  nextVersionNo: async (jobId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM measurement_sheets WHERE job_id = ?", [jobId]);
    return Number(rows[0].next_no);
  },

  createSheet: async ({ jobId, visitId, source, actorId }, conn) => {
    const q = (conn || db).query.bind(conn || db);
    // Repeatable-read safety: re-check inside the caller's transaction.
    const [[{ count }]] = await q(
      "SELECT COUNT(*) AS count FROM measurement_sheets WHERE job_id = ? AND status = 'DRAFT'",
      [jobId]
    );
    if (count > 0) {
      throw Object.assign(new Error("An open DRAFT already exists for this job. Finalize it before starting a new version."), { statusCode: 409 });
    }
    const [[{ next_no }]] = await q("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM measurement_sheets WHERE job_id = ?", [jobId]);
    const [result] = await q(
      "INSERT INTO measurement_sheets (job_id, visit_id, version_no, status, source, created_by, updated_by) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?)",
      [jobId, visitId, next_no, source || "MANUAL", actorId, actorId]
    );
    return { id: result.insertId, version_no: next_no };
  },

  // Replace all draft items transactionally (caller owns the txn).
  replaceItems: async (sheetId, items, conn) => {
    await conn.query("DELETE FROM measurement_items WHERE measurement_sheet_id = ?", [sheetId]);
    let seq = 0;
    for (const it of items) {
      seq += 1;
      await conn.query(
        `INSERT INTO measurement_items
           (measurement_sheet_id, sequence_no, width_ft, height_ft, quantity, media_type, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sheetId, seq,
         it.width_ft ?? null, it.height_ft ?? null, it.quantity ?? 1,
         it.media_type || null, it.remarks || null]
      );
    }
    return seq;
  },

  setSource: async (sheetId, source, actorId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    await q("UPDATE measurement_sheets SET source = ?, updated_by = ? WHERE id = ?", [source, actorId, sheetId]);
  },

  finalizeSheet: async (sheetId, actorId, conn) => {
    const sheet = await Measurement.getSheetById(sheetId, conn);
    if (!sheet) throw Object.assign(new Error("Measurement sheet not found."), { statusCode: 404 });
    if (sheet.status !== "DRAFT") {
      throw Object.assign(new Error(`Only DRAFT sheets can be finalized (current: ${sheet.status}).`), { statusCode: 409 });
    }
    // Row-lock so concurrent finalizes serialize; the loser sees FINAL.
    const [locked] = await conn.query("SELECT status FROM measurement_sheets WHERE id = ? FOR UPDATE", [sheetId]);
    if (!locked[0] || locked[0].status !== "DRAFT") {
      throw Object.assign(new Error("Sheet is no longer a DRAFT (concurrent finalization)."), { statusCode: 409 });
    }
    const items = await Measurement.getItems(sheetId, conn);
    if (items.length === 0) {
      throw Object.assign(new Error("A sheet needs at least one measurement item to finalize."), { statusCode: 400 });
    }
    for (const it of items) {
      const w = Number(it.width_ft);
      const h = Number(it.height_ft);
      const qn = Number(it.quantity);
      if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
        throw Object.assign(new Error(`Item #${it.sequence_no}: width and height must be positive numbers.`), { statusCode: 400 });
      }
      if (!Number.isFinite(qn) || qn <= 0) {
        throw Object.assign(new Error(`Item #${it.sequence_no}: quantity must be positive.`), { statusCode: 400 });
      }
      if (!it.media_type) {
        throw Object.assign(new Error(`Item #${it.sequence_no}: media type is required.`), { statusCode: 400 });
      }
    }
    // Supersede the previous FINAL of this job (history preserved).
    const [prev] = await conn.query(
      "SELECT id FROM measurement_sheets WHERE job_id = ? AND status = 'FINAL' AND id <> ? LIMIT 1",
      [sheet.job_id, sheetId]
    );
    let supersededId = null;
    if (prev[0]) {
      supersededId = prev[0].id;
      await conn.query("UPDATE measurement_sheets SET status = 'SUPERSEDED', updated_by = ? WHERE id = ?", [actorId, supersededId]);
    }
    // Guarded by the row lock above, but the affected-rows check makes
    // the exactly-once guarantee explicit even under races.
    const [upd] = await conn.query("UPDATE measurement_sheets SET status = 'FINAL', updated_by = ? WHERE id = ? AND status = 'DRAFT'", [actorId, sheetId]);
    if (upd.affectedRows === 0) {
      throw Object.assign(new Error("Sheet is no longer a DRAFT (concurrent finalization)."), { statusCode: 409 });
    }
    return { supersededId };
  }
};

module.exports = Measurement;
