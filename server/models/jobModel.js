/**
 * Job Model 
 * DB access for operational jobs + assignments + status history.
 * Reuses jobs / job_assignments / job_status_history .
 * jobs.client_id == stores.client_id is enforced in the controller.
 */
const db = require("../config/db");

const BASE_SELECT = `
    SELECT j.id, j.job_number, j.client_id, j.store_id, j.job_type_id,
           j.job_request_id, j.description,
           j.shop_name, j.shopkeeper_name, j.shopkeeper_mobile,
           j.address, j.city, j.state, j.pincode, j.scheduled_date,
           j.priority, j.status, j.created_by, j.updated_by,
           j.created_at, j.updated_at,
           c.client_code, c.client_name,
           s.store_code, s.store_name,
           t.code AS job_type_code, t.name AS job_type_name,
           r.request_number AS request_number, r.status AS request_status
      FROM jobs j
      JOIN clients c ON c.id = j.client_id
      JOIN stores s ON s.id = j.store_id
      LEFT JOIN job_types t ON t.id = j.job_type_id
      LEFT JOIN job_requests r ON r.id = j.job_request_id
`;

const ASSIGN_SELECT = `
    SELECT a.id, a.job_id, a.employee_id, a.assigned_by, a.assigned_at,
           a.unassigned_at, a.status, a.remarks,
           e.employee_code, e.employee_name,
           u.username AS assigned_by_username
      FROM job_assignments a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN users u ON u.id = a.assigned_by
`;

