"""Shared schema/IO helpers for offline EBD-derived checklist frequencies."""
from contextlib import contextmanager
import hashlib
import os
import json
from pathlib import Path
import shutil
import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]

DATABASES = ("ebird.duckdb", "ebird_daily.duckdb", "ebird_locations.duckdb")
YEARS = tuple(range(2012, 2026))
REQUIRED = {"checklist_id", "complete_checklist", "observation_date", "taxon_id", "category", "state_code", "county_code", "locality_id", "locality_type"}
TABLES = {}
for family in ("region", "hotspot"):
    for period in ("month", "year"):
        for species in (False, True):
            name = ("species_checklists_" if species else "complete_checklists_") + family + "_" + period
            keys = [("region_level", "VARCHAR"), ("region_code", "VARCHAR")] if family == "region" else [("county_code", "VARCHAR"), ("locality_id", "VARCHAR")]
            keys += [("year", "INTEGER")]
            if period == "month": keys += [("month", "INTEGER")]
            if species: keys += [("taxon_id", "VARCHAR")]
            TABLES[name] = {"family": family, "period": period, "species": species, "keys": keys,
                "count": "reporting_checklists" if species else "complete_checklists",
                "database": "ebird.duckdb" if family == "region" else "ebird_locations.duckdb"}
OWNED = set(TABLES) | {"reporting_frequency_build", "reporting_frequency_coverage"}
POLICY = {"version": 1, "denominator": "EBD-represented distinct complete checklist IDs, all taxon categories",
    "complete": "complete_checklist = '1'", "numerator_category": "species", "approved_filter": False,
    "protocol_filter": False, "group_id_deduplication": False, "date_policy": "raw dates; annual DISTINCT independently",
    "start_year": 2012, "end_year": 2025, "duckdb_version": duckdb.__version__}


def log(message): print(message, flush=True)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""): h.update(block)
    return h.hexdigest()


def json_write(path, value):
    path = Path(path); temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, default=str) + "\n", encoding="utf-8")
    temporary.replace(path)


def snapshot(directory):
    files = sorted(Path(directory).glob("part_*.parquet"))
    if not files: raise FileNotFoundError(f"No production Parquet: {directory}")
    result = []
    for index, path in enumerate(files, 1):
        before = path.stat(); sha = digest(path); after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns): raise ValueError(f"Source changed: {path}")
        result.append({"name": path.name, "bytes": after.st_size, "mtime_ns": after.st_mtime_ns, "sha256": sha})
        if index % 50 == 0 or index == len(files): log(f"Source fingerprint: {index}/{len(files)} files")
    return result


def fingerprint(value): return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def connection(path, work, memory="16GB", threads=4, read_only=False):
    con = duckdb.connect(str(path), read_only=read_only,
        config={"memory_limit": memory, "threads": str(threads)})
    con.execute("SET enable_progress_bar=false")
    # Spill outside the candidate even for read-only queries.
    spill = Path(work) / "spill"
    spill.mkdir(parents=True, exist_ok=True)
    con.execute("SET temp_directory=?", [str(spill)])
    if not read_only:
        con.execute("SET preserve_insertion_order=false")
    return con


def identifiers(names): return ",".join('"' + name.replace('"','""') + '"' for name in names)


def table_columns(name):
    spec = TABLES[name]
    return [key for key, _ in spec["keys"]] + [spec["count"]]


def aggregate_sql(name, year):
    """Builder counts distinct IDs directly; validation uses separate raw SQL."""
    s = TABLES[name]; dimensions = [f"{year}::INTEGER AS year"]
    grouping = []
    if s["period"] == "month": dimensions += ["month"]; grouping += ["month"]
    if s["species"]: dimensions += ["taxon_id"]; grouping += ["taxon_id"]
    middle = ",".join(dimensions)
    tail = ("," + ",".join(grouping)) if grouping else ""
    suffix = " AND taxon_id IS NOT NULL" if s["species"] else ""
    source = "observations" if s["species"] else "checklists"
    count = "COUNT(DISTINCT checklist_id)::BIGINT AS " + s["count"]
    if s["family"] == "region":
        return f"""SELECT 'state' AS region_level,state_code AS region_code,{middle},{count}
          FROM {source} WHERE state_code IS NOT NULL{suffix} GROUP BY state_code{tail}
          UNION ALL SELECT 'county',county_code,{middle},{count}
          FROM {source} WHERE county_code IS NOT NULL{suffix} GROUP BY county_code{tail}"""
    return f"""SELECT county_code,locality_id,{middle},{count} FROM {source}
        WHERE county_code IS NOT NULL AND locality_id IS NOT NULL{suffix}
        GROUP BY county_code,locality_id{tail}"""


def safe_remove(path, work):
    path, work = Path(path).resolve(), Path(work).resolve()
    if path == work or work not in path.parents: raise ValueError("Cleanup escaped the work directory")
    if path.is_dir(): shutil.rmtree(path)
    elif path.exists(): path.unlink()


def original_inventory(path):
    """Check legacy schemas and streaming row fingerprints without changing them."""
    result = {}
    with duckdb.connect(str(path), read_only=True) as con:
        tables = con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY 1").fetchall()
        for (name,) in tables:
            if name in OWNED: continue
            cols = con.execute("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='main' AND table_name=? ORDER BY ordinal_position", [name]).fetchall()
            quoted = identifiers([row[0] for row in cols]); table = identifiers([name])
            count, hashed = con.execute(f"SELECT COUNT(*),bit_xor(hash({quoted})) FROM {table}").fetchone()
            result[name] = {"columns": [list(row) for row in cols], "rows": count, "row_hash": str(hashed)}
    return result


