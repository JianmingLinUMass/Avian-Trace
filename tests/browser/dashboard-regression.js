import { mountDashboard } from "/dashboard/dashboard.js";
import { createFilterStore } from "/filters/filter-store.js";
import * as data from "/api/info-loader.js";
import { loadTaxonNameMap } from "/api/taxon-converter.js";

const fixture = document.querySelector("#fixture");
const results = document.querySelector("#results");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function until(predicate) {
  const deadline = performance.now() + 12000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("Timed out waiting for a dashboard update");
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

async function run() {
  const [geography, taxa] = await Promise.all([data.loadGeographicOptions(), loadTaxonNameMap()]);
  const store = createFilterStore();
  store.setShared({ stateCode: "US-MA", countyCode: "US-MA-017", taxonId: "avibase-1DA430B8" });
  const dashboard = mountDashboard({
    container: fixture, geography, taxa, store, d3, topojson,
    data: { ...data, loadCountyGeometry: () => d3.json("/data/counties-10m.json") }
  });
  const { root } = dashboard;
  const find = selector => root.querySelector(selector);
  await dashboard.ready;
  assert(root.querySelectorAll(".visualization-view").length === 6, "Expected six dashboard views");
  assert(root.querySelectorAll("[data-dashboard-shared] .filter-header").length === 1, "Expected one shared header");
  const january = find('.species-heatmap__cell[data-taxon-id="avibase-1DA430B8"][data-month="1"]');
  assert(january?.getAttribute("aria-label").includes("52.1%, 17,512 / 33,583"), "Incorrect Blue Jay monthly frequency");
  january.focus();
  assert(document.querySelector('.species-heatmap__tooltip:not([hidden])')?.textContent.includes("17,512 / 33,583"), "Tooltip omitted counts");

  const stops = find('[data-role="itinerary-stops"]');
  stops.value = "2";
  stops.dispatchEvent(new Event("change"));
  const tripMonth = find('[data-role="frequency-month"]');
  tripMonth.value = "5";
  tripMonth.dispatchEvent(new Event("change"));
  store.setChart("t4", { candidateLocationIds: ["L1823657", "L12764246", "L453924", "L28385444"] });
  await until(() => find('[data-role="frequency-plot"] .itinerary-bars__row'));
  const hotspotRows = () => [...root.querySelectorAll('[data-role="frequency-plot"] .itinerary-bars__row')];
  assert(hotspotRows().length === 1 && hotspotRows()[0].querySelector(".itinerary-bars__value").textContent === "35.37", "Incorrect two-stop itinerary ranking");
  assert(hotspotRows()[0].getAttribute("aria-label").includes("Acton Arboretum") &&
    hotspotRows()[0].getAttribute("aria-label").includes("Alewife Brook Reservation"), "Incorrect best itinerary");
  assert(find(".itinerary-note").textContent.includes("Ada Govan Bird Sanctuary"), "Missing checklist coverage not disclosed");
  assert(!find(".itinerary-result-details").open, "Itinerary details should start collapsed");
  const originalTable = find('[data-role="frequency-plot"] .itinerary-bars');
  store.setShared({ taxonId: "avibase-4E74AE22" });
  assert(originalTable === find('[data-role="frequency-plot"] .itinerary-bars'), "Species filter must not change multi-species itineraries");
  assert(find('[data-role="frequency-status"]').textContent.includes("May · 2016–2025"), "Reference period missing");
  assert(find(".itinerary-stop-list").textContent.includes("215 complete checklists") &&
    find(".itinerary-stop-list").textContent.includes("396 complete checklists"), "Pooled denominators missing");
  tripMonth.value = "6";
  tripMonth.dispatchEvent(new Event("change"));
  await until(() => find('[data-role="frequency-status"]').textContent.includes("June · 2016–2025") && find('[data-role="frequency-plot"]').getAttribute("aria-busy") === "false");
  assert(hotspotRows()[0].querySelector(".itinerary-bars__value").textContent === "26.98", "June failed to use its own monthly summaries");

  find('.county[data-county-code="US-MA-025"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert(store.getState().shared.countyCode === "US-MA-025", "Selecting the map did not update the county");
  assert(find('[data-search-for="shared.countyCode"]').value === "Suffolk County", "County search did not synchronize");
  const suffolkBar = find('.county-bars__county[data-county-code="US-MA-025"]');
  assert(suffolkBar?.getAttribute("aria-pressed") === "true" &&
    suffolkBar.querySelector(".county-bars__name").textContent === "Suffolk County", "Map selection or complete bar label missing");
  assert(!hotspotRows().length && !store.getFilters("t4").candidateLocationIds.length, "County change retained old T4 selections");
  await until(() => find(".species-heatmap__cell"));
  find('.county-bars__county[data-county-code="US-MA-017"]').click();
  assert(find('.county[data-county-code="US-MA-017"]').getAttribute("aria-pressed") === "true" &&
    find('[data-search-for="shared.countyCode"]').value === "Middlesex County", "Bar selection did not update the map and county search");

  dashboard.destroy();
  dashboard.destroy();
  assert(!fixture.children.length && !document.querySelector(".visualization-overlay,.filter-search-options"), "Dashboard resources leaked");
  results.textContent = "PASS — monthly counts, itinerary ranking, missing data, species isolation, trip month changes and county linking";
  document.title = "PASS — Dashboard regression checks";
}
run().catch(error => {
  results.textContent = "FAIL\n" + error.stack;
  document.title = "FAIL — Dashboard regression checks";
  console.error(error);
});
