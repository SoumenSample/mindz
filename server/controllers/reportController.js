/**
 * Report Controller (Module 12.1) — closed-visit Measurement Sheet PDF.
 * READ-ONLY: no INSERT/UPDATE/DELETE anywhere in this module.
 *
 * GET /api/reports/visits/:visitId/measurement-sheet
 *   - chain: verifyToken -> requireActiveUser -> requireFreshPassword
 *     (+ visits.view.all for office; visits.view.own scoping below)
 *   - eligibility: visit must be VISIT_CLOSED (else 422 VISIT_NOT_CLOSED)
 *   - FINAL measurement sheet required (else 422 MEASUREMENT_NOT_FOUND)
 *   - signature embedded when present; graceful "not available" + server
 *     warning when absent (exceptional: Module 12 gates closure on it)
 *   - scoping mirrors visit detail: global / assigned-employee /
 *     own-client, foreign rows 404 (no existence leak)
 */
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

const db = require("../config/db");
const Report = require("../models/reportModel");
const { hasPermission } = require("../services/rbacService");

const COMPANY = {
  name: "MINDZTEAM INDIA SOLUTIONS PVT. LTD.",
  address: "47 South Tangra, Gobinda Khatick Road, Kolkata - 700046, West Bengal",
  cin: "CIN \u2013 U73100WB2026PTC288749",
  gstin: "GSTIN \u2013 19AVCM1674N1ZH",
  pan: "PAN NO \u2013 AALCM1674N",
  phone: "Phone: 8420085996",
  email: "E-mail: rajib@mindzteam.com"
};

const ROWS_PER_PAGE = 20;

// Visible padded rows for a page holding n data rows: round UP to the
// next multiple of 5, minimum 10 (4->10, 5->10, 12->15, 18->20). Short
// sheets stay compact so the table + signature + footer fit one page
// instead of colliding at the bottom margin. Full pages always stay 20.
function paddedRowCount(n) {
  return Math.max(10, Math.ceil(n / 5) * 5);
}

// Server-side IST rendering (client datetime.js is the browser twin and
// stays untouched). Pure Intl, no new dependency.
function istDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric"
  }).format(d);
}

function istDateTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const s = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
  }).format(d);
  return `${s} IST`;
}

function num(v) {
  if (v === null || v === undefined || String(v).trim() === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

// Quantity is always an integer on the reports (width/height keep
// decimals). Display-level rounding only — measurement storage and
// validation are untouched.
function intQty(v) {
  if (v === null || v === undefined || String(v).trim() === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n)) : String(v);
}

function sanitizeFilename(s) {
  return String(s || "").replace(/[^A-Za-z0-9_.-]/g, "");
}

// ---- PDF layout (A4 portrait, Helvetica, black/gray) ----
const PAGE_W = 595.28;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const COLS = [
  { key: "sl", label: "Sl.No.", w: 44 },
  { key: "width", label: "Width", w: 74 },
  { key: "height", label: "Height", w: 74 },
  { key: "qty", label: "Quantity", w: 62 },
  { key: "media", label: "Media Type", w: 92 },
  { key: "remarks", label: "Remarks / Sketch", w: CONTENT_W - (44 + 74 + 74 + 62 + 92) }
];
const ROW_H = 22;
const HEADER_H = 24;

function drawHeaderBlock(doc, snap) {
  const cx = PAGE_W / 2;
  doc.fontSize(9).fillColor("#333").font("Helvetica")
    .text(`No. ${snap.job_number}`, MARGIN, 36, { width: CONTENT_W, align: "left" });
  doc.fontSize(16).fillColor("#000").font("Helvetica-Bold")
    .text("MEASUREMENT SHEET", MARGIN, 50, { width: CONTENT_W, align: "center" });
  let y = 74;
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#000")
    .text(COMPANY.name, MARGIN, y, { width: CONTENT_W, align: "center" });
  y = doc.y + 3;
  doc.fontSize(8.5).font("Helvetica").fillColor("#333")
    .text(COMPANY.address, MARGIN, y, { width: CONTENT_W, align: "center" });
  y = doc.y + 2;
  doc.text(`${COMPANY.cin}    ${COMPANY.gstin}    ${COMPANY.pan}`, MARGIN, y, { width: CONTENT_W, align: "center" });
  y = doc.y + 2;
  doc.text(`${COMPANY.phone}    ${COMPANY.email}`, MARGIN, y, { width: CONTENT_W, align: "center" });
  y = doc.y + 6;
  doc.strokeColor("#000").lineWidth(1).moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).stroke();
  return y + 8;
}

