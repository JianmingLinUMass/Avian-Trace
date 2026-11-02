# 01 — Data Source

## Overview

This project uses the **eBird Basic Dataset (EBD)**, maintained by the Cornell Lab of Ornithology. eBird collects bird observations submitted by birdwatchers worldwide.

**Source:** https://ebird.org/data/download

## Dataset Summary

| Property | Value |
|---|---|
| Release | September 2026 (United States) |
| Records | 1,350,644,619 |
| Original attributes | 52 |
| Retained attributes | 30 |
| Geographic coverage | United States |
| Analysis period | 2012–2026 (through September 30) |

The dataset contains historical observations before 2012, but the project's analytical focus is 2012–2026.

## Retained Attributes

The following 30 attributes were retained from the original 52 columns in the eBird Basic Dataset.

| Category | Attribute | Description |
|---|---|---|
| Taxonomy | `taxon_id` | Unique taxonomic identifier |
| Taxonomy | `common_name` | Common bird name |
| Taxonomy | `scientific_name` | Scientific bird name |
| Taxonomy | `category` | Taxonomic category |
| Taxonomy | `taxonomic_order` | Taxonomic ordering |
| Taxonomy | `exotic_code` | Exotic species classification |
| Observation | `observation_id` | Unique observation record identifier |
| Observation | `count_raw` | Reported bird count, which may contain `X` |
| Observation | `breeding_code` | Breeding evidence code |
| Observation | `breeding_category` | Breeding evidence category |
| Time | `observation_date` | Date of observation |
| Time | `start_time` | Observation start time |
| Geography | `state_code` | State identifier |
| Geography | `county_code` | County identifier |
| Geography | `locality_id` | eBird locality identifier |
| Geography | `locality_name` | Locality name |
| Geography | `locality_type` | Locality type |
| Geography | `latitude` | Observation latitude |
| Geography | `longitude` | Observation longitude |
| Checklist and Effort | `checklist_id` | Checklist identifier |
| Checklist and Effort | `observer_id` | Observer identifier |
| Checklist and Effort | `protocol` | Observation protocol |
| Checklist and Effort | `duration_minutes` | Observation duration |
| Checklist and Effort | `distance_km` | Distance traveled |
| Checklist and Effort | `effort_area_ha` | Area surveyed |
| Checklist and Effort | `observer_count` | Number of observers |
| Checklist and Effort | `complete_checklist` | Whether all identified species were reported |
| Checklist and Effort | `group_id` | Shared checklist group identifier |
| Review and Quality | `approved` | Observation approval status |
| Review and Quality | `reviewed` | Whether the observation was reviewed |

**Note:** These attributes are stored in the processed Parquet observation files. The DuckDB summary tables contain aggregated data and do not preserve every original attribute.

## Unit of Observation

Each row represents a reported taxonomic observation, typically associated with an eBird checklist.

A checklist may contain multiple species observations. Therefore, **observation records do not represent individual birds or independent birdwatching events**.

## Key Attributes

The retained attributes include:

- **Taxonomy:** Species names, scientific names, and taxonomic identifiers.
- **Time:** Observation date and start time.
- **Geography:** State, county, locality, and coordinates.
- **Observations:** Reported bird counts and breeding information.
- **Effort:** Checklist identifiers, protocols, duration, distance, and observer count.

The complete 30-column schema is available in the processing code.

## Limitations

- Observation frequency is influenced by observer participation and sampling effort.
- Geographic coverage is uneven.
- Different observation protocols and checklist completeness affect comparability.
- Taxonomic categories include species and subspecific forms.
- The 2026 dataset covers only January–September.

Consequently, **the number of observation records should not be interpreted as bird population abundance**.

## Attribution

Data provided by the Cornell Lab of Ornithology's eBird program. Use and redistribution are subject to eBird's data-access terms.
