/**
 * Store Service 
 * API calls for Store Master. Uses the shared axios instance so the
 * JWT attaches automatically and 401s bounce to login.
 */
import api from "./api";

const StoreService = {
  getStores: async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const response = await api.get(`/stores${suffix}`);
    return response.data;
  },

  getStoreById: async (id) => {
    const response = await api.get(`/stores/${id}`);
    return response.data;
  },

  createStore: async (payload) => {
    const response = await api.post("/stores", payload);
    return response.data;
  },

  updateStore: async (id, payload) => {
    const response = await api.put(`/stores/${id}`, payload);
    return response.data;
  },

  deactivateStore: async (id) => {
    const response = await api.patch(`/stores/${id}/deactivate`);
    return response.data;
  }
};

export default StoreService;