function drawInfoField(doc, x, y, w, label, value) {
  doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#000").text(`${label}:`, x, y, { width: 78 });
  doc.font("Helvetica").fillColor("#111")
    .text(value || "", x + 80, y, { width: w - 80 });
  return Math.max(doc.y, y + 11);
}

function drawInfoSection(doc, y, info) {
  const leftX = MARGIN;
  const rightX = MARGIN + CONTENT_W / 2 + 8;
  const colW = CONTENT_W / 2 - 8;
  const left = [["Client Name", info.client], ["Brand Name", info.brand], ["State", info.state], ["City", info.city]];
  const right = [["Date", info.date], ["Shop Name", info.shop], ["Shop Address", info.address], ["Mobile No.", info.mobile], ["Measured By", info.measuredBy]];
  let maxRows = Math.max(left.length, right.length);
  let yy = y;
  for (let i = 0; i < maxRows; i++) {
    let yL = yy;
    let yR = yy;
    if (left[i]) yL = drawInfoField(doc, leftX, yy, colW, left[i][0], left[i][1]);
    if (right[i]) yR = drawInfoField(doc, rightX, yy, colW, right[i][0], right[i][1]);
    yy = Math.max(yL, yR) + 3;
  }
  doc.strokeColor("#000").lineWidth(1).moveTo(MARGIN, yy).lineTo(PAGE_W - MARGIN, yy).stroke();
  return yy + 8;
}

function drawTableHeader(doc, y) {
  let x = MARGIN;
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#000");
  COLS.forEach((c) => {
    doc.rect(x, y, c.w, HEADER_H).fillAndStroke("#e8e8e8", "#000");
    doc.fillColor("#000").text(c.label, x, y + 7, { width: c.w, align: "center" });
    x += c.w;
  });
  return y + HEADER_H;
}

function drawTableRow(doc, y, cells) {
  let x = MARGIN;
  doc.fontSize(9).font("Helvetica").fillColor("#111");
  COLS.forEach((c, i) => {
    doc.rect(x, y, c.w, ROW_H).stroke("#000");
    const v = cells[i] || "";
    if (c.key === "sl") {
      doc.text(v, x, y + 6, { width: c.w, align: "center" });
    } else {
      doc.text(v, x + 4, y + 6, { width: c.w - 8, align: "left", lineBreak: false, ellipsis: true });
    }
    x += c.w;
  });
  return y + ROW_H;
}

function drawSignatureBlock(doc, y, sig, verification) {
  doc.fontSize(9).font("Helvetica").fillColor("#000");
  const verifiedLabel = "Verified by: ";
  doc.text(verifiedLabel, MARGIN, y);
  const vx = MARGIN + doc.widthOfString(verifiedLabel) + 4;
  if (verification && verification.verifier_name) {
    doc.font("Helvetica-Bold").text(verification.verifier_name, vx, y);
    doc.font("Helvetica");
  } else {
    doc.strokeColor("#000").lineWidth(0.5)
      .moveTo(vx, y + 12).lineTo(vx + 220, y + 12).stroke();
  }
  let yy = y + 26;
  doc.text("Shop owner Signature & Stamp:", MARGIN, yy);
  yy += 14;
  if (sig && sig.embedded) {
    try {
      doc.image(sig.embedded, MARGIN, yy, { fit: [150, 56] });
    } catch (_) {
      doc.fillColor("#666").text("Signature not available", MARGIN, yy);
      doc.fillColor("#000");
    }
    yy += 60;
    doc.fontSize(8.5).fillColor("#333")
      .text(`${sig.signer_name || ""}${sig.signed_at ? `  ·  ${istDateTime(sig.signed_at)}` : ""}`, MARGIN, yy);
    doc.fillColor("#000");
    yy += 12;
  } else {
    doc.fillColor("#666").text("Signature not available", MARGIN, yy);
    doc.fillColor("#000");
    yy += 14;
  }
  return yy;
}

// Footer is stamped IN-FLOW directly after each page's content (never
// at a fixed y near the margin). Fixed-y footers proved unreliable:
// pdfkit's break-check spawned a blank auto-page per footer in real
// reports even at y values that were safe in isolation. Totals are
// known upfront, so numbering stays exact.
function drawFooter(doc, n, total) {
  doc.moveDown(0.5);
  doc.strokeColor("#999").lineWidth(0.5);
  const ly = doc.y;
  doc.moveTo(MARGIN, ly).lineTo(PAGE_W - MARGIN, ly).stroke();
  doc.fontSize(7.5).font("Helvetica").fillColor("#666")
    .text(`${COMPANY.name}  ·  Generated on: ${istDateTime(new Date())}  ·  Page ${n} of ${total}`,
      { align: "center" });
}

