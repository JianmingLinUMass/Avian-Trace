
import csv
import json
import os
import time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
import multiprocessing as mp

import indexed_gzip
import pyarrow as pa  # type: ignore
import pyarrow.parquet as pq  # type: ignore

# ============================================================
# CONFIGURATION
# ============================================================

ROOT = Path(__file__).resolve().parent.parent

# Change these paths to your actual file locations.
INPUT = ROOT / "raw" / "ebd_US_relSep-2026.txt.gz"
INDEX = ROOT / "raw" / "ebird.gzidx"

OUTPUT = ROOT / "parquet" / "test_1million"

ROW_LIMIT = 1_000_000
WORKERS = 2
BATCH_SIZE = 25_000
PROGRESS_INTERVAL = 100_000

# Keep enough information to construct all four core tables.
# All values are initially stored as strings. We will perform
# typed conversions during the database-building stage.
FIELDS = {
    "GLOBAL UNIQUE IDENTIFIER": "observation_id",
    "TAXON CONCEPT ID": "taxon_id",
    "COMMON NAME": "common_name",
    "SCIENTIFIC NAME": "scientific_name",
    "CATEGORY": "category",
    "TAXONOMIC ORDER": "taxonomic_order",
    "EXOTIC CODE": "exotic_code",
    "OBSERVATION COUNT": "count_raw",
    "BREEDING CODE": "breeding_code",
    "BREEDING CATEGORY": "breeding_category",
    "SAMPLING EVENT IDENTIFIER": "checklist_id",
    "OBSERVER ID": "observer_id",
    "OBSERVATION DATE": "observation_date",
    "TIME OBSERVATIONS STARTED": "start_time",
    "LOCALITY ID": "locality_id",
    "LOCALITY": "locality_name",
    "LOCALITY TYPE": "locality_type",
    "LATITUDE": "latitude",
    "LONGITUDE": "longitude",
    "STATE CODE": "state_code",
    "COUNTY CODE": "county_code",
    "PROTOCOL NAME": "protocol",
    "DURATION MINUTES": "duration_minutes",
    "EFFORT DISTANCE KM": "distance_km",
    "EFFORT AREA HA": "effort_area_ha",
    "NUMBER OBSERVERS": "observer_count",
    "ALL SPECIES REPORTED": "complete_checklist",
    "GROUP IDENTIFIER": "group_id",
    "APPROVED": "approved",
    "REVIEWED": "reviewed",
}

SCHEMA = pa.schema([
    pa.field(name, pa.string())
    for name in FIELDS.values()
])


# ============================================================
# HELPERS
# ============================================================

def open_gzip():
    f = indexed_gzip.IndexedGzipFile(str(INPUT))
    f.import_index(str(INDEX))
    return f


def read_header(f):
    f.seek(0)
    return (
        f.readline()
        .decode("utf-8-sig")
        .rstrip("\r\n")
        .split("\t")
    )


def write_batch(writer, batch):
    if batch:
        table = pa.Table.from_pylist(
            batch,
            schema=SCHEMA
        )
        writer.write_table(table)
        batch.clear()


# ============================================================
# PREPARE EXACT ROW BOUNDARIES
# ============================================================

def prepare_ranges():
    OUTPUT.mkdir(parents=True, exist_ok=True)

    manifest_path = OUTPUT / "ranges.json"

    # Reuse boundaries on restart.
    if manifest_path.exists():
        with open(manifest_path, encoding="utf-8") as inp:
            manifest = json.load(inp)

        if (
            manifest["row_limit"] != ROW_LIMIT
            or manifest["workers"] != WORKERS
            or manifest["input_size"] != INPUT.stat().st_size
        ):
            raise RuntimeError(
                "Existing manifest does not match configuration. "
                "Use a new output directory."
            )

        print("Reusing saved chunk boundaries.", flush=True)
        return manifest["header"], manifest["ranges"]

    print("Finding chunk boundaries...", flush=True)

    # Scan only the first ROW_LIMIT source records.
    with open_gzip() as f:
        header = read_header(f)

        missing = set(FIELDS) - set(header)
        if missing:
            raise ValueError(f"Missing columns: {sorted(missing)}")

        positions = [f.tell()]
        rows_per_worker = [
            ROW_LIMIT // WORKERS
            + (1 if i < ROW_LIMIT % WORKERS else 0)
            for i in range(WORKERS)
        ]

        total_rows = 0

        for target_rows in rows_per_worker:
            for _ in range(target_rows):
                line = f.readline()
                if not line:
                    break
                total_rows += 1

            positions.append(f.tell())

            print(
                f"Located boundary after {total_rows:,} rows",
                flush=True
            )

            if total_rows < sum(rows_per_worker[:len(positions)-1]):
                break

    ranges = []

    for i in range(len(positions) - 1):
        if positions[i] < positions[i + 1]:
            ranges.append([
                positions[i], positions[i + 1]
            ])

    manifest = {
        "row_limit": ROW_LIMIT,
        "workers": WORKERS,
        "input_size": INPUT.stat().st_size,
        "actual_rows": total_rows,
        "header": header,
        "ranges": ranges,
    }

    temp = manifest_path.with_suffix(".json.tmp")
    temp.write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8"
    )
    os.replace(temp, manifest_path)

    return header, ranges


