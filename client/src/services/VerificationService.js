/**
 * Verification Service (Module 13)
 * Admin review queue + per-visit evidence + approve/reject decisions.
 * Uses the shared axios instance (JWT automatic, 401 bounces to login).
 */
import api from "./api";

const VerificationService = {
  getQueue: async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const response = await api.get(`/jobs/verification-queue${suffix}`);
    return response.data;
  },

  getDetail: async (jobId) => {
    const response = await api.get(`/jobs/${jobId}/verification`);
    return response.data;
  },

  approve: async (jobId, payload = {}) => {
    const response = await api.post(`/jobs/${jobId}/approve`, payload);
    return response.data;
  },

  reject: async (jobId, payload) => {
    const response = await api.post(`/jobs/${jobId}/reject`, payload);
    return response.data;
  }
};

export default VerificationService;
