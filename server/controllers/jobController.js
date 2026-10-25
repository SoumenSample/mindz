/**
 * Job Controller  — operational jobs + assignment only.
 * No visits / GPS / measurements / photos / signatures / verification.
 *
 * Scoping (record-level security, always from JWT identity):
 *   - stores.view analogue jobs.view.all -> global (SUPER_ADMIN/ADMIN)
 *   - jobs.view.own + EMPLOYEE -> jobs with an ACTIVE/COMPLETED
 *     assignment to users.employee_id
 *   - jobs.view.own + CLIENT   -> jobs.client_id = users.client_id
 *   - foreign rows answer 404 (no existence leak)
 *
 * Lifecycle in this module: PENDING -> ASSIGNED (assign), reassignment
 * while PENDING/ASSIGNED, CANCELLED before field work. Later-module
 * statuses are never produced here.
 */
const db = require("../config/db");
const Job = require("../models/jobModel");
const { hasPermission } = require("../services/rbacService");

const PRE_FIELD_STATUSES = ["PENDING", "ASSIGNED"];

function isDuplicateEntry(err) {
  return err && err.code === "ER_DUP_ENTRY";
}

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

// Best-effort in-app notification (never fails the business operation).
async function notifyEmployee(conn, employeeId, title, message, jobId) {
  try {
    const [[row]] = await conn.query(
      "SELECT user_id FROM employees WHERE id = ? LIMIT 1",
      [employeeId]
    );
    if (!row || !row.user_id) return;
    await conn.query(
      `INSERT INTO notifications (user_id, title, message, type, reference_type, reference_id)
       VALUES (?, ?, ?, 'JOB_ASSIGNED', 'JOB', ?)`,
      [row.user_id, title, message, jobId]
    );
  } catch (err) {
    console.error("Job notification failed:", err.message);
  }
}

// Read scope from JWT identity: { global } | { employeeId } |
// { clientId } | { denied }. Never trusts request values.
async function resolveScope(req) {
  if (await hasPermission(req.user, "jobs.view.all")) return { global: true };
  if (!(await hasPermission(req.user, "jobs.view.own"))) return { denied: true };
  const [[row]] = await db.query(
    "SELECT employee_id, client_id FROM users WHERE id = ? LIMIT 1",
    [req.user.id]
  );
  if (!row) return { denied: true };
  if (row.employee_id !== null) return { employeeId: Number(row.employee_id) };
  if (row.client_id !== null) return { clientId: Number(row.client_id) };
  return { denied: true };
}

// Field-executive eligibility: EMPLOYEE role + FIELD_EXECUTIVE
// designation + both records Active. Returns { ok, employee } or
// { ok:false, status, message }.
async function checkExecutive(employeeId) {
  if (employeeId === undefined || employeeId === null || !/^\d+$/.test(String(employeeId))) {
    return { ok: false, status: 400, message: "Valid employee_id is required." };
  }
  const emp = await Job.validateExecutive(Number(employeeId));
  if (!emp) return { ok: false, status: 404, message: "Employee not found." };
  if (emp.emp_status !== "Active") {
    return { ok: false, status: 422, message: `Employee '${emp.employee_code}' is not active.` };
  }
  if (!emp.user_id || String(emp.user_role).toLowerCase() !== "employee" || emp.user_status !== "Active") {
    return { ok: false, status: 422, message: `Employee '${emp.employee_code}' has no active EMPLOYEE login.` };
  }
  if (!emp.designation || emp.designation !== "FIELD_EXECUTIVE") {
    return { ok: false, status: 422, message: `Employee '${emp.employee_code}' is not a Field Executive.` };
  }
  return { ok: true, employee: emp };
}

