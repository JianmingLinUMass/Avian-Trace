
from pathlib import Path
import duckdb
import holidays

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "database" / "ebird.duckdb"


def main():
    if not DB_PATH.is_file():
        raise FileNotFoundError(DB_PATH)

    # Generate U.S. holidays from 2012 through 2026.
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

        con.execute("""
            CREATE TABLE IF NOT EXISTS holidays (
                date DATE PRIMARY KEY,
                holiday_name VARCHAR,
                is_observed BOOLEAN
            )
        """)

        # Replace existing holiday data on reruns.
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

        print("Holiday import completed!")
        print(f"Records imported: {len(records)}")

        print("\nFirst 10 holidays:")
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
