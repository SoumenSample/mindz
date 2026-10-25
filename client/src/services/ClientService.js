/**
 * Client Service
 * API calls for Client Master. Uses the shared axios instance so the
 * JWT attaches automatically and 401s bounce to login.
 */
import api from "./api";

const ClientService = {
  getClients: async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const response = await api.get(`/clients${suffix}`);
    return response.data;
  },

  getClientById: async (id) => {
    const response = await api.get(`/clients/${id}`);
    return response.data;
  },

  createClient: async (payload) => {
    const response = await api.post("/clients", payload);
    return response.data;
  },

  updateClient: async (id, payload) => {
    const response = await api.put(`/clients/${id}`, payload);
    return response.data;
  },

  deactivateClient: async (id) => {
    const response = await api.patch(`/clients/${id}/deactivate`);
    return response.data;
  },

  createClientLogin: async (id, payload) => {
    const response = await api.post(`/clients/${id}/login`, payload);
    return response.data;
  }
};

export default ClientService;
