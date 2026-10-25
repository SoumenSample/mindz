/**
 * Job Request Service 
 * API calls for Job Requests. Uses the shared axios instance so the
 * JWT attaches automatically and 401s bounce to login.
 */
import api from "./api";

const JobRequestService = {
  getRequests: async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const response = await api.get(`/job-requests${suffix}`);
    return response.data;
  },

  getRequestById: async (id) => {
    const response = await api.get(`/job-requests/${id}`);
    return response.data;
  },

  getJobTypes: async () => {
    const response = await api.get("/job-requests/meta/job-types");
    return response.data;
  },

  createRequest: async (payload) => {
    const response = await api.post("/job-requests", payload);
    return response.data;
  },

  updateRequest: async (id, payload) => {
    const response = await api.put(`/job-requests/${id}`, payload);
    return response.data;
  },

  cancelRequest: async (id) => {
    const response = await api.patch(`/job-requests/${id}/cancel`);
    return response.data;
  },

  acceptRequest: async (id, admin_remark) => {
    const response = await api.patch(`/job-requests/${id}/accept`, { admin_remark });
    return response.data;
  },

  rejectRequest: async (id, reason) => {
    const response = await api.patch(`/job-requests/${id}/reject`, { reason });
    return response.data;
  }
};

export default JobRequestService;
