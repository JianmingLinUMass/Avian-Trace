// ====================================================================
// Information Fetching Through Backend API
// ====================================================================

import { fetchAPI } from "./api.js";

// Load richness ranking among counties of a selected state from the database
// Used to visualize Task 1: Geographic Species Richness
export function loadRichnessRanking(regionLevel, stateCode, startYear, endYear, 
                                    limit, sortOrder) {
  return fetchAPI("/api/richness-ranking", {
    regionLevel,
    stateCode,
    startYear,
    endYear,
    limit,
    sortOrder
  });
}

// Load the annual observation records for a particular bird taxon 
// within a selected state or county from the database
// Used to visualize Task 2: Long-Term Observation Trends
export function loadSpeciesTrend(regionCode, regionLevel, taxonId, startYear, endYear, season) {
  return fetchAPI("/api/species-trend", {
    regionCode, 
    regionLevel, 
    taxonId, 
    startYear, 
    endYear,
    season
  });
}
// Complete statewide data for the standalone county choropleth.
export function loadCountyRichness(stateCode, startYear, endYear) {
  return fetchAPI("/api/county-richness", { stateCode, startYear, endYear });
}

export function loadGeographicOptions() {
  return fetchAPI("/api/geography");
}

// Top species across all months; independent of selected taxon and the trends season.
export function loadSpeciesHeatmap(regionCode, regionLevel, startYear, endYear, speciesCount) {
  return fetchAPI("/api/species-heatmap", { regionCode, regionLevel, startYear, endYear, speciesCount });
}

// Actual holidays versus their calendar-day complement, using observation records.
export function loadHolidayObservations(countyCode, taxonId, startYear, endYear) {
  return fetchAPI("/api/holiday-observations", { countyCode, taxonId, startYear, endYear });
}

export function loadHotspots(countyCode, search = "", page = 1) {
  return fetchAPI("/api/hotspots", { countyCode, search, page });
}

export function loadHotspotSpecies(countyCode, locationIds) {
  return fetchAPI("/api/hotspot-species", { countyCode, locationIds: locationIds.join(",") });
}

export function loadSpeciesReportingFrequency(regionCode, regionLevel, startYear, endYear, speciesCount) {
  return fetchAPI("/api/species-reporting-frequency", { regionCode, regionLevel, startYear, endYear, speciesCount });
}

export function loadHotspotReportingFrequency(countyCode, locationIds, month) {
  return fetchAPI("/api/hotspot-reporting-frequency", { countyCode, locationIds: locationIds.join(","), month });
}

export function loadCountyItineraries(countyCode, month) {
  return fetchAPI("/api/county-itineraries", { countyCode, month });
}
