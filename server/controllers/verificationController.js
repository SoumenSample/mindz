/**
 * Verification Controller (Module 13) — Admin review queue, evidence
 * pinned to the exact visit under review, approve / reject decisions.
 *
 * Lifecycle (canonical, see 007 header):
 *   ... VISIT_CLOSED > SUBMITTED > UNDER_VERIFICATION > APPROVED
 *   Reject path: UNDER_VERIFICATION > REJECTED > RESUBMISSION_REQUIRED
 *   > ASSIGNED (+ exactly one new OPEN visit, evidence preserved).
 *
 * Invariants:
 *   - closeVisit is untouched: a closed visit IS the submission. The
 *     queue treats VISIT_CLOSED as submission-ready alongside SUBMITTED
 *     and UNDER_VERIFICATION.
 *   - Only jobs.verify holders reach these endpoints (route middleware);
 *     EMPLOYEE/CLIENT hold no such grant, so direct calls 403.
 *   - Reviewer identity is ALWAYS req.user.id — body-supplied reviewer
 *     ids are ignored; body-supplied visit_id is validated against the
 *     latest eligible closed visit (forged/stale -> 409).
 *   - Approve/reject run in a transaction with SELECT ... FOR UPDATE on
 *     the job row, so concurrent decisions serialize: exactly one wins,
 *     the other gets 409. Rejection creates exactly one new visit.
 *   - Historical evidence (sheets, photos, signature, reach, history) is
 *     never mutated — rejection only INSERTs.
 */
const db = require("../config/db");
const Job = require("../models/jobModel");

const REVIEWABLE = ["VISIT_CLOSED", "SUBMITTED", "UNDER_VERIFICATION"];

function audit(req, conn, { action, entityId, oldValues, newValues }) {
  const ip = (req.ip || "").slice(0, 45);
  const ua = (req.headers["user-agent"] || "").slice(0, 255);
  const q = (conn || db).query.bind(conn || db);
  return q(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (?, ?, 'JOB', ?, ?, ?, ?, ?)`,
    [
      req.user.id, action, entityId ?? null,
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

// Best-effort in-app notification to one user (never fails the op).
async function notifyUser(conn, userId, title, message, jobId, type) {
  try {
    await conn.query(
      `INSERT INTO notifications (user_id, title, message, type, reference_type, reference_id)
       VALUES (?, ?, ?, ?, 'JOB', ?)`,
      [userId, title, message, type, jobId]
    );
  } catch (err) {
    console.error("Verification notification failed:", err.message);
  }
}

// Assigned executive's login user (or null when unlinked).
async function employeeUserId(conn, employeeId) {
  const [[row]] = await conn.query("SELECT user_id FROM employees WHERE id = ? LIMIT 1", [employeeId]);
  return row && row.user_id ? row.user_id : null;
}

// Active logins of the owning client organisation.
async function clientUserIds(conn, clientId) {
  const [rows] = await conn.query(
    "SELECT id FROM users WHERE client_id = ? AND status = 'Active'",
    [clientId]
  );
  return rows.map((r) => r.id);
}

function validId(value) {
  return /^\d+$/.test(String(value));
}

// Latest VISIT_CLOSED visit of a job (row-locked in decisions).
async function latestClosedVisit(jobId, conn, forUpdate) {
  const [rows] = await conn.query(
    `SELECT * FROM job_visits WHERE job_id = ? AND status = 'VISIT_CLOSED'
      ORDER BY visit_number DESC, id DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [jobId]
  );
  return rows[0] || null;
}

function cleanRemark(value, { required }) {
  if (value === undefined || value === null) {
    return required
      ? { ok: false, status: 400, message: "Rejection remark is required." }
      : { ok: true, value: null };
  }
  const trimmed = String(value).trim();
  if (trimmed === "") {
    return required
      ? { ok: false, status: 400, message: "Rejection remark is required." }
      : { ok: true, value: null };
  }
  if (trimmed.length > 255) {
    return { ok: false, status: 400, message: "Remark must be 255 characters or fewer." };
  }
  return { ok: true, value: trimmed };
}