# ============================================================
# PARALLEL WORKER
# ============================================================

def process_chunk(worker_id, start, end, header):
    destination = OUTPUT / f"part_{worker_id:03d}.parquet"
    marker = OUTPUT / f"part_{worker_id:03d}.done.json"
    temporary = OUTPUT / f"part_{worker_id:03d}.parquet.tmp"

    if marker.exists():
        if not destination.exists():
            raise RuntimeError(
                f"Worker {worker_id}: marker exists but output is missing"
            )

        metadata = json.loads(marker.read_text(encoding="utf-8"))
        actual = pq.read_metadata(destination).num_rows

        if actual != metadata["rows"]:
            raise RuntimeError("Completed file row count mismatch")

        print(f"[Worker {worker_id}] Already complete", flush=True)
        return metadata["rows"]

    start_time = time.monotonic()
    count = 0
    batch = []
    writer = None

    try:
        with open_gzip() as f:
            f.seek(start)

            with pq.ParquetWriter(
                str(temporary),
                SCHEMA,
                compression="zstd"
            ) as writer:

                while f.tell() < end:
                    line = f.readline()

                    if not line:
                        break

                    # Each source record is expected to occupy
                    # a single physical TSV line.
                    values = next(csv.reader(
                        [line.decode("utf-8-sig")],
                        delimiter="\t"
                    ))

                    if len(values) != len(header):
                        raise ValueError(
                            f"Worker {worker_id}: invalid column count "
                            f"at row {count + 1}: "
                            f"{len(values)} vs {len(header)}"
                        )

                    row = dict(zip(header, values))

                    batch.append({
                        dest: row[src] or None
                        for src, dest in FIELDS.items()
                    })

                    count += 1

                    if len(batch) >= BATCH_SIZE:
                        write_batch(writer, batch)

                    if count % PROGRESS_INTERVAL == 0:
                        elapsed = time.monotonic() - start_time
                        speed = count / max(elapsed, 0.001)

                        print(
                            f"[Worker {worker_id}] "
                            f"{count:,} rows | "
                            f"{speed:,.0f} rows/s | "
                            f"{elapsed:.1f}s",
                            flush=True
                        )

                write_batch(writer, batch)

        # Publish only after ParquetWriter closed successfully.
        os.replace(temporary, destination)

        metadata = {
            "worker": worker_id,
            "rows": count,
            "start": start,
            "end": end,
        }

        temp_marker = marker.with_suffix(".json.tmp")
        temp_marker.write_text(
            json.dumps(metadata, indent=2),
            encoding="utf-8"
        )
        os.replace(temp_marker, marker)

        elapsed = time.monotonic() - start_time

        print(
            f"[Worker {worker_id}] Completed "
            f"{count:,} rows in {elapsed:.1f}s",
            flush=True
        )

        return count

    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise


# ============================================================
# MAIN
# ============================================================

def main():
    started = time.monotonic()

    print("eBird Parquet Extractor")
    print(f"Input: {INPUT}")
    print(f"Output: {OUTPUT}")
    print(f"Workers: {WORKERS}")
    print(f"Test limit: {ROW_LIMIT:,} rows\n", flush=True)

    header, ranges = prepare_ranges()

    jobs = [
        (i + 1, start, end, header)
        for i, (start, end) in enumerate(ranges)
    ]

    print("\nStarting parallel extraction...", flush=True)

    # Windows uses spawn; workers reopen the indexed file.
    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(
            process_chunk,
            *zip(*jobs)
        ))

    total = sum(results)
    elapsed = time.monotonic() - started

    print("\n" + "=" * 55)
    print("EXTRACTION FINISHED")
    print(f"Source rows converted: {total:,}")
    print(f"Parquet output: {OUTPUT}")
    print(f"Elapsed: {elapsed:.1f} seconds")
    print("=" * 55)


if __name__ == "__main__":
    mp.freeze_support()
    main()
