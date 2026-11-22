import { STATE_ABBREVIATIONS } from "../../helpers/geographic-codes.js";
import { getCountiesByStateId } from "../../helpers/location-converter.js";
import { joinCountyRichness } from "./county-choropleth-data.js";
import { createCountyChoropleth } from "./county-choropleth.js";
import { createVisualizationFrame } from "../../components/visualization-frame.js";

const HTML = `
<p id="map-status" role="status" aria-live="polite">Loading geographic options…</p>
      <h2 id="map-title">Select a state</h2>
      <div id="county-map" data-plot aria-busy="true"></div>
      <p id="county-selection" aria-live="polite">No county highlighted.</p>
      <p id="geometry-note"></p>
      <p class="county-richness-page__note">Darker blue indicates more recorded species. Click a county or use the county selector to highlight it; every county remains in the statewide comparison. Keyboard users can focus a county and press Enter or Space. Choose “Select county” to clear the highlight.</p>
      <p class="county-richness-page__note">Counts include species-category observation records, not individual birds or population estimates. A species recorded in multiple years counts once toward richness. The displayed period excludes partial-year 2026.</p>
<div id="county-tooltip" class="county-choropleth__tooltip" role="tooltip" hidden></div>
`;

export function mountCountyChoropleth({ container: host, presentation = "standalone", store, data, geography, taxa, d3 = globalThis.d3, topojson = globalThis.topojson, sizing = {} }) {
  const frame = createVisualizationFrame({ container: host, html: HTML, presentation, className: "county-richness-page" });
  const { elements } = frame;
  let disposed = false;
  const { loadCountyRichness } = data;

const period = { startYear: 2012, endYear: 2025 };
  const status = elements["map-status"];
  const mapContainer = elements["county-map"];
  const selection = elements["county-selection"];
  const geometryNote = elements["geometry-note"];
  const cache = new Map();
  let requestId = 0;
  let displayedCounties = null;
  let displayedRows = [];
  let unsubscribe;
  let chart;

  function updateHighlight(countyCode) {
    chart.setSelectedCounty(countyCode);
    const selected = displayedCounties?.features.find(feature => feature.properties.regionCode === countyCode);
    if (!selected) {
      const row = displayedRows.find(row => row.region_code === countyCode);
      selection.textContent = row
        ? row.county_name + " selected: " + Number(row.species_richness).toLocaleString() + " distinct species; " + Number(row.observation_records).toLocaleString() + " observation records. No matching boundary to highlight; statewide comparison retained."
        : "No county highlighted.";
      return;
    }
    const { countyName, speciesRichness, observationRecords } = selected.properties;
    selection.textContent = speciesRichness === null
      ? countyName + " highlighted. No matching county summary."
      : countyName + " highlighted: " + speciesRichness.toLocaleString() + " distinct species; " + observationRecords.toLocaleString() + " observation records. Statewide comparison retained.";
  }

  async function initialize() {
    try {
      const topology = await data.loadCountyGeometry();
      if (disposed) return;
      const allCounties = topojson.feature(topology, topology.objects.counties);
      const states = geography.filter(row => row.region_level === "state" && Object.values(STATE_ABBREVIATIONS).includes(row.region_code.slice(3)));
      chart = createCountyChoropleth({ d3, sizing, presentation,
        container: mapContainer,
        tooltip: elements["county-tooltip"],
        onCountySelect: countyCode => store.setShared({ countyCode })
      });

      async function update({ filters, changedKeys }) {
        if (disposed) return;
        // Highlight changes never request or filter statewide data.
        if (changedKeys.length && changedKeys.every(key => key === "shared.countyCode")) {
          updateHighlight(filters.countyCode);
          return;
        }
        const currentRequest = ++requestId;
        displayedCounties = null;
        displayedRows = [];
        chart.clear();
        geometryNote.textContent = "";
        selection.textContent = "No county highlighted.";
        if (!filters.stateCode) {
          status.textContent = "Select a state to compare its counties.";
          elements["map-title"].textContent = "Select a state";
          mapContainer.setAttribute("aria-busy", "false");
          return;
        }
        const stateName = states.find(row => row.region_code === filters.stateCode).region_name;
        elements["map-title"].textContent = presentation === "compact" ? "County richness map · " + stateName : stateName + " · 2012–2025";
        status.textContent = "Loading all counties in " + stateName + "…";
        mapContainer.setAttribute("aria-busy", "true");
        try {
          let rows = cache.get(filters.stateCode);
          if (!rows) {
            rows = await loadCountyRichness(filters.stateCode, period.startYear, period.endYear);
            cache.set(filters.stateCode, rows);
          }
          if (currentRequest !== requestId) return;
          displayedRows = rows;
          const stateId = Object.keys(STATE_ABBREVIATIONS).find(id => STATE_ABBREVIATIONS[id] === filters.stateCode.slice(3));
          const counties = getCountiesByStateId(stateId, allCounties);
          displayedCounties = joinCountyRichness(counties, filters.stateCode, rows);
          chart.render({ counties: displayedCounties, selectedCounty: store.getFilters("t1Map").countyCode, stateName });
          updateHighlight(store.getFilters("t1Map").countyCode);
          const codes = new Set(displayedCounties.features.map(feature => feature.properties.regionCode));
          const unmatched = rows.filter(row => !codes.has(row.region_code));
          const missing = displayedCounties.features.filter(feature => feature.properties.speciesRichness === null);
          geometryNote.textContent = [
            unmatched.length ? "County summaries without matching bundled boundaries: " + unmatched.map(row => row.county_name + " (" + Number(row.species_richness).toLocaleString() + " species; " + Number(row.observation_records).toLocaleString() + " observation records)").join("; ") + "." : "",
            missing.length ? "Gray counties have no matching summary; they are not treated as zero observations." : ""
          ].filter(Boolean).join(" ");
          status.textContent = "Showing all " + counties.features.length + " county boundaries in " + stateName + ". Select a county to highlight it.";
        } catch (error) {
          if (disposed) return;
          if (currentRequest !== requestId) return;
          status.textContent = "Unable to load county richness: " + error.message + ". Reselect a state to retry.";
        } finally {
          if (currentRequest === requestId) mapContainer.setAttribute("aria-busy", "false");
        }
      }
      unsubscribe = store.subscribe({ chartId: "t1Map" }, update);
      await update({ filters: store.getFilters("t1Map"), changedKeys: [] });
    } catch (error) {
          if (disposed) return;
      status.textContent = "Unable to initialize county map: " + error.message;
      mapContainer.setAttribute("aria-busy", "false");
    }
  }

  const ready = initialize();
  return { root: frame.root, controls: frame.controls, ready, destroy() {
    if (disposed) return; disposed = true;
    requestId++;
    unsubscribe?.();

    chart?.destroy(); frame.destroy();
  } };
}
