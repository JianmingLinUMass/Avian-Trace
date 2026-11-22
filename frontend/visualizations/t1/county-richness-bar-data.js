const nameOrder = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Convert API counts without changing their meaning; retain every returned county. */
export function sortCountyRichness(rows, sortOrder = "desc") {
  if (!["alpha", "asc", "desc"].includes(sortOrder)) throw new Error("Invalid sort order");
  const counties = rows.map(row => {
    const speciesRichness = Number(row.species_richness);
    const observationRecords = Number(row.observation_records);
    if (row.species_richness === null || row.species_richness === "" ||
        row.observation_records === null || row.observation_records === "" ||
        !Number.isSafeInteger(speciesRichness) || speciesRichness < 0 ||
        !Number.isSafeInteger(observationRecords) || observationRecords < 0) {
      throw new Error("Invalid county observation metrics");
    }
    return {
      regionCode: row.region_code,
      countyName: row.county_name || row.region_code,
      speciesRichness,
      observationRecords
    };
  });
  return counties.sort((a, b) => {
    const alphabetical = nameOrder.compare(a.countyName, b.countyName) || nameOrder.compare(a.regionCode, b.regionCode);
    if (sortOrder === "alpha") return alphabetical;
    const difference = a.speciesRichness - b.speciesRichness;
    return (sortOrder === "asc" ? difference : -difference) || alphabetical;
  });
}
