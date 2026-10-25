/**
 * Employee Service
 * API calls for Employee Master. Uses the shared axios instance so the
 * JWT attaches automatically and 401s bounce to login.
 */
import api from "./api";

const EmployeeService = {
  getEmployees: async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const response = await api.get(`/employees${suffix}`);
    return response.data;
  },

  getEmployeeById: async (id) => {
    const response = await api.get(`/employees/${id}`);
    return response.data;
  },

  createEmployee: async (payload) => {
    // payload may be a plain object (JSON) or FormData (with optional files).
    const response = await api.post("/employees", payload);
    return response.data;
  },

  updateEmployee: async (id, payload) => {
    // payload may be a plain object (JSON) or FormData (with optional files).
    const response = await api.put(`/employees/${id}`, payload);
    return response.data;
  },

  deactivateEmployee: async (id) => {
    const response = await api.patch(`/employees/${id}/deactivate`);
    return response.data;
  },

  createEmployeeLogin: async (id, payload) => {
    const response = await api.post(`/employees/${id}/login`, payload);
    return response.data;
  },

  getDepartments: async () => {
    const response = await api.get("/employees/meta/departments");
    return response.data;
  }
};

export default EmployeeService;
