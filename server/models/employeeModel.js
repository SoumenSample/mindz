/**
 * Employee Model
 * DB access for the employees master. Reuses the existing `employees`
 * table (users.employee_id -> employees.id stays intact). Field
 * executives are employees whose designation code is FIELD_EXECUTIVE.
 */
const db = require("../config/db");

const BASE_SELECT = `
    SELECT e.id, e.employee_code, e.employee_name, e.mobile, e.email,
           e.address, e.address_line_2, e.city, e.district, e.state,
           e.landmark, e.status, e.join_date, e.employment_type,
           e.designation_id, e.department_id, e.user_id,
           e.profile_photo_path, e.id_type, e.photo_id_number,
           e.photo_id_doc_path,
           e.emergency_contact_name, e.emergency_phone, e.emergency_relation,
           e.created_by, e.updated_by, e.created_at, e.updated_at,
           d.code AS designation_code, d.name AS designation_name,
           dep.code AS department_code, dep.name AS department_name,
           u.id AS u_id, u.username AS u_username, u.email AS u_email,
           u.role AS u_role, u.status AS u_status,
           u.must_change_password AS u_must_change
      FROM employees e
      LEFT JOIN designations d ON d.id = e.designation_id
      LEFT JOIN departments dep ON dep.id = e.department_id
      LEFT JOIN users u ON u.id = e.user_id
`;

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    employee_code: row.employee_code,
    employee_name: row.employee_name,
    mobile: row.mobile,
    email: row.email,
    address: row.address,
    address_line_2: row.address_line_2 || null,
    city: row.city,
    district: row.district || null,
    state: row.state,
    landmark: row.landmark || null,
    status: row.status,
    join_date: row.join_date,
    employment_type: row.employment_type || null,
    // All optional: profile photo URL/path, ID type/number, ID doc URL/path.
    profile_photo_path: row.profile_photo_path || null,
    id_type: row.id_type || null,
    photo_id_number: row.photo_id_number || null,
    photo_id_doc_path: row.photo_id_doc_path || null,
    // Optional emergency contact block.
    emergency_contact_name: row.emergency_contact_name || null,
    emergency_phone: row.emergency_phone || null,
    emergency_relation: row.emergency_relation || null,
    designation: row.designation_id
      ? { id: row.designation_id, code: row.designation_code, name: row.designation_name }
      : null,
    department: row.department_id
      ? { id: row.department_id, code: row.department_code, name: row.department_name }
      : null,
    user: row.u_id
      ? { id: row.u_id, username: row.u_username, email: row.u_email, role: row.u_role, status: row.u_status, must_change_password: Number(row.u_must_change) === 1 }
      : null,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

