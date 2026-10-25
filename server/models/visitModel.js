/**
 * Visit Model 
 * DB access for job_visits + job_reach_records + employee_location_tracking.
 * Reuses thetables untouched. A visit belongs to one job;
 * visit_number is unique per job; history is append-only.
 */
const db = require("../config/db");

const VISIT_SELECT = `
    SELECT v.id, v.job_id, v.assignment_id, v.visit_number, v.status,
           v.started_at, v.closed_at, v.closed_by, v.remarks,
           v.created_at, v.updated_at,
           j.job_number, j.status AS job_status, j.client_id, j.store_id,
           s.store_code, s.store_name,
           c.client_code, c.client_name,
           r.id AS reach_id, r.reached_at, r.latitude AS reach_latitude,
           r.longitude AS reach_longitude, r.accuracy_meters AS reach_accuracy,
           r.distance_meters AS reach_distance, r.employee_id AS reach_employee_id,
           (SELECT m.status FROM measurement_sheets m
             WHERE m.visit_id = v.id ORDER BY m.version_no DESC LIMIT 1) AS measurement_status
      FROM job_visits v
      JOIN jobs j ON j.id = v.job_id
      JOIN clients c ON c.id = j.client_id
      JOIN stores s ON s.id = j.store_id
      LEFT JOIN job_reach_records r ON r.visit_id = v.id
`;

const Visit = {
  getById: async (id) => {
    const [rows] = await db.query(`${VISIT_SELECT} WHERE v.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  getByJobAndNumber: async (jobId, visitNumber, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q("SELECT * FROM job_visits WHERE job_id = ? AND visit_number = ? LIMIT 1", [jobId, visitNumber]);
    return rows[0] || null;
  },

  getOpenForAssignment: async (jobId, assignmentId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q(
      `SELECT * FROM job_visits
        WHERE job_id = ? AND assignment_id = ? AND status NOT IN ('VISIT_CLOSED','CANCELLED')
        ORDER BY id DESC LIMIT 1`,
      [jobId, assignmentId]
    );
    return rows[0] || null;
  },

  nextVisitNumber: async (jobId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q("SELECT COALESCE(MAX(visit_number), 0) + 1 AS next_no FROM job_visits WHERE job_id = ?", [jobId]);
    return Number(rows[0].next_no);
  },

  create: async ({ jobId, assignmentId, visitNumber, actorId }, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      "INSERT INTO job_visits (job_id, assignment_id, visit_number, status) VALUES (?, ?, ?, 'OPEN')",
      [jobId, assignmentId, visitNumber]
    );
    void actorId;
    return result.insertId;
  },

  setStatus: async (id, status, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q("UPDATE job_visits SET status = ? WHERE id = ?", [status, id]);
    return result.affectedRows > 0;
  },

  // Paginated visit list. Scope: { employeeId } (assigned jobs),
  // { clientId } (own client), null = global. Reuses the jobs scoping
  // predicates so visit visibility always matches job visibility.
  list: async ({ job_id = "", status = "", page = 1, limit = 20, scopeEmployeeId = null, scopeClientId = null } = {}) => {
    const where = [];
    const params = [];

    if (scopeEmployeeId !== null && scopeEmployeeId !== undefined) {
      where.push(`v.job_id IN (SELECT DISTINCT a.job_id FROM job_assignments a WHERE a.employee_id = ? AND a.status IN ('ACTIVE','COMPLETED'))`);
      params.push(scopeEmployeeId);
    } else if (scopeClientId !== null && scopeClientId !== undefined) {
      where.push("j.client_id = ?");
      params.push(scopeClientId);
    }
    if (job_id !== "" && job_id !== null && job_id !== undefined) {
      if (!/^\d+$/.test(String(job_id))) throw Object.assign(new Error("Invalid job_id filter."), { statusCode: 400 });
      where.push("v.job_id = ?");
      params.push(Number(job_id));
    }
    if (status && status.trim() !== "") {
      where.push("v.status = ?");
      params.push(status.trim());
    }

    const whereSql = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM job_visits v JOIN jobs j ON j.id = v.job_id ${whereSql}`,
      params
    );

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `${VISIT_SELECT} ${whereSql} ORDER BY v.id DESC LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    return {
      data: rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit)
      }
    };
  },

  // Latest tracking point per tracked employee (admin board).
  // One row per Active employee with tracking ON (with or without a
  // point yet) PLUS recently-tracked employees whose tracking is now
  // OFF — their last known location stays visible while its freshness
  // decays to stale/offline. Freshness is computed by the controller
  // so the single source of thresholds stays there.
  activeTracking: async () => {
    const [rows] = await db.query(
      `SELECT e.id AS employee_id, e.employee_code, e.employee_name,
              e.tracking_enabled, d.code AS designation,
              j.id AS job_id, j.job_number, j.status AS job_status,
              s.store_code, s.store_name,
              t.latitude, t.longitude, t.accuracy_meters, t.captured_at,
              TIMESTAMPDIFF(SECOND, t.captured_at, NOW()) AS age_seconds
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN employee_location_tracking t ON t.id = (
           SELECT t2.id FROM employee_location_tracking t2
            WHERE t2.employee_id = e.id
            ORDER BY t2.captured_at DESC, t2.id DESC LIMIT 1
         )
         LEFT JOIN jobs j ON j.id = t.job_id
         LEFT JOIN stores s ON s.id = j.store_id
        WHERE e.status = 'Active'
          AND (e.tracking_enabled = 1 OR t.id IS NOT NULL)
        ORDER BY t.captured_at DESC`
    );
    return rows;
  },

  insertLocation: async ({ employeeId, userId, latitude, longitude, accuracy, speed, heading, capturedAt, jobId, deviceId }, conn) => {
    const q = (conn || db).query.bind(conn || db);
    // capturedAt null would violate the NOT NULL column: fall back to
    // server time (device timestamps are advisory, never trusted blindly).
    const at = capturedAt || new Date().toISOString().slice(0, 19).replace("T", " ");
    const [result] = await q(
      `INSERT INTO employee_location_tracking
         (employee_id, user_id, latitude, longitude, accuracy_meters,
          speed_kmph, heading_degrees, captured_at, job_id, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, userId || null, latitude, longitude, accuracy ?? null,
       speed ?? null, heading ?? null, at, jobId || null, deviceId || null]
    );
    return result.insertId;
  },

  insertReach: async ({ jobId, assignmentId, visitId, employeeId, latitude, longitude, accuracy, distance, deviceInfo, offline }, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `INSERT INTO job_reach_records
         (job_id, assignment_id, visit_id, employee_id, latitude, longitude,
          accuracy_meters, distance_meters, device_info, is_offline_captured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [jobId, assignmentId, visitId, employeeId, latitude, longitude,
       accuracy ?? null, distance ?? null, deviceInfo || null, offline ? 1 : 0]
    );
    return result.insertId;
  }
};

module.exports = Visit;
