import { readReportingFrequency } from "../../helpers/reporting-frequency.js";

export const MONTH_NAMES = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]);
const alphabetical = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Sort the API's already selected top-species cohort; never select alphabetically first. */
export function buildSpeciesHeatmap(rows, sortOrder = "total") {
  if (!["total", "alpha"].includes(sortOrder)) throw new Error("Invalid heatmap sort order");
  const species = new Map();
  for (const row of rows) {
    const month = Number(row.month);
    const total = Number(row.total_observation_records);
    const count = row.observation_records === null ? null : Number(row.observation_records);
    if (row.total_observation_records === null || row.total_observation_records === "" || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isSafeInteger(total) || total < 0 ||
        (count !== null && (row.observation_records === "" || !Number.isSafeInteger(count) || count < 0))) {
      throw new Error("Invalid heatmap observation metrics");
    }
    if (!species.has(row.taxon_id)) species.set(row.taxon_id, {
      taxonId: row.taxon_id, speciesName: row.species_name || row.taxon_id, total, cells: Array(12).fill(null)
    });
    const item = species.get(row.taxon_id);
    if (item.total !== total || item.cells[month - 1] !== null) throw new Error("Inconsistent or duplicate heatmap cells");
    item.cells[month - 1] = { taxonId: item.taxonId, speciesName: item.speciesName, month, observationRecords: count };
  }
  const result = [...species.values()];
  result.forEach(item => { item.cells = item.cells.map((cell, index) => cell || {
    taxonId: item.taxonId, speciesName: item.speciesName, month: index + 1, observationRecords: null
  }); });
  return result.sort((a, b) => {
    const byName = alphabetical.compare(a.speciesName, b.speciesName) || alphabetical.compare(a.taxonId, b.taxonId);
    return sortOrder === "alpha" ? byName : b.total - a.total || byName;
  });
}

/** Adapt frequency rows to the same cohort ordering and cell validation as the original heatmap. */
export function buildFrequencyHeatmap(rows, sortOrder) {
  const byTaxon = new Map();
  const ranked = buildSpeciesHeatmap(rows.map(row => {
    if (!byTaxon.has(row.taxon_id)) byTaxon.set(row.taxon_id, new Map());
    byTaxon.get(row.taxon_id).set(Number(row.month), readReportingFrequency(row));
    return { ...row, total_observation_records: row.total_reporting, observation_records: row.reporting_checklists };
  }), sortOrder);
  return ranked.map(item => ({
    ...item,
    cells: item.cells.map(({ observationRecords, ...cell }) => ({
      ...cell, frequency: byTaxon.get(item.taxonId).get(cell.month) ?? null
    }))
  }));
}
