/**
 * Employee Controller
 * CRUD + deactivate + optional login provisioning for the employees
 * master. Server is authoritative: role/designation/ids are resolved or
 * fixed here, never trusted from request bodies.
 */
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const db = require("../config/db");
const Employee = require("../models/employeeModel");

// Business rule: FIELD_EXECUTIVE is currently the only
// supported designation for Employee Master records.
const ALLOWED_DESIGNATIONS = ["FIELD_EXECUTIVE"];
const ALLOWED_STATUS = ["Active", "Inactive"];
// Type of employment (employee form v2). Omitted/blank defaults to
// Permanent; anything outside the list is rejected.
const ALLOWED_EMPLOYMENT_TYPES = ["Permanent", "Contractual", "Probation", "Intern"];

// Returns { value } (defaults to Permanent) or { error } when out of list.
function resolveEmploymentType(raw) {
  const t = normOptionalText(raw, 20);
  if (t === null) return { value: "Permanent" };
  if (!ALLOWED_EMPLOYMENT_TYPES.includes(t)) {
    return { error: `Employment Type must be one of: ${ALLOWED_EMPLOYMENT_TYPES.join(", ")}.` };
  }
  return { value: t };
}

function isDuplicateEntry(err) {
  return err && err.code === "ER_DUP_ENTRY";
}

// ---- Optional employee identity uploads ---------------------------------
// All three identity fields are OPTIONAL (nothing mandatory):
//   - profile_photo (image)  -> employees.profile_photo_path
//   - photo_id_number (text) -> employees.photo_id_number
//   - id_document (image/pdf) -> employees.photo_id_doc_path
// Disk storage under uploads/employees/ (served by the existing public
// /uploads static mount, same as legacy OCR scans).
const EMP_UPLOAD_DIR = path.join("uploads", "employees");
const MAX_EMP_FILE_BYTES = 5 * 1024 * 1024;
const PROFILE_MIME = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const PROFILE_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const IDDOC_MIME = [...PROFILE_MIME, "application/pdf"];
const IDDOC_EXT = [...PROFILE_EXT, ".pdf"];

const empStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(EMP_UPLOAD_DIR, { recursive: true });
    cb(null, EMP_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || "").toLowerCase()) || ".bin";
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.fieldname}${ext}`;
    cb(null, safe);
  }
});

const empUpload = multer({
  storage: empStorage,
  limits: { fileSize: MAX_EMP_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || "").toLowerCase());
    if (file.fieldname === "profile_photo") {
      if (PROFILE_MIME.includes(file.mimetype) && PROFILE_EXT.includes(ext)) return cb(null, true);
      return cb(new Error("Profile photo must be JPG, PNG or WEBP up to 5 MB."));
    }
    if (file.fieldname === "id_document") {
      if (IDDOC_MIME.includes(file.mimetype) && IDDOC_EXT.includes(ext)) return cb(null, true);
      return cb(new Error("ID document must be JPG, PNG, WEBP or PDF up to 5 MB."));
    }
    return cb(new Error(`Unexpected file field '${file.fieldname}'. Use profile_photo and id_document only.`));
  }
});

// Accept multipart (with files) AND plain JSON. All identity fields optional.
function uploadEmployeeFiles(req, res, next) {
  empUpload.fields([
    { name: "profile_photo", maxCount: 1 },
    { name: "id_document", maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      // Best-effort cleanup of any partially written files.
      try {
        const staged = [...(req.files?.profile_photo || []), ...(req.files?.id_document || [])];
        staged.forEach((f) => { if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); });
      } catch (_) { /* noop */ }
      return res.status(400).json({ success: false, message: err.message || "Invalid file upload." });
    }
    next();
  });
}

function toRelUploadPath(filePath) {
  if (!filePath) return null;
  // Store "uploads/employees/<file>" (forward slashes) so any host can serve it.
  return String(filePath).split(path.sep).join("/").replace(/^\.\//, "");
}

function removeStaleFile(relPath) {
  try {
    if (!relPath) return;
    const abs = path.resolve(String(relPath));
    const root = path.resolve("uploads", "employees");
    // Never delete outside uploads/employees.
    if (!abs.startsWith(root)) return;
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (_) { /* noop */ }
}

// Optional text: empty/whitespace -> null (never a validation error).
function normOptionalText(v, maxLen) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

// Resolve designation input (code or numeric id) to a designation id,
// enforcing allow-list. Returns { id, code } or { error }.
async function resolveDesignation(input) {
  if (input === undefined || input === null || String(input).trim() === "") {
    return { error: "Designation is required (FIELD_EXECUTIVE)." };
  }
  let code;
  if (/^\d+$/.test(String(input))) {
    const [rows] = await db.query("SELECT id, code FROM designations WHERE id = ? LIMIT 1", [Number(input)]);
    if (!rows[0]) return { error: "Invalid designation." };
    code = rows[0].code;
    if (!ALLOWED_DESIGNATIONS.includes(code)) {
      return { error: `Designation '${code}' is not supported. Only FIELD_EXECUTIVE is allowed.` };
    }
    return { id: rows[0].id, code: rows[0].code };
  }
  code = String(input).trim().toUpperCase();
  if (!ALLOWED_DESIGNATIONS.includes(code)) {
    return { error: `Designation '${String(input).trim()}' is not supported. Only FIELD_EXECUTIVE is allowed.` };
  }
  const row = await Employee.getDesignationByCode(code);
  if (!row) return { error: `Designation '${code}' is not configured in master data.` };
  return { id: row.id, code: row.code };
}

// Resolve optional department input (code or numeric id) to id (or null).
async function resolveDepartment(input) {
  if (input === undefined || input === null || String(input).trim() === "") return { id: null };
  if (/^\d+$/.test(String(input))) {
    const row = await Employee.getDepartmentById(Number(input));
    if (!row) return { error: "Invalid department." };
    return { id: row.id };
  }
  const row = await Employee.getDepartmentByCode(String(input).trim().toUpperCase());
  if (!row) return { error: `Department '${String(input).trim()}' does not exist.` };
  return { id: row.id };
}

function validateContact(email, mobile) {
  const errors = [];
  if (email && String(email).trim() !== "") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      errors.push("Invalid email format.");
    }
  }
  if (mobile && String(mobile).trim() !== "") {
    const digits = String(mobile).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) {
      errors.push("Mobile number must contain a valid 10-digit phone number.");
    }
  }
  return errors;
}

// GET /api/employees/meta/departments — active department master rows
// for the Employee form dropdowns (gated by employees.view like the list).
exports.getDepartments = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, code, name FROM departments WHERE is_active = 1 ORDER BY name"
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching departments:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching departments." });
  }
};

// GET /api/employees?search=&status=&designation=&department=&page=&limit=
exports.getAllEmployees = async (req, res) => {
  try {
    const { search = "", status = "", designation = "", department = "", page = 1, limit = 20 } = req.query;
    if (status && !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status filter. Use Active or Inactive." });
    }
    const result = await Employee.list({ search, status, designation, department, page, limit });
    return res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    console.error("Error fetching employees:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching employees." });
  }
};

// GET /api/employees/:id
exports.getEmployeeById = async (req, res) => {
  try {
    const employee = await Employee.getById(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: `Employee with ID ${req.params.id} not found.` });
    }
    return res.status(200).json({ success: true, data: employee });
  } catch (error) {
    console.error("Error fetching employee:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching employee." });
  }
};

// POST /api/employees. employee_code is NOT taken from the request: it
// is auto-generated as EMP-<designation initials>-### (e.g.
// FIELD_EXECUTIVE -> EMP-FE-###). The duplicate-retry covers the rare
// race between generation and insert (unique key stays authoritative).
exports.createEmployee = [
  uploadEmployeeFiles,
  async (req, res) => {
  try {
    const { employee_name, mobile, email, address, address_line_2, city, state, district, landmark, designation, department, status, join_date, employment_type, id_type, photo_id_number, emergency_contact_name, emergency_phone, emergency_relation } = req.body || {};
    const errors = [];
    const employeeName = String(employee_name || "").trim();
    const addressLine1 = String(address || "").trim();
    const stateName = String(state || "").trim();
    const districtName = String(district || "").trim();
    const departmentCode = String(department || "").trim();
    if (employeeName === "") errors.push("Employee Name is required.");
    if (addressLine1 === "") errors.push("Address Line 1 is required.");
    if (stateName === "") errors.push("State is required.");
    if (districtName === "") errors.push("District is required.");
    if (departmentCode === "") errors.push("Department is required.");
    if (status && !ALLOWED_STATUS.includes(status)) errors.push("Status must be Active or Inactive.");
    const employmentType = resolveEmploymentType(employment_type);
    if (employmentType.error) errors.push(employmentType.error);
    errors.push(...validateContact(email, mobile));
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    const desig = await resolveDesignation(designation);
    if (desig.error) return res.status(400).json({ success: false, message: desig.error });
    const dept = await resolveDepartment(department);
    if (dept.error) return res.status(400).json({ success: false, message: dept.error });

    // All optional: missing file/text simply stays NULL.
    const profileFile = req.files?.profile_photo?.[0] || null;
    const idDocFile = req.files?.id_document?.[0] || null;

    let insertId;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const employeeCode = await Employee.nextEmployeeCode(db, desig.code);
        insertId = await Employee.create(
          {
            employee_code: employeeCode,
            employee_name: employeeName,
            mobile: mobile ? String(mobile).trim() : null,
            email: email ? String(email).trim() : null,
            address: addressLine1,
            address_line_2: normOptionalText(address_line_2, 255),
            city: city || null, state: stateName, district: districtName,
            landmark: normOptionalText(landmark, 150),
            emergency_contact_name: normOptionalText(emergency_contact_name, 100),
            emergency_phone: normOptionalText(emergency_phone, 15),
            emergency_relation: normOptionalText(emergency_relation, 50),
            profile_photo_path: profileFile ? toRelUploadPath(profileFile.path) : null,
            id_type: normOptionalText(id_type, 30),
            photo_id_number: normOptionalText(photo_id_number, 100),
            photo_id_doc_path: idDocFile ? toRelUploadPath(idDocFile.path) : null,
            designation_id: desig.id, department_id: dept.id,
            status: status || "Active", join_date: join_date || null,
            employment_type: employmentType.value
          },
          req.user.id
        );
        break;
      } catch (err) {
        if (isDuplicateEntry(err) && attempt < 4) continue;
        throw err;
      }
    }

    const created = await Employee.getById(insertId);
    return res.status(201).json({ success: true, message: "Employee created successfully.", data: created });
  } catch (error) {
    console.error("Error creating employee:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating employee." });
  }
  }
];

// PUT /api/employees/:id
exports.updateEmployee = [
  uploadEmployeeFiles,
  async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const current = await Employee.getById(id);
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Employee with ID ${id} not found.` });
    }

    const { employee_code, employee_name, mobile, email, address, address_line_2, city, state, district, landmark, designation, department, status, join_date, employment_type, id_type, photo_id_number, emergency_contact_name, emergency_phone, emergency_relation } = req.body || {};
    const errors = [];
    // The code is echoed read-only by the edited form. A missing/blank
    // code keeps the current one (never trust a caller-invented code).
    const nextCode = employee_code && String(employee_code).trim() !== ""
      ? String(employee_code).trim()
      : current.employee_code;
    if (!employee_name || String(employee_name).trim() === "") errors.push("Employee Name is required.");
    if (!address || String(address).trim() === "") errors.push("Address Line 1 is required.");
    if (!state || String(state).trim() === "") errors.push("State is required.");
    if (!district || String(district).trim() === "") errors.push("District is required.");
    if (!department || String(department).trim() === "") errors.push("Department is required.");
    if (status && !ALLOWED_STATUS.includes(status)) errors.push("Status must be Active or Inactive.");
    const employmentType = resolveEmploymentType(employment_type);
    if (employmentType.error) errors.push(employmentType.error);
    errors.push(...validateContact(email, mobile));
    if (errors.length > 0) {
      conn.release();
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    const desig = await resolveDesignation(designation);
    if (desig.error) { conn.release(); return res.status(400).json({ success: false, message: desig.error }); }
    const dept = await resolveDepartment(department);
    if (dept.error) { conn.release(); return res.status(400).json({ success: false, message: dept.error }); }

    const codeOwner = await Employee.getByCode(nextCode);
    if (codeOwner && codeOwner.id !== Number(id)) {
      conn.release();
      return res.status(409).json({ success: false, message: `Employee Code '${nextCode}' belongs to another employee.` });
    }

    // Optional identity fields: new upload replaces, otherwise keep existing.
    // photo_id_number: omitted/empty -> keep existing? Explicit empty string
    // clears it. Absent key (undefined) keeps existing so JSON clients that
    // don't send the field won't wipe it.
    const profileFile = req.files?.profile_photo?.[0] || null;
    const idDocFile = req.files?.id_document?.[0] || null;
    const nextProfilePath = profileFile
      ? toRelUploadPath(profileFile.path)
      : (current.profile_photo_path || null);
    const nextIdDocPath = idDocFile
      ? toRelUploadPath(idDocFile.path)
      : (current.photo_id_doc_path || null);
    const nextPhotoIdNumber = (photo_id_number === undefined)
      ? (current.photo_id_number || null)
      : normOptionalText(photo_id_number, 100);

    await conn.beginTransaction();
    await conn.query(
      `UPDATE employees SET employee_code = ?, employee_name = ?, mobile = ?, email = ?,
         address = ?, address_line_2 = ?, city = ?, district = ?, state = ?, landmark = ?,
         emergency_contact_name = ?, emergency_phone = ?, emergency_relation = ?,
         profile_photo_path = ?, id_type = ?, photo_id_number = ?, photo_id_doc_path = ?,
         designation_id = ?, department_id = ?,
         status = ?, join_date = ?, employment_type = ?, updated_by = ? WHERE id = ?`,
      [nextCode, String(employee_name).trim(),
       mobile ? String(mobile).trim() : null, email ? String(email).trim() : null,
       address ? String(address).trim() : null, normOptionalText(address_line_2, 255),
       city || null, normOptionalText(district, 60), state ? String(state).trim() : null,
       normOptionalText(landmark, 150),
       normOptionalText(emergency_contact_name, 100), normOptionalText(emergency_phone, 15), normOptionalText(emergency_relation, 50),
       nextProfilePath, normOptionalText(id_type, 30), nextPhotoIdNumber, nextIdDocPath,
       desig.id, dept.id, status || "Active", join_date || null,
       employmentType.value, req.user.id, id]
    );
    // Keep linked login in step: employee INACTIVE locks the account via
    // the existing Active/Inactive user convention (no auth changes).
    if (current.user) {
      const targetUserStatus = (status || "Active") === "Active" ? "Active" : "Inactive";
      if (current.user.status !== targetUserStatus) {
        await conn.query("UPDATE users SET status = ? WHERE id = ?", [targetUserStatus, current.user.id]);
      }
    }
    await conn.commit();
    conn.release();

    // Best-effort stale file cleanup only after successful commit.
    if (profileFile && current.profile_photo_path && current.profile_photo_path !== nextProfilePath) {
      removeStaleFile(current.profile_photo_path);
    }
    if (idDocFile && current.photo_id_doc_path && current.photo_id_doc_path !== nextIdDocPath) {
      removeStaleFile(current.photo_id_doc_path);
    }

    const updated = await Employee.getById(id);
    return res.status(200).json({ success: true, message: "Employee updated successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Employee Code already exists." });
    }
    console.error("Error updating employee:", error.message);
    return res.status(500).json({ success: false, message: "Server error while updating employee." });
  }
  }
];

