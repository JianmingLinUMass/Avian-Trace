import test from "node:test";
import assert from "node:assert/strict";
import { DuckDBInstance } from "@duckdb/node-api";
import { SEASONAL_SPECIES_TREND_SQL, getTrendMonths, validateSeasonalTrend } from "../backend/species-trend-query.js";
import { buildYearlyTrendSeries, loadSeasonalTrendSeries, TREND_DEFINITIONS } from "../frontend/visualizations/t2/observation-trends-data.js";
import { createFilterStore } from "../frontend/filters/filter-store.js";
import { getFilterEntries } from "../frontend/filters/filter-definitions.js";

test("monthly aggregation covers every approved season, with zeros only for processed years", async () => {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  try {
    await con.run(`
      CREATE TABLE taxa(taxon_id VARCHAR, category VARCHAR);
      INSERT INTO taxa VALUES ('a','species'),('b','species'),('c','issf');
      CREATE TABLE states(state_code VARCHAR);
      INSERT INTO states VALUES ('US-MA'),('US-NY');
      CREATE TABLE counties(county_code VARCHAR);
      INSERT INTO counties VALUES ('US-MA-017'),('US-NY-061');
      CREATE TABLE summary_completed_years(year INTEGER PRIMARY KEY);
      INSERT INTO summary_completed_years VALUES (2012),(2013),(2015);
      CREATE TABLE species_region_month(year INTEGER,month INTEGER,region_level VARCHAR,region_code VARCHAR,taxon_id VARCHAR,observation_rows BIGINT);
      INSERT INTO species_region_month
        SELECT 2012,month,'state','US-MA','a',month FROM range(1,13) months(month);
      INSERT INTO species_region_month VALUES
        (2011,12,'state','US-MA','a',999),
        (2013,1,'state','US-MA','a',10),
        (2014,3,'state','US-MA','a',99),
        (2012,3,'county','US-MA-017','a',100),
        (2012,4,'county','US-MA-017','a',200),
        (2012,12,'county','US-MA-017','a',400),
        (2012,3,'state','US-MA','b',900),
        (2012,3,'state','US-MA','c',1000),
        (2012,3,'state','US-NY','a',50);
    `);
    const read = async (season, region = "US-MA", level = "state", taxon = "a", start = 2012, end = 2015) =>
      (await con.runAndReadAll(SEASONAL_SPECIES_TREND_SQL, [region, level, taxon, start, end, getTrendMonths(season).join(",")])).getRowObjectsJson();
    for (const [season, expected] of [["all", 78], ["spring", 12], ["summer", 21], ["fall", 30], ["winter", 15]]) {
      const rows = await read(season);
      assert.deepEqual(rows.map(row => Number(row.year)), [2012, 2013, 2014, 2015]);
      assert.equal(Number(rows[0].observation_records), expected, season);
      assert.equal(rows[0].summary_available, true);
      assert.equal(typeof rows[0].year, "number");
      assert.equal(rows[2].observation_records, null); // Partial rows without a completion marker are unavailable.
      assert.equal(rows[2].summary_available, false);
      assert.equal(Number(rows[3].observation_records), 0); // Processed, no species records.
    }
    assert.equal(Number((await read("all", "US-MA-017", "county"))[0].observation_records), 700);
    assert.equal(Number((await read("spring", "US-MA-017", "county"))[0].observation_records), 300);
    assert.equal(Number((await read("winter", "US-MA-017", "county"))[0].observation_records), 400);
    assert.equal(Number((await read("spring", "US-NY", "state"))[0].observation_records), 50);
    assert.equal(Number((await read("all", "US-MA", "state", "b"))[0].observation_records), 900);
    assert.deepEqual(await read("all", "US-MA", "state", "c"), []);
    assert.deepEqual(await read("all", "US-ZZ", "state"), []);
    assert.deepEqual(await read("all", "US-MA", "state", "unknown"), []);
    const oneYear = await read("spring", "US-MA", "state", "a", 2013, 2013);
    assert.equal(oneYear.length, 1);
    assert.equal(Number(oneYear[0].observation_records), 0);
  } finally {
    con.closeSync();
    instance.closeSync();
  }
});

