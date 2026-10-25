/**
 * VisitReportButton (Module 12.1) — downloads for one closed visit:
 * Measurement Sheet PDF + Excel (job data, no signature). Renders
 * nothing unless the visit is VISIT_CLOSED (the backend 422s anything
 * else). Used by Jobs detail + My Visits.
 */
import React, { useState } from "react";
import ReportService from "../services/ReportService";

const VisitReportButton = ({ visitId, size = "sm" }) => {
  const [busy, setBusy] = useState(null);
  const [failed, setFailed] = useState("");

  const download = async (kind) => {
    if (!visitId || busy) return;
    setBusy(kind);
    setFailed("");
    try {
      if (kind === "excel") await ReportService.downloadVisitExcel(visitId);
      else await ReportService.downloadVisitReport(visitId);
    } catch (err) {
      setFailed(err.response?.data?.message || err.message || "Download failed.");
      setTimeout(() => setFailed(""), 6000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="d-inline-flex align-items-center gap-1">
      <button
        type="button"
        className={`btn btn-${size} btn-outline-danger`}
        disabled={!!busy}
        onClick={() => download("pdf")}
        title={failed || "Download Measurement Sheet (PDF)"}
      >
        {busy === "pdf"
          ? <span className="spinner-border spinner-border-sm" role="status"></span>
          : <i className="bi bi-file-earmark-pdf"></i>}
        <span className="ms-1">Sheet</span>
      </button>
      <button
        type="button"
        className={`btn btn-${size} btn-outline-success`}
        disabled={!!busy}
        onClick={() => download("excel")}
        title={failed || "Download Measurement Sheet (Excel)"}
      >
        {busy === "excel"
          ? <span className="spinner-border spinner-border-sm" role="status"></span>
          : <i className="bi bi-file-earmark-excel"></i>}
        <span className="ms-1">Excel</span>
      </button>
      {failed && <small className="text-danger">{failed}</small>}
    </span>
  );
};

export default VisitReportButton;
