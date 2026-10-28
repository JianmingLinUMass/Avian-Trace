import time
import duckdb  # type: ignore

con = duckdb.connect(
    "database/ebird.duckdb",
    read_only=True
)

query = """
SELECT
    s.year,
    s.observation_rows
FROM species_region_year s
JOIN taxa t ON s.taxon_id = t.taxon_id
WHERE s.region_level = 'state'
  AND s.region_code = 'US-MA'
  AND t.common_name = 'Northern Cardinal'
  AND t.category = 'species'
ORDER BY s.year
"""

start = time.perf_counter()
result = con.execute(query).df()
elapsed = time.perf_counter() - start

print(result.to_string(index=False))

print(f"\nQuery time: {elapsed:.4f} seconds")
print(f"Rows returned: {len(result):,}")

con.close()
