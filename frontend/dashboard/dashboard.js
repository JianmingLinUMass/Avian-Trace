import { createFilterHeader } from "../components/filter-header.js";
import { createFilterOptions } from "../helpers/filter-options.js";
import { STATE_ABBREVIATIONS } from "../helpers/geographic-codes.js";
import { mountCountyChoropleth } from "../visualizations/t1/county-choropleth-view.js";
import { mountCountyRichnessBar } from "../visualizations/t1/county-richness-bar-view.js";
import { mountObservationTrends } from "../visualizations/t2/observation-trends-view.js";
import { mountHolidayObservationPatterns } from "../visualizations/t3/holiday-observation-patterns-view.js";
import { mountHotspotFrequency } from "../visualizations/t4/hotspot-frequency-view.js";
import { mountSeasonalSpeciesHeatmap } from "../visualizations/t2/seasonal-species-heatmap-view.js";

/** Composition owns headers and panel lifetimes; all rendering belongs to existing views. */
export function mountDashboard({ container, store, data, geography, taxa, d3, topojson, initialCountyScope = false }) {
  const document = container.ownerDocument;
  const root = document.createElement("div");
  root.className = "dashboard-shell";
  root.dataset.layout = "fit";
  root.innerHTML = `
    <header class="dashboard-header">
      <div class="dashboard-brand">
        <h1>Avian Trace</h1>
        <span class="dashboard-subtitle"></span>
        <p class="dashboard-guidance">Select a county on the map to explore.</p>
        <label class="dashboard-layout">Layout
          <select aria-label="Dashboard layout">
            <option value="fit">Fit to screen</option>
            <option value="scroll">Scroll for detail</option>
          </select>
        </label>
      </div>
      <div data-dashboard-shared aria-label="Shared dashboard filters"></div>
    </header>
    <div class="dashboard-grid">
      <div class="dashboard-row dashboard-row--geography">
        <section class="dashboard-panel" data-panel="map" aria-label="T1 County Choropleth"></section>
        <section class="dashboard-panel" data-panel="bars" aria-label="T1 County Richness Bar Chart"></section>
      </div>
      <div class="dashboard-row dashboard-row--trends">
        <section class="dashboard-panel" data-panel="trends" aria-label="T2 Observation Trends"></section>
        <section class="dashboard-panel" data-panel="holiday" aria-label="T3 Holiday Observation Patterns"></section>
      </div>
      <div class="dashboard-row dashboard-row--coverage">
        <section class="dashboard-panel" data-panel="analysis" aria-label="Seasonal species analysis"></section>
        <section class="dashboard-panel" data-panel="hotspots" aria-label="T4 Birding Itinerary Planner"></section>
      </div>
    </div>`;
  container.append(root);
  const layoutControl = root.querySelector(".dashboard-layout select");
  function changeLayout() { root.dataset.layout = layoutControl.value; }
  layoutControl.addEventListener("change", changeLayout);
  const filterOptions = createFilterOptions(geography, taxa, {
    stateCodes: Object.values(STATE_ABBREVIATIONS).map(code => "US-" + code)
  });
  const states = filterOptions.stateCode;
  root.querySelector(".dashboard-subtitle").textContent = states.length === 1
    ? "Data coverage: " + states[0].label
    : states.length ? "Data coverage: " + states.length + " states" : "No state data available";
  const sharedHeader = createFilterHeader({
    container: root.querySelector("[data-dashboard-shared]"), store, scope: "shared",
    options: filterOptions
  });
  const dependencies = { store, data, geography, taxa, d3, topojson, presentation: "compact" };
  const panels = [];
  let disposed = false;

  function mountPanel(name, mount, chartId, options = {}) {
    const host = root.querySelector('[data-panel="' + name + '"]');
    const view = mount({ ...dependencies, container: host, ...options });
    const header = chartId ? createFilterHeader({ container: view.controls, store, chartId, scope: "chart" }) : null;
    panels.push({ ready: view.ready, destroy() { header?.destroy(); view.destroy(); } });
  }
  mountPanel("map", mountCountyChoropleth, "t1Map");
  mountPanel("bars", mountCountyRichnessBar, "t1");
  mountPanel("trends", mountObservationTrends, "t2");
  mountPanel("holiday", mountHolidayObservationPatterns, "t3");
  mountPanel("analysis", mountSeasonalSpeciesHeatmap, "t2Heatmap");
  mountPanel("hotspots", mountHotspotFrequency, null, { initialCountyScope });
  return {
    root, ready: Promise.all(panels.map(panel => panel.ready)),
    destroy() {
      if (disposed) return;
      disposed = true;
      layoutControl.removeEventListener("change", changeLayout);
      panels.forEach(panel => panel.destroy());
      sharedHeader.destroy();
      root.remove();
    }
  };
}
