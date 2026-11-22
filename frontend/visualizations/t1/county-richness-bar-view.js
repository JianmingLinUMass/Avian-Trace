import { sortCountyRichness } from "./county-richness-bar-data.js";
import { createCountyRichnessBarChart } from "./county-richness-bar.js";
import { createVisualizationFrame } from "../../components/visualization-frame.js";

const HTML = `
<p id="chart-status" role="status" aria-live="polite">Loading geographic options…</p>
      <h2 id="chart-title">Select a state</h2>
      <p id="scroll-hint">County labels are shown in full. Scroll down to see more counties. The species scale stays visible.</p>
      <div id="richness-chart" data-plot aria-busy="true"></div>
      <p id="county-selection" aria-live="polite">No county highlighted.</p>
      <p class="county-bars-page__note">Choose a county in the header, click its bar, or focus its row and press Enter or Space to highlight it. All counties remain in the statewide comparison. Selected counties are brought into view. Choose “Select county” to clear the highlight.</p>
      <p class="county-bars-page__note">Richness counts each species once across 2012–2025. Observation counts are species-category observation records, not individual birds, checklists, or population estimates. All counties returned by the data endpoint are included, whether or not map boundaries are available.</p>
<div id="bar-tooltip" class="county-bars__tooltip" role="tooltip" hidden></div>
`;

export function mountCountyRichnessBar({ container: host, presentation = "standalone", store, data, geography, taxa, d3 = globalThis.d3 }) {
  const frame = createVisualizationFrame({ container: host, html: HTML, presentation, className: "county-bars-page" });
  const { elements } = frame;
  let disposed = false;
  const { loadCountyRichness } = data;

  const status = elements["chart-status"];
  const container = elements["richness-chart"];
  const selection = elements["county-selection"];
  const cache = new Map();
  let displayedRows = [];
  let requestId = 0;
  let chart;
  let unsubscribe;

  function updateHighlight(countyCode) {
    chart.setSelectedCounty(countyCode);
    const row = displayedRows.find(row => row.region_code === countyCode);
    selection.textContent = row
      ? row.county_name + " highlighted: " + Number(row.species_richness).toLocaleString() + " distinct species; " + Number(row.observation_records).toLocaleString() + " observation records. Statewide comparison retained."
      : "No county highlighted.";
  }

  function renderCurrent(animation = "none") {
    const filters = store.getFilters("t1");

    chart.render({
      rows: sortCountyRichness(displayedRows, filters.sortOrder),
      selectedCounty: filters.countyCode,
      animation
    });

    updateHighlight(filters.countyCode);
}

  async function initialize() {
    try {
      const states = geography.filter(row => row.region_level === "state");
      chart = createCountyRichnessBarChart({ d3,
        container,
        tooltip: elements["bar-tooltip"],
        onCountySelect: countyCode => store.setShared({ countyCode })
      });
      chart.clear();

      async function update({ filters, changedKeys }) {
        if (disposed) return;
        if (changedKeys.length && changedKeys.every(key => key === "shared.countyCode")) {
          updateHighlight(filters.countyCode);
          return;
        }
        if (changedKeys.length && changedKeys.every(key => key === "charts.t1.sortOrder")) {
          if (displayedRows.length) renderCurrent("sort");
          return;
        }
        const currentRequest = ++requestId;
        displayedRows = [];
        chart.clear();
        selection.textContent = "No county highlighted.";
        if (!filters.stateCode) {
          status.textContent = "Select a state to compare its counties.";
          elements["chart-title"].textContent = "Select a state";
          container.setAttribute("aria-busy", "false");
          return;
        }
        const stateName = states.find(row => row.region_code === filters.stateCode)?.region_name || filters.stateCode;
        elements["chart-title"].textContent = presentation === "compact" ? "County richness ranking · " + stateName : stateName + " · 2012–2025";
        status.textContent = "Loading all counties in " + stateName + "…";
        container.setAttribute("aria-busy", "true");
        try {
          let rows = cache.get(filters.stateCode);
          if (!rows) {
            rows = await loadCountyRichness(filters.stateCode, 2012, 2025);
            cache.set(filters.stateCode, rows);
          }
          if (currentRequest !== requestId) return;
          displayedRows = rows;
          renderCurrent("state-change");
          status.textContent = rows.length
            ? "Showing all " + rows.length + " counties in " + stateName + ". Sort or select a county without removing others."
            : "No county summaries available for " + stateName + ".";
        } catch (error) {
          if (disposed) return;
          if (currentRequest !== requestId) return;
          status.textContent = "Unable to load county richness: " + error.message + ". Reselect a state to retry.";
        } finally {
          if (currentRequest === requestId) container.setAttribute("aria-busy", "false");
        }
      }
      unsubscribe = store.subscribe({ chartId: "t1" }, update);
      await update({ filters: store.getFilters("t1"), changedKeys: [] });
    } catch (error) {
          if (disposed) return;
      status.textContent = "Unable to initialize county bar chart: " + error.message;
      container.setAttribute("aria-busy", "false");
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