// GET /api/jobs/verification-queue?search=&client_id=&store_id=
//   &job_type_id=&employee_id=&verification_status=&submitted_from=&
//   submitted_to=&page=&limit=   (jobs.verify)
exports.getQueue = async (req, res) => {
  try {
    const {
      search = "", client_id = "", store_id = "", job_type_id = "",
      employee_id = "", verification_status = "",
      submitted_from = "", submitted_to = "",
      page = 1, limit = 20
    } = req.query;

    const where = [];
    const params = [];

    // Verification status filter: CSV subset of the reviewable set.
    let statuses = REVIEWABLE;
    if (verification_status && String(verification_status).trim() !== "") {
      const asked = String(verification_status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      const unknown = asked.filter((s) => !REVIEWABLE.includes(s));
      if (unknown.length > 0) {
        return res.status(400).json({ success: false, message: `Invalid verification_status. Use: ${REVIEWABLE.join(", ")}.` });
      }
      statuses = asked;
    }
    where.push(`j.status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);

    if (search && search.trim() !== "") {
      where.push("(j.job_number LIKE ? OR j.shop_name LIKE ? OR s.store_code LIKE ? OR s.store_name LIKE ? OR c.client_code LIKE ? OR c.client_name LIKE ? OR t.name LIKE ?)");
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like, like, like, like);
    }
    const numericFilter = (name, value) => {
      if (value !== "" && value !== null && value !== undefined) {
        if (!/^\d+$/.test(String(value))) {
          const err = new Error(`Invalid ${name} filter.`);
          err.statusCode = 400;
          throw err;
        }
      }
    };
    try {
      numericFilter("client_id", client_id);
      numericFilter("store_id", store_id);
      numericFilter("job_type_id", job_type_id);
      numericFilter("employee_id", employee_id);
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (client_id !== "" && client_id !== null && client_id !== undefined) {
      where.push("j.client_id = ?");
      params.push(Number(client_id));
    }
    if (store_id !== "" && store_id !== null && store_id !== undefined) {
      where.push("j.store_id = ?");
      params.push(Number(store_id));
    }
    if (job_type_id !== "" && job_type_id !== null && job_type_id !== undefined) {
      where.push("j.job_type_id = ?");
      params.push(Number(job_type_id));
    }
    if (employee_id !== "" && employee_id !== null && employee_id !== undefined) {
      where.push("act.employee_id = ?");
      params.push(Number(employee_id));
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (submitted_from && String(submitted_from).trim() !== "") {
      if (!dateRe.test(String(submitted_from).trim())) {
        return res.status(400).json({ success: false, message: "submitted_from must be YYYY-MM-DD." });
      }
      where.push("DATE(lv.closed_at) >= ?");
      params.push(String(submitted_from).trim());
    }
    if (submitted_to && String(submitted_to).trim() !== "") {
      if (!dateRe.test(String(submitted_to).trim())) {
        return res.status(400).json({ success: false, message: "submitted_to must be YYYY-MM-DD." });
      }
      where.push("DATE(lv.closed_at) <= ?");
      params.push(String(submitted_to).trim());
    }

    const FROM = `
        FROM jobs j
        JOIN clients c ON c.id = j.client_id
        JOIN stores s ON s.id = j.store_id
        LEFT JOIN job_types t ON t.id = j.job_type_id
        LEFT JOIN job_assignments act ON act.job_id = j.id AND act.status = 'ACTIVE'
        LEFT JOIN employees ae ON ae.id = act.employee_id
        LEFT JOIN (
          SELECT job_id, MAX(visit_number) AS max_closed_no
            FROM job_visits WHERE status = 'VISIT_CLOSED' GROUP BY job_id
        ) mc ON mc.job_id = j.id
        LEFT JOIN job_visits lv ON lv.job_id = j.id AND lv.visit_number = mc.max_closed_no`;
    const whereSql = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${FROM} ${whereSql}`, params);

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `SELECT j.id, j.job_number, j.client_id, j.store_id, j.job_type_id,
              j.priority, j.status, j.scheduled_date, j.created_at, j.updated_at,
              c.client_code, c.client_name,
              s.store_code, s.store_name,
              t.code AS job_type_code, t.name AS job_type_name,
              ae.employee_code AS assigned_code, ae.employee_name AS assigned_name,
              lv.id AS latest_closed_visit_id,
              lv.visit_number AS latest_closed_visit_number,
              lv.closed_at AS submitted_at,
              (SELECT COUNT(*) FROM job_verifications jv WHERE jv.job_id = j.id) AS verification_count
         ${FROM} ${whereSql}
        ORDER BY lv.closed_at DESC, j.id DESC LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page: safePage, limit: safeLimit, total,
        totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit)
      }
    });
  } catch (error) {
    console.error("Error fetching verification queue:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching verification queue." });
  }
};

// GET /api/jobs/:id/verification (jobs.verify) — review bundle pinned to
// the latest eligible closed visit. Evidence never crosses visits.
exports.getDetail = async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const jobId = Number(req.params.id);
    const job = await Job.getById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }

    const assignments = await Job.getAssignments(jobId);
    const historyRows = await Job.getHistory(jobId);

    const [visitRows] = await db.query(
      `SELECT v.id, v.visit_number, v.status, v.started_at, v.closed_at,
              r.reached_at, r.latitude AS reach_latitude, r.longitude AS reach_longitude,
              r.accuracy_meters AS reach_accuracy, r.distance_meters
         FROM job_visits v
         LEFT JOIN job_reach_records r ON r.visit_id = v.id
        WHERE v.job_id = ? ORDER BY v.visit_number ASC`,
      [jobId]
    );

    const [verifs] = await db.query(
      `SELECT jv.id, jv.job_id, jv.visit_id, jv.action, jv.remark, jv.verified_at,
              v.visit_number, u.name AS verifier_name
         FROM job_verifications jv
         LEFT JOIN job_visits v ON v.id = jv.visit_id
         LEFT JOIN users u ON u.id = jv.verifier_id
        WHERE jv.job_id = ? ORDER BY jv.verified_at ASC, jv.id ASC`,
      [jobId]
    );

    // Latest eligible closed visit = highest closed visit number.
    const closed = visitRows.filter((v) => v.status === "VISIT_CLOSED");
    const reviewVisit = closed.length > 0 ? closed[closed.length - 1] : null;

    let evidence = null;
    if (reviewVisit) {
      const [[sheet]] = await db.query(
        `SELECT id, version_no, status FROM measurement_sheets
          WHERE job_id = ? AND visit_id = ? AND status = 'FINAL'
          ORDER BY version_no DESC LIMIT 1`,
        [jobId, reviewVisit.id]
      );
      let items = [];
      if (sheet) {
        const [itemRows] = await db.query(
          `SELECT sequence_no, width_ft, height_ft, quantity, media_type, remarks
             FROM measurement_items WHERE measurement_sheet_id = ?
             ORDER BY sequence_no ASC`,
          [sheet.id]
        );
        items = itemRows;
      }
      const [photos] = await db.query(
        `SELECT p.id, p.job_id, p.visit_id, p.measurement_item_id, p.photo_type,
                p.latitude, p.longitude, p.captured_at, p.created_at,
                mi.sequence_no AS item_sequence_no
           FROM job_photos p
           LEFT JOIN measurement_items mi ON mi.id = p.measurement_item_id
          WHERE p.visit_id = ? ORDER BY p.created_at ASC, p.id ASC`,
        [reviewVisit.id]
      );
      const [[signature]] = await db.query(
        `SELECT id, job_id, visit_id, signer_name, signer_mobile, remarks,
                signed_at, latitude, longitude, created_at
           FROM job_signatures WHERE visit_id = ? LIMIT 1`,
        [reviewVisit.id]
      );
      evidence = {
        visit: reviewVisit,
        measurement_sheet: sheet || null,
        measurement_items: items,
        photos,
        signature: signature || null
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        job, assignments, status_history: historyRows,
        visits: visitRows, verifications: verifs,
        review_visit: reviewVisit,
        evidence
      }
    });
  } catch (error) {
    console.error("Error fetching verification detail:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching verification detail." });
  }
};

// POST /api/jobs/:id/approve (jobs.verify) — optional remark.
exports.approveJob = async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(404).json({ success: false, message: "Job not found." });
  }
  const jobId = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    const remark = cleanRemark(req.body?.remark, { required: false });
    if (!remark.ok) {
      conn.release();
      return res.status(remark.status).json({ success: false, message: remark.message });
    }

    await conn.beginTransaction();
    const [[job]] = await conn.query("SELECT * FROM jobs WHERE id = ? FOR UPDATE", [jobId]);
    if (!job) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    if (!REVIEWABLE.includes(job.status)) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({
        success: false,
        message: `Job is not awaiting verification (status: ${job.status}).`,
        data: { job_id: job.id, status: job.status }
      });
    }

    const reviewVisit = await latestClosedVisit(jobId, conn, true);
    if (!reviewVisit) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "No closed visit is awaiting review for this job." });
    }
    if (req.body?.visit_id !== undefined && req.body.visit_id !== null && String(req.body.visit_id).trim() !== "") {
      if (!validId(req.body.visit_id) || Number(req.body.visit_id) !== reviewVisit.id) {
        await conn.rollback();
        conn.release();
        return res.status(409).json({ success: false, message: "The visit under review has changed. Refresh and retry." });
      }
    }

    await conn.query(
      "INSERT INTO job_verifications (job_id, visit_id, verifier_id, action, remark) VALUES (?, ?, ?, 'APPROVE', ?)",
      [jobId, reviewVisit.id, req.user.id, remark.value]
    );
    await conn.query("UPDATE jobs SET status = 'APPROVED', updated_by = ? WHERE id = ?", [req.user.id, jobId]);
    const active = await Job.getActiveAssignment(jobId, conn);
    if (active) {
      await conn.query("UPDATE job_assignments SET status = 'COMPLETED' WHERE id = ?", [active.id]);
    }
    await history(conn, {
      jobId, from: job.status, to: "APPROVED", by: req.user.id,
      remark: remark.value || `Visit ${reviewVisit.visit_number} approved`
    });
    await audit(req, conn, {
      action: "JOB_APPROVED", entityId: jobId,
      oldValues: { status: job.status, visit_id: reviewVisit.id },
      newValues: { status: "APPROVED", visit_id: reviewVisit.id, remark: remark.value }
    });

    // Post-commit notices (best-effort; never roll back the decision).
    const notices = [];
    if (active) {
      const empUser = await employeeUserId(conn, active.employee_id);
      if (empUser) {
        notices.push([empUser, `Job approved: ${job.job_number}`,
          `Visit ${reviewVisit.visit_number} of job ${job.job_number} was approved${remark.value ? `: ${remark.value}` : "."}`, "JOB_APPROVED"]);
      }
    }
    const clientUsers = await clientUserIds(conn, job.client_id);
    for (const uid of clientUsers) {
      notices.push([uid, `Job approved: ${job.job_number}`,
        `Job ${job.job_number} at ${job.shop_name || ""} has been approved.`, "JOB_APPROVED"]);
    }
    await conn.commit();
    for (const [uid, title, message, type] of notices) {
      await notifyUser(conn, uid, title, message, jobId, type);
    }
    conn.release();

    const updated = await Job.getById(jobId);
    return res.status(200).json({ success: true, message: "Job approved.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error approving job:", error.message);
    return res.status(500).json({ success: false, message: "Server error while approving job." });
  }
};

// POST /api/jobs/:id/reject (jobs.verify) — remark MANDATORY. Creates
// exactly one new OPEN visit (next sequential number, same assignment)
// and returns the job to ASSIGNED. Old evidence is never touched.
exports.rejectJob = async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(404).json({ success: false, message: "Job not found." });
  }
  const jobId = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    const remark = cleanRemark(req.body?.remark, { required: true });
    if (!remark.ok) {
      conn.release();
      return res.status(remark.status).json({ success: false, message: remark.message });
    }

    await conn.beginTransaction();
    const [[job]] = await conn.query("SELECT * FROM jobs WHERE id = ? FOR UPDATE", [jobId]);
    if (!job) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    if (!REVIEWABLE.includes(job.status)) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({
        success: false,
        message: `Job is not awaiting verification (status: ${job.status}).`,
        data: { job_id: job.id, status: job.status }
      });
    }

    const reviewVisit = await latestClosedVisit(jobId, conn, true);
    if (!reviewVisit) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "No closed visit is awaiting review for this job." });
    }
    if (req.body?.visit_id !== undefined && req.body.visit_id !== null && String(req.body.visit_id).trim() !== "") {
      if (!validId(req.body.visit_id) || Number(req.body.visit_id) !== reviewVisit.id) {
        await conn.rollback();
        conn.release();
        return res.status(409).json({ success: false, message: "The visit under review has changed. Refresh and retry." });
      }
    }

    // Preserve the current executive: the ACTIVE assignment carries over
    // to the new visit (no silent reassignment, no picker in the dialog).
    const active = await Job.getActiveAssignment(jobId, conn);
    if (!active) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "No active assignment to return this job to." });
    }

    await conn.query(
      "INSERT INTO job_verifications (job_id, visit_id, verifier_id, action, remark) VALUES (?, ?, ?, 'REJECT', ?)",
      [jobId, reviewVisit.id, req.user.id, remark.value]
    );

    // Exactly one new visit: MAX+1 is computed inside the row-locked
    // transaction, and the UNIQUE (job_id, visit_number) key turns any
    // residual race into ER_DUP_ENTRY -> 409 (never twin visits).
    const [[{ next_no }]] = await conn.query(
      "SELECT COALESCE(MAX(visit_number), 0) + 1 AS next_no FROM job_visits WHERE job_id = ?",
      [jobId]
    );
    let newVisitId;
    try {
      const [ins] = await conn.query(
        "INSERT INTO job_visits (job_id, assignment_id, visit_number, status) VALUES (?, ?, ?, 'OPEN')",
        [jobId, active.id, Number(next_no)]
      );
      newVisitId = ins.insertId;
    } catch (err) {
      if (err && err.code === "ER_DUP_ENTRY") {
        await conn.rollback();
        conn.release();
        return res.status(409).json({ success: false, message: "A decision was already recorded for this job. Refresh and retry." });
      }
      throw err;
    }

    await conn.query("UPDATE jobs SET status = 'ASSIGNED', updated_by = ? WHERE id = ?", [req.user.id, jobId]);
    await history(conn, { jobId, from: job.status, to: "REJECTED", by: req.user.id, remark: remark.value });
    await history(conn, { jobId, from: "REJECTED", to: "RESUBMISSION_REQUIRED", by: req.user.id, remark: remark.value });
    await history(conn, {
      jobId, from: "RESUBMISSION_REQUIRED", to: "ASSIGNED", by: req.user.id,
      remark: `Resubmission visit ${next_no} opened for rework`
    });
    await audit(req, conn, {
      action: "JOB_REJECTED", entityId: jobId,
      oldValues: { status: job.status, visit_id: reviewVisit.id },
      newValues: { status: "REJECTED", visit_id: reviewVisit.id, remark: remark.value, new_visit_id: newVisitId }
    });
    await audit(req, conn, {
      action: "JOB_RESUBMISSION_CREATED", entityId: jobId,
      oldValues: null,
      newValues: { new_visit_id: newVisitId, visit_number: Number(next_no), assignment_id: active.id }
    });

    const notices = [];
    const empUser = await employeeUserId(conn, active.employee_id);
    if (empUser) {
      notices.push([empUser, `Job needs rework: ${job.job_number}`,
        `Visit ${reviewVisit.visit_number} of job ${job.job_number} was rejected: ${remark.value} A new visit (${next_no}) is open for rework.`, "JOB_REJECTED"]);
    }
    const clientUsers = await clientUserIds(conn, job.client_id);
    for (const uid of clientUsers) {
      notices.push([uid, `Job sent back for rework: ${job.job_number}`,
        `Job ${job.job_number} was sent back for rework: ${remark.value}`, "JOB_REJECTED"]);
    }
    await conn.commit();
    for (const [uid, title, message, type] of notices) {
      await notifyUser(conn, uid, title, message, jobId, type);
    }
    conn.release();

    const updated = await Job.getById(jobId);
    return res.status(200).json({
      success: true,
      message: `Visit ${reviewVisit.visit_number} rejected. Visit ${next_no} opened for rework.`,
      data: { job: updated, new_visit_id: newVisitId, new_visit_number: Number(next_no) }
    });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error rejecting job:", error.message);
    return res.status(500).json({ success: false, message: "Server error while rejecting job." });
  }
};
