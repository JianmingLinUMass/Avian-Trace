
from pathlib import Path
import argparse
import duckdb

ROOT = Path(__file__).resolve().parents[1]
PARQUET_DIR = ROOT / "parquet" / "production"


def main():
    parser = argparse.ArgumentParser(
        description="Inspect a single eBird Parquet file."
    )
    parser.add_argument(
        "--file",
        type=Path,
        help="Parquet file to inspect (default: first production file)"
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=5,
        help="Number of sample rows (default: 5)"
    )

    args = parser.parse_args()

    if args.rows < 1 or args.rows > 100:
        parser.error("--rows must be between 1 and 100")

    if args.file:
        file_path = args.file.resolve()
    else:
        file_path = next(
            iter(sorted(PARQUET_DIR.glob("part_*.parquet"))),
            None
        )

    if file_path is None or not file_path.is_file():
        parser.error("Parquet file not found")

    print("eBird Parquet Inspection")
    print(f"File: {file_path}")
    print(f"File size: {file_path.stat().st_size / 1024**2:.2f} MiB")

    con = duckdb.connect()

    try:
        # DuckDB reads Parquet metadata to obtain its schema.
        schema = con.execute(
            "DESCRIBE SELECT * FROM read_parquet(?)",
            [str(file_path)]
        ).fetchall()

        print("\n" + "=" * 75)
        print(f"COLUMNS ({len(schema)})")
        print("=" * 75)

        for column in schema:
            print(f"{column[0]:25} {column[1]}")

        # Retrieve only a small number of records.
        df = con.execute(
            "SELECT * FROM read_parquet(?) LIMIT ?",
            [str(file_path), args.rows]
        ).df()

        print("\n" + "=" * 75)
        print(f"FIRST {args.rows} ROWS")
        print("=" * 75)

        # Print every column without truncation.
        with __import__("pandas").option_context(
            "display.max_columns", None,
            "display.width", 250,
            "display.max_colwidth", 40
        ):
            print(df.to_string(index=False))

        # Optional date range for this single file.
        # This may scan its observation_date column.
        print("\n" + "=" * 75)
        print("DATE RANGE (THIS FILE ONLY)")
        print("=" * 75)

        first_date, last_date = con.execute("""
            SELECT
                MIN(observation_date),
                MAX(observation_date)
            FROM read_parquet(?)
        """, [str(file_path)]).fetchone()

        print(f"Earliest date: {first_date}")
        print(f"Latest date:   {last_date}")

    finally:
        con.close()


if __name__ == "__main__":
    main()
