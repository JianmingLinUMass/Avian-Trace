import test from "node:test";
import assert from "node:assert/strict";
import { createFilterStore } from "../frontend/filters/filter-store.js";
import { CHART_FILTER_DEFINITIONS, TASK_DEFINITIONS, getFilterEntries } from "../frontend/filters/filter-definitions.js";

function watch(store, chartId) {
  const events = [];
  const unsubscribe = store.subscribe({ chartId }, event => events.push(event));
  return { events, unsubscribe };
}

test("approved defaults keep shared and local filters separate", () => {
  const state = createFilterStore().getState();
  assert.deepEqual(state.shared, { stateCode: null, countyCode: null, taxonId: null, startYear: 2012, endYear: 2025 });
  assert.deepEqual(state.charts, { t1Map: {}, t1: { sortOrder: "desc" }, t2: { season: "all" }, t2Heatmap: { speciesCount: 15, sortOrder: "total" }, t3: {}, t4UpSet: {}, t4Frequency: {}, t4: { candidateLocationIds: [], selectedCombinationIds: [], numberOfLocations: 3, sortOrder: "desc" } });
  assert.deepEqual(CHART_FILTER_DEFINITIONS.t2.season.options.map(({ value, months }) => [value, months]), [
    ["all", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]], ["spring", [3, 4, 5]],
    ["summer", [6, 7, 8]], ["fall", [9, 10, 11]], ["winter", [12, 1, 2]]
  ]);
});

test("shared species and years notify T2/T3 once, without notifying T1/T4", () => {
  const store = createFilterStore();
  const tasks = Object.fromEntries(["t1", "t2", "t3", "t4"].map(id => [id, watch(store, id)]));
  store.setShared({ taxonId: "avibase-4E74AE22", startYear: 2015, endYear: 2020 });
  assert.deepEqual(Object.values(tasks).map(task => task.events.length), [0, 1, 1, 0]);
  assert.deepEqual(tasks.t2.events[0].changedKeys, ["shared.taxonId", "shared.startYear", "shared.endYear"]);
  assert.equal(tasks.t3.events[0].filters.taxonId, "avibase-4E74AE22");
});

test("season, location counts, and sorting notify only the owning task", () => {
  const store = createFilterStore();
  const tasks = ["t1", "t2", "t3", "t4"].map(id => watch(store, id));
  store.setChart("t2", { season: "winter" });
  store.setChart("t4", { numberOfLocations: 5, sortOrder: "alpha" });
  store.setChart("t1", { sortOrder: "asc" });
  assert.deepEqual(tasks.map(task => task.events.length), [1, 1, 0, 1]);
  assert.equal(store.getFilters("t1").sortOrder, "asc");
  assert.equal(store.getFilters("t4").sortOrder, "alpha");
});

test("T1 county selection retains the statewide comparison", () => {
  const store = createFilterStore();
  store.setShared({ stateCode: "US-MA" });
  const task = watch(store, "t1");
  store.setShared({ countyCode: "US-MA-017" });
  assert.equal(task.events[0].filters.stateCode, "US-MA");
  assert.equal(task.events[0].filters.countyCode, "US-MA-017");
  assert.equal(TASK_DEFINITIONS.t1.filterRoles.countyCode, "highlight");
  store.setShared({ countyCode: null });
  assert.equal(store.getFilters("t1").stateCode, "US-MA");
});

test("state changes clear county atomically or accept a compatible county", () => {
  const store = createFilterStore();
  store.setShared({ stateCode: "US-MA", countyCode: "US-MA-017" });
  const task = watch(store, "t3");
  store.setShared({ stateCode: "US-NY" });
  assert.equal(task.events.length, 1);
  assert.deepEqual(task.events[0].changedKeys, ["shared.stateCode", "shared.countyCode"]);
  assert.equal(task.events[0].filters.countyCode, null);
  store.setShared({ stateCode: "US-MA", countyCode: "US-MA-025" });
  assert.equal(store.getState().shared.countyCode, "US-MA-025");
  store.setShared({ stateCode: null });
  assert.equal(store.getState().shared.countyCode, null);
});

test("invalid updates leave state and subscribers untouched", () => {
  const store = createFilterStore();
  const task = watch(store, "t2");
  const before = store.getState();
  const invalid = [
    () => store.setShared({ stateCode: "MA" }),
    () => store.setShared({ countyCode: "US-MA-017" }),
    () => store.setShared({ stateCode: "US-NY", countyCode: "US-MA-017" }),
    () => store.setShared({ stateCode: "US-MA", startYear: 2024, endYear: 2020 }),
    () => store.setShared({ startYear: "2015" }),
    () => store.setShared({ startYear: 2011 }),
    () => store.setShared({ endYear: 2026 }),
    () => store.setShared({ endYear: NaN }),
    () => store.setShared({ season: "spring" }),
    () => store.setShared({ taxonId: " " }),
    () => store.setShared(null),
    () => store.setChart("t2", { season: "monsoon" }),
    () => store.setChart("t1", { sortOrder: "random" }),
    () => store.setChart("t3", { season: "spring" }),
    () => store.setChart("missing", {}),
    ...[2, 6, 3.5, "3", null].map(value => () => store.setChart("t4", { numberOfLocations: value }))
  ];
  invalid.forEach(update => {
    assert.throws(update);
    assert.deepEqual(store.getState(), before);
  });
  assert.equal(task.events.length, 0);
});

