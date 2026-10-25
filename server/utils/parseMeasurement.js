/**
 * Conservative measurement-sheet OCR parser .1).
 * Line-grouping state machine: consecutive label lines accumulate into
 * one item (sparse OCR puts every line on its own); a new item starts at
 * blank lines, numbered headers, dimension lines, or a repeated field
 * once the current partial is already complete.
 * NEVER invents data: uncertain fields stay null for employee review.
 * Digit-lookalike normalization (O->0, I/l->1, S->5) applies ONLY
 * inside numeric captures — prose (e.g. "Vinyl") is never touched.
 */
const MEDIA_KEYWORDS = [
  [/glow[\s-]?sign/i, "GLOW_SIGN"],
  [/non[\s-]?lit/i, "NON_LIT"],
  [/vinyl/i, "VINYL"],
  [/sun[\s-]?pack/i, "SUNPACK"]
];

// Digits plus common OCR lookalikes, usable ONLY where a number is
// expected. Anything else fails closed (null).
const NUM = "[\\dOoIlS]+(?:\\.[\\dOoIlS]+)?";
const DIM_SEP = "[x\u00d7X\\*]";

function normalizeDigits(raw) {
  return String(raw)
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/S/g, "5");
}

function toNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = normalizeDigits(raw).trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}

function mapMedia(text) {
  if (!text) return null;
  for (const [re, code] of MEDIA_KEYWORDS) {
    if (re.test(text)) return code;
  }
  return null;
}

function isDimLine(line) {
  return new RegExp(`^${NUM}\\s*${DIM_SEP}\\s*${NUM}$`, "i").test(line.trim());
}

function isNumberedHeader(line) {
  return /^(?:item\s*)?#?\d+\.?$/i.test(line.trim());
}

function extractFields(line) {
  const f = { width_ft: null, height_ft: null, quantity: null, media_type: null, consumed: false };
  const dim = line.match(new RegExp(`(${NUM})\\s*${DIM_SEP}\\s*(${NUM})`, "i"));
  if (dim) {
    f.width_ft = toNumber(dim[1]);
    f.height_ft = toNumber(dim[2]);
    f.consumed = f.width_ft !== null || f.height_ft !== null;
    if (f.consumed) return f;
  }
  const w = line.match(new RegExp(`(?:\\bW(?:idth)?|wide)\\s*[:=\\-]?\\s*(${NUM})`, "i"));
  if (w) {
    const v = toNumber(w[1]);
    if (v !== null) {
      f.width_ft = v;
      f.consumed = true;
    }
  }
  const h = line.match(new RegExp(`(?:\\bH(?:eight|t)?|high)\\s*[:=\\-]?\\s*(${NUM})`, "i"));
  if (h) {
    const v = toNumber(h[1]);
    if (v !== null) {
      f.height_ft = v;
      f.consumed = true;
    }
  }
  const q = line.match(new RegExp(`(?:\\bQ\\b|qty|quantity|q\\.?t\\.?|nos?|pcs?)\\s*[:=\\-]?\\s*(${NUM})`, "i"));
  if (q) {
    const v = toNumber(q[1]);
    if (v !== null) {
      f.quantity = v;
      f.consumed = true;
    }
  }
  const m = line.match(/med(?:ia)?\s*[:=\-]?\s*([A-Za-z][A-Za-z\s\-]*)/i);
  if (m) {
    // A Media: label with unmappable text becomes OTHER (explicit,
    // reviewer-visible); a bare known media word is recognition.
    f.media_type = mapMedia(m[1]) || "OTHER";
    f.consumed = true;
  } else {
    const bare = mapMedia(line.trim());
    if (bare) {
      f.media_type = bare;
      f.consumed = true;
    }
  }
  return f;
}

function toItem(p, remarks) {
  if (p.width_ft === null && p.height_ft === null) return null;
  return {
    width_ft: p.width_ft,
    height_ft: p.height_ft,
    quantity: p.quantity === null ? 1 : p.quantity,
    media_type: p.media_type,
    remarks: remarks.join(" | ").slice(0, 200) || null
  };
}

function parseMeasurementText(text) {
  if (!text || !text.trim()) return { items: [], rawText: text || "" };
  const items = [];
  let cur = { width_ft: null, height_ft: null, quantity: null, media_type: null };
  let remarks = [];
  const flush = () => {
    const item = toItem(cur, remarks);
    if (item) items.push(item);
    cur = { width_ft: null, height_ft: null, quantity: null, media_type: null };
    remarks = [];
  };
  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.trim();
    // Blank lines are pure separators in sparse OCR output — they never
    // split an item by themselves (fields of one item routinely arrive
    // on blank-separated lines). Numbered headers always do.
    if (!line) {
      continue;
    }
    if (isNumberedHeader(line)) {
      flush();
      continue;
    }
    const f = extractFields(line);
    if (!f.consumed) {
      remarks.push(line);
      continue;
    }
    // A new item starts when the line restates an already-captured
    // field (a second W/H/Qty/Media, or a fresh dimension line while
    // dimensions exist). Anything else accumulates into the current one.
    const restates =
      (f.width_ft !== null && cur.width_ft !== null) ||
      (f.height_ft !== null && cur.height_ft !== null) ||
      (f.quantity !== null && cur.quantity !== null) ||
      (f.media_type !== null && cur.media_type !== null) ||
      (isDimLine(line) && (cur.width_ft !== null || cur.height_ft !== null));
    if (restates) {
      flush();
    }
    if (f.width_ft !== null) cur.width_ft = f.width_ft;
    if (f.height_ft !== null) cur.height_ft = f.height_ft;
    if (f.quantity !== null) cur.quantity = f.quantity;
    if (f.media_type !== null) cur.media_type = f.media_type;
  }
  flush();
  return { items, rawText: String(text).slice(0, 4000) };
}

module.exports = { parseMeasurementText, mapMedia };
