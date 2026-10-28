# U.S. eBird Observation Explorer

CS571 Data Visualization project exploring bird observation patterns across the United States (2012–2026) using the eBird Basic Dataset.

## Quick Start

Install dependencies and start the server:

```bash
npm install
npm start
```

The server runs at `http://127.0.0.1:3000`.

**Test pages:**

- [D3 Visualization Test](http://127.0.0.1:3000/test.html) — Northern Cardinal observations in Massachusetts (2012–2025).
- [API Health Check](http://127.0.0.1:3000/api/health)
- [Database Query Test](http://127.0.0.1:3000/api/region-summary?region=US-MA)
- [Species Trend API](http://127.0.0.1:3000/api/species-trend?region=US-MA&taxon_id=avibase-4E74AE22)

Requires `database/ebird.duckdb` locally. The D3 test uses an external CDN.

## Tech Stack

- **Python** — Data processing
- **Parquet** — Observation storage
- **DuckDB** — Analytical database
- **Node.js + Express** — Backend API
- **D3.js** — Frontend visualizations

## Important: Python Usage

Python is ONLY used for offline data processing and testing.

The application uses Node.js + Express, DuckDB, and D3.js.

## Project Structure

```text
ebird/
├── backend/       # API and SQL queries
├── frontend/      # D3 visualizations
├── database/      # DuckDB database (not tracked by Git)
├── parquet/       # Processed observations (not tracked by Git)
├── scripts/       # Data processing and verification
└── docs/          # Technical documentation
```

## Notes

- Data covers 2012–September 2026.
- Observation records are not population estimates.
- Large datasets and database files are excluded from Git. 
    - See this Google Drive!
- See `docs/` for data processing and database details.
