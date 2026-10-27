
import duckdb
import pyarrow.parquet as pq
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARQUET_DIR = ROOT / "parquet"

TESTS = [
    "test_10pct",
    "test_50pct",
    "test_90pct",
]


def validate_test(name):
    folder = PARQUET_DIR / name
    files = sorted(folder.glob("part_*.parquet"))

    print(f"\n{'=' * 60}")
    print(f"Validating: {name}")
    print("=" * 60)

    if not files:
        print("SKIPPED: No Parquet files found.")
        return False

    # Check each file's Parquet metadata
    metadata_rows = 0

    for file in files:
        metadata = pq.read_metadata(file)
        metadata_rows += metadata.num_rows

        print(
            f"  {file.name}: "
            f"{metadata.num_rows:,} rows"
        )

    con = duckdb.connect()

    pattern = (folder / "part_*.parquet").as_posix()

    result = con.execute("""
        SELECT
            COUNT(*) AS total_rows,
            COUNT(DISTINCT observation_id) AS unique_ids,
            COUNT(*) FILTER (
                WHERE observation_id IS NULL
                   OR observation_id = ''
            ) AS missing_ids,
            COUNT(DISTINCT taxon_id) AS unique_taxa,
            COUNT(DISTINCT locality_id) AS unique_locations,
            COUNT(DISTINCT checklist_id) AS unique_checklists,
            MIN(observation_date) AS earliest_date,
            MAX(observation_date) AS latest_date
        FROM read_parquet(?)
    """, [pattern]).fetchone()

    (
        total,
        unique_ids,
        missing_ids,
        taxa,
        locations,
        checklists,
        earliest,
        latest
    ) = result

    print(f"\nTotal rows:       {total:,}")
    print(f"Unique IDs:       {unique_ids:,}")
    print(f"Missing IDs:      {missing_ids:,}")
    print(f"Unique taxa:      {taxa:,}")
    print(f"Unique locations: {locations:,}")
    print(f"Unique checklists:{checklists:,}")
    print(f"Date range:       {earliest} to {latest}")

    passed = (
        metadata_rows == total
        and total == unique_ids
        and missing_ids == 0
    )

    print(
        "\nRESULT:",
        "PASSED" if passed else "FAILED"
    )

    con.close()
    return passed


def main():
    results = {}

    for test in TESTS:
        results[test] = validate_test(test)

    print(f"\n{'=' * 60}")
    print("FINAL VALIDATION SUMMARY")
    print("=" * 60)

    for name, passed in results.items():
        print(
            f"{name:<15} "
            f"{'PASSED' if passed else 'FAILED / NOT FOUND'}"
        )

    if not all(results.values()):
        raise SystemExit(1)

    print("\nAll extraction tests passed!")


if __name__ == "__main__":
    main()
