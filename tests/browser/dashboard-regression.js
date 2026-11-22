import { mountDashboard } from "/dashboard/dashboard.js";
import { createFilterStore } from "/filters/filter-store.js";
import * as data from "/api/info-loader.js";
import { loadTaxonNameMap } from "/api/taxon-converter.js";

const fixture = document.querySelector("#fixture");
const results = document.querySelector("#results");
const report = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(predicate) {
  const deadline = performance.now() + 20000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("Timed out waiting for a dashboard update");
    await settle();
  }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function trackedStore() {
  const store = createFilterStore(), subscribe = store.subscribe;
  let count = 0;
  store.subscribe = (options, callback) => {
    count++;
    let active = true;
    const off = subscribe(options, callback);
    return () => { if (active) { active = false; count--; off(); } };
  };
  return { store, count: () => count };
}
function checkOwnership(root) {
  const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
  assert(new Set(ids).size === ids.length, "Duplicate IDs");
  assert(root.querySelectorAll(".visualization-view").length === 6, "Expected six dashboard views");
  // The itinerary planner has no chart tooltip; the other five views each own one.
  assert(document.querySelectorAll('[role="tooltip"]').length === 5, "Leaked or missing tooltip portal");
}
function checkFitBounds(root) {
  assert(root.dataset.layout === "fit", "Expected fit layout");
  assert(document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
    "Page-level overflow in fit layout");
  for (const panel of root.querySelectorAll("[data-panel]")) {
    const box = panel.getBoundingClientRect();
    assert(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
      "Panel escaped fit layout: " + panel.dataset.panel);
  }
}

