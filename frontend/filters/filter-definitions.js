// Metadata is independent of controls, data loading, and chart rendering.
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const sortOptions = [
  { value: "alpha", label: "Alphabetical" },
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" }
];

export const SHARED_FILTER_DEFINITIONS = freeze({
  stateCode: { label: "State", type: "state", control: "select", default: null },
  countyCode: { label: "County", type: "county", control: "select", default: null },
  taxonId: { label: "Species", type: "taxon", control: "select", default: null },
  startYear: { label: "Start year", type: "integer", control: "number", default: 2012, min: 2012, max: 2025 },
  endYear: { label: "End year", type: "integer", control: "number", default: 2025, min: 2012, max: 2025 }
});

export const CHART_FILTER_DEFINITIONS = freeze({
  t1Map: {},
  t1: {
    sortOrder: { label: "Sort", type: "enum", control: "select", default: "desc", options: sortOptions }
  },
  t2: {
    season: {
      label: "Season", type: "enum", control: null, default: "all",
      options: [
        { value: "all", label: "All", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        { value: "spring", label: "Spring (Mar–May)", months: [3, 4, 5] },
        { value: "summer", label: "Summer (Jun–Aug)", months: [6, 7, 8] },
        { value: "fall", label: "Fall (Sep–Nov)", months: [9, 10, 11] },
        { value: "winter", label: "Winter (Dec–Feb)", months: [12, 1, 2] }
      ]
    }
  },
  t2Heatmap: {
    speciesCount: {
      label: "Species count", type: "enum", control: "select", default: 15,
      options: [10, 15, 20].map(value => ({ value, label: String(value) }))
    },
    sortOrder: {
      label: "Sort", type: "enum", control: "select", default: "total",
      options: [{ value: "total", label: "Total observations" }, { value: "alpha", label: "Alphabetical" }]
    }
  },
  t3: {},
  t4UpSet: {},
  t4: {
    candidateLocationIds: { label: "Candidate hotspots", maxItems: 10, type: "locationIds", control: null, default: [] },
    selectedCombinationIds: { label: "Selected combination", maxItems: 5, type: "locationIds", control: null, default: [] },
    numberOfLocations: {
      label: "Locations per combination", type: "enum", control: "select", default: 3,
      options: [3, 4, 5].map(value => ({ value, label: String(value) }))
    },
    sortOrder: { label: "Sort", type: "enum", control: "select", default: "desc", options: sortOptions }
  }
});

export const TASK_DEFINITIONS = freeze({
  t1Map: {
    label: "County Choropleth", sharedFilters: ["stateCode", "countyCode"],
    filterRoles: { stateCode: "comparison", countyCode: "highlight" }
  },
  t1: {
    label: "Geographic Species Richness", sharedFilters: ["stateCode", "countyCode"],
    filterRoles: { stateCode: "comparison", countyCode: "highlight" }
  },
  t2: {
    label: "Long-Term Observation Trends",
    sharedFilters: ["stateCode", "countyCode", "taxonId", "startYear", "endYear"]
  },
  t2Heatmap: {
    label: "Seasonal Species Heatmap",
    sharedFilters: ["stateCode", "countyCode", "startYear", "endYear"]
  },
  t3: {
    label: "Holiday Observation Patterns",
    sharedFilters: ["stateCode", "countyCode", "taxonId", "startYear", "endYear"],
    filterRoles: { stateCode: "countyContext", countyCode: "selection" }
  },
  t4UpSet: { label: "Hotspot Species Overlap", sharedFilters: ["stateCode", "countyCode"] },
  t4: { label: "Multi-Location Species Coverage", sharedFilters: ["stateCode", "countyCode"] }
});

// A shared-only header without chartId renders all shared definitions.
export function getFilterEntries({ chartId, scope = "all" } = {}) {
  if (!["all", "shared", "chart"].includes(scope)) throw new Error("Unknown filter scope");
  if (chartId !== undefined && !Object.hasOwn(TASK_DEFINITIONS, chartId)) throw new Error("Unknown chart: " + chartId);
  if (scope !== "shared" && chartId === undefined) throw new Error("chartId is required");
  const entries = [];
  if (scope !== "chart") {
    const keys = chartId ? TASK_DEFINITIONS[chartId].sharedFilters : Object.keys(SHARED_FILTER_DEFINITIONS);
    keys.forEach(key => entries.push({ key, path: "shared." + key, definition: SHARED_FILTER_DEFINITIONS[key] }));
  }
  if (scope !== "shared") {
    Object.entries(CHART_FILTER_DEFINITIONS[chartId]).forEach(([key, definition]) => {
      entries.push({ key, path: "charts." + chartId + "." + key, definition });
    });
  }
  return entries;
}
