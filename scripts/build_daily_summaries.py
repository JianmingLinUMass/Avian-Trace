
from pathlib import Path
import argparse
import time
import duckdb

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "database" / "ebird_daily.duckdb"
PARQUET_DIR = ROOT / "parquet" / "production"

START_DATE = "2012-01-01"
END_DATE = "2026-01-01"  # Exclusive


def create_staging_tables(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS daily_processed_files (
            filename VARCHAR PRIMARY KEY
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS daily_year_staging (
            filename VARCHAR,
            year INTEGER,
            region_level VARCHAR,
            region_code VARCHAR,
            taxon_id VARCHAR,
            reported_birds BIGINT,
            observation_rows BIGINT,
            unknown_count_records BIGINT
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS daily_holiday_staging (
            filename VARCHAR,
            date DATE,
            region_level VARCHAR,
            region_code VARCHAR,
            taxon_id VARCHAR,
            reported_birds BIGINT,
            observation_rows BIGINT,
            unknown_count_records BIGINT
        )
    """)

    # Existing final tables were created without observation_rows.
    con.execute("""
        ALTER TABLE species_region_year_avg
        ADD COLUMN IF NOT EXISTS observation_rows BIGINT
    """)

    con.execute("""
        ALTER TABLE species_region_holiday
        ADD COLUMN IF NOT EXISTS observation_rows BIGINT
    """)


def process_file(con, file_path):
    filename = file_path.name

    con.begin()

    try:
        # Annual totals: state and county summaries.
        con.execute("""
            INSERT INTO daily_year_staging
            SELECT
                ? AS filename,
                year,
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
                taxon_id,
                SUM(COALESCE(bird_count, 0)) AS reported_birds,
                COUNT(*) AS observation_rows,
                COUNT(*) FILTER (
                    WHERE bird_count IS NULL
                ) AS unknown_count_records
            FROM (
                SELECT
                    TRY_CAST(
                        SUBSTR(observation_date, 1, 4)
                        AS INTEGER
                    ) AS year,
                    state_code,
                    county_code,
                    taxon_id,
                    TRY_CAST(count_raw AS BIGINT) AS bird_count
                FROM read_parquet(?)
                WHERE observation_date >= ?
                  AND observation_date < ?
                  AND category = 'species'
            ) p
            GROUP BY GROUPING SETS (
                (year, state_code, taxon_id),
                (year, state_code, county_code, taxon_id)
            )
            HAVING
                CASE
                    WHEN GROUPING(county_code) = 1
                    THEN state_code
                    ELSE county_code
                END IS NOT NULL
        """, [
            filename,
            str(file_path),
            START_DATE,
            END_DATE
        ])

        # Holiday counts: only observations on holiday dates.
        con.execute("""
            INSERT INTO daily_holiday_staging
            SELECT
                ? AS filename,
                h.date,
                CASE
                    WHEN GROUPING(p.county_code) = 1
                    THEN 'state'
                    ELSE 'county'
                END AS region_level,
                CASE
                    WHEN GROUPING(p.county_code) = 1
                    THEN p.state_code
                    ELSE p.county_code
                END AS region_code,
                p.taxon_id,
                SUM(COALESCE(p.bird_count, 0))
                    AS reported_birds,
                COUNT(*) AS observation_rows,
                COUNT(*) FILTER (
                    WHERE p.bird_count IS NULL
                ) AS unknown_count_records
            FROM (
                SELECT
                    observation_date,
                    state_code,
                    county_code,
                    taxon_id,
                    TRY_CAST(count_raw AS BIGINT) AS bird_count
                FROM read_parquet(?)
                WHERE observation_date >= ?
                  AND observation_date < ?
                  AND category = 'species'
            ) p
            JOIN holidays h
                ON p.observation_date = CAST(h.date AS VARCHAR)
            GROUP BY GROUPING SETS (
                (h.date, p.state_code, p.taxon_id),
                (h.date, p.state_code, p.county_code, p.taxon_id)
            )
            HAVING
                CASE
                    WHEN GROUPING(p.county_code) = 1
                    THEN p.state_code
                    ELSE p.county_code
                END IS NOT NULL
        """, [
            filename,
            str(file_path),
            START_DATE,
            END_DATE
        ])

        con.execute(
            "INSERT INTO daily_processed_files VALUES (?)",
            [filename]
        )

        con.commit()

    except Exception:
        con.rollback()
        raise


def finalize(con):
    print("\nBuilding final summary tables...")

    con.begin()

    try:
        con.execute("DELETE FROM species_region_year_avg")
        con.execute("DELETE FROM species_region_holiday")

        con.execute("""
            INSERT INTO species_region_year_avg (
                year,
                region_level,
                region_code,
                taxon_id,
                reported_birds,
                unknown_count_records,
                avg_daily_birds,
                observation_rows
            )
            SELECT
                year,
                region_level,
                region_code,
                taxon_id,
                SUM(reported_birds),
                SUM(unknown_count_records),
                SUM(reported_birds) * 1.0 /
                    CASE
                        WHEN year % 400 = 0 OR
                            (year % 4 = 0 AND year % 100 != 0)
                        THEN 366
                        ELSE 365
                    END,
                SUM(observation_rows)
            FROM daily_year_staging
            GROUP BY
                year, region_level, region_code, taxon_id
        """)

        con.execute("""
            INSERT INTO species_region_holiday (
                date,
                region_level,
                region_code,
                taxon_id,
                reported_birds,
                unknown_count_records,
                observation_rows
            )
            SELECT
                date,
                region_level,
                region_code,
                taxon_id,
                SUM(reported_birds),
                SUM(unknown_count_records),
                SUM(observation_rows)
            FROM daily_holiday_staging
            GROUP BY
                date, region_level, region_code, taxon_id
        """)

        con.commit()

    except Exception:
        con.rollback()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--max-files",
        type=int,
        default=None,
        help="Maximum number of new Parquet files to process"
    )
    args = parser.parse_args()

    files = sorted(PARQUET_DIR.glob("part_*.parquet"))

    if not files:
        raise FileNotFoundError("No production Parquet files found")

    con = duckdb.connect(str(DB_PATH))

    try:
        con.execute("SET threads = 4")
        create_staging_tables(con)

        processed = {
            row[0]
            for row in con.execute("""
                SELECT filename FROM daily_processed_files
            """).fetchall()
        }

        remaining = [
            file for file in files
            if file.name not in processed
        ]

        if args.max_files is not None:
            remaining = remaining[:args.max_files]

        print("eBird Daily Summary Builder")
        print(f"Total Parquet files: {len(files):,}")
        print(f"Already processed: {len(processed):,}")
        print(f"Processing this run: {len(remaining):,}")

        for index, file in enumerate(remaining, 1):
            start = time.perf_counter()

            process_file(con, file)

            elapsed = time.perf_counter() - start

            print(
                f"[{len(processed) + index}/{len(files)}] "
                f"{file.name} | {elapsed:.2f}s",
                flush=True
            )

        completed = con.execute("""
            SELECT COUNT(*) FROM daily_processed_files
        """).fetchone()[0]

        if completed == len(files):
            finalize(con)

            for table in [
                "species_region_year_avg",
                "species_region_holiday"
            ]:
                count = con.execute(
                    f"SELECT COUNT(*) FROM {table}"
                ).fetchone()[0]

                print(f"{table}: {count:,} rows")

            print("\nAll daily summaries completed!")
        else:
            print(
                f"\nProgress saved: {completed}/{len(files)} files"
            )
            print("Final tables will be built after all files finish.")

    finally:
        con.close()


if __name__ == "__main__":
    main()
