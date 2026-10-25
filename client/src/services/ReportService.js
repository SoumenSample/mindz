/**
 * Report Service (Module 12.1) — closed-visit Measurement Sheet PDF.
 * Uses the shared axios instance (JWT automatic, 401 bounces to login).
 * The endpoint streams application/pdf; error statuses arrive as JSON
 * (hand-decoded here because responseType blob would otherwise hide
 * the MISSING/VISIT_NOT_CLOSED payloads).
 */
import api from "./api";

function filenameFromDisposition(header, fallback) {
  const m = /filename="([^"]+)"/.exec(header || "");
  return m ? m[1] : fallback;
}

const ReportService = {
  downloadVisitReport: async (visitId) => {
    const response = await api.get(`/reports/visits/${visitId}/measurement-sheet`, {
      responseType: "blob"
    });
    return saveBlob(response, "application/pdf", `MINDZTEAM_Measurement_Sheet_Visit-${visitId}.pdf`);
  },

  downloadVisitExcel: async (visitId) => {
    const response = await api.get(`/reports/visits/${visitId}/measurement-sheet.xlsx`, {
      responseType: "blob"
    });
    return saveBlob(response,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `MINDZTEAM_Measurement_Sheet_Visit-${visitId}.xlsx`);
  }
};

async function saveBlob(response, mime, fallbackName) {
  const contentType = response.headers["content-type"] || "";
  if (!contentType.includes(mime)) {
    let parsed = {};
    try {
      parsed = JSON.parse(await response.data.text());
    } catch (_) { /* keep generic */ }
    const err = new Error(parsed.message || "Report download failed.");
    err.response = { data: parsed, status: response.status };
    throw err;
  }
  const filename = filenameFromDisposition(response.headers["content-disposition"], fallbackName);
  const url = URL.createObjectURL(new Blob([response.data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { filename };
}

export default ReportService;
