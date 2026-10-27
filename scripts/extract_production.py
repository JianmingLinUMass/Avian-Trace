
import argparse
import csv
import hashlib
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import indexed_gzip
import pyarrow as pa  # type: ignore
import pyarrow.parquet as pq  # type: ignore


ROOT = Path(__file__).resolve().parent.parent

SOURCE = ROOT / "raw" / "ebd_US_relSep-2026.txt.gz"
INDEX = ROOT / "raw" / "ebird.gzidx"
OUTPUT = ROOT / "parquet" / "production"

# Same source-to-output mapping as our validated prototype.
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


def open_source():
    f = indexed_gzip.IndexedGzipFile(str(SOURCE))
    f.import_index(str(INDEX))
    return f


def atomic_json(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(data, indent=2),
        encoding="utf-8"
    )
    os.replace(temporary, path)


def file_identity(path):
    stat = path.stat()
    return {
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def prepare_plan(start_fraction, end_fraction, chunk_mib):
    if not 0 <= start_fraction < end_fraction <= 1:
        raise ValueError("Invalid start/end fractions")

    with open_source() as f:
        f.seek(0)
        header = (
            f.readline()
            .decode("utf-8-sig")
            .rstrip("\r\n")
            .split("\t")
        )
        header_end = f.tell()

        missing = set(FIELDS) - set(header)
        if missing:
            raise ValueError(
                f"Missing source columns: {sorted(missing)}"
            )

        # Reuses the gzip index.
        total_size = f.seek(0, 2)

    start = max(
        header_end,
        int(total_size * start_fraction)
    )
    end = int(total_size * end_fraction)

    if end <= start:
        raise ValueError("Selected byte range is empty")

    chunk_size = chunk_mib * 1024 * 1024

    chunks = []
    position = start

    while position < end:
        next_end = min(position + chunk_size, end)

        chunks.append({
            "id": len(chunks),
            "start": position,
            "end": next_end,
        })

        position = next_end

    configuration = {
        "format_version": 1,
        "source": str(SOURCE.resolve()),
        "source_identity": file_identity(SOURCE),
        "index": str(INDEX.resolve()),
        "index_identity": file_identity(INDEX),
        "header": header,
        "schema": list(FIELDS.items()),
        "total_size": total_size,
        "start_fraction": start_fraction,
        "end_fraction": end_fraction,
        "chunk_mib": chunk_mib,
        "chunks": chunks,
    }

    return configuration


def process_chunk(job):
    chunk, header, batch_size, output_dir = job

    chunk_id = chunk["id"]
    start = chunk["start"]
    end = chunk["end"]

    output_dir = Path(output_dir)

    final = output_dir / f"part_{chunk_id:05d}.parquet"
    temporary = output_dir / f"part_{chunk_id:05d}.tmp"
    marker = output_dir / f"part_{chunk_id:05d}.done.json"

    # Resume only after checking completed output metadata.
    if marker.exists():
        if not final.exists():
            raise RuntimeError(
                f"Chunk {chunk_id}: completion marker "
                "exists but Parquet is missing"
            )

        info = json.loads(marker.read_text(encoding="utf-8"))
        metadata = pq.read_metadata(final)

        if (
            info["start"] == start
            and info["end"] == end
            and info["rows"] == metadata.num_rows
            and info["bytes"] == final.stat().st_size
            and metadata.schema.to_arrow_schema() == SCHEMA
        ):
            print(
                f"[Chunk {chunk_id}] Already complete",
                flush=True
            )
            return metadata.num_rows

        raise RuntimeError(
            f"Chunk {chunk_id}: previous output "
            "failed validation"
        )

    started = time.monotonic()
    count = 0
    batch = []
    last_date = None

    try:
        with open_source() as f:
            # Check the preceding byte so an already
            # aligned boundary doesn't lose a row.
            if start == 0:
                f.seek(0)
            else:
                f.seek(start - 1)
                f.readline()

            # If the chunk begins inside the header,
            # or at its start, skip the header.
            if start == 0:
                f.readline()

            with pq.ParquetWriter(
                str(temporary),
                SCHEMA,
                compression="zstd"
            ) as writer:

                while True:
                    row_start = f.tell()

                    if row_start >= end:
                        break

                    raw = f.readline()
                    if not raw:
                        break

                    values = next(csv.reader(
                        [raw.decode("utf-8-sig")],
                        delimiter="\t"
                    ))

                    if len(values) != len(header):
                        raise ValueError(
                            f"Chunk {chunk_id}, offset {row_start}: "
                            f"expected {len(header)} fields, "
                            f"found {len(values)}"
                        )

                    row = dict(zip(header, values))
                    last_date = row["OBSERVATION DATE"]

                    batch.append({
                        dest: row[src] or None
                        for src, dest in FIELDS.items()
                    })
                    count += 1

                    if len(batch) >= batch_size:
                        writer.write_table(
                            pa.Table.from_pylist(
                                batch,
                                schema=SCHEMA
                            )
                        )
                        batch.clear()

                    if count % 100_000 == 0:
                        elapsed = time.monotonic() - started
                        pct = (
                            100 * (row_start - start) /
                            max(end - start, 1)
                        )

                        print(
                            f"[Chunk {chunk_id}] "
                            f"{min(100, pct):.1f}% | "
                            f"{count:,} rows | "
                            f"Year {last_date[:4]} | "
                            f"{count / max(elapsed, .001):,.0f} rows/s",
                            flush=True
                        )

                if batch:
                    writer.write_table(
                        pa.Table.from_pylist(
                            batch,
                            schema=SCHEMA
                        )
                    )

        # Validate the finished temporary Parquet.
        metadata = pq.read_metadata(temporary)

        if metadata.num_rows != count:
            raise RuntimeError(
                f"Chunk {chunk_id}: row count mismatch"
            )

        if metadata.schema.to_arrow_schema() != SCHEMA:
            raise RuntimeError(
                f"Chunk {chunk_id}: schema mismatch"
            )

        os.replace(temporary, final)

        atomic_json(marker, {
            "chunk_id": chunk_id,
            "start": start,
            "end": end,
            "rows": count,
            "bytes": final.stat().st_size,
        })

        print(
            f"[Chunk {chunk_id}] DONE: {count:,} rows "
            f"in {time.monotonic() - started:.1f}s",
            flush=True
        )
        return count

    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--chunk-mib", type=int, default=512)
    parser.add_argument("--batch-size", type=int, default=25000)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=1.0)
    parser.add_argument(
        "--output", type=Path, default=OUTPUT
    )
    parser.add_argument(
        "--plan-only", action="store_true"
    )

    args = parser.parse_args()

    if min(args.workers, args.chunk_mib, args.batch_size) < 1:
        parser.error(
            "workers, chunk-mib and batch-size must be positive"
        )

    plan = prepare_plan(
        args.start, args.end, args.chunk_mib
    )

    output = args.output.resolve()

    # Fingerprint processing settings and source identity.
    fingerprint_data = {
        k: v for k, v in plan.items()
        if k != "chunks"
    }

    fingerprint = hashlib.sha256(
        json.dumps(
            fingerprint_data, sort_keys=True
        ).encode("utf-8")
    ).hexdigest()

    plan["fingerprint"] = fingerprint

    print(
        f"Uncompressed: "
        f"{plan['total_size'] / 1024**3:.2f} GiB"
    )
    print(f"Chunks: {len(plan['chunks'])}")
    print(f"Workers: {args.workers}")
    print(f"Output: {output}", flush=True)

    if args.plan_only:
        print("Planning only; no data extracted.")
        return

    output.mkdir(parents=True, exist_ok=True)

    manifest = output / "plan.json"

    if manifest.exists():
        previous = json.loads(
            manifest.read_text(encoding="utf-8")
        )

        if previous != plan:
            raise RuntimeError(
                "Output directory contains a different plan. "
                "Choose another --output path."
            )
    else:
        if list(output.iterdir()):
            raise RuntimeError(
                "Output directory is not empty and has no plan. "
                "Choose an empty output directory."
            )
        atomic_json(manifest, plan)

    jobs = [
        (
            chunk,
            plan["header"],
            args.batch_size,
            str(output),
        )
        for chunk in plan["chunks"]
    ]

    started = time.monotonic()
    total_rows = 0

    with ProcessPoolExecutor(
        max_workers=args.workers
    ) as pool:
        futures = {
            pool.submit(process_chunk, job): job[0]["id"]
            for job in jobs
        }

        for future in as_completed(futures):
            chunk_id = futures[future]
            try:
                total_rows += future.result()
            except Exception as exc:
                print(
                    f"Chunk {chunk_id} FAILED: {exc}",
                    flush=True
                )
                raise

    duration = time.monotonic() - started

    print("\nEXTRACTION COMPLETE")
    print(f"Rows: {total_rows:,}")
    print(f"Time: {duration / 60:.1f} minutes")
    print(f"Output: {output}")


if __name__ == "__main__":
    main()
