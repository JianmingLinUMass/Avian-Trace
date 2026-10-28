# U.S. eBird Observation Explorer

A CS571 Data Visualization project exploring bird observation patterns across the United States from **2012 to 2026** using the eBird Basic Dataset (EBD).

The project focuses on geographic distributions, seasonal patterns, species reporting trends, and comparisons across states and counties.

## Dataset

| Metric | Value |
|---|---|
| Source | eBird Basic Dataset, September 2026 |
| Observations | 1,350,644,619 |
| Geographic coverage | United States |
| Time range | 2012–2026 (through September) |
| Retained attributes | 30 |
| Parquet storage | 62.86 GiB |

## Technology Stack

- **Python:** Data extraction and preprocessing
- **Parquet:** Compressed observation storage
- **DuckDB:** Analytical queries and precomputed summaries
- **D3.js:** Interactive data visualization
- **Python API:** Data delivery to the frontend (planned)

## Project Structure

```text
ebird/
├── database/
│   └── ebird.duckdb
├── parquet/
│   └── production/
├── scripts/
│   ├── build_duckdb.py
│   ├── build_summaries.py
│   └── verify_duckdb.py
├── backend/              # Planned
├── frontend/             # Planned
└── docs/
```

## Data Architecture

The original observations are stored in Parquet. DuckDB maintains taxonomy, state/county reference tables, and precomputed annual and monthly summaries.

| Summary table | Rows |
|---|---:|
| `species_region_year` | 10,210,147 |
| `species_region_month` | 48,305,753 |

The planned D3.js dashboard will retrieve aggregated data through a Python API rather than loading raw observations.

## Getting Started

Install the Python dependencies:

```bash
pip install duckdb pyarrow pandas
```

Build and verify the database:

```bash
python scripts/build_duckdb.py
python scripts/build_summaries.py
python scripts/verify_duckdb.py
```

These commands assume the production Parquet files are already available.

## Notes

- Observation counts represent reporting records, **not bird population estimates**.
- Reporting patterns are influenced by birdwatching participation and effort.
- Data for 2026 is incomplete and ends September 30.

## Documentation

Detailed information about data processing, database design, performance, and visualization methodology is maintained in `docs/`.
