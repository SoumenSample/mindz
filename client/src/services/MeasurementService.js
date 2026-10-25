/**
 * Measurement Service 
 * Uses the shared axios instance (JWT automatic, 401 bounces to login).
 */
import api from "./api";

const MeasurementService = {
  getSheetsByJob: async (jobId) => {
    const response = await api.get(`/jobs/${jobId}/measurement-sheets`);
    return response.data;
  },

  getSheetById: async (id) => {
    const response = await api.get(`/measurement-sheets/${id}`);
    return response.data;
  },

  createSheet: async (jobId, payload) => {
    const response = await api.post(`/jobs/${jobId}/measurement-sheets`, payload || {});
    return response.data;
  },

  updateSheet: async (id, items) => {
    const response = await api.put(`/measurement-sheets/${id}`, { items });
    return response.data;
  },

  scanSheet: async (id, file) => {
    const formData = new FormData();
    formData.append("sheet", file);
    const response = await api.post(`/measurement-sheets/${id}/ocr`, formData);
    return response.data;
  },

  finalizeSheet: async (id) => {
    const response = await api.post(`/measurement-sheets/${id}/finalize`);
    return response.data;
  },

  deleteSheet: async (id) => {
    const response = await api.delete(`/measurement-sheets/${id}`);
    return response.data;
  },

  reviseSheet: async (id) => {
    const response = await api.post(`/measurement-sheets/${id}/revise`);
    return response.data;
  },

  startWork: async (jobId) => {
    const response = await api.post(`/jobs/${jobId}/start-work`);
    return response.data;
  }
};

export default MeasurementService;
