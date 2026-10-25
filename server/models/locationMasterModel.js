/**
 * Location Master Model
 * Read-only access to StateMaster / DistrictMaster.
 * Returns plain { id, name } lists for dropdowns. Active rows only.
 */
const db = require("../config/db");

const LocationMaster = {
  getStates: async () => {
    const [rows] = await db.query(
      `SELECT StateId AS id, StateName AS name, StateType AS type
         FROM StateMaster
        WHERE IsActive = 1
        ORDER BY StateName ASC`
    );
    return rows;
  },

  getDistrictsByStateId: async (stateId) => {
    const [rows] = await db.query(
      `SELECT DistrictId AS id, StateId AS stateId, DistrictName AS name
         FROM DistrictMaster
        WHERE StateId = ? AND IsActive = 1
        ORDER BY DistrictName ASC`,
      [Number(stateId)]
    );
    return rows;
  },

  getStateByName: async (stateName) => {
    const [rows] = await db.query(
      `SELECT StateId AS id, StateName AS name, StateType AS type
         FROM StateMaster
        WHERE StateName = ? AND IsActive = 1
        LIMIT 1`,
      [stateName]
    );
    return rows[0] || null;
  },

  getStateById: async (stateId) => {
    const [rows] = await db.query(
      `SELECT StateId AS id, StateName AS name, StateType AS type
         FROM StateMaster
        WHERE StateId = ? AND IsActive = 1
        LIMIT 1`,
      [Number(stateId)]
    );
    return rows[0] || null;
  },

  getDistrictsByStateName: async (stateName) => {
    const [rows] = await db.query(
      `SELECT d.DistrictId AS id, d.StateId AS stateId, d.DistrictName AS name
         FROM DistrictMaster d
         JOIN StateMaster s ON s.StateId = d.StateId
        WHERE s.StateName = ? AND d.IsActive = 1 AND s.IsActive = 1
        ORDER BY d.DistrictName ASC`,
      [stateName]
    );
    return rows;
  }
};

module.exports = LocationMaster;
