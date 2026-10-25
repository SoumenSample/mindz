/**
 * Location Master Controller
 * Read-only dropdown data:
 *   GET /api/locations/states -> all active states/UTs
 *   GET /api/locations/districts?stateId=29 | ?stateName=West%20Bengal
 * Districts resolve by stateId first, else stateName. Unknown / non-WB
 * states simply return an empty list (UI falls back to free text).
 */
const LocationMaster = require("../models/locationMasterModel");

// GET /api/locations/states
exports.getStates = async (req, res) => {
  try {
    const states = await LocationMaster.getStates();
    return res.json({ success: true, data: states });
  } catch (error) {
    console.error("Error fetching states:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load states." });
  }
};

// GET /api/locations/districts?stateId=&stateName=
exports.getDistricts = async (req, res) => {
  try {
    const { stateId = "", stateName = "" } = req.query;

    if (stateId !== "" && stateId !== null && stateId !== undefined) {
      const id = Number(stateId);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ success: false, message: "Invalid stateId." });
      }
      const districts = await LocationMaster.getDistrictsByStateId(id);
      return res.json({ success: true, data: districts, stateId: id });
    }

    if (stateName && String(stateName).trim() !== "") {
      const districts = await LocationMaster.getDistrictsByStateName(String(stateName).trim());
      return res.json({ success: true, data: districts, stateName: String(stateName).trim() });
    }

    return res.status(400).json({
      success: false,
      message: "Provide stateId or stateName to list districts."
    });
  } catch (error) {
    console.error("Error fetching districts:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load districts." });
  }
};
