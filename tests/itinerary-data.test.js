import test from "node:test";
import assert from "node:assert/strict";
import { organizeHotspotFrequencies, rankItineraries, recommendCountyItineraries, listItinerarySpecies } from "../frontend/visualizations/t4/itinerary-data.js";

test("itinerary ranking rewards complementary species and excludes hotspots with no eligible checklists", () => {
  const row = (site, taxon, count, total = 10) => ({
    locality_id: site, locality_name: site, taxon_id: taxon, reporting_checklists: count, complete_checklists: total
  });
  const hotspots = organizeHotspotFrequencies([
    row("A", "jay", 8), row("B", "jay", 7), row("C", "robin", 5), row("D", null, null, null)
  ]);
  const pairs = rankItineraries(hotspots, 2);
  assert.deepEqual(pairs.map(pair => pair.key), ["A,C", "B,C", "A,B"]);
  assert.ok(Math.abs(pairs[0].expectedSpecies - 1.3) < 1e-12);
  assert.ok(Math.abs(pairs[2].expectedSpecies - 0.94) < 1e-12);
  assert.deepEqual(rankItineraries(hotspots, 4), []);
  assert.throws(() => organizeHotspotFrequencies([row("A", "jay", 11)]));
});

test("county recommendations add the greatest marginal gain and return each available stop budget", () => {
  const makeHotspot = (id, complete, rates) => ({ id, name: id, complete, rates: new Map(rates) });
  const result = recommendCountyItineraries([
    makeHotspot("A", 100, [["jay", 0.9]]),
    makeHotspot("B", 100, [["jay", 0.8]]),
    makeHotspot("C", 100, [["robin", 0.6]]),
    makeHotspot("D", null, [])
  ]);
  assert.equal(result.totalHotspots, 4);
  assert.equal(result.eligibleHotspots, 3);
  assert.deepEqual(result.itineraries.map(plan => plan.hotspots.map(site => site.id)), [["A"], ["A", "C"], ["A", "C", "B"]]);
  assert.ok(Math.abs(result.itineraries[2].expectedSpecies - 1.58) < 1e-12);
  assert.equal(Object.hasOwn(result.itineraries[2].hotspots[0], "rates"), false);
});

test("species preview matches the itinerary score and preserves counts for both reported and unreported stops", () => {
  const hotspots = organizeHotspotFrequencies([
    { locality_id: "A", locality_name: "First stop", taxon_id: "jay", complete_checklists: "4", reporting_checklists: "2" },
    { locality_id: "B", locality_name: "Second stop", taxon_id: "jay", complete_checklists: "8", reporting_checklists: "2" },
    { locality_id: "B", locality_name: "Second stop", taxon_id: "robin", complete_checklists: "8", reporting_checklists: "1" }
  ]);
  const birds = listItinerarySpecies(hotspots, new Map([["jay", "Blue Jay"], ["robin", "American Robin"]]));
  assert.deepEqual(birds.map(bird => [bird.name, bird.probability]), [["Blue Jay", 0.625], ["American Robin", 0.125]]);
  assert.equal(birds.reduce((total, bird) => total + bird.probability, 0), rankItineraries(hotspots, 2)[0].expectedSpecies);
  assert.deepEqual(birds[0].sites[0], { name: "First stop", complete: 4, reports: 2, rate: 0.5 });
  assert.deepEqual(birds[1].sites[1], { name: "First stop", complete: 4, reports: 0, rate: 0 });
});
