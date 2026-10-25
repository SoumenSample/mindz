/**
 * Measurement Controller  — sheets/items/manual/OCR/finalize
 * plus the Start Work transition. No photos/signatures/verification.
 *
 * Field-work rule: sheets belong to the job's CURRENT visit and only
 * the ACTIVE assignee may mutate them. Reads branch on jobs.view.all
 * (global) vs jobs.view.own (assignment-scoped employee, FINAL-only
 * client scope). CLIENT never sees drafts.
 */
const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const Measurement = require("../models/measurementModel");
const { hasPermission } = require("../services/rbacService");
const { parseMeasurementText } = require("../utils/parseMeasurement");
const { runMeasurementOcr } = require("../utils/measurementOcr");

const MEDIA_TYPES = ["GLOW_SIGN", "NON_LIT", "VINYL", "SUNPACK", "OTHER"];

// Active assignment of this user on this job (or null). Identity from
// users.employee_id — request employee_ids are never trusted.
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

async function loadJob(jobId, conn) {
  const q = (conn || db).query.bind(conn || db);
  const [rows] = await q(
    "SELECT id, job_number, client_id, store_id, status FROM jobs WHERE id = ? LIMIT 1",
    [jobId]
  );
  return rows[0] || null;
}

// Latest still-open visit of the job (any of OPEN/REACHED/WORK_STARTED;
// closed/cancelled visits never accept new sheets).
async function currentVisit(jobId, conn) {
  const q = (conn || db).query.bind(conn || db);
  const [rows] = await q(
    `SELECT * FROM job_visits
      WHERE job_id = ? AND status NOT IN ('VISIT_CLOSED','CANCELLED')
      ORDER BY visit_number DESC, id DESC LIMIT 1`,
    [jobId]
  );
  return rows[0] || null;
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

function history(conn, { jobId, from, to, by, remark }) {
  return conn.query(
    "INSERT INTO job_status_history (job_id, from_status, to_status, changed_by, remark) VALUES (?, ?, ?, ?, ?)",
    [jobId, from || null, to, by, remark || null]
  );
}

function validId(value) {
  return /^\d+$/.test(String(value));
}

// Read scope for measurement data: { global } | { employeeId } |
// { clientId } | { denied }. Client scope additionally forces FINAL.
async function readScope(req) {
  if (await hasPermission(req.user, "jobs.view.all")) return { global: true };
  if (!(await hasPermission(req.user, "jobs.view.own"))) return { denied: true };
  const [[row]] = await db.query("SELECT employee_id, client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  if (!row) return { denied: true };
  if (row.employee_id !== null) return { employeeId: Number(row.employee_id) };
  if (row.client_id !== null) return { clientId: Number(row.client_id) };
  return { denied: true };
}

async function jobVisibleTo(jobId, scope, conn) {
  const q = (conn || db).query.bind(conn || db);
  if (scope.global) {
    const [rows] = await q("SELECT id FROM jobs WHERE id = ? LIMIT 1", [jobId]);
    return !!rows[0];
  }
  if (scope.employeeId !== undefined) {
    const [rows] = await q(
      "SELECT 1 AS ok FROM job_assignments WHERE job_id = ? AND employee_id = ? AND status IN ('ACTIVE','COMPLETED') LIMIT 1",
      [jobId, scope.employeeId]
    );
    return !!rows[0];
  }
  if (scope.clientId !== undefined) {
    const [rows] = await q("SELECT client_id FROM jobs WHERE id = ? LIMIT 1", [jobId]);
    return !!rows[0] && Number(rows[0].client_id) === scope.clientId;
  }
  return false;
}

// POST /api/jobs/:id/start-work (visits.manage, active assignee only)
exports.startWork = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!validId(id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const job = await loadJob(Number(id), conn);
    if (!job) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const mine = await activeAssignmentFor(Number(id), req.user.id, conn);
    if (!mine) {
      conn.release();
      return res.status(403).json({ success: false, message: "Only the currently assigned Field Executive can start work on this job." });
    }
    if (job.status !== "REACHED") {
      conn.release();
      return res.status(409).json({
        success: false,
        message: job.status === "WORK_STARTED"
          ? "Work has already started on this job."
          : `Work can only start from REACHED (current: ${job.status}).`,
        data: { job_id: job.id, status: job.status }
      });
    }

    await conn.beginTransaction();
    await conn.query("UPDATE jobs SET status = 'WORK_STARTED', updated_by = ? WHERE id = ? AND status = 'REACHED'", [req.user.id, Number(id)]);
    await history(conn, { jobId: Number(id), from: "REACHED", to: "WORK_STARTED", by: req.user.id, remark: "Work started" });
    await audit(req, conn, { action: "WORK_STARTED", entityType: "JOB", entityId: Number(id), oldValues: { status: "REACHED" }, newValues: { status: "WORK_STARTED" } });
    await conn.commit();
    conn.release();

    const [rows] = await db.query("SELECT id, job_number, status FROM jobs WHERE id = ? LIMIT 1", [Number(id)]);
    return res.status(200).json({ success: true, message: "Work started.", data: rows[0] });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error starting work:", error.message);
    return res.status(500).json({ success: false, message: "Server error while starting work." });
  }
};

// POST /api/jobs/:id/measurement-sheets (jobs.measure, assignee, REACHED+)
exports.createSheet = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!validId(id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const job = await loadJob(Number(id), conn);
    if (!job) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const mine = await activeAssignmentFor(Number(id), req.user.id, conn);
    if (!mine) {
      conn.release();
      return res.status(403).json({ success: false, message: "Only the currently assigned Field Executive can measure this job." });
    }
    if (!["REACHED", "WORK_STARTED"].includes(job.status)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Measurements require REACHED or WORK_STARTED (current: ${job.status}).` });
    }
    const source = req.body?.source || "MANUAL";
    if (!["MANUAL", "OCR_SCAN"].includes(source)) {
      conn.release();
      return res.status(400).json({ success: false, message: "Source must be MANUAL or OCR_SCAN." });
    }
    const visit = await currentVisit(Number(id), conn);
    if (!visit) {
      conn.release();
      return res.status(409).json({ success: false, message: "No open visit for this job. Start travel first." });
    }

    await conn.beginTransaction();
    let created;
    try {
      created = await Measurement.createSheet({
        jobId: Number(id), visitId: visit.id, source, actorId: req.user.id
      }, conn);
    } catch (err) {
      await conn.rollback();
      conn.release();
      if (err.statusCode === 409) {
        return res.status(409).json({ success: false, message: err.message });
      }
      throw err;
    }
    await audit(req, conn, {
      action: "MEASUREMENT_SHEET_CREATED", entityType: "MEASUREMENT_SHEET", entityId: created.id,
      oldValues: null, newValues: { job_id: Number(id), visit_id: visit.id, version_no: created.version_no, source }
    });
    await conn.commit();
    conn.release();

    const sheet = await Measurement.getSheetById(created.id);
    return res.status(201).json({ success: true, message: "Measurement sheet created.", data: { ...sheet, items: [] } });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error creating measurement sheet:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating measurement sheet." });
  }
};

// GET /api/jobs/:id/measurement-sheets (scoped; client sees FINAL only)
exports.listSheetsByJob = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const scope = await readScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const visible = await jobVisibleTo(Number(req.params.id), scope);
    if (!visible) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const sheets = await Measurement.getSheetsByJob(Number(req.params.id), null, scope.clientId !== undefined);
    return res.status(200).json({ success: true, data: sheets });
  } catch (error) {
    console.error("Error listing measurement sheets:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

async function scopedSheet(req, res, sheetId) {
  const scope = await readScope(req);
  if (scope.denied) {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  const sheet = await Measurement.getSheetById(Number(sheetId));
  if (!sheet) {
    res.status(404).json({ success: false, message: "Measurement sheet not found." });
    return null;
  }
  const visible = await jobVisibleTo(sheet.job_id, scope);
  if (!visible) {
    res.status(404).json({ success: false, message: "Measurement sheet not found." });
    return null;
  }
  if (scope.clientId !== undefined && sheet.status !== "FINAL") {
    res.status(404).json({ success: false, message: "Measurement sheet not found." });
    return null;
  }
  return { scope, sheet };
}

// GET /api/measurement-sheets/:id
exports.getSheetById = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    const found = await scopedSheet(req, res, req.params.id);
    if (!found) return;
    const items = await Measurement.getItems(Number(req.params.id));
    return res.status(200).json({ success: true, data: { ...found.sheet, items } });
  } catch (error) {
    console.error("Error fetching measurement sheet:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// Owner check: active assignee of the sheet's job.
async function sheetOwner(sheet, userId, conn) {
  const mine = await activeAssignmentFor(sheet.job_id, userId, conn);
  return !!mine;
}

function validateItems(items, { strict }) {
  const errors = [];
  if (!Array.isArray(items)) return ["items must be an array."];
  items.forEach((it, i) => {
    const n = i + 1;
    const w = it.width_ft === undefined || it.width_ft === null || String(it.width_ft).trim() === "" ? null : Number(it.width_ft);
    const h = it.height_ft === undefined || it.height_ft === null || String(it.height_ft).trim() === "" ? null : Number(it.height_ft);
    const q = it.quantity === undefined || it.quantity === null || String(it.quantity).trim() === "" ? null : Number(it.quantity);
    if (strict) {
      if (w === null || !Number.isFinite(w) || w <= 0) errors.push(`Item #${n}: width must be a positive number.`);
      if (h === null || !Number.isFinite(h) || h <= 0) errors.push(`Item #${n}: height must be a positive number.`);
      if (q === null || !Number.isFinite(q) || q <= 0) errors.push(`Item #${n}: quantity must be positive.`);
      if (!it.media_type || !MEDIA_TYPES.includes(it.media_type)) errors.push(`Item #${n}: media type is required.`);
    } else {
      for (const [key, val, label] of [["width_ft", w, "width"], ["height_ft", h, "height"], ["quantity", q, "quantity"]]) {
        void key;
        if (val !== null && (!Number.isFinite(val) || val <= 0)) errors.push(`Item #${n}: ${label} must be a positive number when supplied.`);
      }
      if (it.media_type && !MEDIA_TYPES.includes(it.media_type)) errors.push(`Item #${n}: unknown media type.`);
    }
    if (it.remarks !== undefined && it.remarks !== null && String(it.remarks).length > 255) {
      errors.push(`Item #${n}: remarks too long (max 255).`);
    }
  });
  return errors;
}