// Composition/lifecycle coverage from the older dashboard, adapted to the current
// fixed six-panel dashboard. Layout changes do not swap heatmap and UpSet views.
async function testCompositionAndLifecycle() {
  const [geography, taxa, topology] = await Promise.all([
    data.loadGeographicOptions(), loadTaxonNameMap(), d3.json("/data/counties-10m.json")
  ]);
  const tracked = trackedStore(), store = tracked.store, calls = [];
  let blockedHeatmap, lastHeatmap;
  const trackedData = Object.fromEntries(Object.entries(data).map(([name, fn]) => [name, async (...args) => {
    calls.push({ name, args });
    if (name === "loadSpeciesReportingFrequency" && blockedHeatmap) {
      const pending = blockedHeatmap; blockedHeatmap = null;
      return pending.promise;
    }
    const result = await fn(...args);
    if (name === "loadSpeciesReportingFrequency") lastHeatmap = result;
    return result;
  }]));
  trackedData.loadCountyGeometry = async () => topology;
  store.setShared({ stateCode: "US-MA", countyCode: "US-MA-017", taxonId: "avibase-4E74AE22" });
  const dashboard = mountDashboard({ container: fixture, store, data: trackedData, geography, taxa, d3, topojson });
  try {
    await dashboard.ready;
    await settle();
    const root = dashboard.root;
    const idle = () => !root.querySelector('[aria-busy="true"]');
    checkFitBounds(root); checkOwnership(root);
    assert(root.querySelectorAll('[data-dashboard-shared] .filter-header').length === 1, "Shared header duplicated");
    assert(root.querySelectorAll(".county").length === 14 && root.querySelectorAll(".county-bars__county").length === 14,
      "Statewide county data missing");
    assert(root.querySelectorAll(".observation-trends__line").length === 5, "Seasonal trends failed to render");
    const rankingCalls = calls.filter(call => call.name === "loadCountyRichness").length;
    root.querySelector('.county[data-county-code="US-MA-025"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert(store.getState().shared.countyCode === "US-MA-025", "Map keyboard selection did not reach store");
    assert(root.querySelector('.county-bars__county.is-selected')?.dataset.countyCode === "US-MA-025", "Map did not highlight bars");
    assert(root.querySelector('[data-search-for="shared.countyCode"]').value === "Suffolk County", "County search out of sync");
    assert(root.querySelectorAll(".county-bars__county").length === 14 && calls.filter(call => call.name === "loadCountyRichness").length === rankingCalls,
      "County selection filtered/refetched statewide comparison");
    root.querySelector('.county-bars__county[data-county-code="US-MA-017"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert(root.querySelector('.county.is-selected')?.dataset.countyCode === "US-MA-017", "Bars did not highlight map");
    await until(idle);

    const beforeLocal = calls.length;
    store.setChart("t2", { season: "winter" });
    await settle();
    assert(calls.length === beforeLocal, "Trend highlight unnecessarily reloaded data");
    assert(root.querySelector('.observation-trends__legend-item.is-selected').dataset.season === "winter", "Trend highlight did not update");
    const beforeSpecies = calls.length;
    store.setShared({ taxonId: "avibase-00AF5DA1" });
    await until(idle);
    assert(calls.length > beforeSpecies && calls.slice(beforeSpecies).every(call => ["loadSpeciesTrend", "loadHolidayObservations"].includes(call.name)),
      "Species affected heatmap/T1/itineraries or failed to update");
    const beforeYears = calls.length;
    store.setShared({ startYear: 2015 });
    await until(idle);
    assert(calls.length > beforeYears && calls.slice(beforeYears).every(call => ["loadSpeciesTrend", "loadHolidayObservations", "loadSpeciesReportingFrequency"].includes(call.name)),
      "Year changes affected fixed-coverage views or failed to update");
    store.setChart("t2Heatmap", { speciesCount: 20, sortOrder: "alpha" });
    await until(() => root.querySelectorAll(".species-heatmap__cell").length === 240);
    const body = root.querySelector(".visualization-heatmap__body");
    assert(body.scrollHeight > body.clientHeight, "Heatmap lacks internal row scrolling");
    const roots = [...root.querySelectorAll(".visualization-view")];
    const state = JSON.stringify(store.getState()), subscriptions = tracked.count();
    const overlays = document.querySelectorAll(".visualization-overlay").length;
    const layout = root.querySelector('[aria-label="Dashboard layout"]');
    for (let index = 0; index < 12; index++) {
      layout.value = index % 2 ? "fit" : "scroll";
      layout.dispatchEvent(new Event("change"));
      await settle();
      assert(root.dataset.layout === layout.value, "Layout control did not update");
      if (layout.value === "fit") checkFitBounds(root);
      checkOwnership(root);
      assert(roots.every(node => node.isConnected && root.contains(node)), "Layout remounted a view");
      assert(JSON.stringify(store.getState()) === state, "Layout changed filter selections");
      assert(tracked.count() === subscriptions && document.querySelectorAll(".visualization-overlay").length === overlays,
        "Layout leaked subscriptions or overlays");
    }
    assert(root.querySelector('[data-filter-path="charts.t2Heatmap.speciesCount"]').value === "20", "Heatmap controls not retained");
    const pending = deferred(); blockedHeatmap = pending;
    store.setChart("t2Heatmap", { speciesCount: 10 });
    dashboard.destroy(); dashboard.destroy();
    pending.resolve(lastHeatmap);
    await settle();
    assert(tracked.count() === 0 && !fixture.children.length && !document.querySelector('[role="tooltip"],.visualization-overlay,.filter-search-options'),
      "Pending heatmap or dashboard teardown leaked resources");
    report.push("Composition/lifecycle: fit bounds, six persistent views, linked county selection, seasonal highlight, shared-filter isolation, twelve layout toggles and pending heatmap cleanup passed");
  } finally { dashboard.destroy(); }

  for (const fail of [false, true]) {
    const pending = deferred(), other = trackedStore();
    const late = mountDashboard({ container: fixture, store: other.store,
      data: { ...trackedData, loadCountyGeometry: () => pending.promise }, geography, taxa, d3, topojson });
    late.destroy();
    if (fail) pending.reject(new Error("Expected pending geometry rejection")); else pending.resolve(topology);
    await late.ready; await settle();
    assert(other.count() === 0 && !fixture.children.length && !document.querySelector('[role="tooltip"],.visualization-overlay,.filter-search-options'),
      "Pending initialization survived dashboard destroy");
  }
  report.push("Pending geometry resolve/reject and repeated dashboard destruction passed");
}

async function testFrequencyAndItineraries() {
  const [geography, taxa] = await Promise.all([data.loadGeographicOptions(), loadTaxonNameMap()]);
  const store = createFilterStore();
  store.setShared({ stateCode: "US-MA", countyCode: "US-MA-017", taxonId: "avibase-1DA430B8" });
  const dashboard = mountDashboard({
    container: fixture, geography, taxa, store, d3, topojson,
    data: { ...data, loadCountyGeometry: () => d3.json("/data/counties-10m.json") }
  });
  const { root } = dashboard;
  const find = selector => root.querySelector(selector);
  try {
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
    assert(find(".itinerary-stop-list")?.children.length && find(".itinerary-result-details")?.getAttribute("aria-label") === "Itinerary details",
      "Itinerary details should render directly without expanding");
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
    report.push("Frequency and itineraries: monthly counts/tooltips, ranking, missing coverage, species isolation, month changes and county linking passed");
  } finally { dashboard.destroy(); }
}
async function run() {
  await testCompositionAndLifecycle();
  await testFrequencyAndItineraries();
  results.textContent = "PASS\n" + report.join("\n");
  document.title = "PASS — Dashboard regression checks";
}
run().catch(error => {
  results.textContent = "FAIL\n" + report.join("\n") + "\n" + error.stack;
  document.title = "FAIL — Dashboard regression checks";
  console.error(error);
});
