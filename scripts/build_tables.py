
import csv
import gzip
import sqlite3
from pathlib import Path

import pyarrow as pa  # type: ignore
import pyarrow.parquet as pq  # type: ignore

# ============================================================
# Configuration
# ============================================================

ROOT = Path(__file__).resolve().parent.parent

INPUT = ROOT / "raw" / "ebd_US_relSep-2026.txt.gz"
DATABASE = ROOT / "database" / "ebird.sqlite"
PARQUET_DIR = ROOT / "parquet"

ROW_LIMIT = 100_000
BATCH_SIZE = 10_000

DATABASE.parent.mkdir(parents=True, exist_ok=True)
PARQUET_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================
# SQLite schema
# ============================================================

conn = sqlite3.connect(DATABASE)
conn.execute("PRAGMA foreign_keys = ON")

conn.executescript("""
CREATE TABLE IF NOT EXISTS taxa (
    taxon_id TEXT PRIMARY KEY,
    common_name TEXT,
    scientific_name TEXT,
    category TEXT,
    taxonomic_order INTEGER
);

CREATE TABLE IF NOT EXISTS locations (
    locality_id TEXT PRIMARY KEY,
    locality_name TEXT,
    latitude REAL,
    longitude REAL,
    state_code TEXT,
    county_code TEXT
);

CREATE TABLE IF NOT EXISTS checklists (
    checklist_id TEXT PRIMARY KEY,
    locality_id TEXT,
    observation_date TEXT,
    observer_id TEXT,
    protocol TEXT,
    duration_minutes REAL,
    distance_km REAL,
    observer_count INTEGER,
    complete_checklist INTEGER
);

CREATE TABLE IF NOT EXISTS observations (
    observation_id TEXT PRIMARY KEY,
    checklist_id TEXT,
    taxon_id TEXT,
    locality_id TEXT,
    observation_date TEXT,
    count_raw TEXT,
    observation_count INTEGER,
    FOREIGN KEY (taxon_id) REFERENCES taxa(taxon_id),
    FOREIGN KEY (locality_id) REFERENCES locations(locality_id)
);
""")

# ============================================================
# Helpers
# ============================================================

def integer_or_none(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def float_or_none(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def save_batch(batch):
    if not batch:
        return

    checklists = {}
    taxa = {}
    locations = {}
    observations = []

    for row in batch:
        taxon_id = row["TAXON CONCEPT ID"]
        locality_id = row["LOCALITY ID"]

        checklist_id = row["SAMPLING EVENT IDENTIFIER"]

        if checklist_id:
            checklists[checklist_id] = (
                checklist_id,
                row["LOCALITY ID"] or None,
                row["OBSERVATION DATE"],
                row["OBSERVER ID"] or None,
                row["PROTOCOL NAME"] or None,
                float_or_none(row["DURATION MINUTES"]),
                float_or_none(row["EFFORT DISTANCE KM"]),
                integer_or_none(row["NUMBER OBSERVERS"]),
                integer_or_none(row["ALL SPECIES REPORTED"])
            )

        if taxon_id:
            taxa[taxon_id] = (
                taxon_id,
                row["COMMON NAME"],
                row["SCIENTIFIC NAME"],
                row["CATEGORY"],
                integer_or_none(row["TAXONOMIC ORDER"])
            )

        if locality_id:
            locations[locality_id] = (
                locality_id,
                row["LOCALITY"],
                float_or_none(row["LATITUDE"]),
                float_or_none(row["LONGITUDE"]),
                row["STATE CODE"],
                row["COUNTY CODE"]
            )

        observations.append((
            row["GLOBAL UNIQUE IDENTIFIER"],
            row["SAMPLING EVENT IDENTIFIER"],
            taxon_id or None,
            locality_id or None,
            row["OBSERVATION DATE"],
            row["OBSERVATION COUNT"],
            integer_or_none(row["OBSERVATION COUNT"])
        ))

    with conn:
        conn.executemany("""
            INSERT OR IGNORE INTO checklists
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, checklists.values())

        conn.executemany("""
            INSERT OR IGNORE INTO taxa
            VALUES (?, ?, ?, ?, ?)
        """, taxa.values())

        conn.executemany("""
            INSERT OR IGNORE INTO locations
            VALUES (?, ?, ?, ?, ?, ?)
        """, locations.values())

        conn.executemany("""
            INSERT OR IGNORE INTO observations
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, observations)


# ============================================================
# Read and process
# ============================================================

print("Opening eBird dataset...", flush=True)

processed = 0
batch = []

with gzip.open(INPUT, "rt", encoding="utf-8", newline="") as source:
    reader = csv.DictReader(source, delimiter="\t")

    for row in reader:
        batch.append(row)
        processed += 1

        if len(batch) >= BATCH_SIZE:
            save_batch(batch)
            batch.clear()
            print(f"Processed {processed:,} records", flush=True)

        if processed >= ROW_LIMIT:
            break

    save_batch(batch)

# ============================================================
# Export prototype SQLite tables to Parquet
# ============================================================

for table in ("observations", "taxa", "locations"):
    cursor = conn.execute(f"SELECT * FROM {table}")
    column_names = [col[0] for col in cursor.description]
    rows = cursor.fetchall()

    data = [
        dict(zip(column_names, row))
        for row in rows
    ]

    arrow_table = pa.Table.from_pylist(data)

    pq.write_table(
        arrow_table,
        PARQUET_DIR / f"{table}.parquet",
        compression="zstd"
    )

    print(f"Exported {table}.parquet", flush=True)

# ============================================================
# Validation
# ============================================================

print("\nDatabase summary:")

for table in (
    "observations",
    "checklists",
    "taxa",
    "locations"
):
    count = conn.execute(
        f"SELECT COUNT(*) FROM {table}"
    ).fetchone()[0]

    print(f"{table}: {count:,} rows")

print("Foreign key check:", conn.execute(
    "PRAGMA foreign_key_check"
).fetchall())

conn.close()
print("\nPrototype completed!")
