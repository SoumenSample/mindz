/**
 * Visit Controller  — travel, GPS tracking, store-reached only.
 * No measurements / photos / signatures / verification (later modules).
 *
 * Ownership (always from JWT identity, never request bodies):
 *   - field actions require the caller's employee to be the ACTIVE
 *     assignee of the job (ADMIN/SUPER_ADMIN cannot travel/reach either)
 *   - reads branch on visits.view.all (global) vs visits.view.own
 *     (assignment-scoped employee / client-scoped org), foreign 404
 *
 * Lifecycle here: ASSIGNED -> EN_ROUTE (start-travel, opens visit N) ->
 * REACHED (reach-store, closes the travel leg). Later transitions
 * belong to later modules; no generic status endpoint exists.
 */
const db = require("../config/db");
const Visit = require("../models/visitModel");
const { hasPermission } = require("../services/rbacService");
const { STORE_REACH_RADIUS_METERS, haversineMeters } = require("../utils/geo");

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

function history(conn, { jobId, from, to, by, remark }) {
  return conn.query(
    "INSERT INTO job_status_history (job_id, from_status, to_status, changed_by, remark) VALUES (?, ?, ?, ?, ?)",
    [jobId, from || null, to, by, remark || null]
  );
}

// Best-effort admin notice (never fails the business operation).
async function notifyAdmins(conn, title, message, jobId, type) {
  try {
    const [rows] = await conn.query(
      "SELECT id FROM users WHERE status = 'Active' AND role IN ('super_admin','admin')"
    );
    for (const r of rows) {
      await conn.query(
        `INSERT INTO notifications (user_id, title, message, type, reference_type, reference_id)
         VALUES (?, ?, ?, ?, 'JOB', ?)`,
        [r.id, title, message, type, jobId]
      );
    }
  } catch (err) {
    console.error("Visit notification failed:", err.message);
  }
}

// The caller's ACTIVE assignment on this job (or null). Identity comes
// from users.employee_id — a forged employee_id in the body is ignored.
async function activeAssignmentFor(jobId, userId, conn) {
  const q = (conn || db).query.bind(conn || db);
  const [rows] = await q(
    `SELECT a.id AS assignment_id, a.employee_id, e.employee_code
       FROM job_assignments a
       JOIN users u ON u.employee_id = a.employee_id
       JOIN employees e ON e.id = a.employee_id
      WHERE a.job_id = ? AND a.status = 'ACTIVE' AND u.id = ? LIMIT 1`,
    [jobId, userId]
  );
  return rows[0] || null;
}

async function loadJob(jobId, conn) {
  const q = (conn || db).query.bind(conn || db);
  const [rows] = await q(
    `SELECT j.id, j.job_number, j.client_id, j.store_id, j.status,
            s.store_code, s.store_name, s.latitude AS store_lat, s.longitude AS store_lng
       FROM jobs j JOIN stores s ON s.id = j.store_id
      WHERE j.id = ? LIMIT 1`,
    [jobId]
  );
  return rows[0] || null;
}

function validId(value) {
  return /^\d+$/.test(String(value));
}

function validateGps(latitude, longitude, accuracy) {
  const errors = [];
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (latitude === undefined || longitude === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    errors.push("Valid latitude and longitude are required.");
    return { errors };
  }
  if (lat < -90 || lat > 90) errors.push("Latitude must be between -90 and 90.");
  if (lng < -180 || lng > 180) errors.push("Longitude must be between -180 and 180.");
  let acc = null;
  if (accuracy !== undefined && accuracy !== null && String(accuracy).trim() !== "") {
    acc = Number(accuracy);
    if (!Number.isFinite(acc) || acc < 0) errors.push("Accuracy must be a non-negative number.");
  }
  return { errors, lat, lng, accuracy: acc };
}

function validateCapturedAt(value) {
  if (value === undefined || value === null || String(value).trim() === "") return { ok: true, value: null };
  const d = new Date(String(value).trim());
  if (Number.isNaN(d.getTime())) return { ok: false, message: "captured_at must be a valid ISO timestamp." };
  if (d.getTime() - Date.now() > 5 * 60 * 1000) {
    return { ok: false, message: "captured_at cannot be in the future." };
  }
  return { ok: true, value: d };
}

