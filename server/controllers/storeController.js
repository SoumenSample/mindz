/**
 * Store Controller 
 * CRUD + soft-deactivate for the stores master. Ownership model:
 *   - stores.view.all  -> global office access (SUPER_ADMIN/ADMIN)
 *   - stores.view.own  -> forced users.client_id scope (CLIENT, later use)
 *   - no view grant    -> 403
 * A scoped caller can never escape its client via forged client_id,
 * store_id or URL: filters are overridden server-side and foreign
 * rows answer 404 (no existence leak). Write endpoints require the
 * manage grants, so CLIENT/EMPLOYEE cannot reach them at all.
 */
const db = require("../config/db");
const Store = require("../models/storeModel");
const { hasPermission } = require("../services/rbacService");

const ALLOWED_STATUS = ["ACTIVE", "INACTIVE"];

function isDuplicateEntry(err) {
  return err && err.code === "ER_DUP_ENTRY";
}

function audit(req, conn, { action, entityId, oldValues, newValues }) {
  const ip = (req.ip || "").slice(0, 45);
  const ua = (req.headers["user-agent"] || "").slice(0, 255);
  const q = (conn || db).query.bind(conn || db);
  return q(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (?, ?, 'STORE', ?, ?, ?, ?, ?)`,
    [
      req.user.id, action, entityId ?? null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ip || null, ua || null
    ]
  );
}

// Resolve read scope: null = global, number = forced own client_id,
// false = no view grant at all. Client link comes from the JWT identity.
async function resolveScope(req) {
  if (await hasPermission(req.user, "stores.view.all")) return { scope: null };
  if (await hasPermission(req.user, "stores.view.own")) {
    const [[row]] = await db.query("SELECT client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
    if (!row || row.client_id === null) return { scope: false };
    return { scope: Number(row.client_id) };
  }
  return { scope: false };
}

// Authenticated own client for scoped writers (CLIENT self-service).
// Returns { clientId } or { denied }. Writers without view.all operate
// strictly inside their own client; a missing link denies (no orphans).
async function resolveOwnClient(req) {
  if (await hasPermission(req.user, "stores.view.all")) return { global: true };
  const [[row]] = await db.query("SELECT client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  if (!row || row.client_id === null) return { denied: true };
  return { clientId: Number(row.client_id) };
}

function validateGps(latitude, longitude) {
  const errors = [];
  const hasLat = latitude !== undefined && latitude !== null && String(latitude).trim() !== "";
  const hasLng = longitude !== undefined && longitude !== null && String(longitude).trim() !== "";
  if (hasLat !== hasLng) {
    errors.push("Latitude and longitude must be supplied together.");
    return errors;
  }
  if (hasLat) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push("Latitude must be between -90 and 90.");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push("Longitude must be between -180 and 180.");
  }
  return errors;
}

function toNullable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function toNullableNumber(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// GET /api/stores?search=&client_id=&status=&city=&state=&page=&limit=
exports.getAllStores = async (req, res) => {
  try {
    const { scope } = await resolveScope(req);
    if (scope === false) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { search = "", client_id = "", status = "", city = "", state = "", page = 1, limit = 20 } = req.query;
    if (status && !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status filter. Use ACTIVE or INACTIVE." });
    }
    if (client_id !== "" && !/^\d+$/.test(String(client_id))) {
      return res.status(400).json({ success: false, message: "Invalid client_id filter." });
    }
    const result = await Store.list({ search, client_id, status, city, state, page, limit, forcedClientId: scope });
    return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    console.error("Error fetching stores:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching stores." });
  }
};

// GET /api/stores/:id
exports.getStoreById = async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) {
      return res.status(404).json({ success: false, message: "Store not found." });
    }
    const { scope } = await resolveScope(req);
    if (scope === false) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const store = await Store.getById(Number(req.params.id));
    if (!store || (scope !== null && Number(store.client_id) !== scope)) {
      return res.status(404).json({ success: false, message: "Store not found." });
    }
    return res.status(200).json({ success: true, data: store });
  } catch (error) {
    console.error("Error fetching store:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching store." });
  }
};

// POST /api/stores
exports.createStore = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const b = req.body || {};

    // Ownership forcing FIRST : a scoped writer (CLIENT)
    // can never choose a client — any request client_id is discarded and
    // replaced with the authenticated own client (which the CLIENT form
    // omits entirely). Global writers (ADMIN/SUPER_ADMIN) select the
    // client explicitly.
    const own = await resolveOwnClient(req);
    if (own.denied) {
      conn.release();
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const effectiveClientId = own.global ? Number(b.client_id) : own.clientId;

    const errors = [];
    if (own.global && (b.client_id === undefined || b.client_id === null || !/^\d+$/.test(String(b.client_id)))) {
      errors.push("Valid client_id is required.");
    }
    if (!b.store_name || String(b.store_name).trim() === "") errors.push("Store Name is required.");
    if (b.status && !ALLOWED_STATUS.includes(b.status)) errors.push("Status must be ACTIVE or INACTIVE.");
    errors.push(...validateGps(b.latitude, b.longitude));
    if (b.shopkeeper_mobile && String(b.shopkeeper_mobile).trim() !== "") {
      const digits = String(b.shopkeeper_mobile).replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 13) errors.push("Shopkeeper mobile must be a valid 10-digit number.");
    }
    if (errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    // effectiveClientId resolved in the forcing block above.
    const client = await Store.getClient(effectiveClientId);
    if (!client) {
      conn.release();
      return res.status(404).json({ success: false, message: `Client with ID ${effectiveClientId} not found.` });
    }
    if (client.status !== "Active") {
      conn.release();
      return res.status(400).json({ success: false, message: `Client '${client.client_code}' is not active.` });
    }

    const lat = toNullableNumber(b.latitude);
    const lng = toNullableNumber(b.longitude);
    if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Latitude and longitude must be numbers." });
    }

    await conn.beginTransaction();
    // The store code is NOT caller-supplied: it is auto-generated as
    // STR-<first 3 letters of the client name>-### (e.g. Apollo ->
    // STR-APO-###) inside the transaction — the rare duplicate race
    // retries with a fresh serial, so two saves never share a code.
    let storeCode;
    let insertId;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        storeCode = await Store.nextStoreCode(conn, client.client_name);
        insertId = await Store.create(
          {
            client_id: effectiveClientId, store_code: storeCode, store_name: String(b.store_name).trim(),
            outlet_number: toNullable(b.outlet_number), building_name: toNullable(b.building_name), floor: toNullable(b.floor),
            address_line_1: toNullable(b.address_line_1), address_line_2: toNullable(b.address_line_2),
            landmark: toNullable(b.landmark), city: toNullable(b.city), district: toNullable(b.district),
            state: toNullable(b.state), pincode: toNullable(b.pincode),
            latitude: lat, longitude: lng,
            shopkeeper_name: toNullable(b.shopkeeper_name),
            shopkeeper_mobile: b.shopkeeper_mobile ? String(b.shopkeeper_mobile).trim() : null,
            status: b.status || "ACTIVE"
          },
          req.user.id, conn
        );
        break;
      } catch (insertErr) {
        if (isDuplicateEntry(insertErr) && attempt < 4) continue;
        throw insertErr;
      }
    }
    await audit(req, conn, {
      action: "STORE_CREATED", entityId: insertId,
      oldValues: null,
      newValues: { store_code: storeCode, client_id: effectiveClientId }
    });
    await conn.commit();
    conn.release();

    const created = await Store.getById(insertId);
    return res.status(201).json({ success: true, message: "Store created successfully.", data: created });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Store Code already exists." });
    }
    console.error("Error creating store:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating store." });
  }
};

// PUT /api/stores/:id (client ownership is immutable here)
exports.updateStore = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Store not found." });
    }
    const current = await Store.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Store with ID ${id} not found.` });
    }
    // Scoped writers (CLIENT) touch only their own client (foreign rows
    // answer 404 — same convention as the detail endpoint, no leak).
    const own = await resolveOwnClient(req);
    if (!own.global && (own.denied || Number(current.client_id) !== own.clientId)) {
      conn.release();
      return res.status(404).json({ success: false, message: `Store with ID ${id} not found.` });
    }

    const b = req.body || {};
    const errors = [];
    // The code is echoed read-only by the edited form. A missing/blank
    // code keeps the current one (never trust a caller-invented code).
    const nextCode = b.store_code && String(b.store_code).trim() !== ""
      ? String(b.store_code).trim()
      : current.store_code;
    if (!b.store_name || String(b.store_name).trim() === "") errors.push("Store Name is required.");
    if (b.status && !ALLOWED_STATUS.includes(b.status)) errors.push("Status must be ACTIVE or INACTIVE.");
    errors.push(...validateGps(b.latitude, b.longitude));
    if (b.shopkeeper_mobile && String(b.shopkeeper_mobile).trim() !== "") {
      const digits = String(b.shopkeeper_mobile).replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 13) errors.push("Shopkeeper mobile must be a valid 10-digit number.");
    }
    if (b.client_id !== undefined && b.client_id !== null && Number(b.client_id) !== Number(current.client_id)) {
      errors.push("Store client ownership cannot be changed.");
    }
    if (errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    const codeOwner = await Store.getByCode(nextCode);
    if (codeOwner && codeOwner.id !== Number(id)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Store Code '${nextCode}' belongs to another store.` });
    }

    const lat = toNullableNumber(b.latitude);
    const lng = toNullableNumber(b.longitude);
    if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) {
      conn.release();
      return res.status(400).json({ success: false, message: "Latitude and longitude must be numbers." });
    }

    await conn.beginTransaction();
    await Store.update(Number(id), {
      store_code: nextCode, store_name: String(b.store_name).trim(),
      outlet_number: toNullable(b.outlet_number), building_name: toNullable(b.building_name), floor: toNullable(b.floor),
      address_line_1: toNullable(b.address_line_1), address_line_2: toNullable(b.address_line_2),
      landmark: toNullable(b.landmark), city: toNullable(b.city), district: toNullable(b.district),
      state: toNullable(b.state), pincode: toNullable(b.pincode),
      latitude: lat, longitude: lng,
      shopkeeper_name: toNullable(b.shopkeeper_name),
      shopkeeper_mobile: b.shopkeeper_mobile ? String(b.shopkeeper_mobile).trim() : null,
      status: b.status || "ACTIVE"
    }, req.user.id, conn);
    await audit(req, conn, {
      action: "STORE_UPDATED", entityId: Number(id),
      oldValues: { store_code: current.store_code, store_name: current.store_name, status: current.status, city: current.city },
      newValues: { store_code: nextCode, store_name: String(b.store_name).trim(), status: b.status || "ACTIVE", city: toNullable(b.city) }
    });
    await conn.commit();
    conn.release();

    const updated = await Store.getById(Number(id));
    return res.status(200).json({ success: true, message: "Store updated successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Store Code already exists." });
    }
    console.error("Error updating store:", error.message);
    return res.status(500).json({ success: false, message: "Server error while updating store." });
  }
};

// PATCH /api/stores/:id/deactivate — soft-delete; row stays for jobs/history.
exports.deactivateStore = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    if (!/^\d+$/.test(String(id))) {
      conn.release();
      return res.status(404).json({ success: false, message: "Store not found." });
    }
    const current = await Store.getById(Number(id));
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Store with ID ${id} not found.` });
    }
    // Scoped writers (CLIENT) touch only their own client (foreign rows
    // answer 404 — same convention as the detail endpoint, no leak).
    const ownDe = await resolveOwnClient(req);
    if (!ownDe.global && (ownDe.denied || Number(current.client_id) !== ownDe.clientId)) {
      conn.release();
      return res.status(404).json({ success: false, message: `Store with ID ${id} not found.` });
    }
    if (current.status === "INACTIVE") {
      conn.release();
      return res.status(200).json({ success: true, message: "Store is already inactive.", data: current });
    }
    await conn.beginTransaction();
    await conn.query("UPDATE stores SET status = 'INACTIVE', updated_by = ? WHERE id = ?", [req.user.id, Number(id)]);
    await audit(req, conn, {
      action: "STORE_DEACTIVATED", entityId: Number(id),
      oldValues: { status: "ACTIVE" }, newValues: { status: "INACTIVE" }
    });
    await conn.commit();
    conn.release();

    const updated = await Store.getById(Number(id));
    return res.status(200).json({ success: true, message: "Store deactivated successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error deactivating store:", error.message);
    return res.status(500).json({ success: false, message: "Server error while deactivating store." });
  }
};