function validatePriority(priority) {
  if (priority === undefined || priority === null || String(priority).trim() === "") return null;
  if (!["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) return "Priority must be LOW, NORMAL, HIGH or URGENT.";
  return null;
}

function validateDate(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) return "Scheduled date must be YYYY-MM-DD.";
  return null;
}

// GET /api/jobs?...
exports.getAllJobs = async (req, res) => {
  try {
    const scope = await resolveScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { search = "", status = "", client_id = "", store_id = "", job_type_id = "", employee_id = "", page = 1, limit = 20 } = req.query;
    try {
      const result = await Job.list({
        search, status, client_id, store_id, job_type_id, employee_id, page, limit,
        scopeEmployeeId: scope.employeeId ?? null,
        scopeClientId: scope.clientId ?? null
      });
      return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }
  } catch (error) {
    console.error("Error fetching jobs:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching jobs." });
  }
};

// GET /api/jobs/meta/field-executives — eligible assignees for the
// assign UI. Any authenticated participant may read (assignment itself
// stays behind jobs.assign / jobs.create).
exports.getEligibleExecutives = async (req, res) => {
  try {
    const rows = await Job.eligibleExecutives();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching field executives:", error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/jobs/:id
exports.getJobById = async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const scope = await resolveScope(req);
    if (scope.denied) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const job = await Job.getById(Number(req.params.id));
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    if (scope.employeeId !== undefined) {
      const [rows] = await db.query(
        "SELECT 1 AS ok FROM job_assignments WHERE job_id = ? AND employee_id = ? AND status IN ('ACTIVE','COMPLETED') LIMIT 1",
        [job.id, scope.employeeId]
      );
      if (!rows[0]) {
        return res.status(404).json({ success: false, message: "Job not found." });
      }
    } else if (scope.clientId !== undefined && Number(job.client_id) !== scope.clientId) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }

    const assignments = await Job.getAssignments(job.id);
    const historyRows = await Job.getHistory(job.id);
    let request = null;
    if (job.job_request_id) {
      const [rr] = await db.query(
        "SELECT id, request_number, status FROM job_requests WHERE id = ? LIMIT 1",
        [job.job_request_id]
      );
      request = rr[0] || null;
    }
    //  visit summary (lightweight; full evidence via /:id/visits).
    // Reach timestamps derive from the linked reach rows — the visits
    // table itself carries no duplicate timestamp column by design.
    const [visitRows] = await db.query(
      `SELECT v.id, v.visit_number, v.status, v.started_at, v.closed_at,
              r.reached_at, r.latitude AS reach_latitude,
              r.longitude AS reach_longitude, r.distance_meters
         FROM job_visits v
         LEFT JOIN job_reach_records r ON r.visit_id = v.id
        WHERE v.job_id = ? ORDER BY v.visit_number ASC`,
      [job.id]
    );
    // Module 13: verification decisions (approve/reject + remarks).
    // Client scope sees the verdict + remark + date but never the
    // reviewer's identity; office roles see the verifier name too.
    const [verifRows] = await db.query(
      `SELECT jv.id, jv.job_id, jv.visit_id, jv.action, jv.remark, jv.verified_at,
              v.visit_number, u.name AS verifier_name
         FROM job_verifications jv
         LEFT JOIN job_visits v ON v.id = jv.visit_id
         LEFT JOIN users u ON u.id = jv.verifier_id
        WHERE jv.job_id = ? ORDER BY jv.verified_at ASC, jv.id ASC`,
      [job.id]
    );
    const verifications = (scope.clientId !== undefined)
      ? verifRows.map(({ verifier_name, ...rest }) => rest)
      : verifRows;
    // Client scope sees assignment linkage (code + name) but no office
    // operator usernames.
    const safeAssignments = (scope.clientId !== undefined)
      ? assignments.map(({ assigned_by_username, ...rest }) => rest)
      : assignments;
    return res.status(200).json({
      success: true,
      data: { ...job, assignments: safeAssignments, status_history: historyRows, verifications, request, visits: visitRows }
    });
  } catch (error) {
    console.error("Error fetching job:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching job." });
  }
};