// POST /api/jobs/:id/start-travel (visits.manage, active assignee only)
exports.startTravel = async (req, res) => {
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
      return res.status(403).json({ success: false, message: "Only the currently assigned Field Executive can start travel for this job." });
    }
    if (job.status === "EN_ROUTE") {
      // Controlled conflict (double-tap / retry): point at current state,
      // create nothing.
      const open = await Visit.getOpenForAssignment(Number(id), mine.assignment_id, conn);
      conn.release();
      return res.status(409).json({
        success: false,
        message: "Travel already started for this job.",
        data: { job_id: job.id, status: job.status, visit_id: open ? open.id : null, visit_number: open ? open.visit_number : null }
      });
    }
    if (job.status !== "ASSIGNED") {
      conn.release();
      return res.status(409).json({ success: false, message: `Travel can only start from ASSIGNED (current: ${job.status}).` });
    }

    await conn.beginTransaction();
    // Module 13: a rejection opens the resubmission visit (OPEN) up
    // front. Reuse it here instead of opening a second one — travel
    // simply continues the existing bounded cycle. Fresh assignments
    // have no open visit, so creation below is unchanged for them.
    const existingOpen = await Visit.getOpenForAssignment(Number(id), mine.assignment_id, conn);
    let visitId;
    let visitNumber;
    if (existingOpen) {
      visitId = existingOpen.id;
      visitNumber = existingOpen.visit_number;
    } else {
      visitNumber = await Visit.nextVisitNumber(Number(id), conn);
      try {
        visitId = await Visit.create({ jobId: Number(id), assignmentId: mine.assignment_id, visitNumber, actorId: req.user.id }, conn);
      } catch (err) {
        if (isDuplicateEntry(err)) {
          await conn.rollback();
          conn.release();
          return res.status(409).json({ success: false, message: "A visit is already being opened for this job. Refresh and retry." });
        }
        throw err;
      }
    }
    await conn.query("UPDATE jobs SET status = 'EN_ROUTE', updated_by = ? WHERE id = ? AND status = 'ASSIGNED'", [req.user.id, Number(id)]);
    await history(conn, { jobId: Number(id), from: "ASSIGNED", to: "EN_ROUTE", by: req.user.id, remark: `Travel started (visit ${visitNumber})` });
    await audit(req, conn, { action: "JOB_TRAVEL_STARTED", entityType: "JOB", entityId: Number(id), oldValues: { status: "ASSIGNED" }, newValues: { status: "EN_ROUTE" } });
    if (!existingOpen) {
      await audit(req, conn, { action: "VISIT_CREATED", entityType: "VISIT", entityId: visitId, oldValues: null, newValues: { visit_number: visitNumber } });
    } else {
      await audit(req, conn, { action: "VISIT_RESUMED", entityType: "VISIT", entityId: visitId, oldValues: null, newValues: { visit_number: visitNumber } });
    }
    await notifyAdmins(conn, `Travel started: ${job.job_number}`,
      `${mine.employee_code} started travel to ${job.store_name} (visit ${visitNumber}).`, Number(id), "JOB_EN_ROUTE");
    await conn.commit();
    conn.release();

    const visit = await Visit.getById(visitId);
    return res.status(200).json({ success: true, message: "Travel started.", data: visit });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error starting travel:", error.message);
    return res.status(500).json({ success: false, message: "Server error while starting travel." });
  }
};

