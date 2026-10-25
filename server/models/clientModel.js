/**
 * Client Model
 * DB access for the clients organization master. Reuses the existing
 * `clients` table (users.client_id -> clients.id stays intact).
 * No pincode column exists in the schema — the model exposes exactly
 * the live columns, nothing invented.
 */
const db = require("../config/db");

const BASE_SELECT = `
    SELECT c.id, c.client_code, c.client_name, c.contact_person,
           c.email, c.phone, c.address, c.city, c.state,
           c.logo_path, c.gst_number, c.address_line_1, c.address_line_2,
           c.district, c.police_station, c.pincode, c.landmark, c.remarks,
           c.status, c.customer_id, c.created_by, c.updated_by,
           c.created_at, c.updated_at
      FROM clients c
`;

const Client = {
  // Paginated, filterable list. Filters: search (code/name/contact/
  // phone/email), status (Active/Inactive).
  list: async ({ search = "", status = "", page = 1, limit = 20 } = {}) => {
    const where = [];
    const params = [];

    if (search && search.trim() !== "") {
      where.push("(c.client_code LIKE ? OR c.client_name LIKE ? OR c.contact_person LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)");
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like, like);
    }
    if (status && status.trim() !== "") {
      where.push("c.status = ?");
      params.push(status.trim());
    }

    const whereSql = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM clients c ${whereSql}`,
      params
    );

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `${BASE_SELECT} ${whereSql} ORDER BY c.id ASC LIMIT ? OFFSET ?`,
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
    const [rows] = await db.query(`${BASE_SELECT} WHERE c.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  getByCode: async (code) => {
    const [rows] = await db.query(`${BASE_SELECT} WHERE c.client_code = ? LIMIT 1`, [code]);
    return rows[0] || null;
  },

  // Linked login accounts (safe fields only — never hash).
  getLinkedUsers: async (clientId) => {
    const [rows] = await db.query(
      "SELECT id, name, username, email, role, status, must_change_password FROM users WHERE client_id = ? ORDER BY id",
      [clientId]
    );
    return rows.map((r) => ({ ...r, must_change_password: Number(r.must_change_password) === 1 }));
  },

  // Next auto-generated client_code: CLT- + first 3 letters of the name
  // (padded with X when shorter) + - + a running 3-digit serial per
  // prefix, e.g. "Apollo Pharmacy" -> CLT-APO-001, CLT-APO-002 ...
  // Detects collisions against every existing code with the same prefix
  // (legacy non-CLT codes are never touched). Runs on the caller's
  // connection so it participates in the surrounding transaction.
  nextClientCode: async (conn, clientName) => {
    const q = (conn || db).query.bind(conn || db);
    const base = String(clientName || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3)
      .padEnd(3, "X");
    const prefix = `CLT-${base}`;
    const [rows] = await q(
      "SELECT client_code FROM clients WHERE client_code LIKE ?",
      [`${prefix}%`]
    );
    let maxSerial = 0;
    rows.forEach((r) => {
      const m = /(\d+)$/.exec(r.client_code || "");
      if (m) maxSerial = Math.max(maxSerial, parseInt(m[1], 10));
    });
    return `${prefix}-${String(maxSerial + 1).padStart(3, "0")}`;
  },

  // Create. `client_code` is optional — the controller passes a
  // generated one when omitted. Extra columns match the extended form
  // (migration 024); the legacy `address` column keeps mirroring
  // address_line_1 so older reads never show an empty address.
  create: async (data, actorId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `INSERT INTO clients
          (client_code, client_name, contact_person, email, phone,
           address, city, state, logo_path, gst_number,
           address_line_1, address_line_2, district, police_station,
           pincode, landmark, remarks, status,
           created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.client_code, data.client_name, data.contact_person || null,
        data.email || null, data.phone || null, data.address || null,
        data.city || null, data.state || null,
        data.logo_path || null, data.gst_number || null,
        data.address_line_1 || null, data.address_line_2 || null,
        data.district || null, data.police_station || null,
        data.pincode || null, data.landmark || null, data.remarks || null,
        data.status || "Active", actorId || null, actorId || null
      ]
    );
    return result.insertId;
  },

  update: async (id, data, actorId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `UPDATE clients
          SET client_code = ?, client_name = ?, contact_person = ?,
              email = ?, phone = ?, address = ?, city = ?, state = ?,
              logo_path = ?, gst_number = ?, address_line_1 = ?,
              address_line_2 = ?, district = ?, police_station = ?,
              pincode = ?, landmark = ?, remarks = ?,
              status = ?, updated_by = ?
        WHERE id = ?`,
      [
        data.client_code, data.client_name, data.contact_person || null,
        data.email || null, data.phone || null, data.address || null,
        data.city || null, data.state || null,
        data.logo_path || null,
        data.gst_number || null, data.address_line_1 || null,
        data.address_line_2 || null, data.district || null,
        data.police_station || null, data.pincode || null,
        data.landmark || null, data.remarks || null,
        data.status || "Active", actorId || null, id
      ]
    );
    return result.affectedRows > 0;
  }
};

module.exports = Client;
