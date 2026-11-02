
from pathlib import Path
import duckdb

db_path = Path(__file__).resolve().parents[1] / "database" / "ebird.duckdb"

con = duckdb.connect(str(db_path), read_only=True)

print("\nUNMATCHED STATES")
print(con.execute("""
    SELECT state_code, observation_rows
    FROM states
    WHERE state_name IS NULL
    ORDER BY state_code
""").df().to_string(index=False))

print("\nUNMATCHED COUNTIES")
print(con.execute("""
    SELECT state_code, county_code, observation_rows
    FROM counties
    WHERE county_name IS NULL
    ORDER BY state_code, county_code
""").df().to_string(index=False))

con.close()
