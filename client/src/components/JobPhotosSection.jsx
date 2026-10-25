/**
 * JobPhotosSection (Module 11) — photo proof evidence inside job detail.
 * One component, three faces (no page redesign):
 *   - assigned Field Executive: upload per category + per measurement
 *     item + Close Visit (backend is the gate; the UI only surfaces
 *     MISSING_REQUIRED_PHOTOS so nothing is bypassable from here)
 *   - ADMIN/SUPER_ADMIN: grouped evidence across visits (read-only)
 *   - CLIENT: own-job evidence, read-only, uploader internals hidden
 *     server-side
 * Timestamps use the existing formatIST (datetime.js untouched).
 * Thumbnails load through the authenticated view endpoint as blobs —
 * the filesystem path is never exposed.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import JobPhotoService from "../services/JobPhotoService";
import MeasurementService from "../services/MeasurementService";
import { formatIST } from "../utils/datetime";

const CATEGORIES = [
  { type: "BEFORE_INSTALLATION", label: "Before Installation" },
  { type: "AFTER_INSTALLATION", label: "After Installation" },
  { type: "CLOSEUP", label: "Closeup" },
  { type: "FAR_VIEW", label: "Far View" }
];

const TYPE_LABEL = {
  BEFORE_INSTALLATION: "Before Installation",
  AFTER_INSTALLATION: "After Installation",
  CLOSEUP: "Closeup",
  FAR_VIEW: "Far View",
  MEASUREMENT_ITEM: "Measurement Item"
};

const CLOSED_VISITS = ["VISIT_CLOSED", "CANCELLED"];

function formatBytes(n) {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Blob-backed thumbnail (authenticated view endpoint). One object URL
// per photo, revoked on unmount — no binaries in React state.
function PhotoThumb({ photo, onOpen }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let url = null;
    JobPhotoService.viewObjectUrl(photo.id)
      .then((u) => { if (alive) { url = u; setSrc(u); } else { URL.revokeObjectURL(u); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photo.id]);
  if (failed) {
    return <span className="badge bg-secondary">unavailable</span>;
  }
  return (
    <button
      type="button"
      className="btn p-0 border rounded overflow-hidden"
      style={{ width: 72, height: 72 }}
      title={`${TYPE_LABEL[photo.photo_type] || photo.photo_type} · ${photo.created_at ? formatIST(photo.created_at) : "—"}`}
      onClick={() => onOpen(photo)}
    >
      {src
        ? <img src={src} alt={TYPE_LABEL[photo.photo_type] || "photo"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <span className="spinner-border spinner-border-sm text-secondary" role="status"></span>}
    </button>
  );
}

const JobPhotosSection = ({ job, onChanged }) => {
  const { user, hasPermission } = useAuth();
  const [photos, setPhotos] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState({}); // key -> { file, preview }
  const [busy, setBusy] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  const jobId = job?.id;
  const visits = [...(job?.visits || [])].sort((a, b) => a.visit_number - b.visit_number);
  const openVisit = [...visits].reverse().find((v) => !CLOSED_VISITS.includes(v.status)) || null;

  const activeAssign = (job?.assignments || []).find((a) => a.status === "ACTIVE") || null;
  const myEmployeeId = user?.employee?.id;
  const canUpload = !!(
    myEmployeeId &&
    activeAssign &&
    Number(activeAssign.employee_id) === Number(myEmployeeId) &&
    hasPermission("jobs.photo.upload") &&
    openVisit
  );

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    try {
      const res = await JobPhotoService.listByJob(jobId);
      if (res.success) setPhotos(res.data || []);
      else setError(res.message || "Could not load photos.");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load photos.");
    }
    setLoading(false);
  }, [jobId]);

  // FINAL-sheet items of the open visit (measurement-photo targets).
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    if (!jobId || !openVisit) return undefined;
    MeasurementService.getSheetsByJob(jobId)
      .then(async (res) => {
        if (cancelled || !res.success) return;
        const finals = (res.data || []).filter((s) => s.status === "FINAL" && Number(s.visit_id) === Number(openVisit.id));
        if (finals.length === 0) return;
        const latest = finals.sort((a, b) => b.version_no - a.version_no)[0];
        const detail = await MeasurementService.getSheetById(latest.id).catch(() => null);
        if (!cancelled && detail && detail.success) setItems(detail.data?.items || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [jobId, openVisit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!lightbox) { setLightboxSrc(null); return undefined; }
    let alive = true;
    let url = null;
    JobPhotoService.viewObjectUrl(lightbox.id)
      .then((u) => { if (alive) { url = u; setLightboxSrc(u); } else { URL.revokeObjectURL(u); } })
      .catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [lightbox]);

  const flash = (message) => {
    setNote(message);
    setTimeout(() => setNote(""), 8000);
  };

  const pickFile = (key, file) => {
    if (!file) return;
    setPending((prev) => {
      if (prev[key]?.preview) URL.revokeObjectURL(prev[key].preview);
      return { ...prev, [key]: { file, preview: URL.createObjectURL(file) } };
    });
  };

  const cancelPick = (key) => {
    setPending((prev) => {
      if (prev[key]?.preview) URL.revokeObjectURL(prev[key].preview);
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const doUpload = async (key, { photo_type, measurement_item_id }) => {
    const sel = pending[key];
    if (!sel || !openVisit) return;
    setBusy(key);
    setError("");
    try {
      const out = await JobPhotoService.upload({
        file: sel.file,
        job_id: jobId,
        visit_id: openVisit.id,
        photo_type,
        measurement_item_id
      });
      cancelPick(key);
      flash(out.duplicate ? "Photo already uploaded (duplicate tap ignored)." : "Photo uploaded.");
      await load();
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.response?.data?.message || "Upload failed. Safe to retry.");
    } finally {
      setBusy(null);
    }
  };

  if (!job) return null;

  const photosByVisit = {};
  photos.forEach((p) => {
    const k = p.visit_number ?? `#${p.visit_id}`;
    if (!photosByVisit[k]) photosByVisit[k] = [];
    photosByVisit[k].push(p);
  });

  const uploadBlock = (key, title, sub, uploadArgs) => {
    const sel = pending[key];
    return (
      <div className="border rounded p-2 mb-2 bg-white" key={key}>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div>
            <div className="fw-semibold small">{title}</div>
            {sub && <small className="text-muted">{sub}</small>}
          </div>
          <label className="btn btn-sm btn-outline-primary ms-auto mb-0">
            <i className="bi bi-camera me-1"></i>Add Photo
            <input
              type="file"
              hidden
              accept="image/*"
              capture="environment"
              onChange={(e) => pickFile(key, e.target.files?.[0] || null)}
            />
          </label>
        </div>
        {sel && (
          <div className="d-flex align-items-center gap-2 mt-2">
            <img src={sel.preview} alt="preview" style={{ width: 56, height: 56, objectFit: "cover" }} className="border rounded" />
            <small className="text-muted text-break">{sel.file.name} · {formatBytes(sel.file.size)}</small>
            <div className="ms-auto d-flex gap-1">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => cancelPick(key)}>Cancel</button>
              <button type="button" className="btn btn-sm btn-success" disabled={busy === key} onClick={() => doUpload(key, uploadArgs)}>
                {busy === key ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        )}
        <div className="d-flex gap-1 flex-wrap mt-2">
          {photos.filter((p) => p.photo_type === uploadArgs.photo_type &&
            (uploadArgs.measurement_item_id === undefined || Number(p.measurement_item_id) === Number(uploadArgs.measurement_item_id)) &&
            (!openVisit || Number(p.visit_id) === Number(openVisit.id))).map((p) => (
              <PhotoThumb key={p.id} photo={p} onOpen={setLightbox} />
            ))}
        </div>
      </div>
    );
  };

  return (
    <div className="border rounded p-3 mb-3 bg-light">
      <h6 className="text-muted text-uppercase mb-2" style={{ fontSize: 12 }}>
        {canUpload ? "Photo Proof" : "Photo Evidence"}
      </h6>

      {loading && <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-primary" role="status"></div></div>}
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {note && <div className="alert alert-success py-2 small">{note}</div>}

      {canUpload && openVisit && (
        <>
          <p className="small text-muted mb-2">
            Visit #{openVisit.visit_number} ({openVisit.status}) — photos are optional evidence.
          </p>
          {CATEGORIES.map((c) => uploadBlock(`cat-${c.type}`, c.label, null, { photo_type: c.type }))}
          {items.length > 0 && (
            <>
              <div className="fw-semibold small mt-3 mb-1">Measurement Items</div>
              {items.map((it) => uploadBlock(`item-${it.id}`,
                `Item ${it.sequence_no}${it.media_type ? ` · ${it.media_type}` : ""}`,
                `${it.width_ft ?? "—"} × ${it.height_ft ?? "—"} ft · qty ${it.quantity ?? 1}`,
                { photo_type: "MEASUREMENT_ITEM", measurement_item_id: it.id }))}
            </>
          )}
        </>
      )}

      {canUpload && !openVisit && (
        <p className="small text-muted mb-0">No open visit — photos unlock while a visit is OPEN, REACHED, WORK_IN_PROGRESS or SIGNATURE_PENDING.</p>
      )}

      <div className="mt-3">
        <div className="fw-semibold small mb-2">Evidence{photos.length > 0 ? ` (${photos.length})` : ""}</div>
        {photos.length === 0 && <p className="small text-muted mb-0">No photos uploaded yet.</p>}
        {Object.keys(photosByVisit).sort().map((vk) => (
          <div key={vk} className="mb-2">
            <small className="text-muted">Visit {vk}</small>
            <div className="d-flex gap-1 flex-wrap mt-1">
              {photosByVisit[vk].map((p) => (
                <PhotoThumb key={p.id} photo={p} onOpen={setLightbox} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {lightbox && (
        <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setLightbox(null)}>
          <div className="modal-dialog modal-lg modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h6 className="modal-title">
                  {TYPE_LABEL[lightbox.photo_type] || lightbox.photo_type}
                  <small className="text-muted ms-2">Visit {lightbox.visit_number ?? "—"}</small>
                </h6>
                <button type="button" className="btn-close" onClick={() => setLightbox(null)}></button>
              </div>
              <div className="modal-body text-center">
                {lightboxSrc
                  ? <img src={lightboxSrc} alt="evidence" className="img-fluid rounded" />
                  : <div className="spinner-border text-primary" role="status"></div>}
                <dl className="row mb-0 small text-start mt-3">
                  <dt className="col-4">Uploaded</dt><dd className="col-8">{lightbox.created_at ? formatIST(lightbox.created_at) : "—"}</dd>
                  {lightbox.uploader_name && (<><dt className="col-4">By</dt><dd className="col-8">{lightbox.uploader_name}</dd></>)}
                  {lightbox.item_sequence_no !== null && lightbox.item_sequence_no !== undefined && (<><dt className="col-4">Item</dt><dd className="col-8">#{lightbox.item_sequence_no}</dd></>)}
                  <dt className="col-4">File</dt><dd className="col-8 text-break">{lightbox.original_filename || "—"} · {formatBytes(lightbox.file_size_bytes)}</dd>
                  {(lightbox.latitude !== null && lightbox.latitude !== undefined) && (<><dt className="col-4">GPS</dt><dd className="col-8 font-monospace">{lightbox.latitude}, {lightbox.longitude}</dd></>)}
                </dl>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobPhotosSection;
