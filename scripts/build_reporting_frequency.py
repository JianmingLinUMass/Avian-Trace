"""Resumable, additive frequency preparation. Existing databases stay untouched until publish."""
import argparse
from datetime import datetime, timezone
from concurrent.futures import ProcessPoolExecutor, as_completed
import json
from pathlib import Path
import shutil
import uuid
import time

from reporting_frequency import (DATABASES, YEARS, TABLES, POLICY, log, digest, json_write,
    snapshot, fingerprint, connection, aggregate_sql, safe_remove, original_inventory,
    check_source_schema, verified_year, identifiers, build_lock, default_paths,
    require_separate_work, scratch_path, assert_additive_base)


def database_hashes(directory):
    present = [name for name in DATABASES if (directory / name).exists()]
    if present and len(present) != len(DATABASES): raise ValueError("Partial destination database trio")
    return {name: digest(directory / name) for name in present}


def prepare(input_dir, base_dir, output_dir, work, scope, memory, threads, resume=False):
    input_dir, base_dir, output_dir, work = [Path(p).resolve() for p in (input_dir, base_dir, output_dir, work)]
    require_separate_work(work, (input_dir, base_dir, output_dir))
    source = snapshot(input_dir)
    identity = {"input": str(input_dir), "base": str(base_dir), "output": str(output_dir), "scope": scope, "policy": POLICY, "source": source}
    marker = work / "manifest.json"
    if marker.exists():
        if not resume: raise FileExistsError("Work exists; use --resume for this exact snapshot/settings")
        manifest = json.loads(marker.read_text(encoding="utf-8"))
        if manifest["identity"] != identity: raise ValueError("Source snapshot or build policy changed; use a new work directory")
        for name, sha in manifest["base_hashes"].items():
            if digest(base_dir / name) != sha: raise ValueError("Base database changed since the checkpoint")
        return manifest
    if resume: raise FileNotFoundError("No manifest to resume")
    if work.exists() and any(work.iterdir()):
        raise FileExistsError("Nonempty work directory has no matching manifest; use a new empty directory")
    check_source_schema(input_dir)
    for name in DATABASES:
        if not (base_dir / name).is_file() or (base_dir / (name + ".wal")).exists(): raise ValueError("Base database missing or has a WAL: " + name)
    assert_additive_base(base_dir)
    if shutil.disk_usage(work.parent).free < sum((base_dir / name).stat().st_size for name in DATABASES) * 2 + 20 * 1024**3:
        raise ValueError("Insufficient free staging space (base copies plus at least 20 GiB scratch)")
    work.mkdir(parents=True, exist_ok=True)
    manifest = {"build_id": str(uuid.uuid4()), "identity": identity, "source_fingerprint": fingerprint(identity), "base_hashes": {}, "legacy": {}, "years": [], "status": "preparing"}
    (work / "originals").mkdir(exist_ok=True)
    for name in DATABASES:
        log("Preserving base " + name)
        sha = digest(base_dir / name)
        shutil.copy2(base_dir / name, work / "originals" / name)
        if digest(work / "originals" / name) != sha or digest(base_dir / name) != sha: raise ValueError("Base changed during copying")
        manifest["base_hashes"][name] = sha
        manifest["legacy"][name] = original_inventory(base_dir / name)
    manifest["output_hashes"] = dict(manifest["base_hashes"]) if output_dir == base_dir else database_hashes(output_dir)
    json_write(marker, manifest)
    return manifest


def build_year(input_dir, work, year, memory, threads, scratch_directory=None):
    lock_dir = work / "locks" / str(year)
    lock_dir.mkdir(parents=True, exist_ok=True)
    with build_lock(lock_dir):
        return _build_year(input_dir, work, year, memory, threads, scratch_directory)