// PATCH /api/employees/:id/deactivate — soft-delete; history preserved.
exports.deactivateEmployee = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const current = await Employee.getById(id);
    if (!current) {
      conn.release();
      return res.status(404).json({ success: false, message: `Employee with ID ${id} not found.` });
    }
    if (current.status === "Inactive") {
      conn.release();
      return res.status(200).json({ success: true, message: "Employee is already inactive.", data: current });
    }
    await conn.beginTransaction();
    await conn.query("UPDATE employees SET status = 'Inactive', updated_by = ? WHERE id = ?", [req.user.id, id]);
    if (current.user) {
      await conn.query("UPDATE users SET status = 'Inactive' WHERE id = ?", [current.user.id]);
    }
    await conn.commit();
    conn.release();

    const updated = await Employee.getById(id);
    return res.status(200).json({ success: true, message: "Employee deactivated successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    console.error("Error deactivating employee:", error.message);
    return res.status(500).json({ success: false, message: "Server error while deactivating employee." });
  }
};

// POST /api/employees/:id/login — provision a login for an employee.
// Server-controlled: users.role is always EMPLOYEE and both link columns
// are set from the employee row; any role/ids in the body are ignored.
exports.createEmployeeLogin = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const employee = await Employee.getById(id);
    if (!employee) {
      conn.release();
      return res.status(404).json({ success: false, message: `Employee with ID ${id} not found.` });
    }
    if (employee.user) {
      conn.release();
      return res.status(409).json({ success: false, message: "This employee already has a linked login account." });
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
      `INSERT INTO users (name, username, email, password_hash, role, status, must_change_password, employee_id)
       VALUES (?, ?, ?, ?, 'EMPLOYEE', ?, 1, ?)`,
      [employee.employee_name, String(username).trim(),
       email ? String(email).trim() : null, passwordHash,
       employee.status === "Active" ? "Active" : "Inactive", employee.id]
    );
    await conn.query("UPDATE employees SET user_id = ?, updated_by = ? WHERE id = ?", [result.insertId, req.user.id, employee.id]);
    await conn.commit();
    conn.release();

    const updated = await Employee.getById(id);
    return res.status(201).json({ success: true, message: "Login account created successfully.", data: updated });
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    conn.release();
    if (isDuplicateEntry(error)) {
      return res.status(409).json({ success: false, message: "Username is already taken." });
    }
    console.error("Error creating employee login:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating login account." });
  }
};
