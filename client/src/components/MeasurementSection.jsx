/**
 * MeasurementSection  — embedded in job detail for the
 * assigned employee once the job is REACHED/WORK_STARTED, plus
 * read-only version history for office/client scopes.
 * - REACHED + assignee ......... [Start Work]
 * - WORK_STARTED + assignee .... [Start Measurement] (or continue DRAFT)
 * - DRAFT editor ................ items + Save Draft + Scan Sheet + Finalize
 * - FINAL/SUPERSEDED ............ read-only, history preserved
 * Later-module actions (photos/signature/submit/verify) are absent.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import MeasurementService from "../services/MeasurementService";

const MEDIA_OPTIONS = [
  { code: "", label: "— Select media —" },
  { code: "GLOW_SIGN", label: "Glow Sign" },
  { code: "NON_LIT", label: "Non-Lit" },
  { code: "VINYL", label: "Vinyl" },
  { code: "SUNPACK", label: "Sunpack" },
  { code: "OTHER", label: "Other" }
];

const SHEET_BADGE = {
  DRAFT: "bg-warning-subtle text-warning-emphasis",
  FINAL: "bg-success-subtle text-success-emphasis",
  SUPERSEDED: "bg-secondary-subtle text-secondary-emphasis"
};

const MeasurementSection = ({ job, onChanged }) => {
  const { user, hasPermission } = useAuth();
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, type: "", message: "" });
  const [busy, setBusy] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [items, setItems] = useState([]);
  const [ocrInfo, setOcrInfo] = useState(null);
  const [scanning, setScanning] = useState(false);

  const showAlert = (type, message) => {
    setAlert({ show: true, type, message });
    setTimeout(() => setAlert({ show: false, type: "", message: "" }), 6000);
  };

  const activeAssign = (job.assignments || []).find((a) => a.status === "ACTIVE") || null;
  const isAssignee = !!(
    user?.employee?.id && activeAssign &&
    Number(activeAssign.employee_id) === Number(user.employee.id)
  );
  const canMeasure = hasPermission("jobs.measure") && isAssignee;
  const canWork = ["REACHED", "WORK_STARTED"].includes(job.status);

  const loadSheets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await MeasurementService.getSheetsByJob(job.id);
      if (res.success) {
        const list = [...res.data].sort((a, b) => b.version_no - a.version_no);
        setSheets(list);
        const draft = list.find((s) => s.status === "DRAFT");
        if (draft && canMeasure) openEditor(draft.id);
      }
    } catch (error) {
      if (error.response?.status !== 403 && error.response?.status !== 404) {
        showAlert("danger", error.response?.data?.message || "Could not load measurement sheets.");
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  useEffect(() => {
    loadSheets();
  }, [loadSheets, job.status]);

  const openEditor = async (sheetId) => {
    try {
      const res = await MeasurementService.getSheetById(sheetId);
      if (res.success) {
        setEditingId(sheetId);
        setItems((res.data.items || []).map((it) => ({
          width_ft: it.width_ft ?? "",
          height_ft: it.height_ft ?? "",
          quantity: it.quantity ?? "1",
          media_type: it.media_type || "",
          remarks: it.remarks || ""
        })));
        if (res.data.source === "OCR_SCAN") {
          if (res.data.status === "DRAFT") {
            setOcrInfo({ message: "Values came from OCR — review every field before finalizing." });
          } else {
            setOcrInfo({ kind: "final", message: "This version was captured via OCR scan." });
          }
        } else {
          setOcrInfo(null);
        }
      }
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Could not open sheet.");
    }
  };

  const closeEditor = () => {
    setEditingId(null);
    setItems([]);
    setOcrInfo(null);
  };

  const handleStartWork = async () => {
    setBusy("work");
    try {
      await MeasurementService.startWork(job.id);
      showAlert("success", "Work started. You can now take measurements.");
      if (onChanged) await onChanged();
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Could not start work.");
    } finally {
      setBusy(null);
    }
  };

  const handleStartSheet = async () => {
    setBusy("create");
    try {
      const res = await MeasurementService.createSheet(job.id, {});
      showAlert("success", `Measurement sheet v${res.data?.version_no} created as draft.`);
      await loadSheets();
      if (onChanged) await onChanged();
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Could not create sheet.");
    } finally {
      setBusy(null);
    }
  };

  const setItem = (index, name, value) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [name]: value } : it)));
  };

  const handleSaveDraft = async () => {
    setBusy("save");
    try {
      const res = await MeasurementService.updateSheet(editingId, items);
      showAlert("success", res.message || "Draft saved.");
      await loadSheets();
      if (onChanged) await onChanged();
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Draft save failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleScan = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    try {
      const res = await MeasurementService.scanSheet(editingId, file);
      const scanned = (res.data?.items || []).map((it) => ({
        width_ft: it.width_ft ?? "",
        height_ft: it.height_ft ?? "",
        quantity: it.quantity ?? "1",
        media_type: it.media_type || "",
        remarks: it.remarks || ""
      }));
      setItems(scanned);
      const conf = res.data?.ocr?.confidence;
      if (scanned.length > 0) {
        setOcrInfo({
          kind: "found",
          message: `OCR detected ${scanned.length} item(s)${conf !== null && conf !== undefined ? ` (confidence ${conf}%)` : ""}. Review every value before finalizing — OCR is a draft aid, not truth.`,
          raw: res.data?.raw_text ? res.data.raw_text.slice(0, 500) : null
        });
        showAlert("success", res.message || "OCR processed.");
      } else if (res.data?.text_present) {
        setOcrInfo({
          kind: "notext-values",
          message: "OCR detected text, but no measurement values could be confidently extracted. Review the OCR text below or enter measurements manually.",
          raw: res.data?.raw_text ? res.data.raw_text.slice(0, 500) : null
        });
        showAlert("warning", "OCR found text but no usable measurements — nothing was fabricated. Correct manually or retry with a clearer photo.");
      } else {
        setOcrInfo({
          kind: "empty",
          message: "OCR could not detect measurements. Enter values manually with + Add Item.",
          raw: null
        });
        showAlert("warning", res.message || "OCR found nothing usable.");
      }
      await loadSheets();
    } catch (error) {
      const data = error.response?.data;
      if (data?.code === "OCR_FAILED") {
        setOcrInfo({
          kind: "failed",
          message: "Could not process the image. Try: better lighting, paper flat, move closer, avoid shadows — or enter values manually."
        });
      }
      showAlert("danger", data?.message || "OCR failed.");
    } finally {
      setScanning(false);
    }
  };

  const handleFinalize = async () => {
    if (!window.confirm("Finalize this measurement sheet? It becomes immutable and supersedes the previous final version.")) return;
    setBusy("finalize");
    try {
      const res = await MeasurementService.finalizeSheet(editingId);
      showAlert("success", res.message || "Finalized.");
      closeEditor();
      await loadSheets();
      if (onChanged) await onChanged();
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Finalize failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteDraft = async (sheetId) => {
    const target = sheets.find((s) => s.id === sheetId);
    if (!window.confirm(`Delete draft version ${target?.version_no ?? ""}? This cannot be undone.`)) return;
    setBusy("delete");
    try {
      const res = await MeasurementService.deleteSheet(sheetId);
      showAlert("success", res.message || "Draft deleted.");
      if (editingId === sheetId) closeEditor();
      await loadSheets();
      if (onChanged) await onChanged();
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Delete failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleRevise = async (sheetId) => {
    if (openDraft) {
      showAlert("warning", "Finalize or delete the open draft first, then edit this version.");
      return;
    }
    setBusy("revise");
    try {
      const res = await MeasurementService.reviseSheet(sheetId);
      showAlert("success", res.message || "New draft created — edit and finalize.");
      await loadSheets();
      if (res.data?.id) await openEditor(res.data.id);
      if (onChanged) await onChanged();
    } catch (error) {
      showAlert("danger", error.response?.data?.message || "Could not create editable version.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-primary" role="status"></div></div>;
  }

  const openDraft = sheets.find((s) => s.status === "DRAFT") || null;

  return (
    <div className="mt-3">
      <h6 className="text-muted text-uppercase" style={{ fontSize: 12 }}>Measurement</h6>

      {alert.show && (
        <div className={`alert alert-${alert.type} py-2 small`} role="alert">{alert.message}</div>
      )}

      {sheets.length === 0 && (
        <p className="small text-muted mb-2">No measurement sheet yet.</p>
      )}

      {sheets.map((s) => (
        <div key={s.id} className="d-flex align-items-center gap-2 py-1 small border-bottom">
          <strong>Version {s.version_no}</strong>
          <span className={`badge ${SHEET_BADGE[s.status] || "bg-secondary"}`}>{s.status}</span>
          <span className="text-muted">{s.source === "OCR_SCAN" ? "· OCR scan" : "· manual"}</span>
          <span className="ms-auto d-flex gap-2">
            {canMeasure && s.status === "DRAFT" && editingId !== s.id && (
              <button className="btn btn-sm btn-link p-0" onClick={() => openEditor(s.id)}>Continue</button>
            )}
            {canMeasure && s.status === "DRAFT" && (
              <button className="btn btn-sm btn-link p-0 text-danger" disabled={busy === "delete"}
                onClick={() => handleDeleteDraft(s.id)}>Delete</button>
            )}
            {s.status !== "DRAFT" && (
              <button className="btn btn-sm btn-link p-0" onClick={() => openEditor(s.id)}>View</button>
            )}
            {canMeasure && canWork && s.status !== "DRAFT" && (
              <button className="btn btn-sm btn-link p-0" disabled={busy === "revise" || !!openDraft}
                title={openDraft ? "Finalize or delete the open draft first" : "Create an editable copy as a new draft version"}
                onClick={() => handleRevise(s.id)}>Edit</button>
            )}
          </span>
        </div>
      ))}

      {canMeasure && canWork && !openDraft && editingId === null && (
        <button className="btn btn-sm btn-outline-primary mt-2" disabled={busy === "create"} onClick={handleStartSheet}>
          {busy === "create" ? "Creating..." : sheets.length === 0 ? "Start Measurement" : "New Version"}
        </button>
      )}

      {canMeasure && job.status === "REACHED" && (
        <div className="mt-2">
          <button className="btn btn-sm btn-primary" disabled={busy === "work"} onClick={handleStartWork}>
            {busy === "work" ? "Starting..." : "Start Work"}
          </button>
        </div>
      )}

      {editingId !== null && (
        <div className="border rounded p-3 mt-3 bg-light">
          {(() => {
            const sheet = sheets.find((s) => s.id === editingId);
            const readOnly = !sheet || sheet.status !== "DRAFT" || !canMeasure;
            return (
              <>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <strong className="small">
                    {readOnly ? `Version ${sheet?.version_no} (${sheet?.status})` : `Editing draft v${sheet?.version_no}`}
                  </strong>
                  <button className="btn btn-sm btn-link" onClick={closeEditor}>Close</button>
                </div>
                {ocrInfo && (
                  <div className={`alert py-2 small ${ocrInfo.kind === "found" ? "alert-success" : ocrInfo.kind === "failed" ? "alert-danger" : ocrInfo.kind === "final" ? "alert-info" : "alert-warning"}`}>
                    {ocrInfo.kind === "found" ? "✓ " : ocrInfo.kind === "failed" ? "✕ " : ocrInfo.kind === "final" ? "" : "⚠ "}{ocrInfo.message}
                  </div>
                )}
                {readOnly && items.length > 0 && (
                  <div className="table-responsive">
                    <table className="table table-sm mb-0">
                      <thead><tr><th>#</th><th>W</th><th>H</th><th>Qty</th><th>Media</th><th>Remarks</th></tr></thead>
                      <tbody>
                        {items.map((it, i) => (
                          <tr key={i}>
                            <td>{i + 1}</td><td>{it.width_ft ?? "—"}</td><td>{it.height_ft ?? "—"}</td>
                            <td>{it.quantity ?? "—"}</td><td>{it.media_type || "—"}</td><td>{it.remarks || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {readOnly && items.length === 0 && (
                  <SheetItemsReadOnly sheetId={editingId} />
                )}
                {readOnly && canMeasure && canWork && sheet?.status !== "DRAFT" && (
                  <div className="mt-2">
                    <button className="btn btn-sm btn-outline-primary" disabled={busy === "revise" || !!openDraft}
                      title={openDraft ? "Finalize or delete the open draft first" : "Create an editable copy as a new draft version"}
                      onClick={() => handleRevise(sheet.id)}>
                      {busy === "revise" ? "Creating..." : "Edit as New Version"}
                    </button>
                    {openDraft && <small className="text-muted ms-2">Finalize or delete draft v{openDraft.version_no} first.</small>}
                  </div>
                )}
                {!readOnly && (
                  <>
                    {items.map((it, i) => (
                      <div key={i} className="border rounded p-2 mb-2 bg-white">
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <strong className="small">#{i + 1}</strong>
                          <button className="btn btn-sm btn-link text-danger p-0"
                            onClick={() => setItems((prev) => prev.filter((_, x) => x !== i))}>Remove</button>
                        </div>
                        <div className="row g-2">
                          <div className="col-4">
                            <label className="form-label small mb-0">Width</label>
                            <input type="number" step="0.01" min="0" className="form-control form-control-sm"
                              value={it.width_ft} onChange={(e) => setItem(i, "width_ft", e.target.value)} placeholder="12.5" />
                          </div>
                          <div className="col-4">
                            <label className="form-label small mb-0">Height</label>
                            <input type="number" step="0.01" min="0" className="form-control form-control-sm"
                              value={it.height_ft} onChange={(e) => setItem(i, "height_ft", e.target.value)} placeholder="8.0" />
                          </div>
                          <div className="col-4">
                            <label className="form-label small mb-0">Quantity</label>
                            <input type="number" step="0.01" min="0" className="form-control form-control-sm"
                              value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} placeholder="2" />
                          </div>
                          <div className="col-6">
                            <label className="form-label small mb-0">Media Type</label>
                            <select className="form-select form-select-sm" value={it.media_type}
                              onChange={(e) => setItem(i, "media_type", e.target.value)}>
                              {MEDIA_OPTIONS.map((m) => (
                                <option key={m.code} value={m.code}>{m.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-6">
                            <label className="form-label small mb-0">Remarks</label>
                            <input type="text" className="form-control form-control-sm" value={it.remarks}
                              onChange={(e) => setItem(i, "remarks", e.target.value)} placeholder="Front signage" maxLength={255} />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="d-flex flex-wrap gap-2 mt-2">
                      <button className="btn btn-sm btn-outline-secondary"
                        onClick={() => setItems((prev) => [...prev, { width_ft: "", height_ft: "", quantity: "1", media_type: "", remarks: "" }])}>
                        + Add Item
                      </button>
                      <label className="btn btn-sm btn-outline-secondary mb-0" style={{ cursor: "pointer" }}
                        title="On mobile you can choose Camera or Files. For better OCR: paper flat, good lighting, no shadows, full sheet in frame, hold steady above the sheet.">
                        {scanning ? "Scanning..." : "Scan Sheet"}
                        <input type="file" accept="image/jpeg,image/png,image/jpg" hidden disabled={scanning} onChange={handleScan} />
                      </label>
                      <small className="text-muted w-100">Tip: flat paper · good light · no shadows · full sheet in frame.</small>
                      <button className="btn btn-sm btn-primary" disabled={busy === "save"} onClick={handleSaveDraft}>
                        {busy === "save" ? "Saving..." : "Save Draft"}
                      </button>
                      <button className="btn btn-sm btn-success" disabled={busy === "finalize"} onClick={handleFinalize}>
                        {busy === "finalize" ? "Finalizing..." : "Finalize"}
                      </button>
                      <button className="btn btn-sm btn-outline-danger" disabled={busy === "delete"}
                        onClick={() => handleDeleteDraft(editingId)}>
                        {busy === "delete" ? "Deleting..." : "Delete Draft"}
                      </button>
                    </div>
                    {ocrInfo?.raw && (
                      <details className="mt-2 small text-muted">
                        <summary>OCR raw text (reference only)</summary>
                        <pre className="mt-1 p-2 bg-white border rounded" style={{ whiteSpace: "pre-wrap" }}>{ocrInfo.raw}</pre>
                      </details>
                    )}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};

function SheetItemsReadOnly({ sheetId }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    MeasurementService.getSheetById(sheetId)
      .then((res) => { if (res.success) setItems(res.data.items || []); })
      .catch(() => setItems([]));
  }, [sheetId]);
  if (items === null) return <div className="small text-muted">Loading items...</div>;
  if (items.length === 0) return <div className="small text-muted">No items.</div>;
  return (
    <div className="table-responsive">
      <table className="table table-sm mb-0">
        <thead><tr><th>#</th><th>W</th><th>H</th><th>Qty</th><th>Media</th><th>Remarks</th></tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id || i}>
              <td>{i + 1}</td><td>{it.width_ft ?? "—"}</td><td>{it.height_ft ?? "—"}</td>
              <td>{it.quantity ?? "—"}</td><td>{it.media_type || "—"}</td><td>{it.remarks || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default MeasurementSection;
