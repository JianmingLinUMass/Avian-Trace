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
