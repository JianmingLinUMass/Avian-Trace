# Reporting-frequency data (T2 and T4)

## Scope and definition

This is additive database preparation, not a chart/API migration. Existing observation counts, species-richness calculations, holiday calculations, UpSet memberships, page URLs, filters and dashboard layouts are unchanged. The frequency tables cover **2012–2025**; legacy tables can retain other years.

**EBD-derived reporting frequency (%) = 100 × distinct complete checklists reporting a species / distinct complete checklists represented in EBD in the same geographic/time group.**

- A complete record has `complete_checklist = '1'`. Count distinct raw `checklist_id`, excluding null, empty and whitespace-only IDs. Repeated observation rows and cross-file duplicates count once within each group.
- Numerators require `category = 'species'` and a nonempty `taxon_id`.
- Denominators include **all taxon categories**, independently of the selected species. A complete checklist represented only by non-species taxa still contributes.
- Regional groups use the authoritative `state_code` or `county_code`. Hotspot groups require `locality_type = 'H'`, a county and stable `locality_id`. Personal/other locality types are excluded only from hotspot summaries.
- No protocol, approval, effort or shared-group filtering is added. Checklist IDs, rather than group IDs or location names, define distinctness.

**Limitation:** zero-observation checklists absent from EBD cannot contribute. This is not exact SED-based complete-checklist frequency, abundance, or evidence of ecological absence. H status does not guarantee public access; the existing hotspot access notice remains applicable.

Tables are sparse. A missing species row means zero reporting checklists only when the corresponding processed denominator is positive. Zero eligible checklists imply undefined frequency (`NULL`), not 0%. Missing/unprocessed coverage is unavailable data.

## Database and table schemas

Regional tables are added to `ebird.duckdb`, hotspot tables to `ebird_locations.duckdb`. `ebird_daily.duckdb` is copied **byte-identically**, without frequency tables. The nationwide trio is based on `database/`; the Massachusetts trio defaults to `database_ma/`. Construction writes copies under a work directory, never into either installed directory.

Each list below is the complete column order and type; logical keys must be unique. Counts are positive `BIGINT` values, not stored percentages.

| Database | Table | Columns in order |
| --- | --- | --- |
| `ebird.duckdb` | `complete_checklists_region_month` | `region_level VARCHAR, region_code VARCHAR, year INTEGER, month INTEGER, complete_checklists BIGINT` |
| `ebird.duckdb` | `species_checklists_region_month` | `region_level VARCHAR, region_code VARCHAR, year INTEGER, month INTEGER, taxon_id VARCHAR, reporting_checklists BIGINT` |
| `ebird.duckdb` | `complete_checklists_region_year` | `region_level VARCHAR, region_code VARCHAR, year INTEGER, complete_checklists BIGINT` |
| `ebird.duckdb` | `species_checklists_region_year` | `region_level VARCHAR, region_code VARCHAR, year INTEGER, taxon_id VARCHAR, reporting_checklists BIGINT` |
| `ebird_locations.duckdb` | `complete_checklists_hotspot_month` | `county_code VARCHAR, locality_id VARCHAR, year INTEGER, month INTEGER, complete_checklists BIGINT` |
| `ebird_locations.duckdb` | `species_checklists_hotspot_month` | `county_code VARCHAR, locality_id VARCHAR, year INTEGER, month INTEGER, taxon_id VARCHAR, reporting_checklists BIGINT` |
| `ebird_locations.duckdb` | `complete_checklists_hotspot_year` | `county_code VARCHAR, locality_id VARCHAR, year INTEGER, complete_checklists BIGINT` |
| `ebird_locations.duckdb` | `species_checklists_hotspot_year` | `county_code VARCHAR, locality_id VARCHAR, year INTEGER, taxon_id VARCHAR, reporting_checklists BIGINT` |

`region_level` is `state` or `county`; `region_code` is its corresponding raw code. Every column before the count is part of the logical key. Keys/counts must not be null. Month is 1–12.

Both frequency-bearing databases also have:

- `reporting_frequency_build(build_id VARCHAR, source_fingerprint VARCHAR, scope VARCHAR, start_year INTEGER, end_year INTEGER, denominator VARCHAR, date_policy VARCHAR, complete BOOLEAN)`.
- `reporting_frequency_coverage(year INTEGER, month INTEGER, complete BOOLEAN)`: exactly 168 year/month markers.

These markers are separate from legacy `summary_completed_years`. Partial 2026 observation summaries do not authorize 2026 frequency data. Existing table names are checked for collisions before construction; no existing table is replaced.

## Monthly and annual distinctness

Raw dates are retained. Each monthly summary independently deduplicates IDs in that month; each annual summary independently deduplicates across the entire year. **Never sum monthly counts to obtain annual counts.** Real Massachusetts data has 82,374 statewide annual distinct checklists in 2014 versus 82,375 summed monthly; checklist `S40579016` appears in two months.

