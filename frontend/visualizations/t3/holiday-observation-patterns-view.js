import { buildHolidaySeries } from "./holiday-observations-data.js";
import { createHolidayObservationsChart } from "./holiday-observations-chart.js";
import { createVisualizationFrame } from "../../components/visualization-frame.js";

const HTML = `
<p id="holiday-status" role="status" aria-live="polite">Loading county and species options…</p>
      <h2 id="holiday-title">Select a county and species</h2>
      <p id="holiday-context"></p>
      <div id="holiday-chart" data-plot aria-busy="true" tabindex="0" role="region" aria-label="Holiday and non-holiday observation trends. Scroll horizontally on narrow screens to see every year."></div>
      <p id="coverage-note" aria-live="polite"></p>
      <p class="holiday-patterns-page__note">Hover or focus either yearly point to see both daily averages, observation totals, and calendar-day counts. Every day belongs to exactly one group, including days with zero recorded observations.</p>
      <p class="holiday-patterns-page__note">Holidays are distinct dates marked as actual holidays in the existing calendar. Observed-only substitute dates belong to the non-holiday group. Leap years have 366 days; other years have 365.</p>
      <p class="holiday-patterns-page__note">These are species-category observation records, not individual birds, unique checklists, or population estimates. Unavailable or inconsistent summaries produce gaps rather than zeros. The complete-year range is 2012–2025.</p>
<div id="holiday-tooltip" class="holiday-patterns__tooltip" role="tooltip" hidden></div>
`;

export function mountHolidayObservationPatterns({ container: host, presentation = "standalone", store, data, geography, taxa, d3 = globalThis.d3, sizing = {} }) {
  const frame = createVisualizationFrame({ container: host, html: HTML, presentation, className: "holiday-patterns-page" });
  const { elements } = frame;
  let disposed = false;
  const { loadHolidayObservations } = data;

const container = elements["holiday-chart"];
  const status = elements["holiday-status"];
  const coverage = elements["coverage-note"];
  let chart;
  let unsubscribe;
  let requestId = 0;

  async function initialize() {
    try {
      chart = createHolidayObservationsChart({ d3, sizing, presentation, container, tooltip: elements["holiday-tooltip"] });

      async function update({ filters }) {
        if (disposed) return;
        const currentRequest = ++requestId;
        chart.clear();
        coverage.textContent = "";
        if (!filters.countyCode || !filters.taxonId) {
          status.textContent = "Select a county and species. State narrows the county choices.";
          elements["holiday-title"].textContent = "Select a county and species";
          elements["holiday-context"].textContent = "";
          container.setAttribute("aria-busy", "false");
          return;
        }
        const name = geography.find(row => row.region_code === filters.countyCode)?.region_name || filters.countyCode;
        elements["holiday-title"].textContent = presentation === "compact" ? "Holiday comparison · " + (taxa.get(filters.taxonId) || filters.taxonId) : (taxa.get(filters.taxonId) || filters.taxonId) + " in " + name;
        elements["holiday-context"].textContent = name + " · " + filters.startYear + "–" + filters.endYear + " · actual holidays versus all other dates";
        status.textContent = "Loading daily observation averages…";
        container.setAttribute("aria-busy", "true");
        try {
          const rows = await loadHolidayObservations(filters.countyCode, filters.taxonId, filters.startYear, filters.endYear);
          if (currentRequest !== requestId) return;
          if (!rows.length) {
            status.textContent = "No matching county or species reference found.";
            return;
          }
          const series = buildHolidaySeries(rows, filters.startYear, filters.endYear);
          chart.render({ series, startYear: filters.startYear, endYear: filters.endYear });
          const missing = series.filter(point => point.holidayAverage === null);
          status.textContent = "Showing " + series.length + (series.length === 1 ? " year: " : " years: ") + (series.length - missing.length) + " available, " + missing.length + " unavailable.";
          coverage.textContent = missing.length
            ? "Unavailable summaries: " + missing.map(point => point.year + " (" + point.reason + ")").join("; ") + ". Gaps are not zero observations."
            : "Daily averages use all calendar days in each group, including zero-observation days.";
        } catch (error) {
          if (disposed) return;
          if (currentRequest === requestId) status.textContent = "Unable to load holiday patterns: " + error.message + ". Change a filter to retry.";
        } finally {
          if (currentRequest === requestId) container.setAttribute("aria-busy", "false");
        }
      }
      unsubscribe = store.subscribe({ chartId: "t3" }, update);
      await update({ filters: store.getFilters("t3") });
    } catch (error) {
          if (disposed) return;
      status.textContent = "Unable to initialize holiday patterns: " + error.message;
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