def _build_year(input_dir, work, year, memory, threads, scratch_directory=None):
    years = work / "years"; years.mkdir(exist_ok=True)
    final = years / str(year); partial = years / (str(year) + ".incomplete")
    scratch_root = scratch_path(work, scratch_directory, (input_dir, work / "originals", work / "candidate"))
    scratch_root.mkdir(parents=True, exist_ok=True)
    scratch = scratch_root / f"year-{year}.duckdb"
    if final.exists() and verified_year(final): log(f"Year {year}: verified checkpoint, skipped"); return
    for old in (final, partial):
        if old.exists(): safe_remove(old, work)
    for old in (scratch, Path(str(scratch) + ".wal")):
        if old.exists(): safe_remove(old, scratch_root)
    partial.mkdir()
    started = time.monotonic()
    log(f"Year {year}: reading complete EBD checklists across all source files")
    with connection(scratch, scratch_root / str(year), memory, threads) as con:
        con.execute("""CREATE TABLE observations AS SELECT checklist_id,
            NULLIF(state_code,'') state_code,NULLIF(county_code,'') county_code,
            MONTH(CAST(observation_date AS DATE))::INTEGER AS month,
            CASE WHEN locality_type='H' THEN NULLIF(locality_id,'') END locality_id,
            CASE WHEN category='species' THEN NULLIF(taxon_id,'') END taxon_id
          FROM read_parquet(?) WHERE complete_checklist='1'
            AND checklist_id IS NOT NULL AND TRIM(checklist_id)<>''
            AND observation_date BETWEEN ? AND ?""", [str(input_dir / "part_*.parquet"),f"{year}-01-01",f"{year}-12-31"])
        con.execute("CREATE TABLE checklists AS SELECT DISTINCT checklist_id,state_code,county_code,month,locality_id FROM observations")
        info = {}
        for name in TABLES:
            log(f"Year {year}: {name}")
            result = con.execute("COPY (" + aggregate_sql(name, year) + ") TO ? (FORMAT PARQUET, COMPRESSION ZSTD)", [str(partial / (name + ".parquet"))]).fetchone()[0]
            info[name] = {"rows": result, "sha256": digest(partial / (name + ".parquet"))}
    safe_remove(scratch, scratch_root)
    json_write(partial / "complete.json", info)
    partial.rename(final)
    log(f"Year {year}: checkpoint complete ({time.monotonic()-started:.1f}s)")



def build_years(input_dir, work, manifest, memory, threads, workers=1, scratch_directory=None):
    def completed(year):
        manifest["years"] = sorted(set(manifest["years"] + [year]))
        json_write(work / "manifest.json", manifest)
    if workers == 1:
        for year in YEARS:
            build_year(input_dir, work, year, memory, threads, scratch_directory)
            completed(year)
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(build_year,input_dir,work,year,memory,threads,scratch_directory): year for year in YEARS}
            for future in as_completed(futures):
                future.result()
                completed(futures[future])


def finalize(work, manifest, memory, threads):
    candidate = work / "candidate"
    if candidate.exists():
        raise FileExistsError("Candidate already exists; validate it without reconstructing it")
    assert_additive_base(work / "originals")
    candidate.mkdir()
    for filename in DATABASES:
        shutil.copy2(work / "originals" / filename, candidate / filename)
        names = [name for name, spec in TABLES.items() if spec["database"] == filename]
        if not names: continue
        with connection(candidate / filename, work, memory, threads) as con:
            for name in names:
                paths = [str(work / "years" / str(year) / (name + ".parquet")) for year in YEARS]
                con.execute(f"CREATE TABLE {name} AS SELECT * FROM read_parquet(?)", [paths])
            con.execute("""CREATE TABLE reporting_frequency_build(
              build_id VARCHAR,source_fingerprint VARCHAR,scope VARCHAR,start_year INTEGER,end_year INTEGER,
              denominator VARCHAR,date_policy VARCHAR,complete BOOLEAN)""")
            con.execute("INSERT INTO reporting_frequency_build VALUES (?,?,?,?,?,?,?,FALSE)", [manifest["build_id"],manifest["source_fingerprint"],manifest["identity"]["scope"],2012,2025,POLICY["denominator"],POLICY["date_policy"]])
            con.execute("CREATE TABLE reporting_frequency_coverage AS SELECT y::INTEGER AS year,m::INTEGER AS month,FALSE complete FROM range(2012,2026) a(y) CROSS JOIN range(1,13) b(m)")
            con.execute("CHECKPOINT")
    manifest["status"] = "built"
    json_write(work / "manifest.json", manifest)