async function buildJobPayload(body, { allowClientId }) {
  const errors = [];
  if (allowClientId && (body.client_id === undefined || !/^\d+$/.test(String(body.client_id)))) {
    errors.push("Valid client_id is required.");
  }
  if (body.store_id === undefined || !/^\d+$/.test(String(body.store_id))) {
    errors.push("Valid store_id is required.");
  }
  if (body.job_type_id !== undefined && body.job_type_id !== null && String(body.job_type_id).trim() !== "" && !/^\d+$/.test(String(body.job_type_id))) {
    errors.push("Valid job_type_id is required.");
  }
  const pErr = validatePriority(body.priority);
  if (pErr) errors.push(pErr);
  const dErr = validateDate(body.scheduled_date);
  if (dErr) errors.push(dErr);
  return errors;
}

// Shared insert used by direct creation (Flow B). Caller owns the txn.
async function insertJob(conn, { clientId, store, jobTypeId, description, scheduledDate, priority, requestId, actorId }) {
  const [result] = await conn.query(
    `INSERT INTO jobs
       (job_number, client_id, store_id, job_type_id, job_request_id, description,
        shop_name, shopkeeper_name, shopkeeper_mobile, address, city, state, pincode,
        scheduled_date, priority, status, created_by, updated_by)
     VALUES ('PENDING-NUMBER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    [
      clientId, store.id, jobTypeId, requestId || null, description || null,
      store.store_name, store.shopkeeper_name, store.shopkeeper_mobile,
      [store.address_line_1, store.address_line_2].filter(Boolean).join(", ") || null,
      store.city, store.state, store.pincode,
      scheduledDate || null, priority || "NORMAL", actorId, actorId
    ]
  );
  const jobId = result.insertId;
  const jobNumber = "JOB-" + String(jobId).padStart(6, "0");
  await conn.query("UPDATE jobs SET job_number = ? WHERE id = ?", [jobNumber, jobId]);
  return { jobId, jobNumber };
}

async function assignInTxn(conn, { jobId, fromStatus, employee, actorId, remarks }) {
  // Exactly one ACTIVE assignment: retire any current one first.
  await conn.query(
    "UPDATE job_assignments SET status = 'REASSIGNED', unassigned_at = CURRENT_TIMESTAMP WHERE job_id = ? AND status = 'ACTIVE'",
    [jobId]
  );
  const [result] = await conn.query(
    "INSERT INTO job_assignments (job_id, employee_id, assigned_by, status, remarks) VALUES (?, ?, ?, 'ACTIVE', ?)",
    [jobId, employee.id, actorId, remarks || null]
  );
  await conn.query("UPDATE jobs SET status = 'ASSIGNED', updated_by = ? WHERE id = ?", [actorId, jobId]);
  await history(conn, { jobId, from: fromStatus, to: "ASSIGNED", by: actorId, remark: remarks || null });
  return result.insertId;
}

// POST /api/jobs (jobs.create) — Flow B direct creation, optional
// same-transaction assignment (-> ASSIGNED) or plain PENDING.
exports.createJob = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const b = req.body || {};
    const errors = await buildJobPayload(b, { allowClientId: true });
    if (errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    const store = await Job.getStore(Number(b.store_id));
    if (!store || Number(store.client_id) !== Number(b.client_id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Store not found." });
    }
    if (store.status !== "ACTIVE") {
      conn.release();
      return res.status(400).json({ success: false, message: `Store '${store.store_code}' is not active.` });
    }
    let jobTypeId = null;
    if (b.job_type_id !== undefined && b.job_type_id !== null && String(b.job_type_id).trim() !== "") {
      const jt = await Job.getJobType(Number(b.job_type_id));
      if (!jt) { conn.release(); return res.status(404).json({ success: false, message: "Job type not found." }); }
      if (!jt.is_active) { conn.release(); return res.status(400).json({ success: false, message: `Job type '${jt.code}' is not active.` }); }
      jobTypeId = jt.id;
    }

    let employee = null;
    if (b.employee_id !== undefined && b.employee_id !== null && String(b.employee_id).trim() !== "") {
      const check = await checkExecutive(b.employee_id);
      if (!check.ok) {
        conn.release();
        return res.status(check.status).json({ success: false, message: check.message });
      }
      employee = check.employee;
    }

    await conn.beginTransaction();
    const { jobId, jobNumber } = await insertJob(conn, {
      clientId: Number(b.client_id), store,
      jobTypeId, description: b.description || null,
      scheduledDate: b.scheduled_date || null, priority: b.priority || null,
      requestId: null, actorId: req.user.id
    });
    await history(conn, { jobId, from: null, to: "PENDING", by: req.user.id, remark: "Job created" });
    let assignmentId = null;
    if (employee) {
      assignmentId = await assignInTxn(conn, {
        jobId, fromStatus: "PENDING", employee, actorId: req.user.id,
        remarks: b.assignment_remarks || null
      });
      await notifyEmployee(conn, employee.id, `New job assigned: ${jobNumber}`,
        `You have been assigned job ${jobNumber} at ${store.store_name}.`, jobId);
    }
    await audit(req, conn, {
      action: "JOB_CREATED", entityId: jobId,
      oldValues: null,
      newValues: { job_number: jobNumber, client_id: Number(b.client_id), store_id: store.id, assignment_id: assignmentId }
    });
    await conn.commit();
    conn.release();

    const created = await Job.getById(jobId);
    return res.status(201).json({ success: true, message: "Job created successfully.", data: created });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Job number already exists." });
    }
    console.error("Error creating job:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating job." });
  }
};

// POST /api/jobs/from-request/:requestId (jobs.create) — Flow A.
// Row-locks the request: concurrent conversions serialize, exactly one
// wins (second sees converted_job_id set -> 409). All-or-nothing txn.
exports.convertRequest = async (req, res) => {
  const { requestId } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(requestId))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job request not found." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT r.*, s.id AS store_row_id, s.client_id AS store_client_id, s.status AS store_status,
              s.store_name, s.shopkeeper_name, s.shopkeeper_mobile,
              s.address_line_1, s.address_line_2, s.city, s.state, s.pincode,
              c.status AS client_status, t.is_active AS type_active
         FROM job_requests r
         JOIN stores s ON s.id = r.store_id
         JOIN clients c ON c.id = r.client_id
         LEFT JOIN job_types t ON t.id = r.job_type_id
        WHERE r.id = ? FOR UPDATE`,
      [Number(requestId)]
    );
    const request = rows[0];
    if (!request) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ success: false, message: "Job request not found." });
    }
    if (request.status !== "ACCEPTED") {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: `Only ACCEPTED requests can be converted (current: ${request.status}).` });
    }
    if (request.converted_job_id !== null) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "Request has already been converted to a job." });
    }
    if (Number(request.store_client_id) !== Number(request.client_id)) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "Request store does not belong to the request client." });
    }
    if (request.store_status !== "ACTIVE" && request.store_status !== "Active") {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "Request store is not active." });
    }
    if (request.job_type_id !== null && !request.type_active) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "Request job type is not active." });
    }

    const { jobId, jobNumber } = await insertJob(conn, {
      clientId: Number(request.client_id),
      store: { ...request, id: request.store_row_id },
      jobTypeId: request.job_type_id,
      description: request.description,
      scheduledDate: request.preferred_date || null,
      priority: null, requestId: Number(requestId), actorId: req.user.id
    });
    await conn.query("UPDATE job_requests SET converted_job_id = ?, status = 'CONVERTED', updated_by = ? WHERE id = ?", [jobId, req.user.id, Number(requestId)]);
    await history(conn, { jobId, from: null, to: "PENDING", by: req.user.id, remark: `Converted from ${request.request_number}` });
    await audit(req, conn, {
      action: "JOB_CONVERTED_FROM_REQUEST", entityId: jobId,
      oldValues: null,
      newValues: { job_number: jobNumber, request_id: Number(requestId), request_number: request.request_number }
    });
    await conn.commit();
    conn.release();

    const created = await Job.getById(jobId);
    return res.status(201).json({ success: true, message: "Job created from request.", data: created });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Request has already been converted to a job." });
    }
    console.error("Error converting request:", error.message);
    return res.status(500).json({ success: false, message: "Server error while converting request." });
  }
};

