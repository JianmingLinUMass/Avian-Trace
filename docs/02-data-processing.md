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

## Portable Massachusetts observation export

The offline scripts `scripts/extract_massachusetts.py` and `scripts/validate_massachusetts.py` create and audit a self-contained Massachusetts subset. They use existing DuckDB Python dependencies for native Parquet scanning, filtering, writing and exact comparisons; PyArrow reads schema/footer metadata. No pandas or nationwide Python-memory materialization is used.

### Dependencies and paths

Verified with Python 3.13, DuckDB 2.0.0 and PyArrow 26.0.0. Python 3.12+ is required for filesystem/junction checks. Install the existing pinned dependencies from the repository root (PowerShell):

```powershell
Set-Location D:\Code\Avian-Trace
py -m pip install -r requirements.txt
```

| Purpose | Default path relative to the repository |
| --- | --- |
| Input, nonrecursive | `parquet/production/part_*.parquet` |
| Validated, published dataset | `parquet/massachusetts/` |
| Unpublished work and checkpoints | `parquet/massachusetts.incomplete/` |
| Default DuckDB spill storage | `parquet/massachusetts.incomplete/.duckdb_tmp/` |

The inspected production directory contained 998 Parquet files totaling 67,498,212,129 bytes (67.50 GB / 62.86 GiB). The source file list is captured before extraction. Output/staging cannot overlap the source; source enumeration never recursively includes generated files. The existing `parquet/` Git exclusion covers exports, manifests, lock files, test exports and default temporary storage. Never force-add data artifacts. Custom output/spill locations should be outside the repository or otherwise ignored.

### Lossless selection and schema

The authoritative field is `state_code`, mapped directly from eBird's original `STATE CODE`. The only filter is `state_code = 'US-MA'`. No category, hotspot type, year, approval status, name or county restriction applies. Every matching row is retained, including duplicates and null values. Row ordering and Parquet encoding/file boundaries may change; record values do not.

Production has 30 nullable string columns. Every selected source file's schema is checked, and all columns retain their order, types and nullability. `observation_date` remains a string. Schema drift or incompatible non-nullable input schemas are rejected rather than silently converted. DuckDB statistics propagation is disabled for writing so filtering cannot turn the nullable state field into a required Parquet field; filter pushdown/native writing remain available. Validation parses dates only for reporting chronological coverage and null/unparseable counts. It does not alter or discard those values. There is no 2012–2025 restriction.

### Full extraction, validation and publication

This command performs the full extraction **and full validation before publishing**. It was not run during development:

```powershell
py scripts/extract_massachusetts.py --input "D:\Code\Avian-Trace\parquet\production" --output "D:\Code\Avian-Trace\parquet\massachusetts" --memory-limit 4GB --threads 4 --batch-size 32 --file-size-mib 256
```

DuckDB processes bounded source batches, writing ZSTD Parquet to `batch_00000.pending/`, then renaming each finished batch within staging and atomically recording its checkpoint. `--file-size-mib` is an approximate compressed target checked at row-group boundaries, not a hard cap. Files may be smaller for small batches or larger by a row group. Empty batches produce schema-bearing empty files, so an entirely empty export remains independently readable.

The manifest records source identities, batch boundaries, selection/schema/writer settings, and output SHA-256 checksums, sizes and row counts. Validation independently scans each source batch's Massachusetts rows into DuckDB-managed temporary tables, compares source/output counts and dates, and runs bidirectional full-row `EXCEPT ALL` comparisons. This verifies duplicate multiplicities and detects missing/added/altered rows even when total counts agree. It checks output schemas, unexpected files, non-Massachusetts/null states, and queries exported files alone in a fresh connection before scanning the source. Source identities/output checksums are rechecked at the end.

All generated work stays under `.incomplete` until every batch passes. Only then are `validation.json` (`passed: true`) and the validated manifest written and staging renamed to the completed destination. Default scratch storage is removed after connections close. Failures/Ctrl+C return nonzero and retain checkpoints; they never publish partial data. Existing completed destinations are always refused and left untouched. Choose a different `--output` for another export; there is no automatic overwrite of completed datasets. An OS-backed lock prevents concurrent extraction/validation of the same export. A leftover lock file is harmless: its OS lock releases on process exit.

For a **fresh independent audit** after publication:

```powershell
py scripts/validate_massachusetts.py --input "D:\Code\Avian-Trace\parquet\production" --dataset "D:\Code\Avian-Trace\parquet\massachusetts" --memory-limit 4GB --threads 4
```

