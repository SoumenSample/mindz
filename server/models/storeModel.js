/**
 * Store Model
 * DB access for the stores master. Reuses the existing `stores` table
 * (clients 1:N stores; jobs reference stores). store_code is the only
 * uniqueness constraint — city/address/name are never unique.
 */
const db = require("../config/db");

const BASE_SELECT = `
    SELECT s.id, s.client_id, s.store_code, s.store_name, s.outlet_number,
           s.building_name, s.floor, s.address_line_1, s.address_line_2,
           s.landmark, s.city, s.district, s.state, s.pincode,
           s.latitude, s.longitude, s.shopkeeper_name, s.shopkeeper_mobile,
           s.status, s.created_by, s.updated_by, s.created_at, s.updated_at,
           c.client_code, c.client_name, c.status AS client_status
      FROM stores s
      JOIN clients c ON c.id = s.client_id
`;

const Store = {
  // Paginated, filterable list. Search covers code/name/outlet/city/
  // shopkeeper (+mobile). Optional forcedClientId scopes ownership
  // (CLIENT view.own) and overrides any request client_id filter.
  list: async ({ search = "", client_id = "", status = "", city = "", state = "", page = 1, limit = 20, forcedClientId = null } = {}) => {
    const where = [];
    const params = [];

    if (forcedClientId !== null && forcedClientId !== undefined) {
      where.push("s.client_id = ?");
      params.push(forcedClientId);
    } else if (client_id !== "" && client_id !== null && client_id !== undefined) {
      where.push("s.client_id = ?");
      params.push(Number(client_id));
    }
    if (search && search.trim() !== "") {
      where.push("(s.store_code LIKE ? OR s.store_name LIKE ? OR s.outlet_number LIKE ? OR s.city LIKE ? OR s.shopkeeper_name LIKE ? OR s.shopkeeper_mobile LIKE ?)");
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like, like, like);
    }
    if (status && status.trim() !== "") {
      where.push("s.status = ?");
      params.push(status.trim());
    }
    if (city && city.trim() !== "") {
      where.push("s.city LIKE ?");
      params.push(`%${city.trim()}%`);
    }
    if (state && state.trim() !== "") {
      where.push("s.state LIKE ?");
      params.push(`%${state.trim()}%`);
    }

    const whereSql = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM stores s ${whereSql}`,
      params
    );

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `${BASE_SELECT} ${whereSql} ORDER BY s.id ASC LIMIT ? OFFSET ?`,
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
    const [rows] = await db.query(`${BASE_SELECT} WHERE s.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  getByCode: async (code) => {
    const [rows] = await db.query(`${BASE_SELECT} WHERE s.store_code = ? LIMIT 1`, [code]);
    return rows[0] || null;
  },

  getClient: async (clientId) => {
    const [rows] = await db.query(
      "SELECT id, client_code, client_name, status FROM clients WHERE id = ? LIMIT 1",
      [clientId]
    );
    return rows[0] || null;
  },

  // Next auto-generated store_code: STR- + first 3 letters of the CLIENT
  // name (padded with X when shorter) + - + a running 3-digit serial per
  // client prefix, e.g. client "Apollo Pharmacy" -> STR-APO-001,
  // STR-APO-002 ... The serial continues per client prefix; legacy codes
  // in a different format are never touched. Runs on the caller's
  // connection so it participates in the surrounding transaction.
  nextStoreCode: async (conn, clientName) => {
    const q = (conn || db).query.bind(conn || db);
    const base = String(clientName || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3)
      .padEnd(3, "X");
    const prefix = `STR-${base}`;
    const [rows] = await q(
      "SELECT store_code FROM stores WHERE store_code LIKE ?",
      [`${prefix}%`]
    );
    let maxSerial = 0;
    rows.forEach((r) => {
      const m = /(\d+)$/.exec(r.store_code || "");
      if (m) maxSerial = Math.max(maxSerial, parseInt(m[1], 10));
    });
    return `${prefix}-${String(maxSerial + 1).padStart(3, "0")}`;
  },

  create: async (data, actorId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `INSERT INTO stores
         (client_id, store_code, store_name, outlet_number, building_name, floor,
          address_line_1, address_line_2, landmark, city, district, state, pincode,
          latitude, longitude, shopkeeper_name, shopkeeper_mobile, status,
          created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.client_id, data.store_code, data.store_name, data.outlet_number || null,
        data.building_name || null, data.floor || null, data.address_line_1 || null,
        data.address_line_2 || null, data.landmark || null, data.city || null,
        data.district || null, data.state || null, data.pincode || null,
        data.latitude ?? null, data.longitude ?? null,
        data.shopkeeper_name || null, data.shopkeeper_mobile || null,
        data.status || "ACTIVE", actorId || null, actorId || null
      ]
    );
    return result.insertId;
  },

  update: async (id, data, actorId, conn) => {
    const q = (conn || db).query.bind(conn || db);
    const [result] = await q(
      `UPDATE stores
          SET store_code = ?, store_name = ?, outlet_number = ?, building_name = ?,
              floor = ?, address_line_1 = ?, address_line_2 = ?, landmark = ?,
              city = ?, district = ?, state = ?, pincode = ?,
              latitude = ?, longitude = ?, shopkeeper_name = ?, shopkeeper_mobile = ?,
              status = ?, updated_by = ?
        WHERE id = ?`,
      [
        data.store_code, data.store_name, data.outlet_number || null,
        data.building_name || null, data.floor || null, data.address_line_1 || null,
        data.address_line_2 || null, data.landmark || null, data.city || null,
        data.district || null, data.state || null, data.pincode || null,
        data.latitude ?? null, data.longitude ?? null,
        data.shopkeeper_name || null, data.shopkeeper_mobile || null,
        data.status || "ACTIVE", actorId || null, id
      ]
    );
    return result.affectedRows > 0;
  }
};

module.exports = Store;
