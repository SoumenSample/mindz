/**
 * Client Controller
 * CRUD + deactivate + optional login provisioning for the clients
 * organization master. Server is authoritative: users.role is always
 * CLIENT and users.client_id always the client row — request bodies
 * can never set roles or cross-client ownership.
 */
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const db = require("../config/db");
const Client = require("../models/clientModel");

const ALLOWED_STATUS = ["Active", "Inactive"];

function isDuplicateEntry(err) {
  return err && err.code === "ER_DUP_ENTRY";
}

// ---- Optional client logo upload ----------------------------------------
// Disk storage under uploads/clients/ (served by the existing public
// /uploads static mount). Max 2 MB, JPG/PNG/WEBP/PDF — mirrors the hint
// shown on the redesigned form. Field name: `logo`.
const CLIENT_UPLOAD_DIR = path.join("uploads", "clients");
const MAX_LOGO_FILE_BYTES = 2 * 1024 * 1024;
const LOGO_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const LOGO_EXT = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(CLIENT_UPLOAD_DIR, { recursive: true });
    cb(null, CLIENT_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || "").toLowerCase()) || ".bin";
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.fieldname}${ext}`;
    cb(null, safe);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: MAX_LOGO_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || "").toLowerCase());
    if (LOGO_MIME.includes(file.mimetype) && LOGO_EXT.includes(ext)) return cb(null, true);
    return cb(new Error("Client logo must be JPG, PNG, WEBP or PDF up to 2 MB."));
  }
});

// Tolerates multipart uploads AND plain JSON bodies: multer passes
// non-multipart requests straight through, so both form paths work.
function uploadClientLogo(req, res, next) {
  logoUpload.single("logo")(req, res, (err) => {
    if (err) {
      try {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (_) { /* noop */ }
      return res.status(400).json({ success: false, message: err.message || "Invalid logo upload." });
    }
    next();
  });
}

function toRelUploadPath(filePath) {
  if (!filePath) return null;
  // Store "uploads/clients/<file>" (forward slashes) so any host can serve it.
  return String(filePath).split(path.sep).join("/").replace(/^\.\//, "");
}

function removeStaleFile(relPath) {
  try {
    if (!relPath) return;
    const abs = path.resolve(String(relPath));
    const root = path.resolve("uploads", "clients");
    // Never delete outside uploads/clients.
    if (!abs.startsWith(root)) return;
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (_) { /* noop */ }
}

// Optional text helper: empty/whitespace -> null (never an error).
function normOptionalText(v, maxLen) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

// GSTIN format (optional field): 15 chars — 2 state digits, 10-char PAN,
// entity digit, 'Z', checksum. Checked only when a value is provided.
function isValidGstin(v) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(String(v).toUpperCase());
}

// PIN code (optional): Indian 6-digit format.
function isValidPincode(v) {
  return /^[0-9]{6}$/.test(String(v).trim());
}

// Exported because clientRoutes wires it as route-level middleware
// (POST / and PUT /:id accept an optional multipart `logo` file).
exports.uploadClientLogo = uploadClientLogo;

function audit(req, conn, { action, entityType, entityId, oldValues, newValues }) {
  const ip = (req.ip || "").slice(0, 45);
  const ua = (req.headers["user-agent"] || "").slice(0, 255);
  const q = (conn || db).query.bind(conn || db);
  return q(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id, action, entityType, entityId ?? null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ip || null, ua || null
    ]
  );
}

function validateContact(email, phone) {
  const errors = [];
  if (email && String(email).trim() !== "") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      errors.push("Invalid email format.");
    }
  }
  if (phone && String(phone).trim() !== "") {
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) {
      errors.push("Phone must contain a valid 10-digit number.");
    }
  }
  return errors;
}

function publicClient(row, linkedUsers = null) {
  if (!row) return null;
  const out = { ...row };
  if (linkedUsers !== null) out.linked_users = linkedUsers;
  return out;
}

// Extended form fields accepted on create/update. Everything except
// client_name is optional; blank/whitespace normalizes to NULL.
function parseClientFields(body) {
  return {
    client_name: body?.client_name ? String(body.client_name).trim() : "",
    gst_number: normOptionalText(body?.gst_number, 20),
    address_line_1: normOptionalText(body?.address_line_1, 255),
    address_line_2: normOptionalText(body?.address_line_2, 255),
    city: normOptionalText(body?.city, 60),
    state: normOptionalText(body?.state, 60),
    district: normOptionalText(body?.district, 60),
    police_station: normOptionalText(body?.police_station, 100),
    pincode: normOptionalText(body?.pincode, 10),
    landmark: normOptionalText(body?.landmark, 150),
    contact_person: normOptionalText(body?.contact_person, 100),
    email: normOptionalText(body?.email, 100),
    phone: normOptionalText(body?.phone, 15),
    remarks: normOptionalText(body?.remarks, 255),
    status: body?.status ? String(body.status).trim() : "Active"
  };
}

function validateClientFields(f) {
  const errors = [];
  if (!f.client_name) errors.push("Client Name is required.");
  if (!f.address_line_1) errors.push("Address Line 1 is required.");
  if (!f.city) errors.push("City is required.");
  if (!f.contact_person) errors.push("Contact Person Name is required.");
  if (!f.phone) errors.push("Phone Number is required.");
  if (!f.email) errors.push("Email ID is required.");
  if (!ALLOWED_STATUS.includes(f.status)) errors.push("Status must be Active or Inactive.");
  if (f.gst_number && !isValidGstin(f.gst_number)) {
    errors.push("GST Number must be a valid 15-character GSTIN.");
  }
  if (f.pincode && !isValidPincode(f.pincode)) {
    errors.push("PIN Code must be a 6-digit number.");
  }
  errors.push(...validateContact(f.email, f.phone));
  return errors;
}

// GET /api/clients?search=&status=&page=&limit=
exports.getAllClients = async (req, res) => {
  try {
    const { search = "", status = "", page = 1, limit = 20 } = req.query;
    if (status && !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status filter. Use Active or Inactive." });
    }
    const result = await Client.list({ search, status, page, limit });
    return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    console.error("Error fetching clients:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching clients." });
  }
};

// GET /api/clients/:id (includes linked logins, safe fields only)
exports.getClientById = async (req, res) => {
  try {
    const client = await Client.getById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: `Client with ID ${req.params.id} not found.` });
    }
    const linked = await Client.getLinkedUsers(client.id);
    return res.status(200).json({ success: true, data: publicClient(client, linked) });
  } catch (error) {
    console.error("Error fetching client:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching client." });
  }
};

// POST /api/clients — multipart (optional logo file) OR plain JSON.
// client_code is NOT taken from the request: the backend auto-generates
// it as CLT-FIRST3-### (first 3 letters of the client name + running serial).
exports.createClient = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const f = parseClientFields(req.body);
    const errors = validateClientFields(f);
    if (errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    await conn.beginTransaction();

    // Auto-generate the client code inside the transaction; retry on the
    // (rare) duplicate race so two saves never share a code.
    let clientCode;
    let insertId;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        clientCode = await Client.nextClientCode(conn, f.client_name);
        insertId = await Client.create({
          client_code: clientCode,
          ...f,
          // Legacy free-text address keeps mirroring address_line_1 so
          // older reads (jobs/stores flows) never show an empty address.
          address: f.address_line_1,
          logo_path: req.file ? toRelUploadPath(req.file.path) : null
        }, req.user.id, conn);
        break;
      } catch (insertErr) {
        if (isDuplicateEntry(insertErr) && attempt < 4) continue;
        throw insertErr;
      }
    }

    await audit(req, conn, {
      action: "CLIENT_CREATED", entityType: "CLIENT", entityId: insertId,
      oldValues: null, newValues: { client_code: clientCode, client_name: f.client_name }
    });
    await conn.commit();
    conn.release();

    const created = await Client.getById(insertId);
    return res.status(201).json({ success: true, message: "Client created successfully.", data: publicClient(created, []) });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    // Clean up an uploaded logo if the create failed.
    if (req.file?.path) removeStaleFile(toRelUploadPath(req.file.path));
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Client Code already exists." });
    }
    console.error("Error creating client:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating client." });
  }
};

// PUT /api/clients/:id — multipart (optional new logo) OR plain JSON.
// client_code stays caller-controlled (the form echoes the existing
// code); all extended fields are optional and blank-normalized.
exports.updateClient = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const current = await Client.getById(id);
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Client with ID ${id} not found.` });
    }

    const f = parseClientFields(req.body);
    const errors = validateClientFields(f);
    if (errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    const clientCode = normOptionalText(req.body?.client_code, 30) || current.client_code;
    const codeOwner = await Client.getByCode(String(clientCode).trim());
    if (codeOwner && codeOwner.id !== Number(id)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Client Code '${String(clientCode).trim()}' belongs to another client.` });
    }

    // New logo wins; otherwise the existing path (may be null) is kept.
    const nextLogoPath = req.file ? toRelUploadPath(req.file.path) : (current.logo_path || null);

    await conn.beginTransaction();
    await Client.update(id, {
      client_code: String(clientCode).trim(),
      ...f,
      // Legacy free-text address keeps mirroring address_line_1.
      address: f.address_line_1,
      logo_path: nextLogoPath
    }, req.user.id, conn);
    // Keep linked logins in step with the organization (existing
    // Active/Inactive user convention; no auth changes).
    const targetUserStatus = (f.status || "Active") === "Active" ? "Active" : "Inactive";
    await conn.query("UPDATE users SET status = ? WHERE client_id = ?", [targetUserStatus, id]);
    await audit(req, conn, {
      action: "CLIENT_UPDATED", entityType: "CLIENT", entityId: Number(id),
      oldValues: { client_code: current.client_code, client_name: current.client_name, status: current.status },
      newValues: { client_code: String(clientCode).trim(), client_name: f.client_name, status: f.status }
    });
    await conn.commit();
    conn.release();

    // Swap succeeded — drop the replaced logo file.
    if (req.file && current.logo_path && current.logo_path !== nextLogoPath) {
      removeStaleFile(current.logo_path);
    }

    const updated = await Client.getById(id);
    const linked = await Client.getLinkedUsers(updated.id);
    return res.status(200).json({ success: true, message: "Client updated successfully.", data: publicClient(updated, linked) });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Client Code already exists." });
    }
    console.error("Error updating client:", error.message);
    return res.status(500).json({ success: false, message: "Server error while updating client." });
  }
};

// PATCH /api/clients/:id/deactivate — soft-delete; stores/jobs/history intact.
exports.deactivateClient = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const current = await Client.getById(id);
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Client with ID ${id} not found.` });
    }
    if (current.status === "Inactive") {
      conn.release();
      const linked = await Client.getLinkedUsers(current.id);
      return res.status(200).json({ success: true, message: "Client is already inactive.", data: publicClient(current, linked) });
    }
    await conn.beginTransaction();
    await conn.query("UPDATE clients SET status = 'Inactive', updated_by = ? WHERE id = ?", [req.user.id, id]);
    await conn.query("UPDATE users SET status = 'Inactive' WHERE client_id = ?", [id]);
    await audit(req, conn, {
      action: "CLIENT_DEACTIVATED", entityType: "CLIENT", entityId: Number(id),
      oldValues: { status: "Active" }, newValues: { status: "Inactive" }
    });
    await conn.commit();
    conn.release();

    const updated = await Client.getById(id);
    const linked = await Client.getLinkedUsers(updated.id);
    return res.status(200).json({ success: true, message: "Client deactivated successfully.", data: publicClient(updated, linked) });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error deactivating client:", error.message);
    return res.status(500).json({ success: false, message: "Server error while deactivating client." });
  }
};

