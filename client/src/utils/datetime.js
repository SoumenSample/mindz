/**
 * Timezone Display Hardening — UTC storage, IST display.
 *
 * Contract (do not break):
 * - The database stores timestamps in UTC (MySQL TIMESTAMP, session TZ UTC).
 * - The API returns them as naive strings: "YYYY-MM-DD HH:mm:ss" (UTC wall
 *   time) because the pool uses dateStrings. They carry NO zone info.
 * - The browser must therefore interpret these strings as UTC and render
 *   them in the display zone below. NEVER pass them to `new Date()`
 *   directly: that parses them as LOCAL time and silently shifts every
 *   displayed value (the +05:30 bug this module fixes).
 * - DATE-only fields (preferred_date, scheduled_date, join_date) are NOT
 *   timestamps: display them verbatim, never through these helpers.
 */
export const DISPLAY_TIME_ZONE = "Asia/Kolkata";

/**
 * Parse a backend timestamp into a Date.
 * Accepts "YYYY-MM-DD HH:mm:ss" (treated as UTC), ISO strings with
 * explicit zone/offset (honored as-is), Date instances, and epoch ms.
 * Returns null for empty/invalid input.
 */
export function parseDbTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  // Naive backend format: interpret as UTC, not local time.
  const naive = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (naive) {
    const [, y, mo, d, h, mi, sec] = naive;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec || 0)));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function partsInZone(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/**
 * Format any backend timestamp as "YYYY-MM-DD HH:mm:ss" in the display
 * zone (IST). Same shape as the old raw display — values now correct.
 * Returns "—" for empty/invalid input.
 */
export function formatIST(value) {
  const dt = parseDbTimestamp(value);
  if (!dt) return "—";
  const p = partsInZone(dt);
  const hour = p.h === "24" ? "00" : p.h;
  return `${p.y}-${p.mo}-${p.d} ${hour}:${p.mi}:${p.s}`;
}
