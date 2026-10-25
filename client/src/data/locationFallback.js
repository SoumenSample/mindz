/**
 * Bundled fallback for State -> District dropdowns.
 * Used only when GET /api/locations/* is unreachable (offline or
 * migration 021 not applied yet). Mirrors the DB seeds: all states,
 * West Bengal districts only.
 */

export const FALLBACK_STATES = [
  { id: 1, name: "Andaman and Nicobar Islands", type: "UT" },
  { id: 2, name: "Andhra Pradesh", type: "STATE" },
  { id: 3, name: "Arunachal Pradesh", type: "STATE" },
  { id: 4, name: "Assam", type: "STATE" },
  { id: 5, name: "Bihar", type: "STATE" },
  { id: 6, name: "Chhattisgarh", type: "STATE" },
  { id: 7, name: "Goa", type: "STATE" },
  { id: 8, name: "Gujarat", type: "STATE" },
  { id: 9, name: "Haryana", type: "STATE" },
  { id: 10, name: "Himachal Pradesh", type: "STATE" },
  { id: 11, name: "Jharkhand", type: "STATE" },
  { id: 12, name: "Karnataka", type: "STATE" },
  { id: 13, name: "Kerala", type: "STATE" },
  { id: 14, name: "Madhya Pradesh", type: "STATE" },
  { id: 15, name: "Maharashtra", type: "STATE" },
  { id: 16, name: "Manipur", type: "STATE" },
  { id: 17, name: "Meghalaya", type: "STATE" },
  { id: 18, name: "Mizoram", type: "STATE" },
  { id: 19, name: "Nagaland", type: "STATE" },
  { id: 20, name: "Odisha", type: "STATE" },
  { id: 21, name: "Punjab", type: "STATE" },
  { id: 22, name: "Rajasthan", type: "STATE" },
  { id: 23, name: "Sikkim", type: "STATE" },
  { id: 24, name: "Tamil Nadu", type: "STATE" },
  { id: 25, name: "Telangana", type: "STATE" },
  { id: 26, name: "Tripura", type: "STATE" },
  { id: 27, name: "Uttar Pradesh", type: "STATE" },
  { id: 28, name: "Uttarakhand", type: "STATE" },
  { id: 29, name: "West Bengal", type: "STATE" },
  { id: 30, name: "Delhi", type: "UT" },
  { id: 31, name: "Jammu and Kashmir", type: "UT" },
  { id: 32, name: "Ladakh", type: "UT" },
  { id: 33, name: "Chandigarh", type: "UT" },
  { id: 34, name: "Puducherry", type: "UT" },
  { id: 35, name: "Lakshadweep", type: "UT" },
  { id: 36, name: "Dadra and Nagar Haveli and Daman and Diu", type: "UT" }
];

const WB_NAMES = [
  "Alipurduar",
  "Bankura",
  "Paschim Bardhaman",
  "Purba Bardhaman",
  "Birbhum",
  "Cooch Behar",
  "Darjeeling",
  "Hooghly",
  "Howrah",
  "Jalpaiguri",
  "Jhargram",
  "Kalimpong",
  "Kolkata",
  "Maldah",
  "Murshidabad",
  "Nadia",
  "North 24 Parganas",
  "South 24 Parganas",
  "Paschim Medinipur",
  "Purba Medinipur",
  "Uttar Dinajpur",
  "Dakshin Dinajpur"
];

export const FALLBACK_WB_DISTRICTS = WB_NAMES.map((name, i) => ({
  id: i + 1,
  stateId: 29,
  name
}));

export const isWestBengal = (stateName) =>
  String(stateName || "").trim().toLowerCase() === "west bengal";