test("T4 accepts numeric 3/4/5 and both tasks accept all sorting modes", () => {
  const store = createFilterStore();
  for (const count of [3, 4, 5]) {
    store.setChart("t4", { numberOfLocations: count });
    assert.equal(store.getFilters("t4").numberOfLocations, count);
  }
  for (const id of ["t1", "t4"]) {
    for (const sortOrder of ["alpha", "asc", "desc"]) {
      store.setChart(id, { sortOrder });
      assert.equal(store.getFilters(id).sortOrder, sortOrder);
    }
  }
});

test("unchanged patches are silent and unsubscribe is idempotent", () => {
  const store = createFilterStore();
  const task = watch(store, "t2");
  store.setShared({ startYear: 2012 });
  store.setShared({});
  store.setChart("t2", { season: "all" });
  assert.equal(task.events.length, 0);
  store.setChart("t2", { season: "spring" });
  task.unsubscribe();
  task.unsubscribe();
  store.setChart("t2", { season: "summer" });
  assert.equal(task.events.length, 1);
});

test("snapshots, definitions, and callback values cannot mutate stored state", () => {
  const store = createFilterStore();
  assert.throws(() => { store.getState().shared.stateCode = "US-NY"; }, TypeError);
  assert.throws(() => { store.getFilters("t4").numberOfLocations = 4; }, TypeError);
  assert.throws(() => { CHART_FILTER_DEFINITIONS.t2.season.options[0].months.push(13); }, TypeError);
  let event;
  store.subscribe({ chartId: "t2" }, value => { event = value; });
  store.setChart("t2", { season: "winter" });
  assert.throws(() => { event.filters.season = "all"; }, TypeError);
  assert.equal(store.getFilters("t2").season, "winter");
});

test("explicit subscriptions ignore unrelated keys and copy input key arrays", () => {
  const store = createFilterStore();
  const keys = ["shared.taxonId"];
  const events = [];
  store.subscribe({ keys }, event => events.push(event));
  keys.push("shared.startYear");
  store.setShared({ startYear: 2015 });
  assert.equal(events.length, 0);
  store.setShared({ taxonId: "avibase-4E74AE22" });
  assert.deepEqual(events[0].filters, { "shared.taxonId": "avibase-4E74AE22" });
  assert.throws(() => store.subscribe({ keys: ["shared.season"] }, () => {}));
  assert.throws(() => store.subscribe({ chartId: "t2", keys: [] }, () => {}));
  assert.throws(() => store.subscribe({ chartId: "unknown" }, () => {}));
});

test("separate standalone stores are independent; subscribers on one store share values", () => {
  const first = createFilterStore();
  const second = createFilterStore();
  first.setShared({ stateCode: "US-MA" });
  assert.equal(second.getState().shared.stateCode, null);
  assert.equal(first.getFilters("t1").stateCode, first.getFilters("t4").stateCode);
});

test("header scopes compose without duplicating or omitting controls", () => {
  for (const chartId of ["t1", "t2", "t3", "t4"]) {
    const all = getFilterEntries({ chartId });
    const shared = getFilterEntries({ chartId, scope: "shared" });
    const local = getFilterEntries({ chartId, scope: "chart" });
    assert.deepEqual(all, [...shared, ...local]);
    assert.equal(new Set(all.map(entry => entry.path)).size, all.length);
  }
  assert.equal(getFilterEntries({ scope: "shared" }).length, 5);
  assert.deepEqual(getFilterEntries({ chartId: "t3", scope: "chart" }), []);
  assert.throws(() => getFilterEntries({ chartId: "unknown" }));
  assert.throws(() => getFilterEntries({ scope: "chart" }));
});

test("year bounds configure both initial range and validation", () => {
  const store = createFilterStore({ yearBounds: { min: 2014, max: 2026 } });
  assert.deepEqual(store.getYearBounds(), { min: 2014, max: 2026 });
  assert.equal(store.getState().shared.startYear, 2014);
  store.setShared({ startYear: 2026, endYear: 2026 });
  assert.throws(() => store.setShared({ startYear: 2013 }));
  assert.throws(() => createFilterStore({ yearBounds: { min: 2025, max: 2012 } }));
});

test("nested updates preserve transaction order and subscription snapshots", () => {
  const store = createFilterStore();
  const seen = [];
  store.subscribe({ chartId: "t2" }, ({ filters }) => {
    if (filters.season === "spring") store.setChart("t2", { season: "summer" });
  });
  store.subscribe({ chartId: "t2" }, ({ filters }) => seen.push(filters.season));
  store.setChart("t2", { season: "spring" });
  assert.deepEqual(seen, ["spring", "summer"]);
});

test("a failing subscriber does not prevent others from observing committed state", () => {
  const store = createFilterStore();
  store.subscribe({ chartId: "t2" }, () => { throw new Error("Chart failed"); });
  const task = watch(store, "t2");
  assert.throws(() => store.setChart("t2", { season: "fall" }), AggregateError);
  assert.equal(task.events.length, 1);
  assert.equal(store.getFilters("t2").season, "fall");
});
