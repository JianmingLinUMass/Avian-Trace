
from pathlib import Path
import duckdb

DB_PATH = Path(__file__).resolve().parents[1] / "database" / "ebird.duckdb"
HEAD_ROWS = 5

def main():
    con = duckdb.connect(str(DB_PATH), read_only=True)

    tables = con.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'main'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    """).fetchall()

    for (table_name,) in tables:
        print(f"\n{'=' * 80}")
        print(f"TABLE: {table_name}")
        print(f"{'=' * 80}")

        # Column names and data types
        columns = con.execute(f"""
            DESCRIBE SELECT * FROM "{table_name}"
        """).fetchall()

        print("\nCOLUMNS:")
        for col in columns:
            print(f"  {col[0]:25} {col[1]}")

        # First 5 rows
        df = con.execute(
            f'SELECT * FROM "{table_name}" LIMIT {HEAD_ROWS}'
        ).df()

        print(f"\nFIRST {HEAD_ROWS} ROWS:")
        print(df.to_string(index=False))

    con.close()


if __name__ == "__main__":
    main()