// POST /api/jobs/:id/reach-store (visits.manage, active assignee only)
exports.reachStore = async (req, res) => {
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
      return res.status(403).json({ success: false, message: "Only the currently assigned Field Executive can mark Store Reached for this job." });
    }
    if (job.status !== "EN_ROUTE") {
      conn.release();
      return res.status(409).json({
        success: false,
        message: job.status === "REACHED"
          ? "Store is already marked as reached for this job."
          : `Store Reached requires EN_ROUTE (current: ${job.status}).`,
        data: { job_id: job.id, status: job.status }
      });
    }

    const { latitude, longitude, accuracy, device_info } = req.body || {};
    const gps = validateGps(latitude, longitude, accuracy);
    if (gps.errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: gps.errors.join(" "), errors: gps.errors });
    }
    if (job.store_lat === null || job.store_lng === null) {
      conn.release();
      return res.status(409).json({
        success: false,
        message: "Store has no reference GPS. Ask the office to update the store location first.",
        code: "STORE_GPS_MISSING"
      });
    }
    const distance = haversineMeters(job.store_lat, job.store_lng, gps.lat, gps.lng);
    if (distance === null) {
      conn.release();
      return res.status(500).json({ success: false, message: "Server error while evaluating location." });
    }
    if (distance > STORE_REACH_RADIUS_METERS) {
      conn.release();
      return res.status(409).json({
        success: false,
        message: "Employee is outside the allowed store reach radius.",
        code: "OUTSIDE_REACH_RADIUS",
        data: { distance_meters: distance, radius_meters: STORE_REACH_RADIUS_METERS }
      });
    }

    await conn.beginTransaction();
    const open = await Visit.getOpenForAssignment(Number(id), mine.assignment_id, conn);
    if (!open) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "No open visit for this travel. Start travel first." });
    }
    const reachId = await Visit.insertReach({
      jobId: Number(id), assignmentId: mine.assignment_id, visitId: open.id,
      employeeId: mine.employee_id, latitude: gps.lat, longitude: gps.lng,
      accuracy: gps.accuracy, distance,
      deviceInfo: device_info ? String(device_info).slice(0, 100) : null,
      offline: false
    }, conn);
    await Visit.setStatus(open.id, "REACHED", conn);
    await conn.query("UPDATE jobs SET status = 'REACHED', updated_by = ? WHERE id = ? AND status = 'EN_ROUTE'", [req.user.id, Number(id)]);
    await history(conn, { jobId: Number(id), from: "EN_ROUTE", to: "REACHED", by: req.user.id, remark: `Store reached (visit ${open.visit_number}, ${distance}m)` });
    await audit(req, conn, { action: "JOB_STORE_REACHED", entityType: "JOB", entityId: Number(id), oldValues: { status: "EN_ROUTE" }, newValues: { status: "REACHED", distance_meters: distance } });
    await audit(req, conn, { action: "VISIT_REACHED", entityType: "VISIT", entityId: open.id, oldValues: { status: "OPEN" }, newValues: { status: "REACHED" } });
    await notifyAdmins(conn, `Store reached: ${job.job_number}`,
      `${mine.employee_code} reached ${job.store_name} (${distance}m from reference).`, Number(id), "JOB_REACHED");
    await conn.commit();
    conn.release();

    const visit = await Visit.getById(open.id);
    return res.status(200).json({ success: true, message: "Store reached recorded.", data: visit });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error recording reach:", error.message);
    return res.status(500).json({ success: false, message: "Server error while recording reach." });
  }
};

// POST /api/jobs/:id/location (visits.manage, active assignee, EN_ROUTE)
exports.postLocation = async (req, res) => {
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
      return res.status(403).json({ success: false, message: "Only the currently assigned Field Executive can post location for this job." });
    }
    if (job.status !== "EN_ROUTE") {
      conn.release();
      return res.status(409).json({ success: false, message: `Location is accepted only while EN_ROUTE (current: ${job.status}).` });
    }

    const { latitude, longitude, accuracy, speed, heading, captured_at, device_id } = req.body || {};
    const gps = validateGps(latitude, longitude, accuracy);
    if (gps.errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: gps.errors.join(" "), errors: gps.errors });
    }
    const ts = validateCapturedAt(captured_at);
    if (!ts.ok) {
      conn.release();
      return res.status(400).json({ success: false, message: ts.message });
    }
    const numOrNull = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : Number(v));
    const spd = numOrNull(speed);
    const hdg = numOrNull(heading);
    if ((spd !== null && (!Number.isFinite(spd) || spd < 0)) || (hdg !== null && (!Number.isFinite(hdg) || hdg < 0 || hdg > 360))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Speed must be >= 0 and heading 0-360." });
    }

    const [[me]] = await conn.query(
      "SELECT u.employee_id, u.id AS user_id FROM users u WHERE u.id = ? LIMIT 1",
      [req.user.id]
    );
    const pointId = await Visit.insertLocation({
      employeeId: me.employee_id, userId: me.user_id,
      latitude: gps.lat, longitude: gps.lng, accuracy: gps.accuracy,
      speed: spd, heading: hdg,
      capturedAt: ts.value ? ts.value.toISOString().slice(0, 19).replace("T", " ") : null,
      jobId: Number(id),
      deviceId: device_id ? String(device_id).slice(0, 60) : null
    }, conn);
    conn.release();
    // Deliberately no audit row per point (telemetry volume); the
    // tracking table is the record.
    return res.status(201).json({ success: true, message: "Location recorded.", data: { id: pointId } });
  } catch (error) {
    conn.release();
    console.error("Error recording location:", error.message);
    return res.status(500).json({ success: false, message: "Server error while recording location." });
  }
};

