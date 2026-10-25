/**
 * Job Request Controller  — requests only, no operational Jobs.
 * Ownership model:
 *   - stores.view.all analogue: requests.view.all -> global office queue
 *   - requests.view.own -> forced users.client_id scope (CLIENT)
 *   - request.client_id == store.client_id enforced on every write
 *   - foreign rows answer 404 (no existence leak)
 * Lifecycle enforced in SQL (WHERE status='PENDING'): only
 * PENDING->ACCEPTED / PENDING->REJECTED / PENDING->CANCELLED exist.
 * converted_job_id is Module-8-only and never written here.
 */
const db = require("../config/db");
const JobRequest = require("../models/jobRequestModel");
const { generateRequestNumber } = require("../models/jobRequestModel");
const { hasPermission } = require("../services/rbacService");

const ALLOWED_STATUS_FILTER = ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED", "CONVERTED"];

function isDuplicateEntry(err) {
  return err && err.code === "ER_DUP_ENTRY";
}

function audit(req, conn, { action, entityId, oldValues, newValues }) {
  const ip = (req.ip || "").slice(0, 45);
  const ua = (req.headers["user-agent"] || "").slice(0, 255);
  const q = (conn || db).query.bind(conn || db);
  return q(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (?, ?, 'JOB_REQUEST', ?, ?, ?, ?, ?)`,
    [
      req.user.id, action, entityId ?? null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ip || null, ua || null
    ]
  );
}

// Best-effort in-app notifications (isolated: failures never fail the
// business operation; Module 15 owns the full notification story).
async function notify(conn, userIds, title, message, requestId) {
  try {
    const ids = [...new Set(userIds.filter(Boolean))];
    for (const uid of ids) {
      await conn.query(
        `INSERT INTO notifications (user_id, title, message, type, reference_type, reference_id)
         VALUES (?, ?, ?, 'REQUEST_UPDATE', 'JOB_REQUEST', ?)`,
        [uid, title, message, requestId]
      );
    }
  } catch (err) {
    console.error("Notification insert failed:", err.message);
  }
}

async function adminUserIds(conn) {
  const q = (conn || db).query.bind(conn || db);
  const [rows] = await q(
    "SELECT id FROM users WHERE status = 'Active' AND role IN ('super_admin','admin')"
  );
  return rows.map((r) => r.id);
}

async function clientUserIds(conn, clientId, excludeId = null) {
  const [rows] = await conn.query(
    "SELECT id FROM users WHERE status = 'Active' AND client_id = ?",
    [clientId]
  );
  return rows.map((r) => r.id).filter((id) => id !== excludeId);
}

// Read scope: null = global, number = forced own client_id,
// false = no view grant. Client link comes from the JWT identity.
async function resolveScope(req) {
  if (await hasPermission(req.user, "requests.view.all")) return { scope: null };
  if (await hasPermission(req.user, "requests.view.own")) {
    const [[row]] = await db.query("SELECT client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
    if (!row || row.client_id === null) return { scope: false };
    return { scope: Number(row.client_id) };
  }
  return { scope: false };
}

// Global writers (ADMIN/SUPER_ADMIN) vs scoped CLIENT identity for writes.
async function resolveWriter(req) {
  if (await hasPermission(req.user, "requests.view.all")) return { global: true };
  const [[row]] = await db.query("SELECT client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  if (!row || row.client_id === null) return { denied: true };
  return { clientId: Number(row.client_id) };
}

function validateDate(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) return "Preferred date must be YYYY-MM-DD.";
  const d = new Date(String(value).trim() + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "Preferred date is not a real date.";
  return null;
}

// GET /api/job-requests?... (scoped for CLIENT)
exports.getAllRequests = async (req, res) => {
  try {
    const { scope } = await resolveScope(req);
    if (scope === false) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { search = "", client_id = "", store_id = "", job_type_id = "", status = "", page = 1, limit = 20 } = req.query;
    if (status && !ALLOWED_STATUS_FILTER.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status filter." });
    }
    try {
      const result = await JobRequest.list({ search, client_id, store_id, job_type_id, status, page, limit, forcedClientId: scope });
      return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }
  } catch (error) {
    console.error("Error fetching job requests:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching job requests." });
  }
};

// GET /api/job-requests/meta/job-types — active masters for request forms.
// Any authenticated participant (CLIENT create, ADMIN review) may read.
exports.getActiveJobTypes = async (req, res) => {
  try {
    const rows = await JobRequest.activeJobTypes();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching job types:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching job types." });
  }
};

// GET /api/job-requests/:id
exports.getRequestById = async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) {
      return res.status(404).json({ success: false, message: "Job request not found." });
    }
    const { scope } = await resolveScope(req);
    if (scope === false) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const row = await JobRequest.getById(Number(req.params.id));
    if (!row || (scope !== null && Number(row.client_id) !== scope)) {
      return res.status(404).json({ success: false, message: "Job request not found." });
    }
    return res.status(200).json({ success: true, data: row });
  } catch (error) {
    console.error("Error fetching job request:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching job request." });
  }
};

// POST /api/job-requests (requests.create; CLIENT forced to own client)
exports.createRequest = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const b = req.body || {};

    const writer = await resolveWriter(req);
    if (writer.denied) {
      conn.release();
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    // CLIENT sends no client_id (form omits it); any forged value is
    // discarded. ADMIN/SUPER_ADMIN select explicitly (validated below).
    const effectiveClientId = writer.global ? Number(b.client_id) : writer.clientId;
    if (writer.global && (b.client_id === undefined || b.client_id === null || !/^\d+$/.test(String(b.client_id)))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Valid client_id is required." });
    }

    if (b.job_type_id === undefined || b.job_type_id === null || !/^\d+$/.test(String(b.job_type_id))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Valid job_type_id is required." });
    }
    if (b.store_id === undefined || b.store_id === null || !/^\d+$/.test(String(b.store_id))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Valid store_id is required." });
    }
    const dateError = validateDate(b.preferred_date);
    if (dateError) {
      conn.release();
      return res.status(400).json({ success: false, message: dateError });
    }
    // Supplied status is never honored: every request starts PENDING.

    const jobType = await JobRequest.getJobType(Number(b.job_type_id));
    if (!jobType) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job type with ID ${b.job_type_id} not found.` });
    }
    if (!jobType.is_active) {
      conn.release();
      return res.status(400).json({ success: false, message: `Job type '${jobType.code}' is not active.` });
    }

    const store = await JobRequest.getStore(Number(b.store_id));
    if (!store || Number(store.client_id) !== Number(effectiveClientId)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Store not found." });
    }
    if (store.status !== "ACTIVE") {
      conn.release();
      return res.status(400).json({ success: false, message: `Store '${store.store_code}' is not active.` });
    }

    const [[clientRow]] = await conn.query("SELECT id, status FROM clients WHERE id = ? LIMIT 1", [effectiveClientId]);
    if (!clientRow) {
      conn.release();
      return res.status(404).json({ success: false, message: "Client not found." });
    }
    if (clientRow.status !== "Active") {
      conn.release();
      return res.status(400).json({ success: false, message: "Client is not active." });
    }

    await conn.beginTransaction();
    let insertId = null;
    let lastDup = null;
    for (let attempt = 0; attempt < 3 && insertId === null; attempt++) {
      try {
        insertId = await JobRequest.create(
          {
            request_number: generateRequestNumber(),
            client_id: effectiveClientId,
            store_id: Number(b.store_id),
            job_type_id: Number(b.job_type_id),
            preferred_date: b.preferred_date || null,
            description: b.description || null,
            remarks: b.remarks || null
          },
          req.user.id, conn
        );
      } catch (err) {
        if (isDuplicateEntry(err)) { lastDup = err; continue; }
        throw err;
      }
    }
    if (insertId === null) throw lastDup || new Error("Request number collision.");
    await audit(req, conn, {
      action: "JOB_REQUEST_CREATED", entityId: insertId,
      oldValues: null,
      newValues: { client_id: effectiveClientId, store_id: Number(b.store_id), job_type_id: Number(b.job_type_id) }
    });
    await notify(conn, await adminUserIds(conn), "New job request",
      `Client request for store ${store.store_code} needs review.`, insertId);
    await conn.commit();
    conn.release();

    const created = await JobRequest.getById(insertId);
    return res.status(201).json({ success: true, message: "Job request submitted successfully.", data: created });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error creating job request:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating job request." });
  }
};

