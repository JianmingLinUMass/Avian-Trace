
from pathlib import Path
import sqlite3
import time

import duckdb  # type: ignore


ROOT = Path(__file__).resolve().parent.parent

DATA = ROOT / "parquet" / "production" / "part_*.parquet"

DB_DIR = ROOT / "database"
DB = DB_DIR / "ebird.duckdb"
OLD_DB = DB_DIR / "ebird.sqlite"
TEMP_DIR = DB_DIR / "duckdb_temp"

START = "2012-01-01"
END = "2026-09-30"

EXPECTED_TAXA = 2_747


def exists(con, table):
    return con.execute("""
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'main'
          AND table_name = ?
    """, [table]).fetchone()[0] > 0


def count(con, table):
    return con.execute(
        f"SELECT COUNT(*) FROM {table}"
    ).fetchone()[0]


def build_taxa(con):
    if exists(con, "taxa"):
        actual = count(con, "taxa")

        if actual != EXPECTED_TAXA:
            raise RuntimeError(
                f"Unexpected taxa count: {actual:,}"
            )

        print(
            f"Taxa already built: {actual:,}",
            flush=True
        )
        return

    print("\nBuilding taxa...", flush=True)
    started = time.monotonic()

    con.execute("DROP TABLE IF EXISTS taxa_build")

    if OLD_DB.exists():
        print("Importing taxa from SQLite...", flush=True)

        with sqlite3.connect(OLD_DB) as old:
            rows = old.execute("""
                SELECT
                    taxon_id,
                    common_name,
                    scientific_name,
                    category,
                    taxonomic_order,
                    observation_rows,
                    common_name_variants,
                    scientific_name_variants
                FROM taxa
            """).fetchall()

        con.execute("""
            CREATE TABLE taxa_build (
                taxon_id VARCHAR PRIMARY KEY,
                common_name VARCHAR,
                scientific_name VARCHAR,
                category VARCHAR,
                taxonomic_order VARCHAR,
                observation_rows BIGINT,
                common_name_variants BIGINT,
                scientific_name_variants BIGINT
            )
        """)

        con.executemany(
            """
            INSERT INTO taxa_build
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows
        )

    else:
        print("Building taxa from Parquet...", flush=True)

        con.execute("""
            CREATE TABLE taxa_build AS
            SELECT
                taxon_id,
                MIN(common_name) AS common_name,
                MIN(scientific_name) AS scientific_name,
                MIN(category) AS category,
                MIN(taxonomic_order) AS taxonomic_order,
                COUNT(*) AS observation_rows,
                COUNT(DISTINCT common_name)
                    AS common_name_variants,
                COUNT(DISTINCT scientific_name)
                    AS scientific_name_variants
            FROM read_parquet(?)
            WHERE observation_date BETWEEN ? AND ?
              AND taxon_id IS NOT NULL
              AND taxon_id <> ''
            GROUP BY taxon_id
        """, [str(DATA), START, END])

    actual = count(con, "taxa_build")

    if actual != EXPECTED_TAXA:
        raise RuntimeError(
            f"Taxa count mismatch: {actual:,}"
        )

    con.execute("BEGIN TRANSACTION")
    try:
        con.execute("ALTER TABLE taxa_build RENAME TO taxa")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

    print(
        f"Taxa complete: {actual:,} "
        f"({time.monotonic() - started:.1f}s)",
        flush=True
    )


def build_geography(con):
    if exists(con, "states") and exists(con, "counties"):
        print(
            f"States already built: {count(con, 'states'):,}",
            flush=True
        )
        print(
            f"Counties already built: {count(con, 'counties'):,}",
            flush=True
        )
        return

    print("\nBuilding state and county tables...", flush=True)
    started = time.monotonic()

    # One scan of Parquet creates both grouping levels.
    # GROUPING(county_code) distinguishes state totals
    # from individual county totals.
    con.execute("DROP TABLE IF EXISTS geography_build")

    con.execute("""
        CREATE TABLE geography_build AS
        SELECT
            state_code,
            county_code,
            GROUPING(county_code) AS is_state_total,
            COUNT(*) AS observation_rows
        FROM read_parquet(?)
        WHERE observation_date BETWEEN ? AND ?
          AND state_code IS NOT NULL
          AND state_code <> ''
        GROUP BY GROUPING SETS (
            (state_code),
            (state_code, county_code)
        )
    """, [str(DATA), START, END])

    print("Geographic aggregation complete.", flush=True)

    con.execute("DROP TABLE IF EXISTS states_build")
    con.execute("DROP TABLE IF EXISTS counties_build")

    con.execute("""
        CREATE TABLE states_build AS
        SELECT
            state_code,
            observation_rows
        FROM geography_build
        WHERE is_state_total = 1
    """)

    con.execute("""
        CREATE TABLE counties_build AS
        SELECT
            state_code,
            county_code,
            observation_rows
        FROM geography_build
        WHERE is_state_total = 0
          AND county_code IS NOT NULL
          AND county_code <> ''
    """)

    states_count = count(con, "states_build")
    counties_count = count(con, "counties_build")

    if states_count == 0 or counties_count == 0:
        raise RuntimeError(
            "Geography tables unexpectedly empty."
        )

    # Publish both tables together.
    con.execute("BEGIN TRANSACTION")

    try:
        con.execute("DROP TABLE IF EXISTS states")
        con.execute("DROP TABLE IF EXISTS counties")

        con.execute(
            "ALTER TABLE states_build RENAME TO states"
        )
        con.execute(
            "ALTER TABLE counties_build RENAME TO counties"
        )

        con.execute("COMMIT")

    except Exception:
        con.execute("ROLLBACK")
        raise

    con.execute("DROP TABLE geography_build")

    print("\nGeography complete:", flush=True)
    print(f"States/territories: {states_count:,}", flush=True)
    print(f"Counties: {counties_count:,}", flush=True)
    print(
        f"Elapsed: {time.monotonic() - started:.1f}s",
        flush=True
    )


def main():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    print("eBird DuckDB Builder")
    print(f"Database: {DB}")
    print(f"Period: {START} to {END}")

    con = duckdb.connect(str(DB))

    try:
        con.execute("SET threads = 8")
        con.execute("SET memory_limit = '16GB'")
        con.execute("SET preserve_insertion_order = false")

        temp_path = str(TEMP_DIR).replace("'", "''")
        con.execute(
            f"SET temp_directory = '{temp_path}'"
        )

        build_taxa(con)
        build_geography(con)

        print("\nFinal DuckDB tables:")

        tables = con.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'main'
            ORDER BY table_name
        """).fetchall()

        for (table,) in tables:
            print(f"  {table}: {count(con, table):,} rows")

        print("\nBUILD COMPLETE")

    finally:
        con.close()


if __name__ == "__main__":
    main()
