
from pathlib import Path

import duckdb
import holidays

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "database" / "ebird_daily.duckdb"


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    us_holidays = holidays.country_holidays(
        "US",
        years=range(2012, 2027),
        observed=True
    )

    records = [
        (
            holiday_date,
            name.replace(" (observed)", ""),
            "(observed)" in name.lower()
        )
        for holiday_date, name in sorted(us_holidays.items())
    ]

    con = duckdb.connect(str(DB_PATH))

    try:
        con.begin()

        # Federal holiday reference table.
        con.execute("""
            CREATE TABLE IF NOT EXISTS holidays (
                date DATE PRIMARY KEY,
                holiday_name VARCHAR NOT NULL,
                is_observed BOOLEAN NOT NULL
            )
        """)

        # Yearly daily average for each species and region.
        con.execute("""
            CREATE TABLE IF NOT EXISTS species_region_year_avg (
                year INTEGER,
                region_level VARCHAR,
                region_code VARCHAR,
                taxon_id VARCHAR,
                reported_birds BIGINT,
                unknown_count_records BIGINT,
                avg_daily_birds DOUBLE
            )
        """)

        # Bird counts recorded on individual holidays.
        con.execute("""
            CREATE TABLE IF NOT EXISTS species_region_holiday (
                date DATE,
                region_level VARCHAR,
                region_code VARCHAR,
                taxon_id VARCHAR,
                reported_birds BIGINT,
                unknown_count_records BIGINT
            )
        """)

        # Refresh only the holiday reference data.
        con.execute("DELETE FROM holidays")

        con.executemany("""
            INSERT INTO holidays (
                date,
                holiday_name,
                is_observed
            )
            VALUES (?, ?, ?)
        """, records)

        con.commit()

        print("eBird Daily Database Created")
        print(f"Database: {DB_PATH}")

        print("\nTABLES")
        tables = con.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'main'
            ORDER BY table_name
        """).fetchall()

        for (table_name,) in tables:
            count = con.execute(
                f'SELECT COUNT(*) FROM "{table_name}"'
            ).fetchone()[0]

            print(f"  {table_name}: {count:,} rows")

        print("\nFIRST 10 HOLIDAYS")
        for row in con.execute("""
            SELECT date, holiday_name, is_observed
            FROM holidays
            ORDER BY date
            LIMIT 10
        """).fetchall():
            print(row)

    except Exception:
        con.rollback()
        raise

    finally:
        con.close()


if __name__ == "__main__":
    main()