function buildPdf(snap, sheet, signatureOrNull) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: MARGIN });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("error", reject);

      const address = [snap.address_line_1, snap.address_line_2, snap.landmark]
        .filter(Boolean).join(", ");
      let fullAddress = [address, snap.store_city, snap.store_state, snap.pincode]
        .filter(Boolean).join(", ");
      // Bounded so a very long address can never push the fixed 20-row
      // table off the first page (which would spawn auto-pages).
      if (fullAddress.length > 170) fullAddress = `${fullAddress.slice(0, 167)}...`;
      const info = {
        client: snap.client_name || "",
        brand: snap.client_name || "",
        state: snap.store_state || snap.client_state || "",
        city: snap.store_city || snap.client_city || "",
        date: istDate(snap.closed_at || snap.started_at),
        shop: snap.store_name || "",
        address: fullAddress,
        mobile: snap.shopkeeper_mobile || snap.client_phone || "",
        measuredBy: snap.employee_name
          ? `${snap.employee_name}${snap.employee_code ? ` (${snap.employee_code})` : ""}`
          : ""
      };

      const rows = sheet.items.map((it, i) => [
        String(i + 1), num(it.width_ft), num(it.height_ft),
        intQty(it.quantity), it.media_type || "", it.remarks || ""
      ]);

      // Pages of up to ROWS_PER_PAGE; short sheets pad with empty rows so
      // the form keeps its physical look. Continuation pages repeat the
      // title + header, never truncate.
      const pages = [];
      for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE));
      if (pages.length === 0) pages.push([]);

      // Padded heights are exact upfront: full 20-row pages, dynamic
      // last page (single-page sheets included). The signature decision
      // below is therefore exact before drawing.
      let pageNo = 0;
      let y = drawHeaderBlock(doc, snap);
      y = drawInfoSection(doc, y, info);
      const tableStartY = y;
      const lastCount = pages[pages.length - 1].length;
      const lastPadded = paddedRowCount(lastCount);
      const lastTableEndY = (pages.length === 1 ? tableStartY : 78) + HEADER_H + lastPadded * ROW_H;
      // Signature (~112 tall) goes on the last table page when it fits
      // there (ends by ~780), else on its own page.
      const sigNeedsPage = lastTableEndY + 10 + 112 > 780;
      const totalPages = pages.length + (sigNeedsPage ? 1 : 0);

      pages.forEach((pageRows, pi) => {
        if (pi > 0) {
          // Already on a fresh page: the previous iteration's trailing
          // addPage advanced here. (A second addPage here used to emit
          // a truly empty page — no font resources, blank in viewers.)
          doc.fontSize(13).font("Helvetica-Bold").fillColor("#000")
            .text("MEASUREMENT SHEET", MARGIN, 40, { width: CONTENT_W, align: "center" });
          doc.fontSize(9).font("Helvetica").fillColor("#333")
            .text(`No. ${snap.job_number}  ·  Visit ${snap.visit_number} (contd.)`, MARGIN, 60, { width: CONTENT_W, align: "center" });
          y = 78;
        }
        y = drawTableHeader(doc, y);
        const filled = pageRows.slice();
        const target = pi === pages.length - 1 ? lastPadded : ROWS_PER_PAGE;
        while (filled.length < target) filled.push(["", "", "", "", "", ""]);
        filled.forEach((cells, i) => {
          cells[0] = cells[0] || String(pi * ROWS_PER_PAGE + i + 1);
          y = drawTableRow(doc, y, cells);
        });
        const isLastTablePage = pi === pages.length - 1;
        if (isLastTablePage && !sigNeedsPage) {
          drawSignatureBlock(doc, y + 10, signatureOrNull, snap._verification || null);
        }
        pageNo += 1;
        drawFooter(doc, pageNo, totalPages);
        if (!isLastTablePage || sigNeedsPage) doc.addPage();
      });
      if (sigNeedsPage) {
        let sy = 50;
        doc.fontSize(9).font("Helvetica").fillColor("#333")
          .text(`No. ${snap.job_number}  ·  Visit ${snap.visit_number} — signature`, MARGIN, sy, { width: CONTENT_W, align: "left" });
        drawSignatureBlock(doc, sy + 16, signatureOrNull, snap._verification || null);
        pageNo += 1;
        drawFooter(doc, pageNo, totalPages);
      }

      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Read scope mirrors visit detail: { global } | { employeeId } |