// PUT /api/jobs/:id (jobs.update) — editable only before field work.
exports.updateJob = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const current = await Job.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job with ID ${id} not found.` });
    }
    if (!PRE_FIELD_STATUSES.includes(current.status)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Job can no longer be edited (status: ${current.status}).` });
    }

    const b = req.body || {};
    const errors = [];
    if (b.client_id !== undefined && Number(b.client_id) !== Number(current.client_id)) {
      errors.push("Job client ownership cannot be changed.");
    }
    if (b.status !== undefined) errors.push("Status cannot be changed through this endpoint.");
    if (b.job_number !== undefined) errors.push("Job number cannot be changed.");
    const pErr = validatePriority(b.priority);
    if (pErr) errors.push(pErr);
    const dErr = validateDate(b.scheduled_date);
    if (dErr) errors.push(dErr);
    let jobTypeId = current.job_type_id;
    if (b.job_type_id !== undefined && b.job_type_id !== null && String(b.job_type_id).trim() !== "") {
      if (!/^\d+$/.test(String(b.job_type_id))) errors.push("Valid job_type_id is required.");
      else {
        const jt = await Job.getJobType(Number(b.job_type_id));
        if (!jt) errors.push("Job type not found.");
        else if (!jt.is_active) errors.push(`Job type '${jt.code}' is not active.`);
        else jobTypeId = jt.id;
      }
    }
    let storeId = current.store_id;
    if (b.store_id !== undefined && b.store_id !== null && String(b.store_id).trim() !== "") {
      if (!/^\d+$/.test(String(b.store_id))) errors.push("Valid store_id is required.");
      else {
        const store = await Job.getStore(Number(b.store_id));
        if (!store || Number(store.client_id) !== Number(current.client_id)) {
          errors.push("Store not found.");
        } else if (store.status !== "ACTIVE" && store.status !== "Active") {
          errors.push(`Store '${store.store_code}' is not active.`);
        } else {
          storeId = store.id;
        }
      }
    }
    if (errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    await conn.beginTransaction();
    await conn.query(
      `UPDATE jobs SET job_type_id = ?, description = ?, scheduled_date = ?,
         priority = ?, store_id = ?, updated_by = ? WHERE id = ?`,
      [
        jobTypeId,
        b.description !== undefined ? (b.description || null) : current.description,
        b.scheduled_date !== undefined ? (b.scheduled_date || null) : current.scheduled_date,
        b.priority !== undefined && b.priority !== null && String(b.priority).trim() !== "" ? b.priority : current.priority,
        storeId, req.user.id, Number(id)
      ]
    );
    await audit(req, conn, {
      action: "JOB_UPDATED", entityId: Number(id),
      oldValues: { job_type_id: current.job_type_id, store_id: current.store_id, priority: current.priority },
      newValues: { job_type_id: jobTypeId, store_id: storeId, priority: b.priority || current.priority }
    });
    await conn.commit();
    conn.release();

    const updated = await Job.getById(Number(id));
    return res.status(200).json({ success: true, message: "Job updated successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error updating job:", error.message);
    return res.status(500).json({ success: false, message: "Server error while updating job." });
  }
};