Do not average percentages, sum overlapping geographic/hotspot groups, or assume that monthly counts provide exact custom-season frequencies. Exact pooled seasons, multi-year periods and hotspot combinations require distinct-checklist aggregation at the requested grain; those summaries/interactions are not implemented here. The T4 SQL below reports one row per hotspot, not a combined-set denominator.

## Runnable SQL examples

Run from the repository root in a DuckDB SQL connection (for example `duckdb.connect()` from Python and `con.execute(sql)`). Attach the candidate databases read-only. Adjust only the attachment paths for another work directory/scope. These queries inspect counts even when an immutable candidate's completion flags are pending; production consumers must separately require approved completion/coverage metadata before exposing frequency.

### T2 monthly state or county frequency

The first available Massachusetts taxon makes the example executable without guessing a taxon ID. Substitute an actual selected ID for application use. Change `region_level` to `county` and `region_code` to a county code for county results. Keep the taxon predicate in the numerator join so it cannot restrict the denominator.

```sql
ATTACH '.reporting-frequency/nationwide/candidate/ebird.duckdb' AS freq_region (READ_ONLY);
SET VARIABLE selected_taxon = (
    SELECT taxon_id FROM freq_region.species_checklists_region_year
    WHERE region_level = 'state' AND region_code = 'US-MA'
    ORDER BY taxon_id LIMIT 1
);
SELECT d.year, d.month, d.complete_checklists,
       COALESCE(n.reporting_checklists, 0) AS reporting_checklists,
       100.0 * COALESCE(n.reporting_checklists, 0)
           / NULLIF(d.complete_checklists, 0) AS reporting_frequency_pct
FROM freq_region.complete_checklists_region_month d
LEFT JOIN freq_region.species_checklists_region_month n
  ON n.region_level = d.region_level AND n.region_code = d.region_code
 AND n.year = d.year AND n.month = d.month
 AND n.taxon_id = getvariable('selected_taxon')
WHERE d.region_level = 'state' AND d.region_code = 'US-MA'
  AND d.year BETWEEN 2012 AND 2025
ORDER BY d.year, d.month;
```

### T2 annual frequency

Use the same connection and selected taxon; annual counts come from annual tables.

```sql
SELECT d.year, d.complete_checklists,
       COALESCE(n.reporting_checklists, 0) AS reporting_checklists,
       100.0 * COALESCE(n.reporting_checklists, 0)
           / NULLIF(d.complete_checklists, 0) AS reporting_frequency_pct
FROM freq_region.complete_checklists_region_year d
LEFT JOIN freq_region.species_checklists_region_year n
  ON n.region_level = d.region_level AND n.region_code = d.region_code
 AND n.year = d.year AND n.taxon_id = getvariable('selected_taxon')
WHERE d.region_level = 'state' AND d.region_code = 'US-MA'
  AND d.year BETWEEN 2012 AND 2025
ORDER BY d.year;
```

### T4 monthly and annual hotspot frequency

Use the same connection. The query chooses actual county/hotspot groups from the summaries; application filters should additionally bind selected stable locality IDs. It does not scan observations or pool hotspot denominators.

```sql
ATTACH '.reporting-frequency/nationwide/candidate/ebird_locations.duckdb' AS freq_hotspot (READ_ONLY);
SELECT d.county_code, d.locality_id, d.year, d.month, d.complete_checklists,
       COALESCE(n.reporting_checklists, 0) AS reporting_checklists,
       100.0 * COALESCE(n.reporting_checklists, 0)
           / NULLIF(d.complete_checklists, 0) AS reporting_frequency_pct
FROM freq_hotspot.complete_checklists_hotspot_month d
LEFT JOIN freq_hotspot.species_checklists_hotspot_month n
  ON n.county_code = d.county_code AND n.locality_id = d.locality_id
 AND n.year = d.year AND n.month = d.month
 AND n.taxon_id = getvariable('selected_taxon')
WHERE d.county_code = 'US-MA-017' AND d.year BETWEEN 2012 AND 2025
ORDER BY d.locality_id, d.year, d.month;
```

```sql
SELECT d.county_code, d.locality_id, d.year, d.complete_checklists,
       COALESCE(n.reporting_checklists, 0) AS reporting_checklists,
       100.0 * COALESCE(n.reporting_checklists, 0)
           / NULLIF(d.complete_checklists, 0) AS reporting_frequency_pct
FROM freq_hotspot.complete_checklists_hotspot_year d
LEFT JOIN freq_hotspot.species_checklists_hotspot_year n
  ON n.county_code = d.county_code AND n.locality_id = d.locality_id
 AND n.year = d.year AND n.taxon_id = getvariable('selected_taxon')
WHERE d.county_code = 'US-MA-017' AND d.year BETWEEN 2012 AND 2025
ORDER BY d.locality_id, d.year;
```

