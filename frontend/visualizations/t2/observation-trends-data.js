import { CHART_FILTER_DEFINITIONS } from "../../filters/filter-definitions.js";

const colors = ["#E67E22", "#2E8B57", "#D4AC0D", "#D64545", "#3498DB"];
export const TREND_DEFINITIONS = CHART_FILTER_DEFINITIONS.t2.season.options.map((season, index) =>
  Object.freeze({ id: season.value, label: season.label, color: colors[index] }));

/** Reuse the existing seasonal API; never derive annual totals by adding seasons. */
export async function loadSeasonalTrendSeries(loadSpeciesTrend, filters) {
  const rows = await Promise.all(TREND_DEFINITIONS.map(trend => loadSpeciesTrend(
    filters.countyCode || filters.stateCode, filters.countyCode ? "county" : "state",
    filters.taxonId, filters.startYear, filters.endYear, trend.id
  )));
  if (rows.every(series => !series.length)) return [];
  return TREND_DEFINITIONS.map((trend, index) => ({ ...trend,
    series: buildYearlyTrendSeries(rows[index], filters.startYear, filters.endYear)
  }));
}

/** Keep unavailable years as gaps; only explicit processed zero totals become zero points. */
export function buildYearlyTrendSeries(rows, startYear, endYear) {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) throw new Error("Invalid year range");
  const values = new Map();
  for (const row of rows) {
    const year = Number(row.year);
    if (!Number.isInteger(year) || year < startYear || year > endYear || values.has(year)) throw new Error("Invalid or duplicate trend year");
    const unavailable = row.summary_available === false || row.observation_records === null;
    const count = unavailable ? null : Number(row.observation_records);
    if (!unavailable && (row.observation_records === "" || !Number.isSafeInteger(count) || count < 0)) throw new Error("Invalid observation record count");
    values.set(year, { year, observationRecords: count });
  }
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => {
    const year = startYear + index;
    return values.get(year) || { year, observationRecords: null };
  });
}
