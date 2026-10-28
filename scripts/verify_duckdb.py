
from pathlib import Path

import duckdb  # type: ignore


ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "database" / "ebird.duckdb"

con = duckdb.connect(str(DB), read_only=True)

try:
    print("eBird DuckDB Verification\n")

    tables = {
        row[0]
        for row in con.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'main'
        """).fetchall()
    }

    for name in ("taxa", "states", "counties"):
        if name not in tables:
            print(f"{name}: NOT BUILT")
            continue

        total = con.execute(
            f"SELECT COUNT(*) FROM {name}"
        ).fetchone()[0]

        print(f"{name}: {total:,} rows")

    if "taxa" in tables:
        taxa_count = con.execute(
            "SELECT COUNT(*) FROM taxa"
        ).fetchone()[0]

        print(
            "Taxa verification:",
            "PASS" if taxa_count == 2747 else "CHECK"
        )

    if "states" in tables:
        print("\nTop 10 states by observation records:")

        rows = con.execute("""
            SELECT state_code, observation_rows
            FROM states
            ORDER BY observation_rows DESC
            LIMIT 10
        """).fetchall()

        for state, observations in rows:
            print(f"  {state}: {observations:,}")

    if "counties" in tables:
        print("\nMassachusetts counties:")

        rows = con.execute("""
            SELECT county_code, observation_rows
            FROM counties
            WHERE state_code = 'US-MA'
            ORDER BY observation_rows DESC
            LIMIT 20
        """).fetchall()

        for county, observations in rows:
            print(f"  {county}: {observations:,}")

    print("\nVerification finished.")

finally:
    con.close()