def publish(work, manifest):
    if (work/"PUBLICATION_BLOCKED").exists():
        raise PermissionError("Publication blocked pending explicit approval of transfer and publication paths")
    report = json.loads((work / "validation.json").read_text(encoding="utf-8"))
    if not report["passed"] or report["build_id"] != manifest["build_id"]: raise ValueError("Successful validation required")
    output = Path(manifest["identity"]["output"]); base = Path(manifest["identity"]["base"])
    # Older checkpoints predate this field: only the original base or an empty
    # separate destination is safe for them, never an unchecked existing trio.
    expected_output = manifest.get("output_hashes", manifest["base_hashes"] if output == base else {})
    current_output = database_hashes(output)
    if current_output != expected_output: raise ValueError("Destination changed since construction; refusing to overwrite it")
    current_base = current_output if output == base else database_hashes(base)
    if current_base != manifest["base_hashes"]: raise ValueError("Original database changed before publication")
    for name in DATABASES:
        if digest(work / "candidate" / name) != report["candidate_hashes"][name]: raise ValueError("Candidate changed after validation")
        if (output / (name + ".wal")).exists(): raise ValueError("Stop the backend and checkpoint before publication")
    for name in ("ebird.duckdb", "ebird_locations.duckdb"):
        with connection(work / "candidate" / name, work / "scratch", read_only=True) as con:
            if con.execute("SELECT complete FROM reporting_frequency_build").fetchall() != [(True,)]:
                raise ValueError("Candidate completion flags are not approved for publication")
            if con.execute("SELECT COUNT(*) FROM reporting_frequency_coverage WHERE complete").fetchone()[0] != 168:
                raise ValueError("Candidate coverage flags are incomplete")
    output.mkdir(parents=True, exist_ok=True)
    existing = [name for name in DATABASES if (output / name).exists()]
    if existing and len(existing)!=3: raise ValueError("Partial destination database trio")
    backup = work / ("backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")); backup.mkdir()
    journal = {"status":"preparing","output":str(output),"backup":str(backup),"existing":existing}
    json_write(work / "publication.json",journal)
    temporary = {}; installed = []
    try:
        for name in DATABASES:
            if name in existing: shutil.copy2(output / name, backup / name)
            path = output / ("frequency_" + manifest["build_id"] + "_" + name)
            if path.exists(): raise FileExistsError(path)
            temporary[name] = path
            shutil.copy2(work / "candidate" / name, path)
            if digest(path) != report["candidate_hashes"][name]: raise ValueError("Publication copy failed checksum")
        journal["status"] = "replacing"; json_write(work / "publication.json",journal)
        for name in DATABASES:
            temporary[name].replace(output / name); installed.append(name)
        for name in DATABASES:
            if digest(output / name) != report["candidate_hashes"][name]: raise ValueError("Published checksum differs from validated candidate")
    except BaseException:
        for name in reversed(installed):
            if name in existing: shutil.copy2(backup / name, output / name)
            else: (output / name).unlink()
        for path in temporary.values():
            if path.exists(): path.unlink()
        journal["status"]="rolled_back";json_write(work / "publication.json",journal)
        raise
    journal["status"]="published";json_write(work / "publication.json",journal)
    log(f"Published {output}; preserved originals/backups in {work}")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=["nationwide", "US-MA"], default="nationwide")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--base-databases", type=Path)
    parser.add_argument("--output-databases", type=Path)
    parser.add_argument("--work", "--checkpoint-directory", dest="work", type=Path)
    parser.add_argument("--scratch-directory", type=Path)
    parser.add_argument("--memory-limit", default="16GB")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--workers", type=int, default=1, help="Memory and thread limits apply to EACH worker")
    parser.add_argument("--resume", action="store_true")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--validate-only", action="store_true")
    mode.add_argument("--publish-only", action="store_true")
    parser.add_argument("--ignore-pause", action="store_true", help="Validate despite the pause marker; does not remove it")
    args = parser.parse_args(argv)
    if args.threads < 1 or args.workers < 1:
        parser.error("threads and workers must be positive")
    defaults = default_paths(args.scope)
    args.work = (args.work or defaults["work"]).resolve()
    if not args.validate_only and not args.publish_only:
        args.input = (args.input or defaults["input"]).resolve()
        args.base_databases = (args.base_databases or defaults["base"]).resolve()
        args.output_databases = (args.output_databases or defaults["output"]).resolve()
    return args


def main(argv=None):
    args = parse_args(argv)
    work = args.work
    if args.validate_only or args.publish_only:
        manifest = json.loads((work / "manifest.json").read_text(encoding="utf-8"))
        saved = manifest["identity"]
        protected = (args.input or saved["input"], saved["base"], saved["output"])
    else:
        protected = (args.input, args.base_databases, args.output_databases)
    # Reject unsafe paths before creating even a lock file.
    require_separate_work(work, protected)
    scratch = scratch_path(work, args.scratch_directory, protected)
    work.parent.mkdir(parents=True, exist_ok=True)
    with build_lock(work.parent):
        if args.publish_only:
            publish(work, manifest)
            return
        reuse_candidate = False
        if not args.validate_only:
            manifest = prepare(args.input, args.base_databases, args.output_databases, work,
                               args.scope, args.memory_limit, args.threads, args.resume)
            reuse_candidate = (work / "candidate").exists()
            if reuse_candidate and manifest["status"] not in ("built", "built_validation_deferred", "validated"):
                raise FileExistsError("Partial candidate exists; preserve it and investigate before resuming")
            if not reuse_candidate:
                if args.scope == "US-MA":
                    with connection(":memory:", scratch, args.memory_limit, args.threads) as con:
                        if con.execute("SELECT count(*) FROM read_parquet(?) WHERE state_code IS DISTINCT FROM 'US-MA'", [str(args.input / "part_*.parquet")]).fetchone()[0]:
                            raise ValueError("MA input contains other states")
                build_years(args.input, work, manifest, args.memory_limit, args.threads, args.workers, scratch)
                finalize(work, manifest, args.memory_limit, args.threads)
        from validate_reporting_frequency import validate
        validate(work, manifest, args.memory_limit, args.threads, args.workers,
                 scratch_directory=scratch, source_override=args.input,
                 mark_complete=not (args.validate_only or reuse_candidate),
                 honor_pause=not args.ignore_pause)


if __name__ == "__main__":
    main()
