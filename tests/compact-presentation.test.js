import test from "node:test";
import assert from "node:assert/strict";
import { sortCountyRichness } from "../frontend/visualizations/t1/county-richness-bar-data.js";
test("numeric richness sorting leaves its input records unchanged",()=>{
  const rows=[{region_code:"US-MA-001",county_name:"Alpha",species_richness:"5",observation_records:"12"},{region_code:"US-MA-003",county_name:"Beta",species_richness:"20",observation_records:"30"}];
  const original=structuredClone(rows);const sorted=sortCountyRichness(rows,"desc");
  assert.deepEqual(sorted.map(row=>row.speciesRichness),[20,5]);assert.deepEqual(rows,original);
});
