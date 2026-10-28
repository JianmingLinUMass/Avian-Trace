
from pathlib import Path
import time

import duckdb  # type: ignore


ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "database" / "ebird.duckdb"

START_YEAR = 2012
END_YEAR = 2025  # Complete calendar years only


def fetch(con, sql, params=()):
    """Execute a query and return a list of dictionaries."""
    start = time.perf_counter()

    cursor = con.execute(sql, params)
    columns = [item[0] for item in cursor.description]
    rows = cursor.fetchall()

    elapsed = (time.perf_counter() - start) * 1000

    return (
        [dict(zip(columns, row)) for row in rows],
        elapsed
    )


def get_region_summary(con, region_code, level="state"):
    """Total records and recorded species in a region."""
    return fetch(con, """
        SELECT
            COUNT(DISTINCT s.taxon_id) AS species_richness,
            COALESCE(SUM(s.observation_rows), 0)
                AS observation_records
        FROM species_region_year s
        JOIN taxa t ON s.taxon_id = t.taxon_id
        WHERE s.region_level = ?
          AND s.region_code = ?
          AND s.year BETWEEN ? AND ?
          AND t.category = 'species'
    """, [level, region_code, START_YEAR, END_YEAR])


def get_species_richness_ranking(
    con, level="state", state_code=None, limit=10
):
    """Rank regions by number of recorded species."""
    return fetch(con, """
        SELECT
            s.region_code,
            COUNT(DISTINCT s.taxon_id) AS species_richness
        FROM species_region_year s
        JOIN taxa t ON s.taxon_id = t.taxon_id
        WHERE s.region_level = ?
          AND (? IS NULL OR s.state_code = ?)
          AND s.year BETWEEN ? AND ?
          AND t.category = 'species'
        GROUP BY s.region_code
        ORDER BY species_richness DESC, s.region_code
        LIMIT ?
    """, [
        level, state_code, state_code,
        START_YEAR, END_YEAR, limit
    ])


def get_top_species(con, region_code, level="state", limit=10):
    """Rank species by observation-record count."""
    return fetch(con, """
        SELECT
            t.common_name,
            SUM(s.observation_rows) AS observation_records
        FROM species_region_year s
        JOIN taxa t ON s.taxon_id = t.taxon_id
        WHERE s.region_level = ?
          AND s.region_code = ?
          AND s.year BETWEEN ? AND ?
          AND t.category = 'species'
        GROUP BY t.taxon_id, t.common_name
        ORDER BY observation_records DESC, t.common_name
        LIMIT ?
    """, [
        level, region_code,
        START_YEAR, END_YEAR, limit
    ])


def get_species_trend(
    con, region_code, common_name, level="state"
):
    """Annual observation counts for a species."""
    return fetch(con, """
        SELECT
            s.year,
            SUM(s.observation_rows) AS observation_records
        FROM species_region_year s
        JOIN taxa t ON s.taxon_id = t.taxon_id
        WHERE s.region_level = ?
          AND s.region_code = ?
          AND t.common_name = ?
          AND t.category = 'species'
          AND s.year BETWEEN ? AND ?
        GROUP BY s.year
        ORDER BY s.year
    """, [
        level, region_code, common_name,
        START_YEAR, END_YEAR
    ])


def get_monthly_trend(
    con, region_code, common_name, level="state"
):
    """Monthly counts averaged across the selected years."""
    return fetch(con, """
        SELECT
            s.month,
            ROUND(
                SUM(s.observation_rows)::DOUBLE /
                (? - ? + 1), 2
            ) AS avg_observation_records
        FROM species_region_month s
        JOIN taxa t ON s.taxon_id = t.taxon_id
        WHERE s.region_level = ?
          AND s.region_code = ?
          AND t.common_name = ?
          AND t.category = 'species'
          AND s.year BETWEEN ? AND ?
        GROUP BY s.month
        ORDER BY s.month
    """, [
        END_YEAR, START_YEAR,
        level, region_code, common_name,
        START_YEAR, END_YEAR
    ])


def run_test(con, name, func, *args):
    print(f"\n{'=' * 55}")
    print(name)
    print("=" * 55)

    rows, elapsed = func(con, *args)

    for row in rows[:10]:
        print(row)

    if len(rows) > 10:
        print(f"... {len(rows) - 10} more rows")

    print(f"\nRows returned: {len(rows):,}")
    print(f"Query time: {elapsed:.2f} ms")

    assert elapsed >= 0
    assert isinstance(rows, list)

    return rows


def main():
    if not DB.exists():
        raise FileNotFoundError(DB)

    print("eBird Analytical Query Tests")
    print(f"Database: {DB}")
    print(f"Period: {START_YEAR}-{END_YEAR}")

    con = duckdb.connect(str(DB), read_only=True)

    try:
        summary = run_test(
            con,
            "TEST 1: Massachusetts summary",
            get_region_summary,
            "US-MA"
        )

        ranking = run_test(
            con,
            "TEST 2: Top 10 states by recorded species",
            get_species_richness_ranking
        )

        counties = run_test(
            con,
            "TEST 3: Massachusetts county richness",
            get_species_richness_ranking,
            "county", "US-MA", 14
        )

        species = run_test(
            con,
            "TEST 4: Top 10 Massachusetts species",
            get_top_species,
            "US-MA"
        )

        trend = run_test(
            con,
            "TEST 5: Northern Cardinal annual trend",
            get_species_trend,
            "US-MA", "Northern Cardinal"
        )

        months = run_test(
            con,
            "TEST 6: Northern Cardinal monthly pattern",
            get_monthly_trend,
            "US-MA", "Northern Cardinal"
        )

        # Basic automated checks
        assert summary[0]["species_richness"] > 0
        assert summary[0]["observation_records"] > 0

        assert all(
            ranking[i]["species_richness"] >=
            ranking[i + 1]["species_richness"]
            for i in range(len(ranking) - 1)
        )

        assert len(counties) > 0
        assert len(species) > 0
        assert len(trend) > 0
        assert len(months) == 12

        # Cross-check: annual and monthly totals should match.
        annual_total = sum(
            row["observation_records"] for row in trend
        )
        monthly_total = round(
            sum(row["avg_observation_records"] for row in months)
            * (END_YEAR - START_YEAR + 1)
        )

        assert abs(annual_total - monthly_total) <= 2

        print("\n" + "=" * 55)
        print("ALL BASIC QUERY TESTS PASSED")
        print("=" * 55)

    finally:
        con.close()


if __name__ == "__main__":
    main()
