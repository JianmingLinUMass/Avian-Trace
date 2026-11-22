import { buildFrequencyHeatmap } from "./species-heatmap-data.js";
import { createSpeciesHeatmap } from "./species-heatmap.js";
import { createVisualizationFrame } from "../../components/visualization-frame.js";

const HTML = `
<p id="heatmap-status" role="status" aria-live="polite">Loading geographic options…</p>
      <h2 id="heatmap-title">Select a state</h2>
      <p id="heatmap-context"></p>
      <div id="species-heatmap" data-plot aria-busy="true" tabindex="0" role="region" aria-label="Monthly reporting frequency. Scroll horizontally on narrow screens to see all months."></div>
      <p id="coverage-note" aria-live="polite"></p>
      <p class="species-heatmap-page__note">Each cell shows the share of complete checklists reporting that species. For each calendar month, counts are summed across the selected years before division. Hover or focus a cell to see the percentage and both counts.</p>
      <p class="species-heatmap-page__note">Species are ranked by reporting frequency across the displayed months. A gray cell means no eligible complete checklists. The eBird Basic Dataset excludes checklists with no observations. Reporting frequency measures how often birds were reported.</p>
<div id="heatmap-tooltip" class="species-heatmap__tooltip" role="tooltip" hidden></div>
`;

export function mountSeasonalSpeciesHeatmap({ container: host, presentation = "standalone", store, data, geography, taxa, d3 = globalThis.d3, sizing = {} }) {
  const frame = createVisualizationFrame({ container: host, html: HTML, presentation, className: "species-heatmap-page" });
  const { elements } = frame;
  let disposed = false;
  const { loadSpeciesReportingFrequency } = data;

  const status = elements["heatmap-status"];
  const container = elements["species-heatmap"];
  const coverage = elements["coverage-note"];
  let rows = [];
  let chart;
  let unsubscribe;
  let requestId = 0;

  function renderCurrent() {
    const filters = store.getFilters("t2Heatmap");
    const species = buildFrequencyHeatmap(rows, filters.sortOrder);
    chart.render({ species, startYear: filters.startYear, endYear: filters.endYear });
    return species;
  }

  async function initialize() {
    try {
      chart = createSpeciesHeatmap({ d3, sizing, presentation, container, tooltip: elements["heatmap-tooltip"] });
      async function update({ filters, changedKeys }) {
        if (disposed) return;
        if (changedKeys.length && changedKeys.every(key => key === "charts.t2Heatmap.sortOrder")) {
          if (rows.length) renderCurrent();
          return;
        }
        const currentRequest = ++requestId;
        rows = [];
        chart.clear();
        coverage.textContent = "";
        if (!filters.stateCode) {
          status.textContent = "Select a state. Choose a county to narrow the area.";
          elements["heatmap-title"].textContent = "Select a state";
          elements["heatmap-context"].textContent = "";
          container.setAttribute("aria-busy", "false");
          return;
        }
        const regionCode = filters.countyCode || filters.stateCode;
        const regionLevel = filters.countyCode ? "county" : "state";
        const name = geography.find(row => row.region_code === regionCode)?.region_name || regionCode;
        elements["heatmap-title"].textContent = presentation === "compact" ? "Seasonal frequency" : "Top species in " + name;
        elements["heatmap-context"].textContent = "Complete checklist reporting frequency · " + filters.startYear + "–" + filters.endYear + " · all twelve months";
        status.textContent = "Loading monthly reporting frequency…";
        container.setAttribute("aria-busy", "true");
        try {
          const result = await loadSpeciesReportingFrequency(regionCode, regionLevel, filters.startYear, filters.endYear, filters.speciesCount);
          if (currentRequest !== requestId) return;
          if (result.unavailableYears.length) {
            status.textContent = "Monthly frequency is unavailable for the complete selected range.";
            coverage.textContent = "Missing processed summaries for: " + result.unavailableYears.join(", ") + ". ";
            return;
          }
          rows = result.rows;
          if (!rows.length) {
            status.textContent = "No species reported on complete checklists in the selected area and years.";
            return;
          }
          const species = renderCurrent();
          status.textContent = "Showing " + species.length + " top species and all twelve months in " + name + ".";
          coverage.textContent = species.some(item => item.cells.some(cell => cell.frequency === null))
            ? "Gray cells indicate months without eligible complete checklists."
            : "0% means no reports of that species on eligible complete checklists.";
        } catch (error) {
          if (disposed) return;
          if (currentRequest === requestId) status.textContent = "Unable to load species heatmap: " + error.message + ". Change a filter to retry.";
        } finally {
          if (currentRequest === requestId) container.setAttribute("aria-busy", "false");
        }
      }
      unsubscribe = store.subscribe({ chartId: "t2Heatmap" }, update);
      await update({ filters: store.getFilters("t2Heatmap"), changedKeys: [] });
    } catch (error) {
          if (disposed) return;
      status.textContent = "Unable to initialize species heatmap: " + error.message;
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
