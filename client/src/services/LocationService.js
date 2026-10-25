/**
 * Location Service
 * Dropdown data for dynamic State -> District selects.
 * Backend: GET /api/locations/states, GET /api/locations/districts.
 * Falls back to bundled data when the API is unreachable so forms
 * keep working offline / before migration 021 is applied.
 */
import api from "./api";
import { FALLBACK_STATES, FALLBACK_WB_DISTRICTS } from "../data/locationFallback";

const LocationService = {
  getStates: async () => {
    try {
      const response = await api.get("/locations/states");
      if (response.data?.success && Array.isArray(response.data.data) && response.data.data.length > 0) {
        return response.data.data;
      }
      return FALLBACK_STATES;
    } catch (error) {
      // Offline / migration not applied yet / session issue: use fallback.
      return FALLBACK_STATES;
    }
  },

  /**
   * Districts for a state. Pass { stateId } or { stateName }.
   * West Bengal returns 22 districts; any other state returns [] so
   * the caller can fall back to free text.
   */
  getDistricts: async ({ stateId = "", stateName = "" } = {}) => {
    const qs = new URLSearchParams();
    if (stateId !== "" && stateId !== null && stateId !== undefined) qs.append("stateId", stateId);
    else if (stateName && String(stateName).trim() !== "") qs.append("stateName", String(stateName).trim());
    else return [];

    try {
      const response = await api.get(`/locations/districts?${qs.toString()}`);
      if (response.data?.success && Array.isArray(response.data.data)) {
        return response.data.data;
      }
      return [];
    } catch (error) {
      // Fallback only knows West Bengal districts.
      const name = String(stateName || "");
      const isWB =
        name.trim().toLowerCase() === "west bengal" ||
        String(stateId) === "29";
      return isWB ? FALLBACK_WB_DISTRICTS : [];
    }
  }
};

export default LocationService;
