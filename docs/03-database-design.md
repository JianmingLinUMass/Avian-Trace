# 03 — Database Design

## Overview

The project uses **Parquet and DuckDB** to store and analyze nationwide eBird observations.

Parquet preserves the detailed observation records, while DuckDB stores reference tables and precomputed summaries for efficient analytical queries.

This design avoids duplicating the entire observation dataset while supporting interactive visualizations.

## Data Architecture

```text
Parquet Observation Warehouse
    1,350,644,619 records
              |
              v
           DuckDB
    ├── taxa
    ├── states
    ├── counties
    ├── species_region_month
    └── species_region_year
              |
              v
        Python API
              |
              v
       D3.js Dashboard
```

The Python API and D3.js dashboard are planned components.

## Data Storage

| Component | Location | Purpose |
|---|---|---|
| Observation warehouse | `parquet/production/` | Detailed observation records |
| Analytical database | `database/ebird.duckdb` | Reference tables and summaries |

DuckDB queries Parquet directly when detailed observations are needed. Routine visualization queries use the precomputed summary tables.

## Database Tables

### Reference Tables

| Table | Primary attributes | Rows |
|---|---|---:|
| `taxa` | `taxon_id`, `common_name`, `scientific_name`, `category` | 2,747 |
| `states` | `state_code`, `observation_rows` | 52 |
| `counties` | `state_code`, `county_code`, `observation_rows` | 3,144 |

These tables provide taxonomic information and geographic identifiers.

### Analytical Summary Tables

| Table | Dimensions | Measure | Rows |
|---|---|---|---:|
| `species_region_month` | Year, month, region, taxon | Observation records | 48,305,753 |
| `species_region_year` | Year, region, taxon | Observation records | 10,210,147 |

Both summary tables contain `region_level`, which distinguishes state-level and county-level aggregations.

The monthly table contains:

- `year`
- `month`
- `region_level`
- `region_code`
- `state_code`
- `taxon_id`
- `observation_rows`

The annual table contains the same attributes except `month`.

Annual summaries are derived from monthly summaries, avoiding a second scan of the complete observation warehouse.

A separate `summary_completed_years` table tracks the 15 processed years and supports resumable processing.

## Table Relationships

The summary tables connect to reference tables through shared identifiers:

- **Taxonomy:** `taxon_id` → `taxa.taxon_id`
- **State:** `state_code` → `states.state_code`
- **County:** `region_code` → `counties.county_code`, for county-level records

The `region_level` field determines whether `region_code` represents a state or county.

These are logical relationships used by queries; they do not imply that foreign-key constraints are enforced.

## Example Query

Retrieve annual Northern Cardinal observation records in Massachusetts:

```sql
SELECT
    s.year,
    s.observation_rows
FROM species_region_year s
JOIN taxa t ON s.taxon_id = t.taxon_id
WHERE s.region_level = 'state'
  AND s.region_code = 'US-MA'
  AND t.common_name = 'Northern Cardinal'
  AND t.category = 'species'
ORDER BY s.year;
```

This query returns one observation count per year from 2012 through 2026.

The `species` category filter excludes subspecific taxonomic records. Consequently, the query measures species-category observation records rather than all possible reports attributable to the biological species.

## Visualization Integration

The planned dashboard will use the following workflow:

1. Users select a species, geographic region, and time range.
2. The D3.js frontend sends a request to the Python API.
3. The API queries DuckDB's precomputed summaries.
4. Results are returned as compact JSON.
5. D3.js renders the appropriate chart or map.

For example:

```json
[
  {"year": 2023, "observations": 135262},
  {"year": 2024, "observations": 145868},
  {"year": 2025, "observations": 145470}
]
```

These values are actual Northern Cardinal species-category observation counts from Massachusetts.

## Design Considerations

**Separation of storage and analysis:** Detailed observations remain in Parquet, while frequently queried summaries are materialized in DuckDB.

**Geographic granularity:** State- and county-level aggregations support regional comparisons without requiring individual locality tables.

**Query efficiency:** Precomputed summaries avoid repeated scans of 1.35 billion observation records during routine dashboard interactions.

**Extensibility:** Additional metrics, such as checklist reporting frequency, can be calculated from the observation warehouse and stored as new summary tables.

**Data interpretation:** Observation counts measure reporting activity, not estimated bird population abundance. The year 2026 represents a partial year ending September 30.

---

*Processing performance and storage measurements are documented in `04-performance.md`.*