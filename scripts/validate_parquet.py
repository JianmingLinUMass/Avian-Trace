import duckdb  # type: ignore
from pathlib import Path

root = Path(__file__).resolve().parent.parent
path = (root / "parquet" / "test_1million" / "*.parquet").as_posix()

con = duckdb.connect()

result = con.execute("""
    SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT observation_id) AS unique_ids,
        COUNT(DISTINCT taxon_id) AS unique_taxa,
        COUNT(DISTINCT locality_id) AS unique_locations,
        COUNT(DISTINCT checklist_id) AS unique_checklists,
        MIN(observation_date) AS earliest_date,
        MAX(observation_date) AS latest_date
    FROM read_parquet(?)
""", [path]).df()

print(result.to_string(index=False))

duplicates = con.execute("""
    SELECT observation_id, COUNT(*) AS n
    FROM read_parquet(?)
    GROUP BY observation_id
    HAVING COUNT(*) > 1
    LIMIT 10
""", [path]).df()

print("\nDuplicate observation IDs:")
print(duplicates.to_string(index=False))

assert result["total_rows"][0] == 1_000_000
assert result["unique_ids"][0] == 1_000_000
assert duplicates.empty

print("\nValidation passed!")