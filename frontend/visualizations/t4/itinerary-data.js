import { readReportingFrequency } from "../../helpers/reporting-frequency.js";

export function organizeHotspotFrequencies(rows) {
  const hotspots = new Map();
  for (const row of rows) {
    const complete = row.complete_checklists === null ? null : Number(row.complete_checklists);
    if (complete !== null && (!Number.isSafeInteger(complete) || complete <= 0)) {
      throw new Error("Invalid hotspot checklist total");
    }
    if (!hotspots.has(row.locality_id)) {
      hotspots.set(row.locality_id, { id: row.locality_id, name: row.locality_name, complete, rates: new Map(), reports: new Map() });
    }
    const hotspot = hotspots.get(row.locality_id);
    if (hotspot.complete !== complete) throw new Error("Inconsistent hotspot checklist totals");
    if (row.taxon_id === null && row.reporting_checklists === null) continue;
    const frequency = readReportingFrequency(row);
    if (!frequency || !row.taxon_id || hotspot.rates.has(row.taxon_id)) {
      throw new Error("Invalid or repeated hotspot species summary");
    }
    hotspot.rates.set(row.taxon_id, frequency.rate);
    hotspot.reports.set(row.taxon_id, frequency.reports);
  }
  return [...hotspots.values()];
}

export function rankItineraries(hotspots, stops) {
  if (!Number.isInteger(stops) || stops < 1) throw new Error("Invalid number of stops");
  const eligible = hotspots.filter(hotspot => hotspot.complete !== null);
  const results = [];
  function visit(start, selected, probabilities) {
    if (selected.length === stops) {
      const expectedSpecies = [...probabilities.values()].reduce((sum, value) => sum + value, 0);
      results.push({ hotspots: selected, expectedSpecies, key: selected.map(hotspot => hotspot.id).sort().join(",") });
      return;
    }
    for (let index = start; index <= eligible.length - (stops - selected.length); index++) {
      const hotspot = eligible[index];
      const next = new Map(probabilities);
      for (const [taxonId, rate] of hotspot.rates) {
        const previous = next.get(taxonId) ?? 0;
        next.set(taxonId, previous + (1 - previous) * rate);
      }
      visit(index + 1, [...selected, hotspot], next);
    }
  }
  visit(0, [], new Map());
  return results.sort((a, b) => b.expectedSpecies - a.expectedSpecies || a.key.localeCompare(b.key));
}

/** Return a recommendation for each budget by adding the greatest marginal gain at each step. */
export function recommendCountyItineraries(hotspots, maximumStops = 5) {
  const eligible = hotspots.filter(hotspot => hotspot.complete !== null);
  const remaining = [...eligible].sort((a, b) => a.id.localeCompare(b.id));
  const miss = new Map();
  const selected = [];
  const itineraries = [];
  let expectedSpecies = 0;
  while (selected.length < maximumStops && remaining.length) {
    let bestIndex = 0;
    let bestGain = -1;
    for (const [index, hotspot] of remaining.entries()) {
      let gain = 0;
      for (const [taxon, rate] of hotspot.rates) gain += (miss.get(taxon) ?? 1) * rate;
      if (gain > bestGain) {
        bestIndex = index;
        bestGain = gain;
      }
    }
    const [best] = remaining.splice(bestIndex, 1);
    for (const [taxon, rate] of best.rates) miss.set(taxon, (miss.get(taxon) ?? 1) * (1 - rate));
    const { id, name, complete } = best;
    const hotspot = { id, name, complete };
    selected.push(hotspot);
    expectedSpecies += bestGain;
    itineraries.push({ hotspots: [...selected], expectedSpecies });
  }
  return { totalHotspots: hotspots.length, eligibleHotspots: eligible.length, itineraries };
}

/** A species contributes its chance of being encountered at least once to the itinerary score. */
export function listItinerarySpecies(hotspots, taxa) {
  const ids = new Set(hotspots.flatMap(hotspot => [...hotspot.rates.keys()]));
  return [...ids].map(taxonId => {
    let probability = 0;
    const sites = hotspots.map(hotspot => {
      const rate = hotspot.rates.get(taxonId) ?? 0;
      probability += (1 - probability) * rate;
      return { name: hotspot.name, complete: hotspot.complete, reports: hotspot.reports.get(taxonId) ?? 0, rate };
    }).sort((a, b) => b.rate - a.rate || b.complete - a.complete || a.name.localeCompare(b.name));
    return { taxonId, name: taxa.get(taxonId) || taxonId, probability, sites };
  }).filter(species => species.probability > 0)
    .sort((a, b) => b.probability - a.probability || a.name.localeCompare(b.name) || a.taxonId.localeCompare(b.taxonId));
}