const Employee = {
  // Paginated, filterable list. Filters: search (code/name/phone/email),
  // status (Active/Inactive), designation (code or id), department (code or id).
  list: async ({ search = "", status = "", designation = "", department = "", page = 1, limit = 20 } = {}) => {
    const where = [];
    const params = [];

    if (search && search.trim() !== "") {
      where.push("(e.employee_code LIKE ? OR e.employee_name LIKE ? OR e.mobile LIKE ? OR e.email LIKE ?)");
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like);
    }
    if (status && status.trim() !== "") {
      where.push("e.status = ?");
      params.push(status.trim());
    }
    if (designation !== "" && designation !== null && designation !== undefined) {
      if (/^\d+$/.test(String(designation))) {
        where.push("e.designation_id = ?");
        params.push(Number(designation));
      } else {
        where.push("d.code = ?");
        params.push(String(designation).trim().toUpperCase());
      }
    }
    if (department !== "" && department !== null && department !== undefined) {
      if (/^\d+$/.test(String(department))) {
        where.push("e.department_id = ?");
        params.push(Number(department));
      } else {
        where.push("dep.code = ?");
        params.push(String(department).trim().toUpperCase());
      }
    }

    const whereSql = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM employees e
       LEFT JOIN designations d ON d.id = e.designation_id
       LEFT JOIN departments dep ON dep.id = e.department_id ${whereSql}`,
      params
    );

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `${BASE_SELECT} ${whereSql} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    return {
      data: rows.map(toPublic),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit)
      }
    };
  },

  getById: async (id) => {
    const [rows] = await db.query(`${BASE_SELECT} WHERE e.id = ? LIMIT 1`, [id]);
    return toPublic(rows[0]);
  },

  getByCode: async (code) => {
    const [rows] = await db.query(`${BASE_SELECT} WHERE e.employee_code = ? LIMIT 1`, [code]);
    return toPublic(rows[0]);
  },

  getDesignationByCode: async (code) => {
    const [rows] = await db.query("SELECT id, code, name FROM designations WHERE code = ? LIMIT 1", [code]);
    return rows[0] || null;
  },

  getDepartmentByCode: async (code) => {
    const [rows] = await db.query("SELECT id, code, name FROM departments WHERE code = ? LIMIT 1", [code]);
    return rows[0] || null;
  },

  getDepartmentById: async (id) => {
    const [rows] = await db.query("SELECT id, code, name FROM departments WHERE id = ? LIMIT 1", [id]);
    return rows[0] || null;
  },

  // Next auto-generated employee_code: EMP- + a short letter code derived
  // from the designation (initial of each word in the designation CODE,
  // e.g. FIELD_EXECUTIVE -> FE) + - + a running 3-digit serial per
  // designation, e.g. EMP-FE-001, EMP-FE-002 ... Single-word designation
  // codes fall back to their first 2 letters, capped at 3. Detects
  // collisions against every existing code with the same prefix (legacy
  // EMP001-style seeded codes are never touched). Runs on the caller's
  // connection so it participates in the surrounding transaction.
  nextEmployeeCode: async (conn, designationCode) => {
    const q = (conn || db).query.bind(conn || db);
    const words = String(designationCode || "")
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(Boolean);
    const short = (
      words.length > 1
        ? words.map((w) => w.charAt(0)).join("")
        : (words[0] || "").slice(0, 2)
    ).slice(0, 3) || "XX";
    const prefix = `EMP-${short}`;
    const [rows] = await q(
      "SELECT employee_code FROM employees WHERE employee_code LIKE ?",
      [`${prefix}%`]
    );
    let maxSerial = 0;
    rows.forEach((r) => {
      const m = /(\d+)$/.exec(r.employee_code || "");
      if (m) maxSerial = Math.max(maxSerial, parseInt(m[1], 10));
    });
    return `${prefix}-${String(maxSerial + 1).padStart(3, "0")}`;
  },

  create: async (data, actorId) => {
    const [result] = await db.query(
      `INSERT INTO employees
         (employee_code, employee_name, mobile, email,
          address, address_line_2, city, district, state, landmark,
          emergency_contact_name, emergency_phone, emergency_relation,
          profile_photo_path, id_type, photo_id_number, photo_id_doc_path,
          designation_id, department_id, status, join_date, employment_type,
          created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employee_code, data.employee_name, data.mobile || null, data.email || null,
        data.address || null, data.address_line_2 || null,
        data.city || null, data.district || null, data.state || null, data.landmark || null,
        data.emergency_contact_name || null, data.emergency_phone || null, data.emergency_relation || null,
        data.profile_photo_path || null, data.id_type || null, data.photo_id_number || null, data.photo_id_doc_path || null,
        data.designation_id, data.department_id || null,
        data.status || "Active", data.join_date || null, data.employment_type || null,
        actorId || null, actorId || null
      ]
    );
    return result.insertId;
  },

  update: async (id, data, actorId) => {
    const [result] = await db.query(
      `UPDATE employees
          SET employee_code = ?, employee_name = ?, mobile = ?, email = ?,
              address = ?, address_line_2 = ?, city = ?, district = ?, state = ?, landmark = ?,
              emergency_contact_name = ?, emergency_phone = ?, emergency_relation = ?,
              profile_photo_path = ?, id_type = ?, photo_id_number = ?, photo_id_doc_path = ?,
              designation_id = ?,
              department_id = ?, status = ?, join_date = ?,
              employment_type = ?, updated_by = ?
        WHERE id = ?`,
      [
        data.employee_code, data.employee_name, data.mobile || null, data.email || null,
        data.address || null, data.address_line_2 || null,
        data.city || null, data.district || null, data.state || null, data.landmark || null,
        data.emergency_contact_name || null, data.emergency_phone || null, data.emergency_relation || null,
        data.profile_photo_path || null, data.id_type || null, data.photo_id_number || null, data.photo_id_doc_path || null,
        data.designation_id, data.department_id || null,
        data.status || "Active", data.join_date || null,
        data.employment_type || null, actorId || null, id
      ]
    );
    return result.affectedRows > 0;
  },

  setStatus: async (id, status, actorId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      "UPDATE employees SET status = ?, updated_by = ? WHERE id = ?",
      [status, actorId || null, id]
    );
    return result.affectedRows > 0;
  }
};

module.exports = Employee;
