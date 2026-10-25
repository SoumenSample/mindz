/**
 * Signature Service (Module 12) — shopkeeper acknowledgement evidence.
 * Uses the shared axios instance (JWT automatic, 401 bounces to login).
 * The image is NEVER hot-linked: the view endpoint is authenticated, so
 * display loads as a blob (Authorization header) into an object URL.
 */
import api from "./api";

const SignatureService = {
  getByVisit: async (visitId) => {
    const response = await api.get(`/signatures/visit/${visitId}`);
    return response.data;
  },

  listByJob: async (jobId) => {
    const response = await api.get(`/signatures/job/${jobId}`);
    return response.data;
  },

  getSignature: async (id) => {
    const response = await api.get(`/signatures/${id}`);
    return response.data;
  },

  capture: async ({ file, visit_id, signer_name, signer_mobile, remarks, latitude, longitude }) => {
    const form = new FormData();
    form.append("signature", file, "signature.png");
    form.append("visit_id", visit_id);
    form.append("signer_name", signer_name);
    if (signer_mobile !== undefined && signer_mobile !== null && signer_mobile !== "") {
      form.append("signer_mobile", signer_mobile);
    }
    if (remarks !== undefined && remarks !== null && remarks !== "") {
      form.append("remarks", remarks);
    }
    if (latitude !== undefined && latitude !== null && latitude !== "") form.append("latitude", latitude);
    if (longitude !== undefined && longitude !== null && longitude !== "") form.append("longitude", longitude);
    // Shared instance sets multipart for FormData (see api.js).
    const response = await api.post("/signatures", form);
    return response.data;
  },

  // Authenticated image bytes as an object URL (revoke after use).
  viewObjectUrl: async (id) => {
    const response = await api.get(`/signatures/${id}/view`, { responseType: "blob" });
    return URL.createObjectURL(response.data);
  }
};

export default SignatureService;