const Job = {
  // Paginated list. Scoping: { employeeId } (EMPLOYEE: assigned-to-me),
  // { clientId } (CLIENT: own org), both null = global (office).
  // Filters: search (number/shop/store/client/type), status, client_id,
  // store_id, job_type_id, employee_id (assigned, office use).
  list: async ({ search = "", status = "", client_id = "", store_id = "", job_type_id = "", employee_id = "", page = 1, limit = 20, scopeEmployeeId = null, scopeClientId = null } = {}) => {
    const where = [];
    const params = [];

    if (scopeEmployeeId !== null && scopeEmployeeId !== undefined) {
      where.push(`j.id IN (SELECT DISTINCT a.job_id FROM job_assignments a WHERE a.employee_id = ? AND a.status IN ('ACTIVE','COMPLETED'))`);
      params.push(scopeEmployeeId);
    } else if (scopeClientId !== null && scopeClientId !== undefined) {
      where.push("j.client_id = ?");
      params.push(scopeClientId);
    } else {
      if (client_id !== "" && client_id !== null && client_id !== undefined) {
        if (!/^\d+$/.test(String(client_id))) throw Object.assign(new Error("Invalid client_id filter."), { statusCode: 400 });
        where.push("j.client_id = ?");
        params.push(Number(client_id));
      }
      if (employee_id !== "" && employee_id !== null && employee_id !== undefined) {
        if (!/^\d+$/.test(String(employee_id))) throw Object.assign(new Error("Invalid employee_id filter."), { statusCode: 400 });
        where.push(`j.id IN (SELECT DISTINCT a.job_id FROM job_assignments a WHERE a.employee_id = ? AND a.status IN ('ACTIVE','COMPLETED'))`);
        params.push(Number(employee_id));
      }
    }
    if (store_id !== "" && store_id !== null && store_id !== undefined) {
      if (!/^\d+$/.test(String(store_id))) throw Object.assign(new Error("Invalid store_id filter."), { statusCode: 400 });
      where.push("j.store_id = ?");
      params.push(Number(store_id));
    }
    if (job_type_id !== "" && job_type_id !== null && job_type_id !== undefined) {
      if (!/^\d+$/.test(String(job_type_id))) throw Object.assign(new Error("Invalid job_type_id filter."), { statusCode: 400 });
      where.push("j.job_type_id = ?");
      params.push(Number(job_type_id));
    }
    if (search && search.trim() !== "") {
      where.push("(j.job_number LIKE ? OR j.shop_name LIKE ? OR s.store_code LIKE ? OR s.store_name LIKE ? OR c.client_code LIKE ? OR c.client_name LIKE ? OR t.name LIKE ?)");
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like, like, like, like);
    }
    // Comma-separated status list (e.g. "EN_ROUTE,REACHED,WORK_IN_PROGRESS")
    // for grouped views like In Progress. Placeholders keep it safe;
    // unknown values simply match nothing.
    if (status && status.trim() !== "") {
      const statuses = String(status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (statuses.length === 1) {
        where.push("j.status = ?");
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        where.push(`j.status IN (${statuses.map(() => "?").join(",")})`);
        params.push(...statuses);
      }
    }

    const whereSql = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM jobs j
       JOIN clients c ON c.id = j.client_id
       JOIN stores s ON s.id = j.store_id
       LEFT JOIN job_types t ON t.id = j.job_type_id ${whereSql}`,
      params
    );

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    // One JOIN for the current ACTIVE assignment avoids N+1 per row.
    const [rows] = await db.query(
      `SELECT j.id, j.job_number, j.client_id, j.store_id, j.job_type_id,
              j.job_request_id, j.description,
              j.shop_name, j.city, j.state, j.scheduled_date, j.priority,
              j.status, j.created_at,
              c.client_code, c.client_name,
              s.store_code, s.store_name,
              t.code AS job_type_code, t.name AS job_type_name,
              act.id AS active_assignment_id,
              ae.employee_code AS assigned_code, ae.employee_name AS assigned_name
         FROM jobs j
         JOIN clients c ON c.id = j.client_id
         JOIN stores s ON s.id = j.store_id
         LEFT JOIN job_types t ON t.id = j.job_type_id
         LEFT JOIN job_assignments act ON act.job_id = j.id AND act.status = 'ACTIVE'
         LEFT JOIN employees ae ON ae.id = act.employee_id
       ${whereSql} ORDER BY j.id DESC LIMIT ? OFFSET ?`,
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
    const [rows] = await db.query(`${BASE_SELECT} WHERE j.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  getAssignments: async (jobId) => {
    const [rows] = await db.query(`${ASSIGN_SELECT} WHERE a.job_id = ? ORDER BY a.id ASC`, [jobId]);
    return rows;
  },

  getActiveAssignment: async (jobId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [rows] = await q("SELECT * FROM job_assignments WHERE job_id = ? AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1", [jobId]);
    return rows[0] || null;
  },

  getHistory: async (jobId) => {
    const [rows] = await db.query(
      `SELECT h.id, h.from_status, h.to_status, h.remark, h.created_at,
              u.username AS changed_by_username
         FROM job_status_history h
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.job_id = ? ORDER BY h.id ASC`,
      [jobId]
    );
    return rows;
  },

  getStore: async (storeId) => {
    const [rows] = await db.query(
      `SELECT s.id, s.client_id, s.store_code, s.store_name, s.address_line_1,
              s.address_line_2, s.city, s.state, s.pincode,
              s.shopkeeper_name, s.shopkeeper_mobile, s.status,
              c.status AS client_status
         FROM stores s JOIN clients c ON c.id = s.client_id
        WHERE s.id = ? LIMIT 1`,
      [storeId]
    );
    return rows[0] || null;
  },

  getJobType: async (jobTypeId) => {
    const [rows] = await db.query("SELECT id, code, name, is_active FROM job_types WHERE id = ? LIMIT 1", [jobTypeId]);
    return rows[0] || null;
  },

  // Eligible field executives: ACTIVE employee + FIELD_EXECUTIVE
  // designation + linked ACTIVE EMPLOYEE-role login.
  eligibleExecutives: async () => {
    const [rows] = await db.query(
      `SELECT e.id, e.employee_code, e.employee_name, e.mobile, u.id AS user_id
         FROM employees e
         JOIN designations d ON d.id = e.designation_id AND d.code = 'FIELD_EXECUTIVE'
         JOIN users u ON u.id = e.user_id AND u.role = 'employee' AND u.status = 'Active'
        WHERE e.status = 'Active'
        ORDER BY e.employee_name`
    );
    return rows;
  },

  // Full employee validation for assignment (rule details for 4xx messages).
  validateExecutive: async (employeeId) => {
    const [rows] = await db.query(
      `SELECT e.id, e.employee_code, e.employee_name, e.status AS emp_status,
              d.code AS designation, u.id AS user_id, u.role AS user_role, u.status AS user_status
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    return rows[0] || null;
  }
};

module.exports = Job;