// { clientId } | { denied }. Never trusts request values.
async function reportScope(req) {
  if (await hasPermission(req.user, "visits.view.all")) return { global: true };
  if (!(await hasPermission(req.user, "visits.view.own"))) return { denied: true };
  const [[row]] = await db.query("SELECT employee_id, client_id FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  if (!row) return { denied: true };
  if (row.employee_id !== null) return { employeeId: Number(row.employee_id) };
  if (row.client_id !== null) return { clientId: Number(row.client_id) };
  return { denied: true };
}

function validId(value) {
  return /^\d+$/.test(String(value));
}

// Shared gate for both downloads (PDF + Excel): scoping, eligibility,
// FINAL sheet. Returns { snap, sheet } or { error: { status, body } }.
// Pure reads — never mutates.
async function authorizeVisit(req, visitIdParam) {
  try {
    if (!validId(visitIdParam)) {
      return { error: { status: 404, body: { success: false, code: "VISIT_NOT_FOUND", message: "Visit not found." } } };
    }
    const scope = await reportScope(req);
    if (scope.denied) {
      return { error: { status: 403, body: { success: false, message: "Forbidden" } } };
    }
    const visitId = Number(visitIdParam);
    const snap = await Report.getVisitSnapshot(visitId);
    if (!snap) {
      return { error: { status: 404, body: { success: false, code: "VISIT_NOT_FOUND", message: "Visit not found." } } };
    }
    if (scope.employeeId !== undefined) {
      const [rows] = await db.query(
        "SELECT 1 AS ok FROM job_assignments WHERE job_id = ? AND employee_id = ? AND status IN ('ACTIVE','COMPLETED') LIMIT 1",
        [snap.job_id, scope.employeeId]
      );
      if (!rows[0]) {
        return { error: { status: 404, body: { success: false, code: "VISIT_NOT_FOUND", message: "Visit not found." } } };
      }
    } else if (scope.clientId !== undefined) {
      const [[job]] = await db.query("SELECT client_id FROM jobs WHERE id = ? LIMIT 1", [snap.job_id]);
      if (!job || Number(job.client_id) !== scope.clientId) {
        return { error: { status: 404, body: { success: false, code: "VISIT_NOT_FOUND", message: "Visit not found." } } };
      }
    }
    if (snap.visit_status !== "VISIT_CLOSED") {
      return { error: { status: 422, body: { success: false, code: "VISIT_NOT_CLOSED", message: "Measurement report is available only after the visit is closed." } } };
    }
    const sheet = await Report.getFinalSheet(snap.job_id, visitId);
    if (!sheet) {
      return { error: { status: 422, body: { success: false, code: "MEASUREMENT_NOT_FOUND", message: "No finalized measurement sheet exists for this visit." } } };
    }
    return { snap, sheet };
  } catch (error) {
    console.error("Error authorizing report download:", error.message);
    return { error: { status: 500, body: { success: false, code: "REPORT_GENERATION_FAILED", message: "Could not generate the measurement report." } } };
  }
}

// GET /api/reports/visits/:visitId/measurement-sheet
exports.downloadMeasurementSheet = async (req, res) => {
  const ctx = await authorizeVisit(req, req.params.visitId);
  if (ctx.error) {
    return res.status(ctx.error.status).json(ctx.error.body);
  }
  const { snap, sheet } = ctx;
  const visitId = snap.visit_id;

  let signature = await Report.getSignature(visitId);
    if (signature) {
      const abs = path.resolve(String(signature.signature_file_path));
      const root = path.resolve("uploads", "signatures");
      if (abs.startsWith(root + path.sep) && fs.existsSync(abs)) {
        signature = { ...signature, embedded: abs };
      } else {
        console.warn(`Report: signature file missing for visit ${visitId} (record ${signature.id}). Rendering without image.`);
        signature = { ...signature, embedded: null };
      }
    } else {
      console.warn(`Report: no signature row for VISIT_CLOSED visit ${visitId}. Rendering without image.`);
    }
    snap._verification = await Report.getVerification(snap.job_id);

    let pdf;
    try {
      pdf = await buildPdf(snap, sheet, signature);
    } catch (err) {
      console.error("Report generation failed:", err.message);
      return res.status(500).json({ success: false, code: "REPORT_GENERATION_FAILED", message: "Could not generate the measurement report." });
    }

    const filename = sanitizeFilename(`MINDZTEAM_Measurement_Sheet_${snap.job_number}_Visit-${snap.visit_number}.pdf`)
      || "MINDZTEAM_Measurement_Sheet.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdf.length);
    return res.send(pdf);
};

// ---- Excel download (no signature): job description + measurements +
// measured-by + remarks. Same gate as the PDF. ----
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function excelInfoRow(ws, label, value) {
  const row = ws.addRow([label, value]);
  row.getCell(1).font = { bold: true };
  row.getCell(1).alignment = { vertical: "top" };
  row.getCell(2).alignment = { vertical: "top", wrapText: true };
  return row;
}

async function buildExcel(snap, sheet) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MiNDZTEAM";
  wb.created = new Date();
  const ws = wb.addWorksheet("Measurement Sheet", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    printTitlesRow: "1:1"
  });
  ws.columns = [
    { header: "Sl.No.", key: "sl", width: 10 },
    { header: "Width", key: "width", width: 14 },
    { header: "Height", key: "height", width: 14 },
    { header: "Quantity", key: "qty", width: 12 },
    { header: "Media Type", key: "media", width: 18 },
    { header: "Remarks", key: "remarks", width: 44 }
  ];

  const title = ws.addRow(["MINDZTEAM INDIA SOLUTIONS PVT. LTD."]);
  title.font = { bold: true, size: 14 };
  ws.addRow([COMPANY.address]).font = { size: 10, color: { argb: "FF444444" } };
  ws.addRow([`${COMPANY.cin}    ${COMPANY.gstin}    ${COMPANY.pan}`]).font = { size: 9, color: { argb: "FF444444" } };
  ws.addRow([`${COMPANY.phone}    ${COMPANY.email}`]).font = { size: 9, color: { argb: "FF444444" } };
  ws.addRow([]);
  ws.addRow([`MEASUREMENT SHEET — No. ${snap.job_number}  ·  Visit ${snap.visit_number}`]).font = { bold: true, size: 12 };

  const address = [snap.address_line_1, snap.address_line_2, snap.landmark].filter(Boolean).join(", ");
  const fullAddress = [address, snap.store_city, snap.store_state, snap.pincode].filter(Boolean).join(", ");
  excelInfoRow(ws, "Client Name", snap.client_name || "");
  excelInfoRow(ws, "Brand Name", snap.client_name || "");
  excelInfoRow(ws, "Date (IST)", istDate(snap.closed_at || snap.started_at));
  excelInfoRow(ws, "Shop Name", snap.store_name || "");
  excelInfoRow(ws, "Shop Address", fullAddress);
  excelInfoRow(ws, "State", snap.store_state || snap.client_state || "");
  excelInfoRow(ws, "City", snap.store_city || snap.client_city || "");
  excelInfoRow(ws, "Mobile No.", snap.shopkeeper_mobile || snap.client_phone || "");
  excelInfoRow(ws, "Measured By", snap.employee_name
    ? `${snap.employee_name}${snap.employee_code ? ` (${snap.employee_code})` : ""}` : "");
  excelInfoRow(ws, "Job Description", snap.job_description || "");

  ws.addRow([]);
  const head = ws.addRow(["Sl.No.", "Width", "Height", "Quantity", "Media Type", "Remarks"]);
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
  head.alignment = { horizontal: "center", vertical: "center" };
  sheet.items.forEach((it, i) => {
    const row = ws.addRow([i + 1, num(it.width_ft), num(it.height_ft),
      intQty(it.quantity), it.media_type || "", it.remarks || ""]);
    row.getCell(1).alignment = { horizontal: "center" };
  });
  ws.eachRow((row, n) => {
    if (n >= head.number) {
      row.eachCell((cell) => {
        cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      });
    }
  });
  ws.addRow([]);
  ws.addRow([`Generated on: ${istDateTime(new Date())}  ·  ${COMPANY.name}`]).font = { size: 9, color: { argb: "FF666666" } };

  return wb.xlsx.writeBuffer();
}

// GET /api/reports/visits/:visitId/measurement-sheet.xlsx
exports.downloadMeasurementExcel = async (req, res) => {
  const ctx = await authorizeVisit(req, req.params.visitId);
  if (ctx.error) {
    return res.status(ctx.error.status).json(ctx.error.body);
  }
  const { snap, sheet } = ctx;
  let xlsx;
  try {
    xlsx = await buildExcel(snap, sheet);
  } catch (err) {
    console.error("Excel report generation failed:", err.message);
    return res.status(500).json({ success: false, code: "REPORT_GENERATION_FAILED", message: "Could not generate the measurement report." });
  }
  const filename = sanitizeFilename(`MINDZTEAM_Measurement_Sheet_${snap.job_number}_Visit-${snap.visit_number}.xlsx`)
    || "MINDZTEAM_Measurement_Sheet.xlsx";
  res.setHeader("Content-Type", EXCEL_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", xlsx.length);
  return res.send(Buffer.from(xlsx));
};