// PATCH /api/jobs/:id/assign (jobs.assign) — initial assignment only.
exports.assignJob = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const current = await Job.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job with ID ${id} not found.` });
    }
    if (current.status !== "PENDING") {
      conn.release();
      return res.status(409).json({ success: false, message: `Only PENDING jobs can be assigned here (status: ${current.status}). Use reassign.` });
    }
    const check = await checkExecutive(req.body?.employee_id);
    if (!check.ok) {
      conn.release();
      return res.status(check.status).json({ success: false, message: check.message });
    }

    await conn.beginTransaction();
    const assignmentId = await assignInTxn(conn, {
      jobId: Number(id), fromStatus: "PENDING", employee: check.employee,
      actorId: req.user.id, remarks: req.body?.remarks || null
    });
    await notifyEmployee(conn, check.employee.id, `New job assigned: ${current.job_number}`,
      `You have been assigned job ${current.job_number} at ${current.shop_name}.`, Number(id));
    await audit(req, conn, {
      action: "JOB_ASSIGNED", entityId: Number(id),
      oldValues: { status: "PENDING" },
      newValues: { status: "ASSIGNED", assignment_id: assignmentId, employee_id: check.employee.id }
    });
    await conn.commit();
    conn.release();

    const updated = await Job.getById(Number(id));
    return res.status(200).json({ success: true, message: "Job assigned successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error assigning job:", error.message);
    return res.status(500).json({ success: false, message: "Server error while assigning job." });
  }
};

// PATCH /api/jobs/:id/reassign (jobs.reassign) — PENDING/ASSIGNED only.
exports.reassignJob = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const current = await Job.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job with ID ${id} not found.` });
    }
    if (!PRE_FIELD_STATUSES.includes(current.status)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Job can no longer be reassigned (status: ${current.status}).` });
    }
    const check = await checkExecutive(req.body?.employee_id);
    if (!check.ok) {
      conn.release();
      return res.status(check.status).json({ success: false, message: check.message });
    }

    await conn.beginTransaction();
    const previous = await Job.getActiveAssignment(Number(id), conn);
    const assignmentId = await assignInTxn(conn, {
      jobId: Number(id), fromStatus: current.status, employee: check.employee,
      actorId: req.user.id, remarks: req.body?.reason || req.body?.remarks || null
    });
    await notifyEmployee(conn, check.employee.id, `New job assigned: ${current.job_number}`,
      `Job ${current.job_number} at ${current.shop_name} was reassigned to you.`, Number(id));
    if (previous && previous.employee_id !== check.employee.id) {
      await notifyEmployee(conn, previous.employee_id, `Job reassigned: ${current.job_number}`,
        `Job ${current.job_number} was reassigned to another executive.`, Number(id));
    }
    await audit(req, conn, {
      action: "JOB_REASSIGNED", entityId: Number(id),
      oldValues: { status: current.status, assignment_id: previous ? previous.id : null, employee_id: previous ? previous.employee_id : null },
      newValues: { status: "ASSIGNED", assignment_id: assignmentId, employee_id: check.employee.id }
    });
    await conn.commit();
    conn.release();

    const updated = await Job.getById(Number(id));
    return res.status(200).json({ success: true, message: "Job reassigned successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error reassigning job:", error.message);
    return res.status(500).json({ success: false, message: "Server error while reassigning job." });
  }
};

// PATCH /api/jobs/:id/cancel (jobs.cancel) — before field work only.
exports.cancelJob = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const current = await Job.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job with ID ${id} not found.` });
    }
    if (!PRE_FIELD_STATUSES.includes(current.status)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Job can no longer be cancelled (status: ${current.status}).` });
    }

    await conn.beginTransaction();
    await conn.query(
      "UPDATE job_assignments SET status = 'CANCELLED', unassigned_at = CURRENT_TIMESTAMP WHERE job_id = ? AND status = 'ACTIVE'",
      [Number(id)]
    );
    await conn.query("UPDATE jobs SET status = 'CANCELLED', updated_by = ? WHERE id = ?", [req.user.id, Number(id)]);
    await history(conn, { jobId: Number(id), from: current.status, to: "CANCELLED", by: req.user.id, remark: req.body?.reason || null });
    await audit(req, conn, {
      action: "JOB_CANCELLED", entityId: Number(id),
      oldValues: { status: current.status }, newValues: { status: "CANCELLED" }
    });
    await conn.commit();
    conn.release();

    const updated = await Job.getById(Number(id));
    return res.status(200).json({ success: true, message: "Job cancelled.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error cancelling job:", error.message);
    return res.status(500).json({ success: false, message: "Server error while cancelling job." });
  }
};
