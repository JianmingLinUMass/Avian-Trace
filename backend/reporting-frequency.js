import { validateSeasonalTrend } from "./species-trend-query.js";
import { CHART_FILTER_DEFINITIONS } from "../frontend/filters/filter-definitions.js";

export async function requireFrequencyMetadata(query) {
  const { data: tables } = await query(`
    SELECT COUNT(*) AS count FROM information_schema.tables
    WHERE table_schema = 'main' AND table_name IN ('reporting_frequency_build', 'reporting_frequency_coverage')
  `);
  if (Number(tables[0].count) !== 2) {
    throw Object.assign(new Error("Install the updated database with reporting frequency summaries."), { status: 503 });
  }
}

export async function frequencyCoverage(query, startYear, endYear) {
  await requireFrequencyMetadata(query);
  const { data } = await query(`
    SELECT y.year::INTEGER AS year FROM range($1::INTEGER, $2::INTEGER + 1) y(year)
    WHERE (SELECT COUNT(DISTINCT c.month) FROM reporting_frequency_coverage c
           WHERE c.year = y.year AND c.complete AND c.month BETWEEN 1 AND 12) <> 12
       OR NOT EXISTS (SELECT 1 FROM reporting_frequency_build b
                      WHERE b.complete AND y.year BETWEEN b.start_year AND b.end_year)
    ORDER BY y.year
  `, [startYear, endYear]);
  return data.map(row => row.year);
}

export const MONTHLY_FREQUENCY_SQL = `
  WITH denominators AS (
    SELECT month, SUM(complete_checklists) AS complete_checklists
    FROM complete_checklists_region_month
    WHERE region_level = $2 AND region_code = $1 AND year BETWEEN $3 AND $4
    GROUP BY month
  ), monthly AS (
    SELECT n.taxon_id, n.month, SUM(n.reporting_checklists) AS reporting_checklists
    FROM species_checklists_region_month n
    WHERE n.region_level = $2 AND n.region_code = $1 AND n.year BETWEEN $3 AND $4
    GROUP BY n.taxon_id, n.month
  ), ranked AS (
    SELECT m.taxon_id, t.common_name AS species_name, SUM(m.reporting_checklists) AS total_reporting
    FROM monthly m JOIN taxa t USING (taxon_id)
    WHERE t.category = 'species'
    GROUP BY m.taxon_id, t.common_name
    ORDER BY total_reporting DESC, lower(t.common_name), m.taxon_id LIMIT $5
  )
  SELECT r.taxon_id, r.species_name, r.total_reporting, m.month::INTEGER AS month,
    d.complete_checklists, CASE WHEN d.complete_checklists > 0 THEN COALESCE(n.reporting_checklists, 0) END AS reporting_checklists
  FROM ranked r CROSS JOIN range(1, 13) m(month)
  LEFT JOIN denominators d USING (month)
  LEFT JOIN monthly n ON n.taxon_id = r.taxon_id AND n.month = m.month
  ORDER BY r.total_reporting DESC, lower(r.species_name), r.taxon_id, m.month
`;

export async function queryMonthlyFrequency(query, regionCode, regionLevel, startYear, endYear, speciesCount) {
  validateSeasonalTrend(regionCode, regionLevel, startYear, endYear);
  if (!CHART_FILTER_DEFINITIONS.t2Heatmap.speciesCount.options.some(option => option.value === speciesCount)) {
    throw new Error("Invalid heatmap species count");
  }
  const unavailableYears = await frequencyCoverage(query, startYear, endYear);
  if (unavailableYears.length) return { data: { rows: [], unavailableYears } };
  const result = await query(MONTHLY_FREQUENCY_SQL, [regionCode, regionLevel, startYear, endYear, speciesCount]);
  return { data: { rows: result.data, unavailableYears } };
}
