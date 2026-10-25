/**
 * Job Request Model 
 * DB access for the job_requests table . A request belongs
 * to exactly one client + one store; store.client_id must equal
 * request.client_id (enforced in the controller, documented there).
 */
const db = require("../config/db");

const BASE_SELECT = `
    SELECT r.id, r.request_number, r.client_id, r.store_id, r.job_type_id,
           r.requested_by, r.requested_date, r.preferred_date,
           r.description, r.remarks, r.status, r.admin_remark,
           r.converted_job_id, r.reviewed_by, r.reviewed_at,
           r.created_by, r.updated_by, r.created_at, r.updated_at,
           c.client_code, c.client_name,
           s.store_code, s.store_name, s.city AS store_city,
           t.code AS job_type_code, t.name AS job_type_name,
           u.name AS requested_by_name, u.username AS requested_by_username,
           v.name AS reviewer_name, v.username AS reviewer_username
      FROM job_requests r
      JOIN clients c ON c.id = r.client_id
      JOIN stores s ON s.id = r.store_id
      LEFT JOIN job_types t ON t.id = r.job_type_id
      LEFT JOIN users u ON u.id = r.requested_by
      LEFT JOIN users v ON v.id = r.reviewed_by
`;

const JobRequest = {
  // Paginated, filterable list. forcedClientId scopes CLIENT ownership
  // and overrides any request client_id filter (attack-safe).
  list: async ({ search = "", client_id = "", store_id = "", job_type_id = "", status = "", page = 1, limit = 20, forcedClientId = null } = {}) => {
    const where = [];
    const params = [];

    if (forcedClientId !== null && forcedClientId !== undefined) {
      where.push("r.client_id = ?");
      params.push(forcedClientId);
    } else if (client_id !== "" && client_id !== null && client_id !== undefined) {
      if (!/^\d+$/.test(String(client_id))) throw Object.assign(new Error("Invalid client_id filter."), { statusCode: 400 });
      where.push("r.client_id = ?");
      params.push(Number(client_id));
    }
    if (store_id !== "" && store_id !== null && store_id !== undefined) {
      if (!/^\d+$/.test(String(store_id))) throw Object.assign(new Error("Invalid store_id filter."), { statusCode: 400 });
      where.push("r.store_id = ?");
      params.push(Number(store_id));
    }
    if (job_type_id !== "" && job_type_id !== null && job_type_id !== undefined) {
      if (!/^\d+$/.test(String(job_type_id))) throw Object.assign(new Error("Invalid job_type_id filter."), { statusCode: 400 });
      where.push("r.job_type_id = ?");
      params.push(Number(job_type_id));
    }
    if (search && search.trim() !== "") {
      where.push("(r.request_number LIKE ? OR s.store_code LIKE ? OR s.store_name LIKE ? OR c.client_code LIKE ? OR c.client_name LIKE ? OR t.name LIKE ?)");
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like, like, like);
    }
    if (status && status.trim() !== "") {
      where.push("r.status = ?");
      params.push(status.trim());
    }

    const whereSql = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM job_requests r
       JOIN clients c ON c.id = r.client_id
       JOIN stores s ON s.id = r.store_id
       LEFT JOIN job_types t ON t.id = r.job_type_id ${whereSql}`,
      params
    );

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `${BASE_SELECT} ${whereSql} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
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

  getById: async (id) => {
    const [rows] = await db.query(`${BASE_SELECT} WHERE r.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  getByNumber: async (number) => {
    const [rows] = await db.query(`${BASE_SELECT} WHERE r.request_number = ? LIMIT 1`, [number]);
    return rows[0] || null;
  },

  getStore: async (storeId) => {
    const [rows] = await db.query(
      "SELECT id, client_id, store_code, store_name, status FROM stores WHERE id = ? LIMIT 1",
      [storeId]
    );
    return rows[0] || null;
  },

  getJobType: async (jobTypeId) => {
    const [rows] = await db.query(
      "SELECT id, code, name, is_active FROM job_types WHERE id = ? LIMIT 1",
      [jobTypeId]
    );
    return rows[0] || null;
  },

  activeJobTypes: async () => {
    const [rows] = await db.query(
      "SELECT id, code, name FROM job_types WHERE is_active = 1 ORDER BY name"
    );
    return rows;
  },

  create: async (data, actorId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `INSERT INTO job_requests
         (request_number, client_id, store_id, job_type_id, requested_by,
          preferred_date, description, remarks, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      [
        data.request_number, data.client_id, data.store_id, data.job_type_id,
        actorId, data.preferred_date || null, data.description || null,
        data.remarks || null, actorId, actorId
      ]
    );
    return result.insertId;
  },

  updatePending: async (id, data, actorId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `UPDATE job_requests
          SET store_id = ?, job_type_id = ?, preferred_date = ?,
              description = ?, remarks = ?, updated_by = ?
        WHERE id = ? AND status = 'PENDING'`,
      [
        data.store_id, data.job_type_id, data.preferred_date || null,
        data.description || null, data.remarks || null, actorId, id
      ]
    );
    return result.affectedRows > 0;
  },

  setStatus: async (id, status, actorId, extra, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `UPDATE job_requests
          SET status = ?, admin_remark = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
              updated_by = ?
        WHERE id = ? AND status = 'PENDING'`,
      [status, extra?.admin_remark ?? null, actorId, actorId, id]
    );
    return result.affectedRows > 0;
  }
};

function generateRequestNumber() {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const rand = Math.floor(100 + Math.random() * 900);
  return `REQ-${stamp}-${rand}`;
}

module.exports = JobRequest;
module.exports.generateRequestNumber = generateRequestNumber;