// PUT /api/job-requests/:id (requests.update.own; own + PENDING only)
exports.updateRequest = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job request not found." });
    }
    const current = await JobRequest.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job request with ID ${id} not found.` });
    }
    const writer = await resolveWriter(req);
    if (!writer.global && (writer.denied || Number(current.client_id) !== writer.clientId)) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job request with ID ${id} not found.` });
    }
    if (current.status !== "PENDING") {
      conn.release();
      return res.status(409).json({ success: false, message: `Only PENDING requests can be edited (current: ${current.status}).` });
    }

    const b = req.body || {};
    if (b.store_id === undefined || !/^\d+$/.test(String(b.store_id))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Valid store_id is required." });
    }
    if (b.job_type_id === undefined || !/^\d+$/.test(String(b.job_type_id))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Valid job_type_id is required." });
    }
    const dateError = validateDate(b.preferred_date);
    if (dateError) {
      conn.release();
      return res.status(400).json({ success: false, message: dateError });
    }

    const jobType = await JobRequest.getJobType(Number(b.job_type_id));
    if (!jobType) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job type with ID ${b.job_type_id} not found.` });
    }
    if (!jobType.is_active) {
      conn.release();
      return res.status(400).json({ success: false, message: `Job type '${jobType.code}' is not active.` });
    }
    const store = await JobRequest.getStore(Number(b.store_id));
    if (!store || Number(store.client_id) !== Number(current.client_id)) {
      conn.release();
      return res.status(404).json({ success: false, message: "Store not found." });
    }
    if (store.status !== "ACTIVE") {
      conn.release();
      return res.status(400).json({ success: false, message: `Store '${store.store_code}' is not active.` });
    }

    await conn.beginTransaction();
    await JobRequest.updatePending(Number(id), {
      store_id: Number(b.store_id), job_type_id: Number(b.job_type_id),
      preferred_date: b.preferred_date || null,
      description: b.description ?? null, remarks: b.remarks ?? null
    }, req.user.id, conn);
    await audit(req, conn, {
      action: "JOB_REQUEST_UPDATED", entityId: Number(id),
      oldValues: { store_id: current.store_id, job_type_id: current.job_type_id },
      newValues: { store_id: Number(b.store_id), job_type_id: Number(b.job_type_id) }
    });
    await conn.commit();
    conn.release();

    const updated = await JobRequest.getById(Number(id));
    return res.status(200).json({ success: true, message: "Job request updated successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error updating job request:", error.message);
    return res.status(500).json({ success: false, message: "Server error while updating job request." });
  }
};

// PATCH /api/job-requests/:id/cancel (requests.cancel.own; own + PENDING)
exports.cancelRequest = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job request not found." });
    }
    const current = await JobRequest.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job request with ID ${id} not found.` });
    }
    const writer = await resolveWriter(req);
    if (!writer.global && (writer.denied || Number(current.client_id) !== writer.clientId)) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job request with ID ${id} not found.` });
    }
    if (current.status !== "PENDING") {
      conn.release();
      return res.status(409).json({ success: false, message: `Only PENDING requests can be cancelled (current: ${current.status}).` });
    }

    await conn.beginTransaction();
    await conn.query(
      "UPDATE job_requests SET status = 'CANCELLED', updated_by = ? WHERE id = ? AND status = 'PENDING'",
      [req.user.id, Number(id)]
    );
    await audit(req, conn, {
      action: "JOB_REQUEST_CANCELLED", entityId: Number(id),
      oldValues: { status: "PENDING" }, newValues: { status: "CANCELLED" }
    });
    await notify(conn, await adminUserIds(conn), "Job request cancelled",
      `Request ${current.request_number} was cancelled by the client.`, Number(id));
    await conn.commit();
    conn.release();

    const updated = await JobRequest.getById(Number(id));
    return res.status(200).json({ success: true, message: "Job request cancelled.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error cancelling job request:", error.message);
    return res.status(500).json({ success: false, message: "Server error while cancelling job request." });
  }
};

// PATCH /api/job-requests/:id/accept (requests.review; PENDING only)
exports.acceptRequest = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job request not found." });
    }
    const current = await JobRequest.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job request with ID ${id} not found.` });
    }
    if (current.status !== "PENDING") {
      conn.release();
      return res.status(409).json({ success: false, message: `Only PENDING requests can be accepted (current: ${current.status}).` });
    }

    await conn.beginTransaction();
    const ok = await JobRequest.setStatus(Number(id), "ACCEPTED", req.user.id, {
      admin_remark: req.body?.admin_remark || null
    }, conn);
    if (!ok) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "Request is no longer PENDING." });
    }
    await audit(req, conn, {
      action: "JOB_REQUEST_ACCEPTED", entityId: Number(id),
      oldValues: { status: "PENDING" }, newValues: { status: "ACCEPTED" }
    });
    await notify(conn, await clientUserIds(conn, current.client_id), "Job request accepted",
      `Request ${current.request_number} was accepted and queued for operational processing.`, Number(id));
    await conn.commit();
    conn.release();

    const updated = await JobRequest.getById(Number(id));
    return res.status(200).json({ success: true, message: "Job request accepted.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error accepting job request:", error.message);
    return res.status(500).json({ success: false, message: "Server error while accepting job request." });
  }
};