// PUT /api/measurement-sheets/:id (DRAFT + owner only, replace items)
exports.updateSheet = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!validId(id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    const sheet = await Measurement.getSheetById(Number(id), conn);
    if (!sheet) {
      conn.release();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    if (!(await sheetOwner(sheet, req.user.id, conn))) {
      conn.release();
      return res.status(403).json({ success: false, message: "Only the assigned Field Executive can edit this sheet." });
    }
    if (sheet.status !== "DRAFT") {
      conn.release();
      return res.status(409).json({ success: false, message: `Only DRAFT sheets can be edited (current: ${sheet.status}).` });
    }
    const errors = validateItems(req.body?.items || [], { strict: false });
    if (errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    await conn.beginTransaction();
    const count = await Measurement.replaceItems(Number(id), req.body.items || [], conn);
    await conn.query("UPDATE measurement_sheets SET updated_by = ? WHERE id = ?", [req.user.id, Number(id)]);
    await audit(req, conn, {
      action: "MEASUREMENT_SHEET_UPDATED", entityType: "MEASUREMENT_SHEET", entityId: Number(id),
      oldValues: null, newValues: { items: count }
    });
    await conn.commit();
    conn.release();

    const updated = await Measurement.getSheetById(Number(id));
    const items = await Measurement.getItems(Number(id));
    return res.status(200).json({ success: true, message: "Draft saved.", data: { ...updated, items } });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error updating measurement sheet:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/measurement-sheets/:id/ocr (multipart image -> DRAFT items)
// Pipeline: preprocess -> bounded multi-PSM passes -> best text ->
// conservative parse -> replace draft items. OCR NEVER finalizes.
// All temp files (upload + preprocessed) are deleted in finally.
exports.scanSheet = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  const tempFiles = req.file ? [req.file.path] : [];
  const cleanup = () => {
    for (const f of tempFiles) {
      fs.unlink(f, () => { /* temp scan images never persist */ });
    }
  };
  try {
    if (!validId(id)) {
      conn.release();
      cleanup();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    if (!req.file) {
      conn.release();
      return res.status(400).json({ success: false, message: "Sheet image is required." });
    }
    const sheet = await Measurement.getSheetById(Number(id), conn);
    if (!sheet) {
      conn.release();
      cleanup();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    if (!(await sheetOwner(sheet, req.user.id, conn))) {
      conn.release();
      cleanup();
      return res.status(403).json({ success: false, message: "Only the assigned Field Executive can scan this sheet." });
    }
    if (sheet.status !== "DRAFT") {
      conn.release();
      cleanup();
      return res.status(409).json({ success: false, message: `Only DRAFT sheets can be scanned (current: ${sheet.status}).` });
    }

    let ocr;
    try {
      ocr = await runMeasurementOcr(
        req.file.path,
        path.dirname(req.file.path),
        path.parse(req.file.filename).name,
        parseMeasurementText
      );
      tempFiles.push(...ocr.tempFiles.filter((f) => !tempFiles.includes(f)));
    } catch (err) {
      conn.release();
      cleanup();
      console.error("Measurement OCR failed:", err.message);
      return res.status(502).json({ success: false, message: "OCR could not read the image. Try a clearer photo or enter values manually.", code: "OCR_FAILED" });
    }
    const { items, rawText } = parseMeasurementText(ocr.best.text);
    const textPresent = rawText.trim().length > 0;

    await conn.beginTransaction();
    await Measurement.replaceItems(Number(id), items, conn);
    await Measurement.setSource(Number(id), "OCR_SCAN", req.user.id, conn);
    await audit(req, conn, {
      action: "MEASUREMENT_OCR_PROCESSED", entityType: "MEASUREMENT_SHEET", entityId: Number(id),
      oldValues: null, newValues: { detected_items: items.length }
    });
    await conn.commit();
    conn.release();
    cleanup();

    // Raw text + debug are returned for review context only — never
    // persisted, never audited.
    const saved = await Measurement.getSheetById(Number(id));
    const savedItems = await Measurement.getItems(Number(id));
    return res.status(200).json({
      success: true,
      message: items.length > 0
        ? `OCR detected ${items.length} item(s). Review every value before finalizing.`
        : textPresent
          ? "OCR detected text, but no measurement values could be confidently extracted. Review the OCR text below or enter measurements manually."
          : "OCR could not detect measurements. Enter values manually.",
      data: {
        ...saved,
        items: savedItems,
        raw_text: rawText,
        detected_items: items.length,
        text_present: textPresent,
        ocr: {
          detected: items.length > 0,
          confidence: ocr.best.confidence,
          passes: ocr.passes.map((p) => ({
            psm: p.psm,
            confidence: p.confidence,
            detected_items: p.detected_items,
            fallback: !!p.fallback
          }))
        }
      }
    });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    cleanup();
    console.error("Error scanning measurement sheet:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// DELETE /api/measurement-sheets/:id (DRAFT + owner only)
// Drafts are disposable; FINAL/SUPERSEDED are immutable history and
// can never be deleted — revise them into a new DRAFT instead.
exports.deleteSheet = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!validId(id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    const sheet = await Measurement.getSheetById(Number(id), conn);
    if (!sheet) {
      conn.release();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    if (!(await sheetOwner(sheet, req.user.id, conn))) {
      conn.release();
      return res.status(403).json({ success: false, message: "Only the assigned Field Executive can delete this sheet." });
    }
    if (sheet.status !== "DRAFT") {
      conn.release();
      return res.status(409).json({ success: false, message: `Only DRAFT sheets can be deleted (current: ${sheet.status}). Final versions are immutable — use Edit to revise into a new version.` });
    }

    await conn.beginTransaction();
    await conn.query("DELETE FROM measurement_items WHERE measurement_sheet_id = ?", [Number(id)]);
    await conn.query("DELETE FROM measurement_sheets WHERE id = ? AND status = 'DRAFT'", [Number(id)]);
    await audit(req, conn, {
      action: "MEASUREMENT_SHEET_DELETED", entityType: "MEASUREMENT_SHEET", entityId: Number(id),
      oldValues: { job_id: sheet.job_id, version_no: sheet.version_no, status: "DRAFT" }, newValues: null
    });
    await conn.commit();
    conn.release();

    return res.status(200).json({ success: true, message: `Draft version ${sheet.version_no} deleted.` });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error deleting measurement sheet:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/measurement-sheets/:id/revise (FINAL/SUPERSEDED + owner)
// Creates a new DRAFT prefilled with a copy of the source sheet's items.
// FINALs stay immutable — edits always land in the new draft version,
// which on finalize supersedes the previous FINAL.
exports.reviseSheet = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!validId(id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    const source = await Measurement.getSheetById(Number(id), conn);
    if (!source) {
      conn.release();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    if (!["FINAL", "SUPERSEDED"].includes(source.status)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Only FINAL versions can be edited into a new version (current: ${source.status}). Continue the open draft instead.` });
    }
    if (!(await sheetOwner(source, req.user.id, conn))) {
      conn.release();
      return res.status(403).json({ success: false, message: "Only the assigned Field Executive can edit this sheet." });
    }
    const job = await loadJob(source.job_id, conn);
    if (!job || !["REACHED", "WORK_STARTED"].includes(job.status)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Measurements require REACHED or WORK_STARTED (current: ${job?.status || "unknown"}).` });
    }
    const visit = await currentVisit(source.job_id, conn);
    if (!visit) {
      conn.release();
      return res.status(409).json({ success: false, message: "No open visit for this job. Start travel first." });
    }
    const sourceItems = await Measurement.getItems(source.id, conn);

    await conn.beginTransaction();
    let created;
    try {
      created = await Measurement.createSheet({
        jobId: source.job_id, visitId: visit.id, source: source.source || "MANUAL", actorId: req.user.id
      }, conn);
    } catch (err) {
      await conn.rollback();
      conn.release();
      if (err.statusCode === 409) {
        return res.status(409).json({ success: false, message: "An open DRAFT already exists. Finalize or delete it before editing this version." });
      }
      throw err;
    }
    if (sourceItems.length > 0) {
      await Measurement.replaceItems(created.id, sourceItems.map((it) => ({
        width_ft: it.width_ft,
        height_ft: it.height_ft,
        quantity: it.quantity,
        media_type: it.media_type,
        remarks: it.remarks
      })), conn);
    }
    await audit(req, conn, {
      action: "MEASUREMENT_SHEET_REVISED", entityType: "MEASUREMENT_SHEET", entityId: created.id,
      oldValues: { copied_from: source.id, version_no: source.version_no },
      newValues: { job_id: source.job_id, visit_id: visit.id, version_no: created.version_no, items: sourceItems.length }
    });
    await conn.commit();
    conn.release();

    const sheet = await Measurement.getSheetById(created.id);
    const items = await Measurement.getItems(created.id);
    return res.status(201).json({ success: true, message: `Version ${sheet.version_no} created from version ${source.version_no} — edit and finalize.`, data: { ...sheet, items } });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error revising measurement sheet:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/measurement-sheets/:id/finalize (DRAFT + owner, transactional)
exports.finalizeSheet = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!validId(id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    const sheet = await Measurement.getSheetById(Number(id), conn);
    if (!sheet) {
      conn.release();
      return res.status(404).json({ success: false, message: "Measurement sheet not found." });
    }
    if (!(await sheetOwner(sheet, req.user.id, conn))) {
      conn.release();
      return res.status(403).json({ success: false, message: "Only the assigned Field Executive can finalize this sheet." });
    }

    await conn.beginTransaction();
    let outcome;
    try {
      outcome = await Measurement.finalizeSheet(Number(id), req.user.id, conn);
    } catch (err) {
      await conn.rollback();
      conn.release();
      if (err.statusCode === 400 || err.statusCode === 404 || err.statusCode === 409) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      throw err;
    }
    await audit(req, conn, {
      action: "MEASUREMENT_SHEET_FINALIZED", entityType: "MEASUREMENT_SHEET", entityId: Number(id),
      oldValues: { status: "DRAFT" }, newValues: { status: "FINAL", version_no: sheet.version_no }
    });
    if (outcome.supersededId) {
      await audit(req, conn, {
        action: "MEASUREMENT_SHEET_SUPERSEDED", entityType: "MEASUREMENT_SHEET", entityId: outcome.supersededId,
        oldValues: { status: "FINAL" }, newValues: { status: "SUPERSEDED" }
      });
    }
    await conn.commit();
    conn.release();

    const updated = await Measurement.getSheetById(Number(id));
    const items = await Measurement.getItems(Number(id));
    return res.status(200).json({ success: true, message: "Measurement sheet finalized.", data: { ...updated, items } });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error finalizing measurement sheet:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
