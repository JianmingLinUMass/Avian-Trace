import { organizeHotspotFrequencies, recommendCountyItineraries } from "../frontend/visualizations/t4/itinerary-data.js";
import { frequencyCoverage, requireFrequencyMetadata } from "./reporting-frequency.js";
import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_CANDIDATES = 10;
const databasePath = fileURLToPath(new URL("../database/ebird_locations.duckdb", import.meta.url));
let pendingConnection;

function invalid(message) { const error = new Error(message); error.status = 400; return error; }
export function validateCounty(countyCode) {
  if (typeof countyCode !== "string" || !/^US-[A-Z]{2}-[0-9]{3}$/.test(countyCode)) throw invalid("Invalid county code");
}
export function validateCandidateIds(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_CANDIDATES ||
      ids.some(id => typeof id !== "string" || !/^L[0-9]+$/.test(id)) || new Set(ids).size !== ids.length) {
    throw invalid("Invalid candidate locations: choose 1–10 distinct hotspot IDs");
  }
}

export function createLocationQueries(connection) {
  return {
    async tripMonthFrequency(countyCode, ids, month) {
      validateCounty(countyCode);
      if (ids !== null) validateCandidateIds(ids);
      if (!Number.isInteger(month) || month < 1 || month > 12) throw invalid("Invalid trip month");
      const query = async (sql, params = []) => ({
        data: (await connection.runAndReadAll(sql, params)).getRowObjectsJson()
      });
      await requireFrequencyMetadata(query);
      const { data: periods } = await query(`
        SELECT c.year
        FROM reporting_frequency_coverage c
        WHERE c.complete AND c.year < $1 AND c.month BETWEEN 1 AND 12
          AND EXISTS (SELECT 1 FROM reporting_frequency_build b
                      WHERE b.complete AND c.year BETWEEN b.start_year AND b.end_year)
        GROUP BY c.year HAVING COUNT(DISTINCT c.month) = 12
        ORDER BY c.year DESC LIMIT 10
      `, [new Date().getFullYear()]);
      const referenceYears = periods.map(row => row.year).reverse();
      if (referenceYears.length !== 10) {
        throw Object.assign(new Error("The trip planner requires ten complete years of hotspot checklist data."), { status: 503 });
      }
      const years = referenceYears.map((_, index) => "$" + (index + 3)).join(",");
      const idFilter = ids === null ? "" : "AND locality_id IN (" + ids.map((_, index) => "$" + (index + 13)).join(",") + ")";
      const { data: rows } = await query(`
        WITH candidates AS (
          SELECT locality_id, locality_name FROM locations WHERE county_code = $1 ${idFilter}
        ), eligible AS (
          SELECT locality_id, SUM(complete_checklists) AS complete_checklists
          FROM complete_checklists_hotspot_month
          WHERE county_code = $1 AND month = $2 AND year IN (${years})
            AND locality_id IN (SELECT locality_id FROM candidates)
          GROUP BY locality_id
        ), reports AS (
          SELECT locality_id, taxon_id, SUM(reporting_checklists) AS reporting_checklists
          FROM species_checklists_hotspot_month
          WHERE county_code = $1 AND month = $2 AND year IN (${years})
            AND locality_id IN (SELECT locality_id FROM eligible)
          GROUP BY locality_id, taxon_id
        )
        SELECT c.locality_id, c.locality_name, d.complete_checklists, n.taxon_id, n.reporting_checklists
        FROM candidates c
        LEFT JOIN eligible d USING (locality_id)
        LEFT JOIN reports n USING (locality_id)
        ORDER BY lower(c.locality_name), c.locality_id, n.taxon_id
      `, [countyCode, month, ...referenceYears, ...(ids ?? [])]);
      if (ids !== null && new Set(rows.map(row => row.locality_id)).size !== ids.length) {
        throw invalid("Invalid candidate: hotspot not present in the selected county summary");
      }
      return { referenceYears, rows };
    },
    async search(countyCode, search = "", page = 1) {
      validateCounty(countyCode);
      if (typeof search !== "string" || search.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 1000000) throw invalid("Invalid location search or page");
      const params = [countyCode, search.trim()];
      const where = "county_code=$1 AND (contains(lower(locality_name),lower($2)) OR contains(lower(locality_id),lower($2)))";
      const total = Number((await connection.runAndReadAll("SELECT COUNT(*) AS total FROM locations WHERE " + where, params)).getRowObjectsJson()[0].total);
      const locations = (await connection.runAndReadAll("SELECT locality_id,locality_name,species_richness FROM locations WHERE " + where + " ORDER BY lower(locality_name),locality_id LIMIT 50 OFFSET $3", [...params, (page - 1) * 50])).getRowObjectsJson();
      return { locations, total, page, pageSize: 50, startYear: 2012, endYear: 2025 };
    },
    async frequency(countyCode, ids, year) {
      validateCounty(countyCode);
      if (ids !== null) validateCandidateIds(ids);
      const idFilter = ids === null ? "" : "AND l.locality_id IN (" + ids.map((_, index) => "$" + (index + 3)).join(",") + ")";
      if (!Number.isInteger(year) || year < 2012 || year > 2025) {
        throw invalid("Invalid reporting year");
      }
      const query = async (sql, params = []) => ({
        data: (await connection.runAndReadAll(sql, params)).getRowObjectsJson()
      });
      if ((await frequencyCoverage(query, year, year)).length) {
        throw Object.assign(new Error("Hotspot frequency is unavailable for the selected year."), { status: 503 });
      }
      const { data } = await query(`
        SELECT l.locality_id, l.locality_name, d.complete_checklists, n.taxon_id, n.reporting_checklists
        FROM locations l
        LEFT JOIN complete_checklists_hotspot_year d
          ON d.county_code = l.county_code AND d.locality_id = l.locality_id AND d.year = $2
        LEFT JOIN species_checklists_hotspot_year n
          ON n.county_code = d.county_code AND n.locality_id = d.locality_id AND n.year = d.year
        WHERE l.county_code = $1 ${idFilter}
        ORDER BY lower(l.locality_name), l.locality_id, n.taxon_id
      `, [countyCode, year, ...(ids ?? [])]);
      if (ids !== null && new Set(data.map(row => row.locality_id)).size !== ids.length) throw invalid("Invalid candidate: hotspot not present in the selected county summary");
      return data;
    },
    async memberships(countyCode, ids) {
      validateCounty(countyCode);
      validateCandidateIds(ids);
      const locations = (await connection.runAndReadAll(`
        SELECT l.locality_id,l.locality_name,LIST(m.taxon_id ORDER BY m.taxon_id) AS species_ids
        FROM locations l JOIN location_species m USING(county_code,locality_id)
        WHERE l.county_code=$1 AND l.locality_id IN (${ids.map((id,index) => "$" + (index+2)).join(",")})
        GROUP BY l.locality_id,l.locality_name ORDER BY l.locality_id
      `, [countyCode, ...ids])).getRowObjectsJson();
      if (locations.length !== ids.length) throw invalid("Invalid candidate: hotspot not present in the selected county summary");
      return locations;
    }
  };
}