// POST /api/jobs/:id/close-visit (visits.manage, active assignee only)
// Closes the current open visit. Module 12: a captured shopkeeper
// signature for the visit is REQUIRED (-> 422 MISSING_SIGNATURE).
// Module 11 photo proof stays OPTIONAL evidence — no photo category
// blocks closure (per standing product rule). The ONLY closure path.
exports.closeVisit = async (req, res) => {
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
      return res.status(403).json({ success: false, message: "Only the currently assigned Field Executive can close the visit for this job." });
    }
    if (!["WORK_STARTED", "WORK_IN_PROGRESS", "IN_PROGRESS"].includes(job.status)) {
      conn.release();
      return res.status(409).json({
        success: false,
        message: job.status === "VISIT_CLOSED"
          ? "The visit is already closed for this job."
          : `A visit can only close once work is underway (current: ${job.status}).`,
        data: { job_id: job.id, status: job.status }
      });
    }

    const open = await Visit.getOpenForAssignment(Number(id), mine.assignment_id, conn);
    if (!open) {
      conn.release();
      return res.status(409).json({ success: false, message: "No open visit for this job." });
    }

    // Module 12 gate: signature captured for this visit (photos stay
    // optional — only the signature blocks closure).
    const [sigRows] = await conn.query(
      "SELECT id FROM job_signatures WHERE visit_id = ? LIMIT 1",
      [open.id]
    );
    if (!sigRows[0]) {
      conn.release();
      return res.status(422).json({
        success: false,
        code: "MISSING_SIGNATURE",
        message: "Capture the shopkeeper signature for this visit before closing it."
      });
    }

    await conn.beginTransaction();
    await Visit.setStatus(open.id, "VISIT_CLOSED", conn);
    await conn.query(
      "UPDATE job_visits SET closed_at = NOW(), closed_by = ? WHERE id = ?",
      [req.user.id, open.id]
    );
    await conn.query("UPDATE jobs SET status = 'VISIT_CLOSED', updated_by = ? WHERE id = ? AND status = ?", [req.user.id, Number(id), job.status]);
    await history(conn, { jobId: Number(id), from: job.status, to: "VISIT_CLOSED", by: req.user.id, remark: `Visit ${open.visit_number} closed (photo proof verified)` });
    await audit(req, conn, { action: "VISIT_CLOSED", entityType: "VISIT", entityId: open.id, oldValues: { status: open.status }, newValues: { status: "VISIT_CLOSED" } });
    await audit(req, conn, { action: "JOB_VISIT_CLOSED", entityType: "JOB", entityId: Number(id), oldValues: { status: job.status }, newValues: { status: "VISIT_CLOSED", visit_id: open.id } });
    await notifyAdmins(conn, `Visit closed: ${job.job_number}`,
      `${mine.employee_code} closed visit ${open.visit_number} at ${job.store_name} (photo proof verified).`, Number(id), "VISIT_CLOSED");
    await conn.commit();
    conn.release();

    const visit = await Visit.getById(open.id);
    return res.status(200).json({ success: true, message: "Visit closed.", data: visit });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error closing visit:", error.message);
    return res.status(500).json({ success: false, message: "Server error while closing visit." });
  }
};

// GET /api/jobs/:id/visits (scoped exactly like job detail)
exports.getJobVisits = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const scope = await visitReadScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const [job] = await db.query("SELECT id, client_id FROM jobs WHERE id = ? LIMIT 1", [Number(req.params.id)]);
    if (!job[0]) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    if (scope.employeeId !== undefined) {
      const [rows] = await db.query(
        "SELECT 1 AS ok FROM job_assignments WHERE job_id = ? AND employee_id = ? AND status IN ('ACTIVE','COMPLETED') LIMIT 1",
        [Number(req.params.id), scope.employeeId]
      );
      if (!rows[0]) {
        return res.status(404).json({ success: false, message: "Job not found." });
      }
    } else if (scope.clientId !== undefined && Number(job[0].client_id) !== scope.clientId) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const result = await Visit.list({ job_id: Number(req.params.id), page: 1, limit: 100 });
    return res.status(200).json({ success: true, data: scope.clientId !== undefined ? result.data.map(stripInternal) : result.data });
  } catch (error) {
    console.error("Error fetching job visits:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching visits." });
  }
};

