
import { query } from "./database.js";

/**
 * Get the total recorded species richness and observation records
 * for a specific state or county within a year range.
 *
 * @param {string} region - Region code (e.g., "US-MA" or "US-MA-017").
 * @param {"state"|"county"} level - Geographic level of the region.
 * @param {number} from - Starting year (inclusive).
 * @param {number} to - Ending year (inclusive).
 * @returns {Promise<object>} Query result containing species_richness
 *   and observation_records.
 */
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

/**
 * Get annual observation records for a particular bird taxon
 * within a selected state or county.
 *
 * @param {string} region - Region code (e.g., "US-MA").
 * @param {"state"|"county"} level - Geographic level.
 * @param {string} taxonId - Bird taxonomic identifier (Avibase ID).
 * @param {number} from - Starting year (inclusive).
 * @param {number} to - Ending year (inclusive).
 * @returns {Promise<object>} Query result containing year and
 *   observation_records for each available year.
 */
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

/**
 * Rank geographic regions by recorded species richness.
 *
 * When level="state", ranks all U.S. states.
 * When level="county", ranks counties within the specified state.
 *
 * @param {"state"|"county"} level - Geographic level to rank.
 * @param {string|null} stateFilter - State code (e.g., "US-MA")
 *   used to restrict county rankings. Pass null for no filter.
 * @param {number} from - Starting year (inclusive).
 * @param {number} to - Ending year (inclusive).
 * @returns {Promise<object>} Query result containing region_code
 *   and species_richness, sorted from highest to lowest.
 */
export function getRichnessRanking(level, stateFilter, from, to) {
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
  `, [level, stateFilter, from, to]);
}

/**
 * Get the most frequently reported bird species in a region.
 *
 * Ranking is based on observation records, not the number of
 * individual birds or estimated population abundance.
 *
 * @param {string} region - Region code (e.g., "US-MA").
 * @param {"state"|"county"} level - Geographic level.
 * @param {number} from - Starting year (inclusive).
 * @param {number} to - Ending year (inclusive).
 * @param {number} limit - Maximum number of species to return.
 * @returns {Promise<object>} Query result containing taxon_id,
 *   common_name, and observation_records, sorted descending.
 */
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
