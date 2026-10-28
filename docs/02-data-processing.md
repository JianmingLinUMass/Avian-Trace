# 02 — Data Processing

## Overview

The original eBird dataset was converted from compressed TSV into Parquet to support efficient analysis of over 1.35 billion observation records.

The preprocessing pipeline uses Python, indexed gzip access, PyArrow, and DuckDB.

## Processing Pipeline

1. **Extraction:** Used indexed gzip access and parallel processing to read the large source file in chunks.
2. **Column selection:** Retained 30 of the original 52 attributes relevant to the project.
3. **Conversion:** Saved observations into ZSTD-compressed Parquet files.
4. **Validation:** Checked observation identifiers, record counts, and extraction boundaries.
5. **Aggregation:** Used DuckDB to generate state/county and monthly/annual species summaries.

The original compressed dataset was approximately 124.62 GiB, while the resulting Parquet warehouse occupies approximately 62.86 GiB.

## Processed Data

| Dataset | Records |
|---|---:|
| Original observations extracted | 1,350,644,619 |
| Parquet files | 998 |
| Distinct taxa | 2,747 |
| State-level codes | 52 |
| County codes | 3,144 |
| Monthly summary rows | 48,305,753 |
| Annual summary rows | 10,210,147 |

All extracted observation records are retained in Parquet. DuckDB stores reference tables and precomputed summaries.

## Data Validation

The extraction was checked using the following methods:

- **Record count:** Confirmed 1,350,644,619 records across the Parquet warehouse.
- **Identifier uniqueness:** Confirmed every observation identifier was unique and nonmissing.
- **Boundary validation:** Compared sampled extracted records against the original source to detect missing or duplicated records at chunk boundaries.
- **Aggregation consistency:** Verified that monthly and annual summary totals match.

These checks validate processing consistency but do not establish the scientific accuracy of individual observations.

## Design Decisions

**Parquet storage:** Columnar storage and ZSTD compression reduce storage requirements and support efficient analytical queries.

**DuckDB processing:** DuckDB performs large-scale aggregations directly over Parquet without importing the entire observation warehouse.

**State/county aggregation:** Geographic analysis focuses on state and county identifiers rather than individual observation localities.

**Precomputed summaries:** Monthly and annual results are stored for reuse, avoiding repeated full-data scans during dashboard interactions.

## Reproducibility

The project includes Python scripts for database construction and analytical aggregation.

```bash
python scripts/build_duckdb.py
python scripts/build_summaries.py
python scripts/verify_duckdb.py
```

These commands operate on the processed Parquet warehouse. Reproducing the initial extraction requires access to the original eBird source dataset.

---

*Database schemas and query architecture are documented in `03-database-design.md`.*