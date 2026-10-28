import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getRegionSummary,
  getSpeciesTrend,
  getRichnessRanking,
  getTopSpecies
} from "./queries.js";

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
  const region = String(req.query.region ?? "US-MA");
  const level = String(req.query.level ?? "state");
  const from = Number(req.query.from ?? 2012);
  const to = Number(req.query.to ?? 2025);
  const limit = Number(req.query.limit ?? 10);

  if (!["state", "county"].includes(level)) {
    throw new Error("Invalid region level");
  }

  if (
    !/^[A-Z0-9-]{2,30}$/.test(region) ||
    (level === "state" && !/^US-[A-Z]{2}$/.test(region)) ||
    (level === "county" && !/^US-[A-Z]{2}-[0-9]{3}$/.test(region))
  ) {
    throw new Error("Invalid region code");
  }

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 2012 ||
    to > 2026 ||
    from > to
  ) {
    throw new Error("Invalid year range");
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be between 1 and 100");
  }

  return { region, level, from, to, limit };
}

function endpoint(handler) {
  return async (req, res) => {
    try {
      const filters = parseFilters(req);
      const result = await handler(req, filters);
      res.json(result);
    } catch (error) {
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
    f.region, f.level, f.from, f.to
  )
));

app.get("/api/species-trend", endpoint(
  (req, f) => {
    const taxonId = String(req.query.taxon_id ?? "");

    if (!/^avibase-[A-Za-z0-9-]+$/.test(taxonId)) {
      throw new Error("Missing or invalid taxon_id");
    }

    return getSpeciesTrend(
      f.region, f.level, taxonId, f.from, f.to
    );
  }
));

app.get("/api/richness-ranking", endpoint(
  (req, f) => getRichnessRanking(
    f.level,
    f.level === "county"
      ? String(req.query.state ?? "US-MA")
      : null,
    f.from,
    f.to
  )
));

app.get("/api/top-species", endpoint(
  (req, f) => getTopSpecies(
    f.region, f.level, f.from, f.to, f.limit
  )
));

app.listen(PORT, HOST, () => {
  console.log(`eBird API running at http://${HOST}:${PORT}`);
});