async function queries() {
  if (!existsSync(databasePath)) {
    const error = new Error("Hotspot summary unavailable. Run node scripts/build_location_summaries.js before using T4.");
    error.status = 503;
    throw error;
  }
  if (!pendingConnection) pendingConnection = (async () => {
    const instance = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY", threads: "4" });
    const connection = await instance.connect();
    try {
      const metadata = (await connection.runAndReadAll("SELECT * FROM build_metadata")).getRowObjectsJson();
      if (metadata.length !== 1 || !metadata[0].complete || metadata[0].version !== 1 || metadata[0].start_year !== 2012 || metadata[0].end_year !== 2025 || metadata[0].locality_type !== "H") throw new Error("Incomplete hotspot summary");
      return { instance, connection, queries: createLocationQueries(connection) };
    } catch (cause) { connection.closeSync(); instance.closeSync(); throw cause; }
  })().catch(cause => { pendingConnection = undefined; const error = new Error("Hotspot summary unavailable or incompatible. Complete the offline preparation.", { cause }); error.status = 503; throw error; });
  return (await pendingConnection).queries;
}

export function registerLocationRoutes(app) {
  function endpoint(handler) {
    return async (req, res) => {
      try { res.json({ data: await handler(req) }); }
      catch (error) {
        if (!error.status) console.error(error);
        res.status(error.status || 500).json({ error: error.status ? error.message : "Location query failed" });
      }
    };
  }
  app.get("/api/hotspots", endpoint(async req => {
    const county = String(req.query.countyCode ?? "");
    validateCounty(county);
    return (await queries()).search(county, String(req.query.search ?? ""), Number(req.query.page ?? 1));
  }));
  app.get("/api/hotspot-reporting-frequency", endpoint(async req => {
    const county = String(req.query.countyCode ?? "");
    const ids = String(req.query.locationIds ?? "").split(",");
    validateCounty(county); validateCandidateIds(ids);
    const location = await queries();
    if (req.query.month !== undefined) return location.tripMonthFrequency(county, ids, Number(req.query.month));
    return location.frequency(county, ids, Number(req.query.year));
  }));
  app.get("/api/county-itineraries", endpoint(async req => {
    const county = String(req.query.countyCode ?? "");
    validateCounty(county);
    const location = await queries();
    if (req.query.month !== undefined) {
      const { referenceYears, rows } = await location.tripMonthFrequency(county, null, Number(req.query.month));
      const plan = recommendCountyItineraries(organizeHotspotFrequencies(rows));
      const selectedIds = new Set(plan.itineraries.at(-1)?.hotspots.map(hotspot => hotspot.id));
      return { referenceYears, ...plan, speciesRows: rows.filter(row => selectedIds.has(row.locality_id)) };
    }
    const rows = await location.frequency(county, null, Number(req.query.year));
    return recommendCountyItineraries(organizeHotspotFrequencies(rows));
  }));
  app.get("/api/hotspot-species", endpoint(async req => {
    const county = String(req.query.countyCode ?? "");
    const ids = String(req.query.locationIds ?? "").split(",");
    validateCounty(county); validateCandidateIds(ids);
    return (await queries()).memberships(county, ids);
  }));
}
