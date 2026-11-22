import test from "node:test";
import assert from "node:assert/strict";
import { sortCountyRichness } from "../frontend/visualizations/t1/county-richness-bar-data.js";
import { createFilterStore } from "../frontend/filters/filter-store.js";
import { getFilterEntries } from "../frontend/filters/filter-definitions.js";

const rows = [
  { region_code: "US-MA-003", county_name: "Zulu County", species_richness: "9", observation_records: "100" },
  { region_code: "US-MA-001", county_name: "Alpha County", species_richness: "100", observation_records: "2300" },
  { region_code: "US-MA-007", county_name: "Beta County", species_richness: "9", observation_records: "20" },
  { region_code: "US-MA-005", county_name: "Empty County", species_richness: "0", observation_records: "0" }
];

test("default descending sorts numeric richness while preserving all metrics and input rows", () => {
  const original = structuredClone(rows);
  const result = sortCountyRichness(rows);
  assert.deepEqual(result.map(row => row.speciesRichness), [100, 9, 9, 0]);
  assert.deepEqual(result.map(row => row.countyName), ["Alpha County", "Beta County", "Zulu County", "Empty County"]);
  assert.equal(result[0].observationRecords, 2300);
  assert.equal(result[3].observationRecords, 0);
  assert.deepEqual(rows, original);
});

test("alphabetical and ascending modes use deterministic alphabetical tie breaks", () => {
  assert.deepEqual(sortCountyRichness(rows, "alpha").map(row => row.countyName), ["Alpha County", "Beta County", "Empty County", "Zulu County"]);
  assert.deepEqual(sortCountyRichness(rows, "asc").map(row => row.speciesRichness), [0, 9, 9, 100]);
  assert.equal(sortCountyRichness(rows, "asc")[1].countyName, "Beta County");
  assert.throws(() => sortCountyRichness(rows, "random"), /Invalid sort/);
});

test("all endpoint rows survive independently of polygon availability or duplicate names", () => {
  const extra = [
    { region_code: "US-AK-063", county_name: "Chugach Census Area", species_richness: "301", observation_records: "201616" },
    { region_code: "US-HI-010", county_name: null, species_richness: "2", observation_records: "3" },
    { region_code: "US-MA-009", county_name: "Alpha County", species_richness: "100", observation_records: "4" }
  ];
  const result = sortCountyRichness([...rows, ...extra]);
  assert.equal(result.length, 7);
  assert.ok(result.some(row => row.regionCode === "US-AK-063"));
  assert.equal(result.find(row => row.regionCode === "US-HI-010").countyName, "US-HI-010");
  assert.deepEqual(result.filter(row => row.countyName === "Alpha County").map(row => row.regionCode), ["US-MA-001", "US-MA-009"]);
});

test("unavailable and invalid counts cannot silently become recorded zeros", () => {
  for (const value of [null, "", undefined, "unknown", -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => sortCountyRichness([{ ...rows[0], species_richness: value }]), /Invalid county/);
    assert.throws(() => sortCountyRichness([{ ...rows[0], observation_records: value }]), /Invalid county/);
  }
});

test("existing standalone t1 filters retain descending default and isolate local sorting", () => {
  const store = createFilterStore();
  assert.equal(store.getFilters("t1").sortOrder, "desc");
  assert.deepEqual(getFilterEntries({ chartId: "t1" }).map(entry => entry.path), ["shared.stateCode", "shared.countyCode", "charts.t1.sortOrder"]);
  const barEvents = [];
  const mapEvents = [];
  store.subscribe({ chartId: "t1" }, event => barEvents.push(event));
  store.subscribe({ chartId: "t1Map" }, event => mapEvents.push(event));
  store.setShared({ stateCode: "US-MA", countyCode: "US-MA-017" });
  store.setChart("t1", { sortOrder: "alpha" });
  assert.equal(barEvents.length, 2);
  assert.equal(mapEvents.length, 1);
  assert.equal(store.getFilters("t1").stateCode, "US-MA");
  assert.equal(store.getFilters("t1").countyCode, "US-MA-017");
});
