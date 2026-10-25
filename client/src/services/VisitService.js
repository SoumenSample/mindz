/**
 * Visit + Tracking Service 
 * Uses the shared axios instance (JWT automatic, 401 bounces to login).
 * GPS comes from the browser Geolocation API at call sites — no new
 * dependencies (no Capacitor plugin present in this project).
 */
import api from "./api";

const VisitService = {
  getMyVisits: async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const response = await api.get(`/visits/mine${suffix}`);
    return response.data;
  },

  getAllVisits: async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const response = await api.get(`/visits${suffix}`);
    return response.data;
  },

  getVisitById: async (id) => {
    const response = await api.get(`/visits/${id}`);
    return response.data;
  },

  getJobVisits: async (jobId) => {
    const response = await api.get(`/jobs/${jobId}/visits`);
    return response.data;
  },

  startTravel: async (jobId) => {
    const response = await api.post(`/jobs/${jobId}/start-travel`);
    return response.data;
  },

  reachStore: async (jobId, payload) => {
    const response = await api.post(`/jobs/${jobId}/reach-store`, payload);
    return response.data;
  },

  postLocation: async (jobId, payload) => {
    const response = await api.post(`/jobs/${jobId}/location`, payload);
    return response.data;
  },

  getActiveTracking: async () => {
    const response = await api.get("/tracking/active");
    return response.data;
  },

  getTrackingState: async () => {
    const response = await api.get("/tracking/state");
    return response.data;
  },

  enableTracking: async () => {
    const response = await api.post("/tracking/enable");
    return response.data;
  },

  disableTracking: async () => {
    const response = await api.post("/tracking/disable");
    return response.data;
  },

  postTrackingLocation: async (payload) => {
    const response = await api.post("/tracking/location", payload);
    return response.data;
  }
};

export default VisitService;
