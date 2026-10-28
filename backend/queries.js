import { query } from "./database.js";

// Summary card: recorded species + observation records
export function getRegionSummary(region, level, from, to) {
  return query(`
    SELECT
      COUNT(DISTINCT s.taxon_id) AS species_richness,
      COALESCE(SUM(s.observation_rows), 0)
        AS observation_records
    FROM species_region_year s
    JOIN taxa t ON s.taxon_id = t.taxon_id
    WHERE s.region_level = $1
      AND s.region_code = $2
      AND s.year BETWEEN $3 AND $4
      AND t.category = 'species'
  `, [level, region, from, to]);
}

// Line chart: annual trends for a taxon
export function getSpeciesTrend(region, level, taxonId, from, to) {
  return query(`
    SELECT
      s.year,
      SUM(s.observation_rows) AS observation_records
    FROM species_region_year s
    JOIN taxa t ON s.taxon_id = t.taxon_id
    WHERE s.region_level = $1
      AND s.region_code = $2
      AND s.taxon_id = $3
      AND t.category = 'species'
      AND s.year BETWEEN $4 AND $5
    GROUP BY s.year
    ORDER BY s.year
  `, [level, region, taxonId, from, to]);
}

// Bar chart / choropleth: rank regions by richness
export function getRichnessRanking(level, state, from, to) {
  return query(`
    SELECT
      s.region_code,
      COUNT(DISTINCT s.taxon_id) AS species_richness
    FROM species_region_year s
    JOIN taxa t ON s.taxon_id = t.taxon_id
    WHERE s.region_level = $1
      AND ($2 IS NULL OR s.state_code = $2)
      AND s.year BETWEEN $3 AND $4
      AND t.category = 'species'
    GROUP BY s.region_code
    ORDER BY species_richness DESC, s.region_code
  `, [level, state, from, to]);
}

// Bar chart: most frequently reported species
export function getTopSpecies(region, level, from, to, limit) {
  return query(`
    SELECT
      t.taxon_id,
      t.common_name,
      SUM(s.observation_rows) AS observation_records
    FROM species_region_year s
    JOIN taxa t ON s.taxon_id = t.taxon_id
    WHERE s.region_level = $1
      AND s.region_code = $2
      AND s.year BETWEEN $3 AND $4
      AND t.category = 'species'
    GROUP BY t.taxon_id, t.common_name
    ORDER BY observation_records DESC
    LIMIT $5
  `, [level, region, from, to, limit]);
}