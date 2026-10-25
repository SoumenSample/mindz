/**
 * Job Service 
 * API calls for Operational Jobs + Assignment. Uses the shared axios
 * instance so the JWT attaches automatically and 401s bounce to login.
 */
import api from "./api";

const JobService = {
  getJobs: async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const response = await api.get(`/jobs${suffix}`);
    return response.data;
  },

  getJobById: async (id) => {
    const response = await api.get(`/jobs/${id}`);
    return response.data;
  },

  getFieldExecutives: async () => {
    const response = await api.get("/jobs/meta/field-executives");
    return response.data;
  },

  createJob: async (payload) => {
    const response = await api.post("/jobs", payload);
    return response.data;
  },

  convertRequest: async (requestId) => {
    const response = await api.post(`/jobs/from-request/${requestId}`);
    return response.data;
  },

  updateJob: async (id, payload) => {
    const response = await api.put(`/jobs/${id}`, payload);
    return response.data;
  },

  assignJob: async (id, payload) => {
    const response = await api.patch(`/jobs/${id}/assign`, payload);
    return response.data;
  },

  reassignJob: async (id, payload) => {
    const response = await api.patch(`/jobs/${id}/reassign`, payload);
    return response.data;
  },

  cancelJob: async (id, payload) => {
    const response = await api.patch(`/jobs/${id}/cancel`, payload || {});
    return response.data;
  }
};

export default JobService;
