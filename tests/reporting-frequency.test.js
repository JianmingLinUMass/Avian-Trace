import test from "node:test";
import assert from "node:assert/strict";
import { DuckDBInstance } from "@duckdb/node-api";
import { queryMonthlyFrequency } from "../backend/reporting-frequency.js";
import { buildFrequencyHeatmap } from "../frontend/visualizations/t2/species-heatmap-data.js";

test("monthly frequency pools counts across years, distinguishes zero from missing effort, and requires complete coverage", async () => {
  const db = await DuckDBInstance.create(":memory:");
  const connection = await db.connect();
  try {
    await connection.run(`
      CREATE TABLE reporting_frequency_build AS SELECT 2024 AS start_year, 2025 AS end_year, true AS complete;
      CREATE TABLE reporting_frequency_coverage AS SELECT year, month, true AS complete
        FROM range(2024, 2026) y(year) CROSS JOIN range(1, 13) m(month);
      CREATE TABLE taxa AS SELECT 'bird' AS taxon_id, 'Test Bird' AS common_name, 'species' AS category;
      CREATE TABLE complete_checklists_region_month (region_level VARCHAR, region_code VARCHAR, year INTEGER, month INTEGER, complete_checklists BIGINT);
      INSERT INTO complete_checklists_region_month VALUES
        ('county','US-MA-017',2024,1,2), ('county','US-MA-017',2025,1,8), ('county','US-MA-017',2025,2,9);
      CREATE TABLE species_checklists_region_month (region_level VARCHAR, region_code VARCHAR, year INTEGER, month INTEGER, taxon_id VARCHAR, reporting_checklists BIGINT);
      INSERT INTO species_checklists_region_month VALUES ('county','US-MA-017',2024,1,'bird',2);
    `);
    const query = async (sql, args) => ({ data: (await connection.runAndReadAll(sql, args)).getRowObjectsJson() });
    const load = () => queryMonthlyFrequency(query, "US-MA-017", "county", 2024, 2025, 10);
    const result = await load();
    const [bird] = buildFrequencyHeatmap(result.data.rows, "total");
    assert.equal(bird.cells.length, 12);
    assert.deepEqual(bird.cells[0].frequency, { complete: 10, reports: 2, rate: 0.2 });
    assert.deepEqual(bird.cells[1].frequency, { complete: 9, reports: 0, rate: 0 });
    assert.equal(bird.cells[2].frequency, null);
    await connection.run("UPDATE reporting_frequency_coverage SET complete = false WHERE year = 2024 AND month = 7");
    assert.deepEqual((await load()).data, { rows: [], unavailableYears: [2024] });
  } finally {
    connection.closeSync();
    db.closeSync();
  }
});
