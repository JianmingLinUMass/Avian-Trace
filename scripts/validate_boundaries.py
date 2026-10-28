
import json
import csv
import sys
import time
from pathlib import Path

import indexed_gzip
import pyarrow.parquet as pq  # type: ignore


ROOT = Path(__file__).resolve().parent.parent

TESTS = [
    "test_start",
    "test_10pct",
    "test_50pct",
    "test_90pct",
]

PROGRESS_INTERVAL = 100_000


def parquet_ids(path):
    """Stream IDs from a Parquet file in original row order."""
    parquet = pq.ParquetFile(path)

    for batch in parquet.iter_batches(
        batch_size=10_000,
        columns=["observation_id"]
    ):
        for observation_id in batch.column(0).to_pylist():
            yield observation_id


def source_ids(f, start, end, header, id_index):
    """Stream complete TSV records assigned to one byte range."""

    # Match the production extractor's boundary alignment.
    if start == 0:
        f.seek(0)
        f.readline()  # Skip header
    else:
        f.seek(start - 1)
        f.readline()  # Discard preceding partial record

    while True:
        row_start = f.tell()

        if row_start >= end:
            return

        raw = f.readline()
        if not raw:
            return

        values = next(csv.reader(
            [raw.decode("utf-8-sig")],
            delimiter="\t"
        ))

        if len(values) != len(header):
            raise ValueError(
                f"Invalid source record at offset {row_start}: "
                f"{len(values)} fields instead of {len(header)}"
            )

        yield values[id_index]


def validate_chunk(
    f, folder, chunk, header, id_index
):
    chunk_id = chunk["id"]
    start = chunk["start"]
    end = chunk["end"]

    parquet_path = folder / f"part_{chunk_id:05d}.parquet"
    marker_path = folder / f"part_{chunk_id:05d}.done.json"

    if not parquet_path.exists() or not marker_path.exists():
        raise FileNotFoundError(
            f"Chunk {chunk_id}: missing output or completion marker"
        )

    marker = json.loads(
        marker_path.read_text(encoding="utf-8")
    )

    if marker["start"] != start or marker["end"] != end:
        raise ValueError(
            f"Chunk {chunk_id}: marker range mismatch"
        )

    metadata = pq.read_metadata(parquet_path)

    if metadata.num_rows != marker["rows"]:
        raise ValueError(
            f"Chunk {chunk_id}: Parquet row count mismatch"
        )

    expected = source_ids(
        f, start, end, header, id_index
    )
    actual = parquet_ids(parquet_path)

    count = 0
    first_id = None
    last_id = None
    started = time.monotonic()

    while True:
        source_id = next(expected, None)
        parquet_id = next(actual, None)

        if source_id is None and parquet_id is None:
            break

        if source_id != parquet_id:
            raise AssertionError(
                f"\nChunk {chunk_id} mismatch at record "
                f"{count + 1:,}:\n"
                f"Source ID:  {source_id}\n"
                f"Parquet ID: {parquet_id}"
            )

        if first_id is None:
            first_id = source_id

        last_id = source_id
        count += 1

        if count % PROGRESS_INTERVAL == 0:
            print(
                f"  Checked {count:,} records...",
                flush=True
            )

    if count != metadata.num_rows:
        raise AssertionError(
            f"Chunk {chunk_id}: expected "
            f"{metadata.num_rows:,}, checked {count:,}"
        )

    elapsed = time.monotonic() - started

    print(
        f"  PASSED: {count:,} records "
        f"matched in {elapsed:.1f}s",
        flush=True
    )

    return {
        "chunk": chunk_id,
        "rows": count,
        "first_id": first_id,
        "last_id": last_id,
    }


def validate_test(name):
    folder = ROOT / "parquet" / name
    plan_path = folder / "plan.json"

    print(f"\n{'=' * 60}")
    print(f"VALIDATING: {name}")
    print("=" * 60, flush=True)

    if not plan_path.exists():
        raise FileNotFoundError(plan_path)

    plan = json.loads(
        plan_path.read_text(encoding="utf-8")
    )

    source_path = Path(plan["source"])
    index_path = Path(plan["index"])
    header = plan["header"]

    if not source_path.exists() or not index_path.exists():
        raise FileNotFoundError(
            "Source gzip or index is missing"
        )

    if (
        source_path.stat().st_size
        != plan["source_identity"]["size"]
    ):
        raise RuntimeError("Source file size changed")

    if (
        index_path.stat().st_size
        != plan["index_identity"]["size"]
    ):
        raise RuntimeError("Index file size changed")

    id_index = header.index("GLOBAL UNIQUE IDENTIFIER")

    results = []

    with indexed_gzip.IndexedGzipFile(
        str(source_path)
    ) as f:

        f.import_index(str(index_path))

        # Validate chunks in source order.
        chunks = sorted(
            plan["chunks"],
            key=lambda c: c["start"]
        )

        for i, chunk in enumerate(chunks):
            print(
                f"\nChunk {chunk['id']}: "
                f"bytes {chunk['start']:,}–{chunk['end']:,}",
                flush=True
            )

            # Check adjacent byte ranges.
            if i > 0:
                previous = chunks[i - 1]
                if previous["end"] != chunk["start"]:
                    raise AssertionError(
                        "Chunk byte ranges are not contiguous"
                    )

            result = validate_chunk(
                f, folder, chunk, header, id_index
            )
            results.append(result)

    total = sum(r["rows"] for r in results)

    print(f"\n{name}: PASSED")
    print(f"Total verified: {total:,} records")

    return total


def main():
    grand_total = 0
    started = time.monotonic()

    for name in TESTS:
        grand_total += validate_test(name)

    print(f"\n{'=' * 60}")
    print("ALL BOUNDARY TESTS PASSED")
    print("=" * 60)
    print(f"Verified records: {grand_total:,}")
    print(
        f"Elapsed time: "
        f"{time.monotonic() - started:.1f}s"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"\nVALIDATION FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
