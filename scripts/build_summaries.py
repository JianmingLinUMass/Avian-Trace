
from pathlib import Path
import time

import duckdb  # type: ignore


ROOT = Path(__file__).resolve().parent.parent

SOURCE = str(
    ROOT / "parquet" / "production" / "part_*.parquet"
)

DB_DIR = ROOT / "database"
DB = DB_DIR / "ebird.duckdb"
TEMP_DIR = DB_DIR / "duckdb_temp"

FIRST_YEAR = 2012
LAST_YEAR = 2026

THREADS = 8
MEMORY_LIMIT = "16GB"


def configure(con):
    con.execute(f"SET threads = {THREADS}")
    con.execute(f"SET memory_limit = '{MEMORY_LIMIT}'")
    con.execute("SET preserve_insertion_order = false")

    temp_path = str(TEMP_DIR).replace("'", "''")
    con.execute(
        f"SET temp_directory = '{temp_path}'"
    )

    # Show query execution progress after 1 second
    con.execute("SET enable_progress_bar = true")
    con.execute("SET enable_progress_bar_print = true")
    con.execute("SET progress_bar_time = 1000")


def setup(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS species_region_month (
            year INTEGER,
            month INTEGER,
            region_level VARCHAR,
            region_code VARCHAR,
            state_code VARCHAR,
            taxon_id VARCHAR,
            observation_rows BIGINT
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS summary_completed_years (
            year INTEGER PRIMARY KEY
        )
    """)


def completed_years(con):
    rows = con.execute("""
        SELECT year
        FROM summary_completed_years
    """).fetchall()

    return {row[0] for row in rows}


def build_month(con, year):
    started = time.monotonic()

    date_start = f"{year}-01-01"
    date_end = (
        "2026-09-30"
        if year == 2026
        else f"{year}-12-31"
    )

    print(
        f"\nProcessing {year}: "
        f"{date_start} to {date_end}",
        flush=True
    )

    # Both levels are computed from the source:
    # - state: all valid state observations
    # - county: observations with valid county codes
    #
    # GROUPING() distinguishes state totals from county totals.

    sql = """
        INSERT INTO species_region_month
        SELECT
            ? AS year,
            TRY_CAST(
                SUBSTR(observation_date, 6, 2) AS INTEGER
            ) AS month,

            CASE
                WHEN GROUPING(county_code) = 1
                THEN 'state'
                ELSE 'county'
            END AS region_level,

            CASE
                WHEN GROUPING(county_code) = 1
                THEN state_code
                ELSE county_code
            END AS region_code,

            state_code,
            taxon_id,
            COUNT(*) AS observation_rows

        FROM read_parquet(?)

        WHERE observation_date BETWEEN ? AND ?
          AND taxon_id IS NOT NULL
          AND taxon_id <> ''
          AND state_code IS NOT NULL
          AND state_code <> ''

        GROUP BY GROUPING SETS (
            (
                state_code,
                taxon_id,
                SUBSTR(observation_date, 6, 2)
            ),
            (
                state_code,
                county_code,
                taxon_id,
                SUBSTR(observation_date, 6, 2)
            )
        )

        HAVING
            GROUPING(county_code) = 1
            OR (
                county_code IS NOT NULL
                AND county_code <> ''
            )
    """

    con.execute("BEGIN TRANSACTION")

    try:
        con.execute(
            sql,
            [year, SOURCE, date_start, date_end]
        )

        # The completion marker is committed together
        # with the yearly summary rows.
        con.execute("""
            INSERT INTO summary_completed_years
            VALUES (?)
        """, [year])

        con.execute("COMMIT")

    except Exception:
        con.execute("ROLLBACK")
        raise

    elapsed = time.monotonic() - started

    print(
        f"Year {year} completed in "
        f"{elapsed / 60:.2f} minutes",
        flush=True
    )


def table_exists(con, name):
    return con.execute("""
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'main'
          AND table_name = ?
    """, [name]).fetchone()[0] > 0


def build_year_summary(con, changed):
    if table_exists(con, "species_region_year") and not changed:
        print(
            "\nAnnual summary already built. Skipping.",
            flush=True
        )
        return

    print(
        "\nDeriving annual summaries from monthly data...",
        flush=True
    )

    started = time.monotonic()

    con.execute(
        "DROP TABLE IF EXISTS species_region_year_build"
    )

    con.execute("""
        CREATE TABLE species_region_year_build AS
        SELECT
            year,
            region_level,
            region_code,
            state_code,
            taxon_id,
            SUM(observation_rows)::BIGINT
                AS observation_rows

        FROM species_region_month

        GROUP BY
            year,
            region_level,
            region_code,
            state_code,
            taxon_id
    """)

    total = con.execute("""
        SELECT COUNT(*)
        FROM species_region_year_build
    """).fetchone()[0]

    if total == 0:
        raise RuntimeError(
            "Annual summary unexpectedly empty."
        )

    con.execute("BEGIN TRANSACTION")

    try:
        con.execute(
            "DROP TABLE IF EXISTS species_region_year"
        )

        con.execute("""
            ALTER TABLE species_region_year_build
            RENAME TO species_region_year
        """)

        con.execute("COMMIT")

    except Exception:
        con.execute("ROLLBACK")
        raise

    print(
        f"Annual summary complete: {total:,} rows",
        flush=True
    )

    print(
        f"Elapsed: "
        f"{(time.monotonic() - started) / 60:.2f} minutes",
        flush=True
    )


def verify(con):
    print("\nSummary verification")

    monthly = con.execute("""
        SELECT COUNT(*)
        FROM species_region_month
    """).fetchone()[0]

    annual = con.execute("""
        SELECT COUNT(*)
        FROM species_region_year
    """).fetchone()[0]

    years = con.execute("""
        SELECT COUNT(*)
        FROM summary_completed_years
    """).fetchone()[0]

    print(f"Monthly summary rows: {monthly:,}")
    print(f"Annual summary rows: {annual:,}")
    print(f"Completed years: {years}")

    if years != LAST_YEAR - FIRST_YEAR + 1:
        raise RuntimeError(
            "Not all years are complete."
        )

    # Annual totals must match the monthly totals.
    result = con.execute("""
        SELECT
            (SELECT SUM(observation_rows)
             FROM species_region_month),
            (SELECT SUM(observation_rows)
             FROM species_region_year)
    """).fetchone()

    if result[0] != result[1]:
        raise RuntimeError(
            "Monthly/annual observation totals differ."
        )

    print("Monthly/annual totals: PASS")


def main():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    print("eBird Summary Builder")
    print(f"Database: {DB}")
    print(f"Source: {SOURCE}")
    print(f"Years: {FIRST_YEAR}-{LAST_YEAR}")
    print("2026 ends on September 30.")
    print()

    started = time.monotonic()

    con = duckdb.connect(str(DB))

    try:
        configure(con)
        setup(con)

        completed = completed_years(con)
        changed = False
        total_years = LAST_YEAR - FIRST_YEAR + 1

        def show_overall_progress():
            finished = len(completed)
            width = 30
            filled = int(width * finished / total_years)

            bar = "█" * filled + "░" * (width - filled)
            percent = finished / total_years * 100

            print(
                f"\nOverall: [{bar}] "
                f"{percent:.1f}% ({finished}/{total_years} years)",
                flush=True
            )

        show_overall_progress()

        for year in range(
            FIRST_YEAR,
            LAST_YEAR + 1
        ):
            if year in completed:
                print(
                    f"{year}: already completed, skipping.",
                    flush=True
                )
                continue

            build_month(con, year)
            completed.add(year)
            changed = True
            show_overall_progress()

        build_year_summary(con, changed)
        verify(con)

        print("\nBUILD COMPLETE")
        print(
            f"Total runtime: "
            f"{(time.monotonic() - started) / 60:.2f} minutes"
        )

    finally:
        con.close()


if __name__ == "__main__":
    main()