// Read scope shared by visit reads: { global } | { employeeId } |
// { clientId } | { denied }. Mirrors the job visibility contract.
async function visitReadScope(req) {
  if (await hasPermission(req.user, "visits.view.all")) return { global: true };
  if (!(await hasPermission(req.user, "visits.view.own"))) return { denied: true };
  const [[row]] = await db.query("SELECT employee_id, client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  if (!row) return { denied: true };
  if (row.employee_id !== null) return { employeeId: Number(row.employee_id) };
  if (row.client_id !== null) return { clientId: Number(row.client_id) };
  return { denied: true };
}

// Client scope never sees device/internal detail.
function stripInternal(visit) {
  const copy = { ...visit };
  delete copy.device_info;
  delete copy.reach_employee_id;
  return copy;
}

// GET /api/visits (visits.view.all; filters job_id/status/page)
exports.getAllVisits = async (req, res) => {
  try {
    const { job_id = "", status = "", page = 1, limit = 20 } = req.query;
    const result = await Visit.list({ job_id, status, page, limit });
    return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Error fetching visits:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching visits." });
  }
};

// GET /api/visits/mine (visits.view.own; global viewers such as ADMIN
// fall back to the recent global queue so the shared My Visits menu
// works for every role that holds it).
exports.getMyVisits = async (req, res) => {
  try {
    const scope = await visitReadScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { status = "", page = 1, limit = 20 } = req.query;
    const result = await Visit.list({
      status, page, limit,
      scopeEmployeeId: scope.employeeId ?? null,
      scopeClientId: scope.clientId ?? null
    });
    const data = scope.clientId !== undefined ? result.data.map(stripInternal) : result.data;
    return res.status(200).json({ success: true, data, pagination: result.pagination });
  } catch (error) {
    console.error("Error fetching my visits:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching visits." });
  }
};

// GET /api/visits/:id (scoped; client view strips internal detail)
exports.getVisitById = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }
    const scope = await visitReadScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const visit = await Visit.getById(Number(req.params.id));
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
      return res.status(200).json({ success: true, data: visit });
    }
    if (scope.clientId !== undefined && Number(visit.client_id) !== scope.clientId) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }
    return res.status(200).json({
      success: true,
      data: scope.clientId !== undefined ? stripInternal(visit) : visit
    });
  } catch (error) {
    console.error("Error fetching visit:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching visit." });
  }
};

// GET /api/tracking/active (tracking.view) — latest point per tracked
// employee, with server-computed freshness. Never bulk history.
exports.getActiveTracking = async (req, res) => {
  try {
    const rows = await Visit.activeTracking();
    const data = rows.map((r) => {
      // NO_LOCATION: tracking is ON but no fix was ever received.
      // Distinct from stale/offline so the board never fakes presence.
      if (r.captured_at === null || r.captured_at === undefined) {
        return {
          ...r,
          freshness_seconds: null,
          freshness: Number(r.tracking_enabled) === 1 ? "no_location" : "offline"
        };
      }
      // Age comes DB-side (TIMESTAMPDIFF) so it is exact in ANY session
      // time zone — never re-parse rendered timestamp strings in JS
      // (that silently shifts by the host's UTC offset).
      const freshness_seconds = Math.max(0, Number(r.age_seconds) || 0);
      const freshness = freshness_seconds <= 60 ? "fresh"
        : freshness_seconds <= 180 ? "recent"
        : freshness_seconds <= 600 ? "stale" : "offline";
      const { age_seconds, ...rest } = r;
      void age_seconds;
      return { ...rest, freshness_seconds, freshness };
    });
    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("Error fetching tracking:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching tracking." });
  }
};

// ----  persistent tracking: explicit ON/OFF state owned by
// the employee. All identity derives from users.employee_id; a forged
// employee_id in the body can never redirect points to someone else. ----

