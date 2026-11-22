import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getFilterEntries, SHARED_FILTER_DEFINITIONS, CHART_FILTER_DEFINITIONS } from "../frontend/filters/filter-definitions.js";
import { createFilterStore } from "../frontend/filters/filter-store.js";

const url = relative => new URL(relative, import.meta.url);
const source = async relative => await readFile(url(relative), "utf8");

// The dashboard panel wiring in frontend/dashboard/dashboard.js.
const DASHBOARD_WIRING = [
  { panel: "map", chartId: "t1Map", view: "t1/county-choropleth-view.js" },
  { panel: "bars", chartId: "t1", view: "t1/county-richness-bar-view.js" },
  { panel: "trends", chartId: "t2", view: "t2/observation-trends-view.js" },
  { panel: "analysis", chartId: "t2Heatmap", view: "t2/seasonal-species-heatmap-view.js" },
  { panel: "holiday", chartId: "t3", view: "t3/holiday-observation-patterns-view.js" },
  { panel: "hotspots", chartId: null, view: "t4/hotspot-frequency-view.js" }
];

// Each standalone page and the dashboard view module it must share.
const PAGE_WIRING = [
  { page: "pages/county-choropleth.js", chartId: "t1Map", view: "t1/county-choropleth-view.js" },
  { page: "pages/county-richness-bar.js", chartId: "t1", view: "t1/county-richness-bar-view.js" },
  { page: "pages/observation-trends.js", chartId: "t2", view: "t2/observation-trends-view.js" },
  { page: "pages/seasonal-species-heatmap.js", chartId: "t2Heatmap", view: "t2/seasonal-species-heatmap-view.js" },
  { page: "pages/holiday-observation-patterns.js", chartId: "t3", view: "t3/holiday-observation-patterns-view.js" },
  { page: "pages/hotspot-frequency.js", chartId: "t4Frequency", view: "t4/hotspot-frequency-view.js" }
];

const SIX_DATA_FILTERS = ["t1Map", "t1", "t2", "t2Heatmap", "t3", "t4Frequency"];

test("every standalone page mounts the same view module and chart id as the dashboard", async () => {
  const dashboardSource = await source("../frontend/dashboard/dashboard.js");
  for (const { panel, chartId, view } of DASHBOARD_WIRING) {
    const panelCall = dashboardSource.match(new RegExp('mountPanel\\("' + panel + '", (\\w+)'));
    assert.ok(panelCall, "dashboard mounts panel " + panel);
    const importLine = dashboardSource.match(new RegExp('import \\{ (\\w+) \\} from "\\.\\./visualizations/' + view.replace(/\./g, "\\.") + '"'));
    assert.ok(importLine, "dashboard imports " + view);
    assert.equal(panelCall[1], importLine[1], "dashboard panel " + panel + " mounts the view it imports");
    if (chartId) assert.ok(dashboardSource.includes('"' + chartId + '"'), "dashboard wires " + panel + " to chart " + chartId);
  }
  for (const { page, chartId, view } of PAGE_WIRING) {
    const pageSource = await source("../frontend/" + page);
    const importLine = pageSource.match(new RegExp('import \\{ (\\w+) \\} from "\\.\\./visualizations/' + view.replace(/\./g, "\\.") + '"'));
    assert.ok(importLine, page + " imports the shared dashboard view " + view);
    assert.ok(pageSource.includes(importLine[1] + "("), page + " mounts the imported view");
    assert.ok(pageSource.includes('chartId: "' + chartId + '"'), page + " uses the dashboard chart id " + chartId);
  }
});

