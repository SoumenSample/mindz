/**
 * StateDistrictSelect
 * Reusable dynamic State -> District dropdowns backed by
 * GET /api/locations/states + /districts (migration 021), with a
 * bundled fallback (all states, WB districts) when offline.
 *
 * - StateSelect: all states always listed.
 * - DistrictSelect: lists districts of the given state only; when the
 *   state has no seeded districts (any state except West Bengal for
 *   now) it degrades to a free-text input so other states stay usable.
 * - Selecting a new state always clears the district value.
 */
import React, { useState, useEffect } from "react";
import LocationService from "../services/LocationService";

export function useStates() {
  const [states, setStates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    LocationService.getStates()
      .then((list) => {
        if (alive) setStates(Array.isArray(list) ? list : []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { states, loading };
}

export function useDistricts({ stateId = "", stateName = "" } = {}) {
  const [districts, setDistricts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const sid = stateId !== "" && stateId !== null && stateId !== undefined ? String(stateId) : "";
    const sname = stateName ? String(stateName).trim() : "";
    if (!sid && !sname) {
      setDistricts([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    LocationService.getDistricts({ stateId: sid, stateName: sid ? "" : sname })
      .then((list) => {
        if (alive) setDistricts(Array.isArray(list) ? list : []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [stateId, stateName]);

  return { districts, loading };
}

export function StateSelect({
  value,
  onChange,
  includeAll = false,
  allLabel = "All",
  placeholder = "-- Select State --",
  disabled = false,
  required = false,
  id,
  name = "state",
  className = "form-select",
  states: statesProp,
  loading: loadingProp
}) {
  const { states: fetched, loading: fetching } = useStates();
  const states = Array.isArray(statesProp) ? statesProp : fetched;
  const loading = loadingProp !== undefined ? loadingProp : fetching;

  return (
    <select
      id={id}
      name={name}
      className={className}
      value={value || ""}
      disabled={disabled || loading}
      required={required}
      onChange={(e) => onChange && onChange(e.target.value)}
    >
      {includeAll ? (
        <option value="">{allLabel}</option>
      ) : (
        <option value="">{loading ? "Loading states..." : placeholder}</option>
      )}
      {states.map((s) => (
        <option key={s.id || s.name} value={s.name}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

export function DistrictSelect({
  stateId = "",
  stateName = "",
  value,
  onChange,
  includeAll = false,
  allLabel = "All",
  placeholder = "-- Select District --",
  disabled = false,
  required = false,
  id,
  name = "district",
  className = "form-select",
  allowFreeText = true,
  freeTextPlaceholder = "Type district..."
}) {
  const { districts, loading } = useDistricts({ stateId, stateName });
  const hasState = (stateId !== "" && stateId !== null && stateId !== undefined) || (stateName && String(stateName).trim() !== "");

  // No state chosen yet -> disabled select.
  if (!hasState) {
    return (
      <select id={id} name={name} className={className} value="" disabled onChange={() => {}}>
        <option value="">Select state first</option>
      </select>
    );
  }

  if (loading) {
    return (
      <select id={id} name={name} className={className} value="" disabled onChange={() => {}}>
        <option value="">Loading districts...</option>
      </select>
    );
  }

  // State has seeded districts (West Bengal today) -> dropdown.
  if (districts.length > 0) {
    return (
      <select
        id={id}
        name={name}
        className={className}
        value={value || ""}
        disabled={disabled}
        required={required}
        onChange={(e) => onChange && onChange(e.target.value)}
      >
        {includeAll ? (
          <option value="">{allLabel}</option>
        ) : (
          <option value="">{placeholder}</option>
        )}
        {districts.map((d) => (
          <option key={d.id || d.name} value={d.name}>
            {d.name}
          </option>
        ))}
      </select>
    );
  }

  // Other states have no district seeds yet -> free text (or disabled note).
  if (allowFreeText) {
    return (
      <input
        type="text"
        id={id}
        name={name}
        className="form-control"
        value={value || ""}
        disabled={disabled}
        required={required}
        placeholder={freeTextPlaceholder}
        title="No district master for this state yet — type manually."
        onChange={(e) => onChange && onChange(e.target.value)}
      />
    );
  }

  return (
    <select id={id} name={name} className={className} value="" disabled onChange={() => {}}>
      <option value="">No districts for this state</option>
    </select>
  );
}

export default StateSelect;