test("season and region validation reject unsupported or partial-year requests", () => {
  assert.deepEqual(getTrendMonths("winter"), [12, 1, 2]);
  assert.equal(getTrendMonths("all").length, 12);
  assert.throws(() => getTrendMonths("monsoon"), /Invalid season/);
  assert.throws(() => getTrendMonths(""), /Invalid season/);
  validateSeasonalTrend("US-MA", "state", 2012, 2025);
  validateSeasonalTrend("US-MA-017", "county", 2025, 2025);
  for (const args of [["US-MA-017", "state", 2012, 2025], ["US-MA", "county", 2012, 2025],
    ["MA", "state", 2012, 2025], ["US-MA", "state", 2025, 2012],
    ["US-MA", "state", 2012, 2026], ["US-MA", "state", 2011, 2025]]) {
    assert.throws(() => validateSeasonalTrend(...args), /Invalid/);
  }
});

test("yearly series preserves explicit zeros and leaves omitted/unavailable years as gaps", () => {
  const rows = [
    { year: 2022, observation_records: "7", summary_available: true },
    { year: 2019, observation_records: null, summary_available: false },
    { year: 2020, observation_records: "0", summary_available: true }
  ];
  const original = structuredClone(rows);
  assert.deepEqual(buildYearlyTrendSeries(rows, 2019, 2022), [
    { year: 2019, observationRecords: null }, { year: 2020, observationRecords: 0 },
    { year: 2021, observationRecords: null }, { year: 2022, observationRecords: 7 }
  ]);
  assert.deepEqual(rows, original);
  assert.deepEqual(buildYearlyTrendSeries([{ year: 2025, observation_records: "0", summary_available: true }], 2025, 2025), [{ year: 2025, observationRecords: 0 }]);
});

test("series validation rejects duplicate years, out-of-range years, and invalid counts", () => {
  assert.throws(() => buildYearlyTrendSeries([{year:2020,observation_records:1},{year:2020,observation_records:2}],2020,2021), /duplicate/);
  assert.throws(() => buildYearlyTrendSeries([{year:2019,observation_records:1}],2020,2021), /Invalid/);
  for (const value of ["",undefined,-1,1.5,"unknown",Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => buildYearlyTrendSeries([{year:2020,observation_records:value}],2020,2020), /Invalid/);
  }
  assert.throws(() => buildYearlyTrendSeries([],2025,2012), /Invalid/);
});

test("T2 standalone filters retain single species and isolate season from other visualizations", () => {
  assert.deepEqual(getFilterEntries({chartId:"t2"}).map(entry=>entry.path), [
    "shared.stateCode","shared.countyCode","shared.taxonId","shared.startYear","shared.endYear","charts.t2.season"
  ]);
  const store=createFilterStore();
  const trendEvents=[];
  const otherEvents=[];
  store.subscribe({chartId:"t2"},event=>trendEvents.push(event));
  store.subscribe({chartId:"t3"},event=>otherEvents.push(event));
  store.setShared({stateCode:"US-MA",taxonId:"a",startYear:2020,endYear:2025});
  store.setChart("t2",{season:"winter"});
  assert.equal(trendEvents.length,2);
  assert.equal(otherEvents.length,1);
  assert.equal(store.getFilters("t2").taxonId,"a");
  assert.throws(()=>store.setShared({taxonId:["a","b"]}),/Invalid/);
});


test("all five seasonal series use existing queries, permanent colors and independent gaps", async () => {
  const calls = [];
  const filters = { stateCode: "US-MA", countyCode: "US-MA-017", taxonId: "a", startYear: 2024, endYear: 2025, season: "winter" };
  const trends = await loadSeasonalTrendSeries(async (...args) => {
    calls.push(args);
    return [{ year: 2024, observation_records: args[5] === "winter" ? "0" : "12", summary_available: true }];
  }, filters);
  assert.deepEqual(trends.map(trend => trend.id), ["all", "spring", "summer", "fall", "winter"]);
  assert.deepEqual(trends.map(trend => trend.color), ["#E67E22", "#2E8B57", "#D4AC0D", "#D64545", "#3498DB"]);
  assert.deepEqual(calls, TREND_DEFINITIONS.map(trend => ["US-MA-017", "county", "a", 2024, 2025, trend.id]));
  assert.equal(trends[4].series[0].observationRecords, 0);
  assert.ok(trends.every(trend => trend.series[1].observationRecords === null));
  calls.length = 0;
  await loadSeasonalTrendSeries(async (...args) => { calls.push(args); return []; }, { ...filters, countyCode: null });
  assert.ok(calls.every(args => args[0] === "US-MA" && args[1] === "state"));
  assert.deepEqual(await loadSeasonalTrendSeries(async () => [], filters), []);
  await assert.rejects(loadSeasonalTrendSeries(async () => { throw new Error("Unavailable"); }, filters), /Unavailable/);
  assert.equal(getFilterEntries({chartId: "t2"}).find(entry => entry.key === "season").definition.control, null);
});