test("standalone T4 URLs share one itinerary initializer and its dashboard wiring", async () => {
  const shared = await source("../frontend/pages/hotspot-frequency.js");
  for (const alias of ["pages/location-combinations.js", "pages/hotspot-species-overlap.js"]) {
    assert.equal((await source("../frontend/" + alias)).trim(), 'import "./hotspot-frequency.js";',
      alias + " must delegate to the shared itinerary initializer");
  }
  assert.ok(shared.includes('from "../visualizations/t4/hotspot-frequency-view.js"'), "T4 page mounts the dashboard itinerary view");
  assert.ok(shared.includes("parseHotspotOverlapSelection"), "T4 page keeps the documented link restoration");
  const viewSource = await source("../frontend/visualizations/t4/hotspot-frequency-view.js");
  assert.ok(viewSource.includes('store.getFilters("t4")'), "itinerary view consumes charts.t4 filters");
  assert.ok(viewSource.includes('"shared.countyCode"') && viewSource.includes('"charts.t4.candidateLocationIds"'),
    "itinerary view subscribes to the same shared county and candidate keys in both contexts");
  // The standalone header chart id exposes exactly the shared filters the view consumes.
  const pageEntries = getFilterEntries({ chartId: "t4Frequency", scope: "all" });
  assert.deepEqual(pageEntries.filter(entry => entry.path.startsWith("shared.")).map(entry => entry.key), ["stateCode", "countyCode"]);
  assert.equal(pageEntries.filter(entry => !entry.path.startsWith("shared.")).length, 0,
    "t4Frequency adds no chart controls that the dashboard T4 panel lacks");
});

test("standalone headers and dashboard panels expose identical data filters per chart", () => {
  for (const chartId of SIX_DATA_FILTERS) {
    const pageEntries = getFilterEntries({ chartId, scope: "all" });
    const sharedEntries = getFilterEntries({ chartId, scope: "shared" });
    const chartEntries = getFilterEntries({ chartId, scope: "chart" });
    assert.deepEqual(pageEntries.map(entry => entry.path),
      [...sharedEntries, ...chartEntries].map(entry => entry.path),
      chartId + ": a standalone header shows exactly the shared and chart filters the dashboard supplies");
    for (const entry of pageEntries) {
      const definition = entry.path.startsWith("shared.")
        ? SHARED_FILTER_DEFINITIONS[entry.key]
        : CHART_FILTER_DEFINITIONS[chartId][entry.key];
      assert.equal(entry.definition, definition, chartId + "/" + entry.key + " uses the single frozen definition in both contexts");
    }
  }
});

test("standalone pages reuse the shared data loaders and add no duplicate logic", async () => {
  for (const { page } of PAGE_WIRING) {
    const pageSource = await source("../frontend/" + page);
    assert.ok(pageSource.includes('from "../api/info-loader.js"'), page + " uses the shared API loader module");
    assert.ok(!pageSource.includes("fetchAPI"), page + " must not duplicate network logic");
    assert.ok(!/from "[^"]*-data\.js"/.test(pageSource), page + " must not duplicate calculation modules");
    assert.ok(!pageSource.includes("stateCodes: ["), page + " must not narrow geographic coverage below the dashboard");
  }
});

test("both contexts read identical store defaults for the six tasks", () => {
  const store = createFilterStore();
  const shared = store.getState().shared;
  const sharedExpected = Object.fromEntries(Object.entries(SHARED_FILTER_DEFINITIONS).map(([key, definition]) => [key, definition.default]));
  assert.deepEqual({ ...shared }, sharedExpected);
  for (const chartId of SIX_DATA_FILTERS) {
    const expected = Object.fromEntries(getFilterEntries({ chartId }).map(entry => [entry.key, entry.definition.default]));
    assert.deepEqual({ ...store.getFilters(chartId) }, expected,
      chartId + " defaults come from the single shared definitions in both contexts");
  }
  assert.deepEqual(store.getYearBounds(), { min: 2012, max: 2025 });
});

test("view modules never dereference the compact-only controls slot outside a guard", async () => {
  // Regression: county-choropleth-view appended a Reset button to frame.controls
  // unconditionally, which is undefined in standalone presentation and crashed
  // county-choropleth.html during mount ("reading 'append'").
  const viewDirectory = "frontend/visualizations";
  const sources = [
    "t1/county-choropleth-view.js", "t1/county-richness-bar-view.js",
    "t2/observation-trends-view.js", "t2/seasonal-species-heatmap-view.js",
    "t3/holiday-observation-patterns-view.js",
    "t4/hotspot-frequency-view.js", "t4/location-combinations-view.js", "t4/hotspot-species-overlap-view.js"
  ];
  for (const file of sources) {
    const source = await readFile(url("../" + viewDirectory + "/" + file), "utf8");
    const unguarded = source
      .split(/\r?\n/)
      .filter(line => /frame\.controls\./.test(line))
      .filter(line => !/if \(frame\.controls\)[^.]*frame\.controls\./.test(line));
    assert.deepEqual(unguarded, [], file + " must guard every frame.controls dereference (controls is undefined in standalone presentation)");
  }
});