// POST /api/clients/:id/login — provision a client login.
// Server-controlled: users.role is always CLIENT and users.client_id is
// always this client; any role/client_id in the body is ignored.
exports.createClientLogin = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const client = await Client.getById(id);
    if (!client) {
      conn.release();
      return res.status(404).json({ success: false, message: `Client with ID ${id} not found.` });
    }

    const { username, email, password } = req.body || {};
    if (!username || String(username).trim().length < 3) {
      conn.release();
      return res.status(400).json({ success: false, message: "Username is required (minimum 3 characters)." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      conn.release();
      return res.status(400).json({ success: false, message: "Invalid email format." });
    }
    if (!password || String(password).length < 6) {
      conn.release();
      return res.status(400).json({ success: false, message: "Password is required (minimum 6 characters)." });
    }

    const [taken] = await conn.query("SELECT id FROM users WHERE username = ? LIMIT 1", [String(username).trim()]);
    if (taken[0]) {
      conn.release();
      return res.status(409).json({ success: false, message: `Username '${String(username).trim()}' is already taken.` });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO users (name, username, email, password_hash, role, status, must_change_password, client_id)
       VALUES (?, ?, ?, ?, 'CLIENT', ?, 1, ?)`,
      [client.client_name, String(username).trim(),
       email ? String(email).trim() : null, passwordHash,
       client.status === "Active" ? "Active" : "Inactive", client.id]
    );
    await audit(req, conn, {
      action: "CLIENT_LOGIN_CREATED", entityType: "USER", entityId: result.insertId,
      oldValues: null, newValues: { username: String(username).trim(), role: "CLIENT", client_id: client.id }
    });
    await conn.commit();
    conn.release();

    const updated = await Client.getById(id);
    const linked = await Client.getLinkedUsers(updated.id);
    return res.status(201).json({ success: true, message: "Login account created successfully.", data: publicClient(updated, linked) });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Username is already taken." });
    }
    console.error("Error creating client login:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating login account." });
  }
};