## Portable build procedure

**The production aggregation is already complete and validated. Do not rerun it for consolidation or publication.** The following commands document future builds of a new source snapshot in a fresh work directory.

Use Python 3.12+ and the repository's pinned DuckDB Python dependency. No new dependency is required:

```powershell
py -m pip install -r requirements.txt
```

Defaults are anchored to the script's repository root, independent of the caller's current directory. Explicit relative arguments are resolved against the caller's working directory. All examples below run from the repository root.

| Setting | Nationwide default | Massachusetts default |
| --- | --- | --- |
| `--scope` | `nationwide` | `US-MA` |
| `--input` | `parquet/production` | `parquet_ma/production` |
| `--base-databases` | `database` | `database_ma` |
| `--output-databases` (future publication destination) | `database` | `database_ma` |
| `--work` / `--checkpoint-directory` | `.reporting-frequency/nationwide` | `.reporting-frequency/massachusetts` |
| `--scratch-directory` | `<work>/scratch` | `<work>/scratch` |

Each base must contain the existing three closed/checkpointed databases with their legacy tables and without the frequency-owned table names. If frequency tables are already installed, use the retained pre-frequency originals as the explicit base for a new generation; never drop installed tables to make room. This builder adds frequency summaries; it does **not** create the legacy baseline from scratch. If a Massachusetts baseline is stored elsewhere, explicitly override `--base-databases`. An absent `database_ma/` fails rather than silently copying nationwide tables. Inputs are only `part_*.parquet` immediately inside the specified production directory; root prototype/catalog Parquet files are not scanned.

```powershell
# Future fresh nationwide construction only; no installed database is replaced.
py scripts/build_reporting_frequency.py --scope nationwide --memory-limit 16GB --threads 4 --workers 2

# Future fresh Massachusetts construction; requires the Massachusetts baseline trio.
py scripts/build_reporting_frequency.py --scope US-MA --memory-limit 16GB --threads 4

# Explicit relative paths and separate checkpoints/scratch for a new generation.
py scripts/build_reporting_frequency.py --scope nationwide --input parquet/production --base-databases database --output-databases database --checkpoint-directory .reporting-frequency/nationwide-next --scratch-directory .reporting-frequency/scratch/nationwide-next --memory-limit 16GB --threads 4 --workers 2
```

Construction preserves byte copies in `<work>/originals/`, creates eight checksum-verified Parquet files plus `complete.json` in each `<work>/years/<year>/`, then adds only the new tables to `<work>/candidate/`. Candidate filenames remain `ebird.duckdb`, `ebird_daily.duckdb`, `ebird_locations.duckdb`. A fresh build validates before setting its own new completion metadata. No API or installed database is changed.

Source file names, sizes, modification times and SHA-256 hashes, policy/DuckDB version, original hashes and proposed destination hashes are recorded in `manifest.json`. Source snapshots must remain immutable. Memory/thread/worker/scratch settings can change without changing counting semantics. Each worker has its own memory/thread limit: two 16GB workers may use 32GB of DuckDB buffers plus process overhead. Source scans use native DuckDB operations, not pandas or whole-dataset Python collections. Independent validation can be more expensive than construction because it checks every group.

Allow disk space for originals, candidates, yearly Parquet outputs, temporary year databases, validation databases, spill and future publication backups. The initial free-space check is a minimum, not a peak-space guarantee. Use a distinct scratch root per work generation. Scratch must not overlap inputs, installed databases, candidates, originals or checkpoint/result directories.

Default work/scratch, `database_ma/` and generated DuckDB files are ignored by Git. Ignore any custom data/work paths too. Never commit generated databases, Parquet, checkpoints or validation artifacts.

## Validation and recovery

For a future interrupted construction, repeat the original command with `--resume`. Source/policy identities and base hashes must match. Each completed year is SHA-256 checked and skipped; only genuinely incomplete/corrupt yearly work is regenerated. **Retain a copy of any incomplete work before authorizing repair** if it may be needed for diagnosis. Old serial scratch files are not automatically discarded by the consolidated builder.

Once a candidate exists, `finalize` refuses to overwrite it. Resuming a built/validated generation skips aggregation and candidate assembly and performs a read-only audit; it does not reset completion flags. A partially assembled candidate must be preserved and investigated, not silently deleted/replaced. OS locks prevent competing jobs; the lock file itself is not a completion marker. Never start a second worker pool while original workers are alive.

