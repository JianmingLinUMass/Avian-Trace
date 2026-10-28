# U.S. eBird Observation Explorer

CS571 Data Visualization project exploring bird observation patterns across the United States (2012–2026) using the eBird Basic Dataset.

## 📦 Project Data

**[Download Project Data — Google Drive](https://drive.google.com/drive/folders/1dYRLeSEYjXCO4iDgs1_9ARdvllL0kgPN?usp=drive_link)**

Download the `database/` and `parquet/` folders and place them in the project root.

## Quick Start

Install dependencies and start the server:

```bash
npm install
npm start
```

The server runs at `http://127.0.0.1:3000`.

**Test Pages:**

- [D3 Visualization Test](http://127.0.0.1:3000/test.html) — Northern Cardinal observations in Massachusetts (2012–2025).
- [API Health Check](http://127.0.0.1:3000/api/health)
- [Database Query Test](http://127.0.0.1:3000/api/region-summary?region=US-MA)
- [Species Trend API](http://127.0.0.1:3000/api/species-trend?region=US-MA&taxon_id=avibase-4E74AE22)

## ⚠️ Important: Python Usage

**Python is ONLY used for offline data processing and testing.**

**The application uses Node.js + Express, DuckDB, and D3.js.**

## Tech Stack

- **Python** — Offline processing and testing
- **Parquet** — Observation storage
- **DuckDB** — Analytical database
- **Node.js + Express** — Backend API
- **D3.js** — Frontend visualization

## Project Structure

```text
ebird/
├── backend/       # API and SQL queries
├── frontend/      # D3 visualizations
├── database/      # DuckDB database
├── parquet/       # Processed observations
├── scripts/       # Data processing and testing
└── docs/          # Technical documentation
```

## Notes

- Data covers 2012–September 2026.
- Observation records are not bird population estimates.
- Database and Parquet files are excluded from Git.
- See `docs/` for data processing and database details.