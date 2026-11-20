from pathlib import Path
import argparse
import duckdb


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "database" / "ebird_locations.duckdb"


def inspect_table(con, table_name, limit):
    print(f"\n{'=' * 75}")
    print(f"TABLE: {table_name}")
    print("=" * 75)

    # Schema
    print("\nSCHEMA")

    columns = con.execute(
        f'DESCRIBE "{table_name.replace(chr(34), chr(34) * 2)}"'
    ).fetchall()

    for column in columns:
        name, data_type, nullable = column[:3]
        print(f"  {name:<28} {data_type:<18} NULL: {nullable}")

    # Row count
    quoted_table = '"' + table_name.replace('"', '""') + '"'

    row_count = con.execute(
        f"SELECT COUNT(*) FROM {quoted_table}"
    ).fetchone()[0]

    print(f"\nROW COUNT: {row_count:,}")

    if row_count == 0 or limit == 0:
        return

    # Sample records
    print(f"\nFIRST {min(limit, row_count)} ROWS")

    cursor = con.execute(
        f"SELECT * FROM {quoted_table} LIMIT ?",
        [limit]
    )

    column_names = [col[0] for col in cursor.description]
    rows = cursor.fetchall()

    for index, row in enumerate(rows, 1):
        print(f"\n  Row {index}")

        for name, value in zip(column_names, row):
            print(f"    {name:<28} {value}")


def main():
    parser = argparse.ArgumentParser(
        description="Inspect the eBird locations DuckDB database."
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Number of sample rows per table (default: 5)"
    )

    parser.add_argument(
        "--table",
        help="Inspect only one table"
    )

    args = parser.parse_args()

    if args.limit < 0:
        parser.error("--limit must be non-negative")

    if not DB_PATH.exists():
        raise FileNotFoundError(
            f"Database not found: {DB_PATH}"
        )

    # Read-only connection
    con = duckdb.connect(
        str(DB_PATH),
        read_only=True
    )

    try:
        print("eBird Locations Database Inspector")
        print(f"Database: {DB_PATH}")
        print(
            f"File size: "
            f"{DB_PATH.stat().st_size / (1024 ** 2):,.2f} MiB"
        )

        tables = [
            row[0]
            for row in con.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'main'
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """).fetchall()
        ]

        print(f"\nTABLES FOUND: {len(tables)}")

        for table in tables:
            print(f"  - {table}")

        if args.table:
            if args.table not in tables:
                parser.error(
                    f"Table '{args.table}' does not exist."
                )

            tables = [args.table]

        for table in tables:
            inspect_table(con, table, args.limit)

    finally:
        con.close()


if __name__ == "__main__":
    main()