// Resolve the caller's own Active employee row (or null).
async function selfEmployee(userId, conn) {
  const q = (conn || db).query.bind(conn || db);
  const [rows] = await q(
    `SELECT e.id, e.employee_code, e.employee_name, e.tracking_enabled,
            u.id AS user_id
       FROM users u JOIN employees e ON e.id = u.employee_id
      WHERE u.id = ? AND e.status = 'Active' LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

// GET /api/tracking/state — own tracking state + last reported point.
exports.getTrackingState = async (req, res) => {
  try {
    const emp = await selfEmployee(req.user.id);
    if (!emp) {
      return res.status(403).json({ success: false, message: "No active employee profile is linked to this login." });
    }
    const [pts] = await db.query(
      `SELECT latitude, longitude, accuracy_meters, captured_at, job_id
         FROM employee_location_tracking
        WHERE employee_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1`,
      [emp.id]
    );
    return res.status(200).json({
      success: true,
      data: {
        tracking_enabled: Number(emp.tracking_enabled) === 1,
        employee_id: emp.id,
        last_point: pts[0] || null
      }
    });
  } catch (error) {
    console.error("Error fetching tracking state:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

async function setTrackingEnabled(req, res, enabled, auditAction) {
  const conn = await db.getConnection();
  try {
    const emp = await selfEmployee(req.user.id, conn);
    if (!emp) {
      conn.release();
      return res.status(403).json({ success: false, message: "No active employee profile is linked to this login." });
    }
    await conn.beginTransaction();
    await conn.query("UPDATE employees SET tracking_enabled = ? WHERE id = ?", [enabled ? 1 : 0, emp.id]);
    await audit(req, conn, {
      action: auditAction, entityType: "EMPLOYEE", entityId: emp.id,
      oldValues: { tracking_enabled: Number(emp.tracking_enabled) === 1 },
      newValues: { tracking_enabled: enabled }
    });
    await conn.commit();
    conn.release();
    return res.json({ success: true, tracking_enabled: enabled });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error toggling tracking:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
}

// POST /api/tracking/enable | POST /api/tracking/disable
exports.enableTracking = (req, res) => setTrackingEnabled(req, res, true, "EMPLOYEE_TRACKING_ENABLED");
exports.disableTracking = (req, res) => setTrackingEnabled(req, res, false, "EMPLOYEE_TRACKING_DISABLED");

// POST /api/tracking/location — persistent channel. Requires tracking
// ON (else 403 TRACKING_DISABLED). job_id is derived server-side from
// the current live assignment (ACTIVE on a non-terminal job) or NULL
// when between jobs — never taken from the request.
exports.postTrackingLocation = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const emp = await selfEmployee(req.user.id, conn);
    if (!emp) {
      conn.release();
      return res.status(403).json({ success: false, message: "No active employee profile is linked to this login." });
    }
    if (Number(emp.tracking_enabled) !== 1) {
      conn.release();
      return res.status(403).json({
        success: false,
        message: "Location tracking is OFF for this employee.",
        code: "TRACKING_DISABLED"
      });
    }

    const { latitude, longitude, accuracy, speed, heading, captured_at, device_id } = req.body || {};
    const gps = validateGps(latitude, longitude, accuracy);
    if (gps.errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: gps.errors.join(" "), errors: gps.errors });
    }
    const ts = validateCapturedAt(captured_at);
    if (!ts.ok) {
      conn.release();
      return res.status(400).json({ success: false, message: ts.message });
    }
    const numOrNull = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : Number(v));
    const spd = numOrNull(speed);
    const hdg = numOrNull(heading);
    if ((spd !== null && (!Number.isFinite(spd) || spd < 0)) || (hdg !== null && (!Number.isFinite(hdg) || hdg < 0 || hdg > 360))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Speed must be >= 0 and heading 0-360." });
    }

    const [asg] = await conn.query(
      `SELECT a.job_id FROM job_assignments a
         JOIN jobs j ON j.id = a.job_id
        WHERE a.employee_id = ? AND a.status = 'ACTIVE'
          AND j.status NOT IN ('CANCELLED','COMPLETED','APPROVED')
        ORDER BY a.id DESC LIMIT 1`,
      [emp.id]
    );
    const pointId = await Visit.insertLocation({
      employeeId: emp.id, userId: emp.user_id,
      latitude: gps.lat, longitude: gps.lng, accuracy: gps.accuracy,
      speed: spd, heading: hdg,
      capturedAt: ts.value ? ts.value.toISOString().slice(0, 19).replace("T", " ") : null,
      jobId: asg[0] ? asg[0].job_id : null,
      deviceId: device_id ? String(device_id).slice(0, 60) : null
    }, conn);
    conn.release();
    // No per-point audit row (telemetry volume); the table is the record.
    return res.status(201).json({ success: true, message: "Location recorded.", data: { id: pointId, job_id: asg[0] ? asg[0].job_id : null } });
  } catch (error) {
    conn.release();
    console.error("Error recording tracking location:", error.message);
    return res.status(500).json({ success: false, message: "Server error while recording location." });
  }
};
