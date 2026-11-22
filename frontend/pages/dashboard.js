import { createFilterStore } from "../filters/filter-store.js";
import * as api from "../api/info-loader.js";
import { loadTaxonNameMap } from "../api/taxon-converter.js";
import { mountDashboard } from "../dashboard/dashboard.js";

const container = document.querySelector("#dashboard");
const store = createFilterStore();
let disposed = false, dashboard;
async function initialize() {
  try {
    const [geography, taxa] = await Promise.all([api.loadGeographicOptions(), loadTaxonNameMap()]);
    if (disposed) return;
    const hasRegion = (level, code) => geography.some(row => row.region_level === level && row.region_code === code);
    const stateCode = hasRegion("state", "US-MA") ? "US-MA" : null;
    store.setShared({
      stateCode,
      countyCode: stateCode && hasRegion("county", "US-MA-017") ? "US-MA-017" : null,
      taxonId: taxa.has("avibase-1DA430B8") ? "avibase-1DA430B8" : null
    });
    let geometry;
    const data = { ...api, loadCountyGeometry: () => geometry ??= d3.json("/data/counties-10m.json") };
    container.replaceChildren();
    dashboard = mountDashboard({ container, store, data, geography, taxa, d3, topojson, initialCountyScope: true });
    await dashboard.ready;
  } catch (error) {
    if (!disposed) { dashboard?.destroy(); container.textContent = "Unable to initialize dashboard: " + error.message + ". Reload to retry."; }
  }
}
initialize();
window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  disposed = true; dashboard?.destroy();
});
