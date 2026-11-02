
from pathlib import Path
import csv
import duckdb

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "database" / "ebird.duckdb"
REFERENCE = ROOT / "database"


def load_file(filename, code_column, name_column, code_fn):
    result = []

    with (REFERENCE / filename).open(
        "r", encoding="utf-8-sig", newline=""
    ) as file:
        reader = csv.DictReader(file, delimiter="|")

        for row in reader:
            code = code_fn(row)
            name = row[name_column].strip()
            result.append((code, name))

    return result


states = load_file(
    "2026_Gaz_state_national.txt",
    "USPS",
    "NAME",
    lambda row: f"US-{row['USPS'].strip()}"
)

counties = load_file(
    "2026_Gaz_counties_national.txt",
    "GEOID",
    "NAME",
    lambda row: (
        f"US-{row['USPS'].strip()}-"
        f"{row['GEOID'].strip()[-3:]}"
    )
)

con = duckdb.connect(str(DB))

try:
    con.begin()

    con.execute("""
        ALTER TABLE states
        ADD COLUMN IF NOT EXISTS state_name VARCHAR
    """)

    con.execute("""
        ALTER TABLE counties
        ADD COLUMN IF NOT EXISTS county_name VARCHAR
    """)

    con.execute("""
        CREATE TEMP TABLE state_lookup (
            state_code VARCHAR,
            state_name VARCHAR
        )
    """)

    con.execute("""
        CREATE TEMP TABLE county_lookup (
            county_code VARCHAR,
            county_name VARCHAR
        )
    """)

    con.executemany(
        "INSERT INTO state_lookup VALUES (?, ?)", states
    )

    con.executemany(
        "INSERT INTO county_lookup VALUES (?, ?)", counties
    )

    con.execute("""
        UPDATE states
        SET state_name = l.state_name
        FROM state_lookup l
        WHERE states.state_code = l.state_code
    """)

    con.execute("""
        UPDATE counties
        SET county_name = l.county_name
        FROM county_lookup l
        WHERE counties.county_code = l.county_code
    """)

    # Historical county codes absent from the 2026 Census Gazetteer.
    historical_counties = {
        "US-AK-270": "Wade Hampton Census Area",
        "US-CT-001": "Fairfield County",
        "US-CT-003": "Hartford County",
        "US-CT-005": "Litchfield County",
        "US-CT-007": "Middlesex County",
        "US-CT-009": "New Haven County",
        "US-CT-011": "New London County",
        "US-CT-013": "Tolland County",
        "US-CT-015": "Windham County",
        "US-SD-113": "Shannon County",
    }

    con.executemany("""
        UPDATE counties
        SET county_name = ?
        WHERE county_code = ?
        AND county_name IS NULL
    """, [
        (name, code)
        for code, name in historical_counties.items()
    ])

    for table, name_column in [
        ("states", "state_name"),
        ("counties", "county_name")
    ]:
        matched, missing = con.execute(f"""
            SELECT
                COUNT(*) FILTER (
                    WHERE {name_column} IS NOT NULL
                ),
                COUNT(*) FILTER (
                    WHERE {name_column} IS NULL
                )
            FROM {table}
        """).fetchone()

        print(
            f"{table}: {matched} matched, "
            f"{missing} unmatched"
        )

    con.commit()

except Exception:
    con.rollback()
    raise

finally:
    con.close()
