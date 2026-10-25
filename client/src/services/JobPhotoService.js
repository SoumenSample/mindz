/**
 * JobPhoto Service (Module 11) — photo proof evidence.
 * Uses the shared axios instance (JWT automatic, 401 bounces to login).
 * Images are NEVER hot-linked: the view endpoint is authenticated, so
 * thumbnails load as blobs (Authorization header) into object URLs.
 */
import api from "./api";

const JobPhotoService = {
  listByJob: async (jobId) => {
    const response = await api.get(`/job-photos/job/${jobId}`);
    return response.data;
  },

  listByVisit: async (visitId) => {
    const response = await api.get(`/job-photos/visit/${visitId}`);
    return response.data;
  },

  getPhoto: async (id) => {
    const response = await api.get(`/job-photos/${id}`);
    return response.data;
  },

  upload: async ({ file, job_id, visit_id, photo_type, measurement_item_id, latitude, longitude, captured_at }) => {
    const form = new FormData();
    form.append("photo", file);
    form.append("job_id", job_id);
    form.append("visit_id", visit_id);
    form.append("photo_type", photo_type);
    if (measurement_item_id !== undefined && measurement_item_id !== null && measurement_item_id !== "") {
      form.append("measurement_item_id", measurement_item_id);
    }
    if (latitude !== undefined && latitude !== null && latitude !== "") form.append("latitude", latitude);
    if (longitude !== undefined && longitude !== null && longitude !== "") form.append("longitude", longitude);
    if (captured_at) form.append("captured_at", captured_at);
    // Let the shared instance set multipart for FormData (see api.js).
    const response = await api.post("/job-photos/upload", form);
    return response.data;
  },

  // Authenticated image bytes as an object URL (revoke after use).
  viewObjectUrl: async (id) => {
    const response = await api.get(`/job-photos/${id}/view`, { responseType: "blob" });
    return URL.createObjectURL(response.data);
  },

  remove: async (id) => {
    const response = await api.delete(`/job-photos/${id}`);
    return response.data;
  },

  closeVisit: async (jobId) => {
    const response = await api.post(`/jobs/${jobId}/close-visit`);
    return response.data;
  }
};

export default JobPhotoService;