def check_source_schema(directory):
    with duckdb.connect() as con:
        rows = con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(Path(directory) / "part_*.parquet")]).fetchall()
    if not REQUIRED <= {r[0] for r in rows}: raise ValueError("Required production fields missing")
    if any(r[1] != "VARCHAR" for r in rows if r[0] in REQUIRED): raise ValueError("Expected original VARCHAR production fields")


def verified_year(directory):
    marker = directory / "complete.json"
    if not marker.exists(): return False
    try:
        info = json.loads(marker.read_text(encoding="utf-8"))
        return all((directory / (name + ".parquet")).is_file() and digest(directory / (name + ".parquet")) == info[name]["sha256"] for name in TABLES)
    except (KeyError, ValueError): return False


@contextmanager
def build_lock(directory):
    """Process lock released by the OS after interruption; not a completion marker."""
    lock_path = Path(directory) / ".reporting-frequency.lock"
    with lock_path.open("a+b") as stream:
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            if not stream.read(1):
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def default_paths(scope):
    """Repository-root defaults, independent of the caller's working directory."""
    ma = scope == "US-MA"
    return {
        "input": REPO_ROOT / ("parquet_ma" if ma else "parquet") / "production",
        "base": REPO_ROOT / ("database_ma" if ma else "database"),
        "output": REPO_ROOT / ("database_ma" if ma else "database"),
        "work": REPO_ROOT / ".reporting-frequency" / ("massachusetts" if ma else "nationwide"),
    }


def assert_additive_base(directory):
    """Never replace a pre-existing frequency table or view, including in a copy."""
    for filename in DATABASES:
        with duckdb.connect(str(Path(directory) / filename), read_only=True) as con:
            names = {row[0] for row in con.execute(
                "SELECT table_name FROM information_schema.tables"
            ).fetchall()}
            collisions = names & OWNED
            if collisions:
                raise ValueError("Frequency table names already exist in " + filename + ": " + ", ".join(sorted(collisions)))


def catalog_inventory(con, alias):
    """Logical catalog metadata; attachment-local OIDs and storage estimates vary."""
    result = {}
    for kind in ("tables", "columns", "indexes", "constraints", "views", "schemas", "sequences", "types", "functions"):
        cursor = con.execute("SELECT * FROM duckdb_" + kind + "() WHERE database_name=?", [alias])
        columns = [item[0] for item in cursor.description]
        rows = []
        for values in cursor.fetchall():
            row = dict(zip(columns, values))
            if row.get("internal", False) or row.get("table_name") in OWNED:
                continue
            row = {key: value for key, value in row.items()
                   if key != "database_name" and not key.endswith("_oid")
                   and key not in ("oid", "constraint_index", "estimated_size", "data_type_id", "is_bound")}
            rows.append(row)
        result[kind] = sorted(rows, key=lambda row: json.dumps(row, sort_keys=True, default=str))
    result["database"] = con.execute(
        "SELECT comment,tags,type,encrypted,cipher,options FROM duckdb_databases() WHERE database_name=?", [alias]
    ).fetchall()
    return result


def verify_preserved(original, candidate, scratch, memory="16GB", threads=4):
    """Exact legacy multiset comparison plus schemas, indexes and catalog metadata."""
    original, candidate = Path(original), Path(candidate)
    before, after = digest(original), digest(candidate)
    scratch = Path(scratch)
    scratch.mkdir(parents=True, exist_ok=True)
    with duckdb.connect(config={"memory_limit": memory, "threads": str(threads), "temp_directory": str(scratch)}) as con:
        con.execute("ATTACH ? AS original (READ_ONLY)", [str(original)])
        con.execute("ATTACH ? AS candidate (READ_ONLY)", [str(candidate)])
        left, right = catalog_inventory(con, "original"), catalog_inventory(con, "candidate")
        changed = [key for key in left if left[key] != right[key]]
        if changed:
            raise ValueError("Legacy catalog metadata changed: " + ", ".join(changed))
        tables = {}
        for schema, table in con.execute("SELECT schema_name,table_name FROM duckdb_tables() WHERE database_name='original' AND NOT internal ORDER BY 1,2").fetchall():
            if table in OWNED:
                raise ValueError("Frequency table collides with original: " + table)
            qualified = identifiers([schema]) + "." + identifiers([table])
            if before != after:
                a, b = "SELECT * FROM original." + qualified, "SELECT * FROM candidate." + qualified
                differences = con.execute("SELECT COUNT(*) FROM ((" + a + " EXCEPT ALL " + b + ") UNION ALL (" + b + " EXCEPT ALL " + a + "))").fetchone()[0]
                if differences:
                    raise ValueError("Legacy contents changed: " + table)
            tables[schema + "." + table] = con.execute("SELECT COUNT(*) FROM original." + qualified).fetchone()[0]
    return {"original_sha256": before, "candidate_sha256": after, "catalog_equal": True,
            "contents_equal": True, "method": "identical file SHA256" if before == after else "bidirectional EXCEPT ALL", "tables": tables}


def require_separate_work(work, protected):
    work = Path(work).resolve()
    for directory in protected:
        directory = Path(directory).resolve()
        if work == directory or work in directory.parents or directory in work.parents:
            raise ValueError("Work directory must be separate from source and database directories")


def scratch_path(work, requested, protected):
    work = Path(work).resolve()
    scratch = Path(requested).resolve() if requested else work / "scratch"
    require_separate_work(scratch, list(protected) + [work / name for name in ("candidate", "originals", "years", "validation")])
    return scratch
