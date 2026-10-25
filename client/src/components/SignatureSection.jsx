/**
 * SignatureSection (Module 12) — shopkeeper/client acknowledgement.
 * Embedded in job detail (no new page). Three faces:
 *   - assigned Field Executive + open visit: signer fields + signature
 *     pad (mouse + touch via pointer events) + Clear/Save
 *   - after capture: status, signer, IST timestamp, secure view
 *   - everyone else: read-only evidence (Pending vs Captured)
 * No replacement UI: evidence is immutable after capture (backend 409s
 * repeats). Timestamps use the existing formatIST (datetime.js untouched).
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import SignatureService from "../services/SignatureService";
import JobPhotoService from "../services/JobPhotoService";
import { formatIST } from "../utils/datetime";

const CLOSED_VISITS = ["VISIT_CLOSED", "CANCELLED"];
const PAD_W = 900;
const PAD_H = 360;

function setupPad(canvas) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = PAD_W * dpr;
  canvas.height = PAD_H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1a237e";
  return ctx;
}

function SignaturePad({ onInk }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    setupPad(canvas);
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * PAD_W,
        y: ((e.clientY - r.top) / r.height) * PAD_H
      };
    };
    const down = (e) => {
      e.preventDefault();
      drawing.current = true;
      last.current = pos(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };
    const move = (e) => {
      if (!drawing.current) return;
      e.preventDefault();
      const ctx = canvas.getContext("2d");
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      if (onInk) onInk();
    };
    const up = () => { drawing.current = false; last.current = null; };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [onInk]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupPad(canvas);
    ctx.clearRect(0, 0, PAD_W, PAD_H);
  };

  useEffect(() => {
    canvasRef.current.__clearPad = clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "auto", touchAction: "none", cursor: "crosshair", background: "#fff" }}
      className="border rounded"
      aria-label="Signature pad. Sign inside the box."
    />
  );
}

const SignatureSection = ({ job, onChanged }) => {
  const { user, hasPermission } = useAuth();
  const [signed, setSigned] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerMobile, setSignerMobile] = useState("");
  const [remarks, setRemarks] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [viewSrc, setViewSrc] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const padWrapRef = useRef(null);

  const jobId = job?.id;
  const visits = [...(job?.visits || [])].sort((a, b) => a.visit_number - b.visit_number);
  const openVisit = [...visits].reverse().find((v) => !CLOSED_VISITS.includes(v.status)) || null;
  // VIEW is visit-agnostic: with no open visit, display falls back to the
  // latest (closed) visit so saved evidence stays visible. CAPTURE still
  // requires openVisit (see canCapture below) — viewing never implies
  // permission to sign.
  const displayVisit = openVisit || (visits.length > 0 ? visits[visits.length - 1] : null);
  const displayVisitId = displayVisit?.id ?? null;

  const activeAssign = (job?.assignments || []).find((a) => a.status === "ACTIVE") || null;
  const myEmployeeId = user?.employee?.id;
  const canCapture = !!(
    myEmployeeId &&
    activeAssign &&
    Number(activeAssign.employee_id) === Number(myEmployeeId) &&
    hasPermission("visits.manage") &&
    openVisit
  );

  const load = useCallback(async () => {
    // Display follows displayVisit (open visit preferred, else the latest
    // closed visit). A closed visit never blocks viewing its signature.
    if (!jobId || !displayVisitId) { setLoading(false); setSigned(null); return; }
    setLoading(true);
    setError("");
    try {
      const res = await SignatureService.getByVisit(displayVisitId);
      if (res.success) setSigned(res.data);
      else setSigned(null);
    } catch (err) {
      // 404 = Pending (no signature yet) — not an error state.
      setSigned(null);
      if (err.response?.status !== 404) {
        setError(err.response?.data?.message || "Could not load signature.");
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, displayVisitId]);

  useEffect(() => { load(); }, [load]);

  const flash = (message) => {
    setNote(message);
    setTimeout(() => setNote(""), 8000);
  };

  const clearPad = () => {
    const canvas = padWrapRef.current?.querySelector("canvas");
    if (canvas && canvas.__clearPad) canvas.__clearPad();
    setHasInk(false);
  };

  const save = async () => {
    const canvas = padWrapRef.current?.querySelector("canvas");
    if (!canvas || !openVisit) return;
    const name = signerName.trim();
    if (!name) {
      setError("Signer name is required.");
      return;
    }
    if (!hasInk) {
      setError("Signature is blank. Ask the signer to sign inside the pad, then save again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob || blob.size === 0) {
        setError("Could not read the signature. Try again.");
        setBusy(false);
        return;
      }
      const file = new File([blob], "signature.png", { type: "image/png" });
      await SignatureService.capture({
        file,
        visit_id: openVisit.id,
        signer_name: name,
        signer_mobile: signerMobile.trim(),
        remarks: remarks.trim()
      });
      clearPad();
      setSignerName("");
      setSignerMobile("");
      setRemarks("");
      flash("Signature captured.");
      await load();
      if (onChanged) await onChanged();
    } catch (err) {
      const data = err.response?.data;
      setError(data?.code === "SIGNATURE_ALREADY_EXISTS"
        ? "A signature already exists for this visit."
        : (data?.message || "Could not save signature. Safe to retry."));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const doCloseVisit = async () => {
    if (!openVisit || closing) return;
    setClosing(true);
    setError("");
    try {
      await JobPhotoService.closeVisit(jobId);
      flash(`Visit #${openVisit.visit_number} closed.`);
      await load();
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.response?.data?.message || "Could not close visit.");
      if (onChanged) await onChanged();
    } finally {
      setClosing(false);
    }
  };

  const openView = async () => {    if (!signed) return;
    setViewOpen(true);
    setViewSrc(null);
    try {
      const url = await SignatureService.viewObjectUrl(signed.id);
      setViewSrc(url);
    } catch (_) { /* keeps spinner; closing revokes nothing */ }
  };

  const closeView = () => {
    setViewOpen(false);
    if (viewSrc) URL.revokeObjectURL(viewSrc);
    setViewSrc(null);
  };

  if (!job) return null;

  return (
    <div className="border rounded p-3 mb-3 bg-light">
      <h6 className="text-muted text-uppercase mb-2" style={{ fontSize: 12 }}>Signature</h6>

      {loading && <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-primary" role="status"></div></div>}
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {note && <div className="alert alert-success py-2 small">{note}</div>}

      {!loading && signed && (
        <div className="alert alert-success py-2 small mb-2">
          <i className="bi bi-check-circle me-2"></i>
          Signature captured — {signed.signer_name}
          {signed.visit_number !== null && signed.visit_number !== undefined ? ` (Visit #${signed.visit_number})` : ""}
          {signed.created_at ? ` · ${formatIST(signed.created_at)}` : ""}
          <button type="button" className="btn btn-sm btn-outline-success ms-2" onClick={openView}>View Signature</button>
        </div>
      )}

      {!loading && !signed && canCapture && (
        <>
          <p className="small text-muted mb-2">
            Visit #{openVisit.visit_number} ({openVisit.status}) — collect the shopkeeper acknowledgement below.
          </p>
          <div className="row g-2 mb-2">
            <div className="col-12 col-md-5">
              <label className="form-label small mb-1">Signer Name *</label>
              <input className="form-control form-control-sm" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="e.g. Raj Kumar" maxLength={100} />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label small mb-1">Signer Mobile</label>
              <input className="form-control form-control-sm" value={signerMobile} onChange={(e) => setSignerMobile(e.target.value)} placeholder="optional" inputMode="tel" maxLength={15} />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label small mb-1">Remarks</label>
              <input className="form-control form-control-sm" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="optional" maxLength={255} />
            </div>
          </div>
          <div ref={padWrapRef}>
            <SignaturePad onInk={() => setHasInk(true)} />
          </div>
          <div className="d-flex gap-2 mt-2">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearPad}>Clear</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
              {busy ? (<><span className="spinner-border spinner-border-sm me-2"></span>Saving...</>) : (<><i className="bi bi-pen me-1"></i>Save Signature</>)}
            </button>
          </div>
        </>
      )}

      {!loading && !signed && !canCapture && (
        <p className="small text-muted mb-0">
          {openVisit
            ? "No signature captured for the open visit yet."
            : displayVisit
              ? `Signature not available for Visit #${displayVisit.visit_number}.`
              : "No visits yet — signatures unlock once travel starts."}
        </p>
      )}

      {!loading && canCapture && (
        <>
          {!signed && (
            <div className="alert alert-warning py-2 small mt-2 mb-2">
              <i className="bi bi-pen me-2"></i>
              Capture the shopkeeper signature before closing this visit.
            </div>
          )}
          <button type="button" className="btn btn-primary mt-2" disabled={closing || !signed} onClick={doCloseVisit}>
            {closing ? (<><span className="spinner-border spinner-border-sm me-2"></span>Closing...</>) : (<><i className="bi bi-check-circle me-2"></i>Close Visit #{openVisit.visit_number}</>)}
          </button>
        </>
      )}

      {viewOpen && (
        <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.6)" }} onClick={closeView}>
          <div className="modal-dialog modal-md modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h6 className="modal-title">Shopkeeper Signature<small className="text-muted ms-2">Visit {signed.visit_number ?? "—"}</small></h6>
                <button type="button" className="btn-close" onClick={closeView}></button>
              </div>
              <div className="modal-body text-center">
                {viewSrc
                  ? <img src={viewSrc} alt="signature" className="img-fluid border rounded bg-white" />
                  : <div className="spinner-border text-primary" role="status"></div>}
                <dl className="row mb-0 small text-start mt-3">
                  <dt className="col-4">Signer</dt><dd className="col-8">{signed.signer_name}</dd>
                  {signed.signer_mobile && (<><dt className="col-4">Contact</dt><dd className="col-8">{signed.signer_mobile}</dd></>)}
                  {signed.remarks && (<><dt className="col-4">Remarks</dt><dd className="col-8">{signed.remarks}</dd></>)}
                  <dt className="col-4">Captured</dt><dd className="col-8">{signed.created_at ? formatIST(signed.created_at) : "—"}</dd>
                  {signed.captured_by_name && (<><dt className="col-4">By</dt><dd className="col-8">{signed.captured_by_name}</dd></>)}
                </dl>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignatureSection;
