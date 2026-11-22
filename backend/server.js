import { queryMonthlyFrequency } from "./reporting-frequency.js";
import { query } from "./database.js";
import { registerLocationRoutes } from "./location-queries.js";
import { getHolidayObservations } from "./holiday-observations.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getSpeciesHeatmap,
  getCountyRichness,
  getGeographicOptions,
  getRegionSummary,
  getSpeciesTrend,
  getRichnessRanking,
  getTopSpecies,
  getTaxonNameMap
} from "./queries.js";

import registerHolidayRoutes from "./holiday-route.cjs";

const app = express();
const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const frontendPath = path.resolve(
  __dirname,
  "../frontend"
);

app.use(express.static(frontendPath));
const PORT = 3000;

// Local development only
const HOST = "127.0.0.1";

function parseFilters(req) {
  const regionCode = String(req.query.regionCode ?? "US-MA");
  const regionLevel = String(req.query.regionLevel ?? "state");
  const stateCode = String(req.query.stateCode ?? "US-MA");
  const taxonId = String(req.query.taxonId ?? "avibase-00AF5DA1");
  const startYear = Number(req.query.startYear ?? 2012);
  const endYear = Number(req.query.endYear ?? 2025);
  const limit = Number(req.query.limit ?? 10);
  const sortOrder = String(req.query.sortOrder ?? "desc");

  if (!["state", "county"].includes(regionLevel)) {
    throw new Error("Invalid region level");
  }

  if (regionLevel === "county" && !/^US-[A-Z]{2}$/.test(stateCode)) {
    throw new Error("Invalid state code");
  }

  if (
    !Number.isInteger(startYear) ||
    !Number.isInteger(endYear) ||
    startYear < 2012 ||
    endYear > 2026 ||
    startYear > endYear
  ) {
    throw new Error("Invalid year range");
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be between 1 and 100");
  }

  if (!["asc", "desc"].includes(sortOrder)) {
    throw new Error("Invalid sort order");
  }

  return { regionCode, regionLevel, stateCode, taxonId, startYear, endYear, limit, sortOrder };
}

function endpoint(handler) {
  return async (req, res) => {
    try {
      const filters = parseFilters(req);
      const result = await handler(req, filters);
      res.json(result);
    } catch (error) {
      if (error.status === 503) return res.status(503).json({ error: error.message });
      if (error.message.startsWith("Invalid") ||
          error.message.startsWith("Limit") ||
          error.message.startsWith("Missing")) {
        return res.status(400).json({ error: error.message });
      }

      console.error(error);
      res.status(500).json({ error: "Database query failed" });
    }
  };
}

// Test the server without querying DuckDB
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "eBird API"
  });
}); 

app.get("/api/region-summary", endpoint(
  (req, f) => getRegionSummary(
    f.regionCode, f.regionLevel, f.startYear, f.endYear
  )
));

app.get("/api/species-trend", endpoint(
  (req, f) => {
    return getSpeciesTrend(
      f.regionCode, f.regionLevel, f.taxonId, f.startYear, f.endYear,
      req.query.season === undefined ? undefined : String(req.query.season)
    );
  }
));

app.get("/api/richness-ranking", endpoint(
  (req, f) => getRichnessRanking(
    f.regionLevel,
    f.regionLevel === "county" ? f.stateCode : null,
    f.startYear,
    f.endYear,
    f.limit,
    f.sortOrder
  )
));

app.get("/api/top-species", endpoint(
  (req, f) => getTopSpecies(
    f.regionCode, f.regionLevel, f.startYear, f.endYear, f.limit
  )
));

app.get("/api/taxa/names", async (req, res) => {
  try {
    const result = await getTaxonNameMap();
    res.json(result.data);
  } catch (err) {
    console.error("Failed to retrieve taxon names:", err);
    res.status(500).json({ error: "Failed to retrieve taxon names" });
  }
});

app.get("/api/geography", endpoint(() => getGeographicOptions()));

app.get("/api/county-richness", endpoint((req, filters) => {
  if (!/^US-[A-Z]{2}$/.test(filters.stateCode)) throw new Error("Invalid state code");
  return getCountyRichness(filters.stateCode, filters.startYear, filters.endYear);
}));

app.get("/api/species-reporting-frequency", endpoint((req, filters) => queryMonthlyFrequency(
  query, filters.regionCode, filters.regionLevel, filters.startYear, filters.endYear,
  Number(req.query.speciesCount ?? 15)
)));

app.get("/api/species-heatmap", endpoint((req, filters) => getSpeciesHeatmap(
  filters.regionCode, filters.regionLevel, filters.startYear, filters.endYear,
  Number(req.query.speciesCount ?? 15)
)));

app.get("/api/holiday-observations", endpoint((req, filters) => getHolidayObservations(
  String(req.query.countyCode ?? ""), filters.taxonId, filters.startYear, filters.endYear
)));

registerHolidayRoutes(app);
registerLocationRoutes(app);

app.listen(PORT, HOST, () => {
  console.log(`eBird API running at http://${HOST}:${PORT}`);
});
