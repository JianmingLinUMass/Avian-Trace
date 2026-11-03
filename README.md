# U.S. eBird Observation Explorer

CS571 Data Visualization project exploring bird observation patterns across the United States using the eBird Basic Dataset (2012–September 2026).

## 📦 Project Data

**[Download Project Data — Google Drive](https://drive.google.com/drive/folders/1dYRLeSEYjXCO4iDgs1_9ARdvllL0kgPN?usp=drive_link)**

Download the `database/` and `parquet/` folders and place them in the project root.

The project uses two DuckDB databases:

| Database | Purpose |
|---|---|
| `ebird.duckdb` | Species, geography, annual and monthly observation trends |
| `ebird_daily.duckdb` | Holiday dates, annual average daily bird counts, and holiday-specific counts |

## 🚀 Quick Start

Install dependencies and start the server:

```bash
npm install
npm start
```

The server runs at http://127.0.0.1:3000.

### Visualization Test Pages

- [Species Trend Visualization](http://127.0.0.1:3000/test.html) — Northern Cardinal observations in Massachusetts (2012–2025).
- [Holiday Comparison Visualization](http://127.0.0.1:3000/holiday-test.html) — Compare holiday bird counts with annual average daily counts across multiple years.

### API Test Endpoints

- [API Health Check](http://127.0.0.1:3000/api/health)
- [Region Summary](http://127.0.0.1:3000/api/region-summary?region=US-MA)
- [Species Trend](http://127.0.0.1:3000/api/species-trend?region=US-MA&taxon_id=avibase-4E74AE22)
- [Holiday Comparison](http://127.0.0.1:3000/api/holiday-comparison?species=House%20Sparrow&region=US-MA-017&level=county&holiday=Christmas%20Day)

## ⚠️ Important: Python Usage

**Python is ONLY used for offline data processing and testing.**

The application itself uses **Node.js + Express, DuckDB, and D3.js**.

Python is not required to run the application when the processed project data has already been downloaded.

## 🛠️ Tech Stack

- **Python** — Offline processing and testing
- **Parquet** — Observation storage
- **DuckDB** — Analytical databases
- **Node.js + Express** — Backend API
- **D3.js** — Interactive frontend visualizations

## 📁 Project Structure

```text
ebird/
├── backend/       # Express API and SQL queries
├── frontend/      # D3 visualizations
├── database/      # DuckDB databases
│   ├── ebird.duckdb
│   └── ebird_daily.duckdb
├── parquet/       # Processed observations
├── scripts/       # Offline processing and testing
└── docs/          # Technical documentation
```

## 🗄️ DuckDB Tables

### Main Database — `ebird.duckdb`

| Table | Description |
|---|---|
| `taxa` | Bird taxonomy and species identifiers |
| `states` | State codes, names, and observation totals |
| `counties` | County codes, names, and observation totals |
| `species_region_year` | Annual species observation counts by state/county |
| `species_region_month` | Monthly species observation counts by state/county |
| `summary_completed_years` | Years covered by the generated summaries |

Inspect the main database:

```bash
python scripts/inspect_duckdb.py
```

### Holiday Database — `ebird_daily.duckdb`

| Table | Description |
|---|---|
| `holidays` | U.S. holiday dates and names |
| `species_region_year_avg` | Annual average daily reported bird counts by species and state/county |
| `species_region_holiday` | Holiday-specific reported bird counts by species and state/county |

Inspect the holiday database:

```bash
python scripts/inspect_duckdb_daily.py
```

## 🐦 Holiday Bird Count Comparison

The holiday visualization compares the number of birds reported on a selected holiday against the average number reported per calendar day in the same year.

For example, users can explore **House Sparrow observations in Middlesex County, Massachusetts, on Christmas Day from 2012–2025**.

The visualization supports:

- Selecting different bird species.
- Comparing observations at the state or county level.
- Selecting different U.S. holidays.
- Exploring year-to-year changes through an interactive D3 line chart.

## 📝 Notes

- The underlying dataset covers January 2012 through September 2026.
- Holiday comparisons currently cover complete years from 2012 through 2025.
- Observation records are not bird population estimates.
- Reported bird counts can be influenced by seasonal changes and birdwatching activity.
- Database and Parquet files are excluded from Git.
- See `docs/` for additional technical documentation.