import { loadSeasonalTrendSeries } from "./observation-trends-data.js";
import { createObservationTrendsChart } from "./observation-trends-chart.js";
import { createVisualizationFrame } from "../../components/visualization-frame.js";

const HTML = `
<p id="trend-status" role="status" aria-live="polite">Loading geographic and species options…</p>
      <h2 id="trend-title">Select an area and species</h2>
      <p id="trend-context"></p>
      <div id="trend-chart" data-plot aria-busy="true" tabindex="0" role="region" aria-label="Observation trends. Scroll horizontally on narrow screens to see every year."></div>
      <p id="coverage-note" aria-live="polite"></p>
      <p class="observation-trends-page__note">Select a line or legend item to emphasize a trend; all five remain visible. Hover or focus a yearly point to see its season and observation count. A processed year with no matching records is shown as zero; an unavailable summary produces a line gap. Zero recorded observations does not establish that a species was absent.</p>
      <p class="observation-trends-page__note">Counts are species-category observation records, not individual birds, unique checklists, or population estimates. Winter selects January, February, and December within each labeled year. The available complete-year range is 2012–2025; partial-year 2026 is excluded.</p>
<div id="trend-tooltip" class="observation-trends__tooltip" role="tooltip" hidden></div>
`;

export function mountObservationTrends({ container: host, presentation = "standalone", store, data, geography, taxa, d3 = globalThis.d3, sizing = {} }) {
  const frame = createVisualizationFrame({ container: host, html: HTML, presentation, className: "observation-trends-page" });
  const { elements } = frame;
  let disposed = false;
  const { loadSpeciesTrend } = data;

const container = elements["trend-chart"];
  const status = elements["trend-status"];
  const coverage = elements["coverage-note"];
  let chart;
  let unsubscribe;
  let requestId = 0;

  async function initialize() {
    try {
      chart = createObservationTrendsChart({ d3, sizing, presentation, container, tooltip: elements["trend-tooltip"],
        onSelectSeason: season => store.setChart("t2", { season }) });

      async function update({ filters, changedKeys }) {
        if (disposed) return;
        chart.selectSeason(filters.season);
        if (changedKeys?.every(key => key === "charts.t2.season")) return;
        const currentRequest = ++requestId;
        chart.clear();
        coverage.textContent = "";
        if (!filters.stateCode || !filters.taxonId) {
          status.textContent = "Select a state and species. Choose a county to narrow the area.";
          elements["trend-title"].textContent = "Select an area and species";
          elements["trend-context"].textContent = "";
          container.setAttribute("aria-busy", "false");
          return;
        }
        const regionCode = filters.countyCode || filters.stateCode;
        const regionName = geography.find(row => row.region_code === regionCode)?.region_name || regionCode;
        const speciesName = taxa.get(filters.taxonId) || filters.taxonId;
        elements["trend-title"].textContent = speciesName + " in " + regionName;
        elements["trend-context"].textContent = regionName + " · " + filters.startYear + "–" + filters.endYear + " · " + "All five seasonal trends";
        status.textContent = "Loading yearly observation records…";
        container.setAttribute("aria-busy", "true");
        try {
          const trends = await loadSeasonalTrendSeries(loadSpeciesTrend, filters);
          if (currentRequest !== requestId) return;
          if (!trends.length) {
            status.textContent = "No matching species or geographic reference was found.";
            return;
          }
          const series = trends[0].series;
          chart.render({ trends, startYear: filters.startYear, endYear: filters.endYear });
          const unavailable = series.filter(point => point.observationRecords === null).map(point => point.year);
          status.textContent = "Showing " + series.length + (series.length === 1 ? " year: " : " years: ") + (series.length - unavailable.length) + " available, " + unavailable.length + " unavailable.";
          coverage.textContent = unavailable.length
            ? "No processed summary for: " + unavailable.join(", ") + ". Line gaps indicate unavailable data, not zero observations."
            : series.every(point => point.observationRecords === 0)
              ? "No observation records for this species in the selected area and years."
              : "All selected years have processed observation summaries.";
        } catch (error) {
          if (disposed) return;
          if (currentRequest === requestId) status.textContent = "Unable to load observation trends: " + error.message + ". Change a filter to retry.";
        } finally {
          if (currentRequest === requestId) container.setAttribute("aria-busy", "false");
        }
      }
      unsubscribe = store.subscribe({ chartId: "t2" }, update);
      await update({ filters: store.getFilters("t2") });
    } catch (error) {
          if (disposed) return;
      status.textContent = "Unable to initialize observation trends: " + error.message;
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