The audit recomputes every batch comparison rather than trusting validation checkpoints. It does not alter or publish the dataset; it can also inspect `.incomplete` without publishing. Extraction normally makes one filtering pass, and full validation adds one filtered source pass with all columns needed for exact comparison. A fresh audit intentionally repeats validation. Schema/identity checks use footers/file metadata; output checksums read only the smaller Massachusetts export.

### Resumption and resource controls

Resume using the same input, output, subset limit, batch size and file-size target:

```powershell
py scripts/extract_massachusetts.py --input "D:\Code\Avian-Trace\parquet\production" --output "D:\Code\Avian-Trace\parquet\massachusetts" --memory-limit 4GB --threads 4 --batch-size 32 --file-size-mib 256 --resume
```

The manifest must match source paths, file list, byte sizes, nanosecond mtimes, schema, DuckDB version and extraction settings. Changed snapshots/settings are refused before resuming. Source identities use size/mtime, not a full 67.5 GB content hash: leave production immutable throughout extraction/validation. Completed batches are reused only after checksums, schema and metadata match. Partial/unrecorded/damaged batches and batches with failed row comparisons are regenerated only in the current export's owned directories; links/junctions are refused. Validated batches may reuse validation checkpoints after source/output integrity checks. Fresh validator invocations always recompute comparisons.

`--memory-limit` and `--threads` may change on resume because they do not affect selection semantics. DuckDB's limit controls its buffer manager, not all process overhead; large operations spill to disk. `--temp-directory` selects scratch storage outside source/completed/staging data directories, except for the owned default scratch path. Custom scratch is not recursively removed. Fresh validation uses separate sibling scratch storage to leave the completed dataset read-only. Allow space for output and spills. Change batch size/file-size target only for a new export.

### Small test mode and recorded results

`--max-files` limits the sorted source list. It is marked as a subset in manifests/reports and cannot use the default full-export destination:

```powershell
py -m unittest discover -s tests -p test_massachusetts_export.py -v
py scripts/extract_massachusetts.py --input parquet/production --output parquet/massachusetts-test --max-files 3 --batch-size 1 --file-size-mib 16 --memory-limit 512MB --threads 2
py scripts/validate_massachusetts.py --input parquet/production --dataset parquet/massachusetts-test --memory-limit 512MB --threads 2
```

Synthetic tests cover exact duplicates, nulls, mixed states/names, source files with no Massachusetts rows, dates before 2012/after 2025, decimal/boolean/string types, schema mismatch, invalid paths, destination refusal, locking, interrupted extraction/validation, damaged checkpoints, snapshot/settings mismatch, fresh validation and querying after the synthetic source is moved away.

The **three-file production subset only** (`part_00000.parquet`–`part_00002.parquet`) produced:

| Metric | Verified subset result |
| --- | ---: |
| Source Massachusetts rows / exported rows | 144,896 / 144,896 |
| Non-Massachusetts or null-state output rows | 0 |
| Columns | 30; schemas match |
| Parquet files | 3 |
| Parquet bytes | 4,540,933 (4.33 MiB) |
| Total files / bytes, including manifest/report | 5 / 4,547,827 |
| Observation coverage | 2012-01-01 through 2012-12-31 |
| Full-row multiset comparison | Passed |

These are not full Massachusetts figures and do not limit full-export coverage. No nationwide extraction was run during development. A full run prints actual rows, files, Parquet/total bytes and date coverage; `validation.json` retains validated Parquet statistics and coverage. Total directory bytes are measured after metadata publication in the terminal report and by fresh audits.

### Querying and sharing

Share the entire **published** `parquet/massachusetts/` folder, retaining batch subdirectories, `manifest.json` and `validation.json`. Do not share `.incomplete`, scratch directories or the external lock file as a finished export. The teammate does not need the original observations, databases or manifest source paths to read the Parquet data. Auditing completeness against the original snapshot does require that source.

Query only the exported data, replacing the path with the teammate's location:

```python
import duckdb

with duckdb.connect() as con:
    print(con.execute("""
        SELECT COUNT(*) AS rows,
               MIN(observation_date) AS first_date,
               MAX(observation_date) AS last_date
        FROM read_parquet('D:/Code/Avian-Trace/parquet/massachusetts/batch_*/*.parquet',
                          hive_partitioning=false)
    """).fetchone())
```

Normal Parquet readers can consume these files without DuckDB attachments. This export does not reconfigure the application's serving databases or API routes.

---

*Database schemas and query architecture are documented in `03-database-design.md`.*