from pathlib import Path
import duckdb


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "database" / "ebird.duckdb"


SQL = """
SELECT
    st.state_name,
    co.county_name,
    t.common_name AS species,
    s.year,
    s.reporting_checklists,
    c.complete_checklists,
    ROUND(
        100.0 * s.reporting_checklists
        / NULLIF(c.complete_checklists, 0),
        2
    ) AS reporting_frequency_percent
FROM species_checklists_region_year AS s
JOIN complete_checklists_region_year AS c
    ON s.region_level = c.region_level
    AND s.region_code = c.region_code
    AND s.year = c.year
JOIN counties AS co
    ON s.region_code = co.county_code
JOIN states AS st
    ON co.state_code = st.state_code
JOIN taxa AS t
    ON s.taxon_id = t.taxon_id
WHERE st.state_name = 'Massachusetts'
  AND co.county_name = 'Barnstable County'
  AND t.common_name = 'American Robin'
  AND t.category = 'species'
  AND s.region_level = 'county'
  AND s.year = 2025;
"""


def main():
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")

    con = duckdb.connect(str(DB_PATH), read_only=True)

    try:
        result = con.execute(SQL)
        columns = [column[0] for column in result.description]
        rows = result.fetchall()

        print("American Robin Reporting Frequency")
        print("Location: Barnstable County, Massachusetts")
        print("Year: 2025")
        print("=" * 55)

        if not rows:
            print("No matching data found.")
            return

        for row in rows:
            record = dict(zip(columns, row))

            print(f"State: {record['state_name']}")
            print(f"County: {record['county_name']}")
            print(f"Species: {record['species']}")
            print(f"Year: {record['year']}")
            print(
                f"Reporting checklists: "
                f"{record['reporting_checklists']:,}"
            )
            print(
                f"Complete checklists: "
                f"{record['complete_checklists']:,}"
            )
            print(
                f"Reporting frequency: "
                f"{record['reporting_frequency_percent']}%"
            )

    finally:
        con.close()


if __name__ == "__main__":
    main()