For existing completed work, use the validator directly. It leaves candidate bytes, flags, source data and historical manifest unchanged. `PAUSE_BEFORE_VALIDATION` is honored unless `--ignore-pause` is explicitly supplied after validation approval; that option does not remove the marker. `PUBLICATION_BLOCKED` is never removed by validation. Select a new report filename if one already exists.

```powershell
# Fresh/default-path generation: audit candidates without reconstructing them.
py scripts/validate_reporting_frequency.py --work .reporting-frequency/nationwide --ignore-pause --memory-limit 16GB --threads 4 --workers 2 --report .reporting-frequency/reports/nationwide-audit.json
py scripts/validate_reporting_frequency.py --work .reporting-frequency/massachusetts --ignore-pause --memory-limit 16GB --threads 4 --report .reporting-frequency/reports/massachusetts-audit.json

# Existing work may live anywhere; supply its path without editing source code.
$FrequencyWork = Read-Host 'Existing completed checkpoint directory'
py scripts/validate_reporting_frequency.py --work "$FrequencyWork" --ignore-pause --scratch-directory .reporting-frequency/scratch/audit --memory-limit 16GB --threads 4 --workers 2 --report .reporting-frequency/reports/existing-audit.json

# Cross-scope reconciliation of every Massachusetts row in all eight tables.
py scripts/validate_reporting_frequency.py --nationwide .reporting-frequency/nationwide/candidate --massachusetts .reporting-frequency/massachusetts/candidate --report .reporting-frequency/reports/cross-scope.json
```

`--input`, `--candidates`, and `--originals` on the validator support relocated snapshots/copies without rewriting historical provenance. Recorded source identities and original hashes must still match. Validation-year receipts are tied to the source fingerprint and all three candidate file hashes; compatible receipts are reused. A changed candidate cannot reuse stale receipts.

The validator uses independent raw SQL: select distinct raw checklist/geography/time/taxon keys, then count rows. It compares all rows in both directions, checks key uniqueness, exact schemas, positive counts, numerator ≤ denominator, independently computed annual counts, monthly/annual bounds, policy metadata and all 168 coverage markers. It compares existing tables exactly with `EXCEPT ALL`, including duplicate multiplicity, or uses identical whole-file SHA-256 for an unchanged database. It also compares schemas, indexes, constraints, defaults, generated expressions, comments, tags, views, user types, sequences and database-level metadata. Original backup hashes and unchanged source/candidate hashes are required.

The completed production audit passed all eight tables for all fourteen years in both datasets, and every Massachusetts group matched nationwide results with zero discrepancies. All 32 pre-existing tables across both trios were preserved; both daily databases remained byte-identical. The consolidation itself uses synthetic regression tests only and does not repeat that completed national audit.

```powershell
py -m unittest discover -s tests -p "test_*.py" -v
npm test
```

Tests cover cross-file duplicates, non-species denominators, incomplete/empty IDs, H-only eligibility, missing groups, year boundaries, raw-date conflicts, checkpoint identity, parallel work, path defaults/overrides, immutable audits, completed-candidate resume, catalog/content corruption and publication rollback. They build/publish only temporary synthetic fixtures.

## Completion flags and publication recommendation

**Publication is a separate, unapproved milestone. Do not publish during consolidation.** The validated nationwide candidates still contain `false` in their new completion/coverage flags. Preserve those files, their hashes, all checkpoints, originals and validation reports exactly. The publisher now refuses incomplete flags; a read-only validation pass does not activate them.

Recommended procedure after explicit publication/path approval:

1. Make a separate publication-generation copy of the three immutable candidates and verify its initial hashes against the successful audit. Retain the original candidates and reports unchanged.
2. In those copies only, set `reporting_frequency_build.complete` and `reporting_frequency_coverage.complete` to true for the validated generation. Do not change build IDs, source fingerprints, policy fields, coverage keys or any existing/frequency count table. Keep the daily database byte-identical.
3. Record an activation report linking the original audit/hashes to the new publication hashes. Prove exact equality of every legacy and frequency count table, catalog metadata, and all other build/coverage fields; the two intended boolean updates must be the only logical differences. This preserves the original validation evidence and establishes evidence for the changed file hashes without rerunning aggregation.
4. Review explicit source, destination, independent backup and rollback paths. Historical manifests retain their original proposed destinations; do not rewrite them or blindly run `--publish-only` against an obsolete destination. Publication of these generations needs a separately reviewed destination/activation plan.
5. Stop affected backends before replacement. Preserve verified backups of all installed files, stage closed copies beside the approved destinations, recheck hashes, and use a publication journal. Three file replacements are not a single filesystem transaction. After an interruption, restore the entire previous trio from the same verified backup generation before restarting; never mix generations.

No activation copies, completion updates, installed replacements or publication steps are performed by this consolidation. `database/` and `database_ma/` remain distinct, and the existing application does not automatically switch to frequency tables.
