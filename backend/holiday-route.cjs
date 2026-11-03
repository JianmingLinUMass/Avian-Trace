
const path = require("node:path");

const mainDb = path.resolve(__dirname, "../database/ebird.duckdb");
const dailyDb = path.resolve(__dirname, "../database/ebird_daily.duckdb");

function sqlPath(file) {
  return file.replace(/'/g, "''").replace(/\\/g, "/");
}

let connectionPromise;

async function getConnection() {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const { DuckDBInstance } = await import("@duckdb/node-api");

      const instance = await DuckDBInstance.create(":memory:");
      const con = await instance.connect();

      await con.run(
        `ATTACH '${sqlPath(mainDb)}' AS reference_db (READ_ONLY)`
      );

      await con.run(
        `ATTACH '${sqlPath(dailyDb)}' AS daily_db (READ_ONLY)`
      );

      return con;
    })().catch(error => {
      connectionPromise = null;
      throw error;
    });
  }

  return connectionPromise;
}

function registerHolidayRoutes(app) {
  app.get("/api/holiday-comparison", async (req, res) => {
    const species = String(req.query.species || "House Sparrow");
    const region = String(req.query.region || "US-MA-017");
    const level = String(req.query.level || "county");
    const holiday = String(req.query.holiday || "Christmas Day");

    if (!["state", "county"].includes(level)) {
      return res.status(400).json({
        error: "level must be state or county"
      });
    }

    if (
      species.length > 150 ||
      region.length > 30 ||
      holiday.length > 150
    ) {
      return res.status(400).json({
        error: "Invalid query parameter length"
      });
    }

    try {
      const con = await getConnection();

      const speciesResult = await con.runAndReadAll(`
        SELECT taxon_id, common_name
        FROM reference_db.taxa
        WHERE LOWER(common_name) = LOWER(?)
          AND category = 'species'
        LIMIT 1
      `, [species]);

      const foundSpecies = speciesResult.getRowObjects();

      if (!foundSpecies.length) {
        return res.status(404).json({
          error: `Species not found: ${species}`
        });
      }

      const taxonId = String(foundSpecies[0].taxon_id);

      const result = await con.runAndReadAll(`
        WITH years AS (
          SELECT generate_series AS year
          FROM generate_series(2012, 2025)
        ),
        annual AS (
          SELECT
            year,
            avg_daily_birds
          FROM daily_db.species_region_year_avg
          WHERE region_level = ?
            AND region_code = ?
            AND taxon_id = ?
        ),
        holiday_counts AS (
          SELECT
            YEAR(h.date) AS year,
            SUM(s.reported_birds)::DOUBLE AS birds,
            CAST(MIN(h.date) AS VARCHAR) AS holiday_date
          FROM daily_db.holidays h
          LEFT JOIN daily_db.species_region_holiday s
            ON s.date = h.date
           AND s.region_level = ?
           AND s.region_code = ?
           AND s.taxon_id = ?
          WHERE h.holiday_name = ?
            AND h.is_observed = FALSE
            AND YEAR(h.date) BETWEEN 2012 AND 2025
          GROUP BY YEAR(h.date)
        )
        SELECT
          y.year,
          a.avg_daily_birds,
          CASE
            WHEN hc.holiday_date IS NULL THEN NULL
            ELSE COALESCE(hc.birds, 0)
          END AS holiday_birds,
          hc.holiday_date
        FROM years y
        LEFT JOIN annual a ON a.year = y.year
        LEFT JOIN holiday_counts hc ON hc.year = y.year
        ORDER BY y.year
      `, [
        level, region, taxonId,
        level, region, taxonId,
        holiday
      ]);

      const data = result.getRowObjects().map(row => ({
        year: Number(row.year),
        avg_daily_birds: row.avg_daily_birds == null
          ? null
          : Number(row.avg_daily_birds),
        holiday_birds: row.holiday_birds == null
          ? null
          : Number(row.holiday_birds),
        holiday_date: row.holiday_date || null
      }));

      res.json({
        species: String(foundSpecies[0].common_name),
        taxon_id: taxonId,
        region,
        level,
        holiday,
        data
      });
    } catch (error) {
      console.error("Holiday comparison error:", error);
      res.status(500).json({
        error: "Failed to query holiday comparison"
      });
    }
  });
}

module.exports = registerHolidayRoutes;