// PATCH /api/job-requests/:id/reject (requests.review; PENDING + reason)
exports.rejectRequest = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Job request not found." });
    }
    const current = await JobRequest.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Job request with ID ${id} not found.` });
    }
    const reason = req.body?.reason ?? req.body?.admin_remark ?? "";
    if (!reason || String(reason).trim() === "") {
      conn.release();
      return res.status(400).json({ success: false, message: "Rejection reason is required." });
    }
    if (current.status !== "PENDING") {
      conn.release();
      return res.status(409).json({ success: false, message: `Only PENDING requests can be rejected (current: ${current.status}).` });
    }

    await conn.beginTransaction();
    const ok = await JobRequest.setStatus(Number(id), "REJECTED", req.user.id, {
      admin_remark: String(reason).trim()
    }, conn);
    if (!ok) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ success: false, message: "Request is no longer PENDING." });
    }
    await audit(req, conn, {
      action: "JOB_REQUEST_REJECTED", entityId: Number(id),
      oldValues: { status: "PENDING" }, newValues: { status: "REJECTED" }
    });
    await notify(conn, await clientUserIds(conn, current.client_id), "Job request rejected",
      `Request ${current.request_number} was rejected: ${String(reason).trim()}`, Number(id));
    await conn.commit();
    conn.release();

    const updated = await JobRequest.getById(Number(id));
    return res.status(200).json({ success: true, message: "Job request rejected.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error rejecting job request:", error.message);
    return res.status(500).json({ success: false, message: "Server error while rejecting job request." });
  }
};

async function clientUserIds(conn, clientId) {
  const [rows] = await conn.query(
    "SELECT id FROM users WHERE status = 'Active' AND client_id = ?",
    [clientId]
  );
  return rows.map((r) => r.id);
}
