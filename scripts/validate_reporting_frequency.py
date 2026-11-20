"""Independent raw-Parquet frequency validation and cross-scope reconciliation."""
import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import duckdb

from reporting_frequency import (DATABASES, YEARS, TABLES, POLICY, log, digest, json_write,
    snapshot, connection, safe_remove, original_inventory, identifiers,
    build_lock, default_paths, scratch_path, require_separate_work, verify_preserved)


def expected_sql(name, year):
    # Deliberately separate from the builder: deduplicate raw keys, then COUNT(*).
    spec=TABLES[name]
    month=",EXTRACT(month FROM CAST(observation_date AS DATE))::INTEGER AS month" if spec["period"]=="month" else ""
    taxon=",taxon_id" if spec["species"] else ""
    species=" AND category='species' AND taxon_id IS NOT NULL AND taxon_id<>''" if spec["species"] else ""
    if spec["family"]=="region":
        expanded=f"""SELECT 'state' AS region_level,state_code AS region_code,{year}::INTEGER AS year{month}{taxon},checklist_id
          FROM validation_raw WHERE state_code IS NOT NULL AND state_code<>''{species}
          UNION ALL SELECT 'county',county_code,{year}::INTEGER{month}{taxon},checklist_id
          FROM validation_raw WHERE county_code IS NOT NULL AND county_code<>''{species}"""
    else:
        expanded=f"""SELECT county_code,locality_id,{year}::INTEGER AS year{month}{taxon},checklist_id
          FROM validation_raw WHERE locality_type='H' AND county_code IS NOT NULL AND county_code<>''
            AND locality_id IS NOT NULL AND locality_id<>''{species}"""
    keys=identifiers([key for key,_ in spec["keys"]])
    return f"SELECT {keys},COUNT(*)::BIGINT AS {spec['count']} FROM (SELECT DISTINCT * FROM ({expanded})) GROUP BY {keys}"


def compare(con, left, right, label):
    count=con.execute(f"SELECT COUNT(*) FROM (({left} EXCEPT ALL {right}) UNION ALL ({right} EXCEPT ALL {left})) differences").fetchone()[0]
    if count: raise ValueError(f"{label}: {count} differing rows")


def invariants(candidate, work, memory, threads):
    counts={}
    for filename in ("ebird.duckdb","ebird_locations.duckdb"):
        with connection(candidate/filename,work,memory,threads,True) as con:
            for name,s in TABLES.items():
                if s["database"]!=filename:continue
                expected=[(key,kind) for key,kind in s["keys"]]+[(s["count"],"BIGINT")]
                actual=[(row[0],row[1]) for row in con.execute(f"DESCRIBE {name}").fetchall()]
                if actual!=expected:raise ValueError("Frequency schema mismatch: "+name)
                keys=identifiers([key for key,_ in s["keys"]]);count=s["count"]
                if con.execute(f"SELECT COUNT(*) FROM (SELECT {keys} FROM {name} GROUP BY {keys} HAVING COUNT(*)>1)").fetchone()[0]:raise ValueError("Duplicate frequency group: "+name)
                null_keys = " OR ".join(key + " IS NULL" for key,_ in s["keys"])
                if con.execute(f"SELECT COUNT(*) FROM {name} WHERE {null_keys} OR {count} IS NULL OR {count}<1 OR year NOT BETWEEN 2012 AND 2025"+(" OR month NOT BETWEEN 1 AND 12" if s["period"]=="month" else "")).fetchone()[0]:raise ValueError("Invalid frequency count/coverage: "+name)
                counts[name]=con.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                if s["species"]:
                    denominator=name.replace("species_checklists_","complete_checklists_")
                    keys=[key for key,_ in s["keys"] if key!="taxon_id"]
                    join=" AND ".join(f"n.{key} IS NOT DISTINCT FROM d.{key}" for key in keys)
                    bad=con.execute(f"SELECT COUNT(*) FROM {name} n LEFT JOIN {denominator} d ON {join} WHERE d.complete_checklists IS NULL OR n.reporting_checklists>d.complete_checklists").fetchone()[0]
                    if bad:raise ValueError("Numerator exceeds or lacks denominator: "+name)
                if s["period"]=="year":
                    monthly=name[:-4]+"month"
                    keys=identifiers([key for key,_ in s["keys"]])
                    compare_query=f"SELECT {keys},MAX({count}) lo,SUM({count}) hi FROM {monthly} GROUP BY {keys}"
                    join=" AND ".join(f"a.{key} IS NOT DISTINCT FROM m.{key}" for key,_ in s["keys"])
                    bad=con.execute(f"SELECT COUNT(*) FROM {name} a FULL JOIN ({compare_query}) m ON {join} WHERE a.{count} IS NULL OR m.lo IS NULL OR a.{count}<m.lo OR a.{count}>m.hi").fetchone()[0]
                    if bad:raise ValueError("Annual distinct/monthly bounds fail: "+name)
    return counts


def validate_year(work, source, candidate, year, identity_source, seed_hashes, memory, threads, scratch_directory=None):
    lock_dir = work / "locks" / ("validation-" + str(year))
    lock_dir.mkdir(parents=True, exist_ok=True)
    with build_lock(lock_dir):
        return _validate_year(work, source, candidate, year, identity_source, seed_hashes, memory, threads, scratch_directory)


def _validate_year(work, source, candidate, year, identity_source, seed_hashes, memory, threads, scratch_directory=None):
    validation_dir=work/"validation";validation_dir.mkdir(exist_ok=True)
    marker=validation_dir/(str(year)+".json")
    identity={"source":identity_source,"candidates":seed_hashes,"year":year}
    if marker.exists() and json.loads(marker.read_text(encoding="utf-8"))==identity:
        log(f"Validation {year}: verified checkpoint, skipped");return
    scratch_root = scratch_path(work, scratch_directory, (source, candidate, work / "originals"))
    scratch_root.mkdir(parents=True, exist_ok=True)
    scratch=scratch_root/f"validation-{year}.duckdb"
    for old in (scratch,Path(str(scratch)+".wal")):
        if old.exists():safe_remove(old,scratch_root)
    with connection(scratch,scratch_root/("validation-"+str(year)),memory,threads) as con:
        # Independent scan of raw Parquet, not the builder's normalized/year files.
        con.execute("""CREATE TABLE validation_raw AS SELECT checklist_id,observation_date,state_code,county_code,
          locality_id,locality_type,category,taxon_id FROM read_parquet(?)
          WHERE complete_checklist='1' AND checklist_id IS NOT NULL AND LENGTH(TRIM(checklist_id))>0
          AND observation_date>=? AND observation_date<?""",[str(source/"part_*.parquet"),f"{year}-01-01",f"{year+1}-01-01"])
        con.execute("ATTACH ? AS main_candidate (READ_ONLY)",[str(candidate/"ebird.duckdb")])
        con.execute("ATTACH ? AS hotspot_candidate (READ_ONLY)",[str(candidate/"ebird_locations.duckdb")])
        for name,s in TABLES.items():
            log(f"Validation {year}: {name} against raw Parquet")
            alias="main_candidate" if s["family"]=="region" else "hotspot_candidate"
            compare(con,expected_sql(name,year),f"SELECT * FROM {alias}.{name} WHERE year={year}",name)
    safe_remove(scratch,scratch_root);json_write(marker,identity)


def validate(work, manifest, memory="16GB", threads=4, workers=1, *, scratch_directory=None,
             source_override=None, candidate_directory=None, original_directory=None,
             mark_complete=False, honor_pause=True, report_path=None):
    work=Path(work)
    if honor_pause and (work/"PAUSE_BEFORE_VALIDATION").exists():
        log("Aggregation complete; validation deferred by PAUSE_BEFORE_VALIDATION. Candidates and checkpoints retained.")
        if mark_complete:
            manifest["status"]="built_validation_deferred"
            json_write(work/"manifest.json",manifest)
        return {"passed":False,"deferred":True}
    source=Path(source_override or manifest["identity"]["input"]).resolve()
    candidate=Path(candidate_directory or work/"candidate").resolve()
    originals=Path(original_directory or work/"originals").resolve()
    protected=(source,manifest["identity"]["base"],manifest["identity"]["output"])
    require_separate_work(work,protected)
    scratch_root=scratch_path(work,scratch_directory,list(protected)+[candidate,originals])
    report_path=Path(report_path) if report_path else work/("validation.json" if mark_complete else "validation-read-only.json")
    if not mark_complete and report_path.exists():
        raise FileExistsError("Preserve the existing report; choose a new --report path")
    if snapshot(source)!=manifest["identity"]["source"]:raise ValueError("Raw source changed during construction")
    seed_hashes={name:digest(candidate/name) for name in DATABASES}
    preservation={}
    for name in DATABASES:
        if digest(originals/name)!=manifest["base_hashes"][name]:raise ValueError("Original backup changed: "+name)
        if original_inventory(candidate/name)!=manifest["legacy"][name]:raise ValueError("Legacy tables changed: "+name)
        preservation[name]=verify_preserved(originals/name,candidate/name,scratch_root/"preservation",memory,threads)
    if digest(candidate/"ebird_daily.duckdb")!=manifest["base_hashes"]["ebird_daily.duckdb"]:raise ValueError("Daily database changed")
    row_counts=invariants(candidate,scratch_root,memory,threads)
    for filename in ("ebird.duckdb","ebird_locations.duckdb"):
        with connection(candidate/filename,scratch_root,memory,threads,True) as con:
            expected_metadata=[(manifest["build_id"],manifest["source_fingerprint"],manifest["identity"]["scope"],2012,2025,POLICY["denominator"],POLICY["date_policy"])]
            if con.execute("SELECT build_id,source_fingerprint,scope,start_year,end_year,denominator,date_policy FROM reporting_frequency_build").fetchall()!=expected_metadata:
                raise ValueError("Frequency generation metadata mismatch")
            if con.execute("SELECT year,month FROM reporting_frequency_coverage ORDER BY year,month").fetchall()!=[(year,month) for year in YEARS for month in range(1,13)]:
                raise ValueError("Frequency completion coverage mismatch")
    validation_dir=work/"validation";validation_dir.mkdir(exist_ok=True)
    if workers == 1:
        for year in YEARS: validate_year(work,source,candidate,year,manifest["source_fingerprint"],seed_hashes,memory,threads,scratch_root)
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures=[pool.submit(validate_year,work,source,candidate,year,manifest["source_fingerprint"],seed_hashes,memory,threads,scratch_root) for year in YEARS]
            for future in futures: future.result()
    if snapshot(source)!=manifest["identity"]["source"]:raise ValueError("Raw source changed during validation")
    if {name:digest(candidate/name) for name in DATABASES}!=seed_hashes:
        raise ValueError("Candidate changed during validation")
    # Only a fresh construction owns its metadata. Audits/resume leave evidence intact.
    if mark_complete:
        for filename in ("ebird.duckdb","ebird_locations.duckdb"):
            with connection(candidate/filename,scratch_root,memory,threads) as con:
                con.execute("UPDATE reporting_frequency_build SET complete=TRUE")
                con.execute("UPDATE reporting_frequency_coverage SET complete=TRUE")
                con.execute("CHECKPOINT")
    report={"passed":True,"build_id":manifest["build_id"],"scope":manifest["identity"]["scope"],
        "raw_sql_validation_years":list(YEARS),"row_counts":row_counts,
        "preservation":preservation,"completion_flags_updated":mark_complete,"input_candidate_hashes":seed_hashes,"source_files":len(manifest["identity"]["source"]),
        "candidate_bytes":{name:(candidate/name).stat().st_size for name in DATABASES},
        "candidate_hashes":{name:digest(candidate/name) for name in DATABASES}}
    report_path.parent.mkdir(parents=True,exist_ok=True)
    json_write(report_path,report)
    if mark_complete:
        manifest["status"]="validated";json_write(work/"manifest.json",manifest)
    log(json.dumps(report,indent=2))
    return report


def compare_massachusetts(nationwide, massachusetts, memory="16GB", threads=4, scratch_directory=None):
    nationwide,massachusetts=Path(nationwide),Path(massachusetts)
    scratch=Path(scratch_directory or default_paths("nationwide")["work"].parent/"cross-scope-scratch").resolve()
    require_separate_work(scratch,(nationwide,massachusetts))
    scratch.mkdir(parents=True,exist_ok=True)
    matched=[]
    for filename in ("ebird.duckdb","ebird_locations.duckdb"):
        con=duckdb.connect(config={"memory_limit":memory,"threads":str(threads),"temp_directory":str(scratch)})
        try:
            con.execute("ATTACH ? AS nation (READ_ONLY)",[str(nationwide/filename)])
            con.execute("ATTACH ? AS ma (READ_ONLY)",[str(massachusetts/filename)])
            for name,s in TABLES.items():
                if s["database"]!=filename:continue
                condition="(region_code='US-MA' OR starts_with(region_code,'US-MA-'))" if s["family"]=="region" else "starts_with(county_code,'US-MA-')"
                compare(con,f"SELECT * FROM nation.{name} WHERE {condition}",f"SELECT * FROM ma.{name}","Nationwide/MA "+name)
                matched.append(name)
                log("PASS cross-scope: "+name)
        finally:con.close()
    return {"passed":True,"tables":matched,"nationwide":str(nationwide.resolve()),"massachusetts":str(massachusetts.resolve()),
        "hashes":{str(directory.resolve()):{filename:digest(directory/filename) for filename in ("ebird.duckdb","ebird_locations.duckdb")} for directory in (nationwide,massachusetts)}}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", "--checkpoint-directory", dest="work", type=Path)
    parser.add_argument("--input",type=Path,help="Relocated raw snapshot; its recorded hashes must still match")
    parser.add_argument("--candidates",type=Path)
    parser.add_argument("--originals",type=Path)
    parser.add_argument("--nationwide",type=Path,default=default_paths("nationwide")["work"]/"candidate")
    parser.add_argument("--massachusetts",type=Path,default=default_paths("US-MA")["work"]/"candidate")
    parser.add_argument("--scratch-directory",type=Path)
    parser.add_argument("--memory-limit",default="16GB")
    parser.add_argument("--threads",type=int,default=4)
    parser.add_argument("--workers",type=int,default=1)
    parser.add_argument("--ignore-pause",action="store_true",help="Honor explicit validation approval without removing the pause marker")
    parser.add_argument("--report",type=Path)
    args=parser.parse_args(argv)
    if args.threads<1 or args.workers<1:parser.error("threads and workers must be positive")
    if args.work:
        work=args.work.resolve()
        manifest=json.loads((work/"manifest.json").read_text(encoding="utf-8"))
        protected=(args.input or manifest["identity"]["input"],manifest["identity"]["base"],manifest["identity"]["output"])
        require_separate_work(work,protected)
        with build_lock(work.parent):
            report=validate(work,manifest,args.memory_limit,args.threads,args.workers,
                            scratch_directory=args.scratch_directory,source_override=args.input,
                            candidate_directory=args.candidates,original_directory=args.originals,
                            mark_complete=False,honor_pause=not args.ignore_pause,report_path=args.report)
    else:
        if args.input or args.candidates or args.originals:parser.error("Snapshot overrides require --work")
        report_path=args.report or default_paths("nationwide")["work"].parent/"cross-scope-validation.json"
        if report_path.exists():raise FileExistsError("Preserve the existing report; choose a new --report path")
        report=compare_massachusetts(args.nationwide,args.massachusetts,args.memory_limit,args.threads,args.scratch_directory)
        report_path.parent.mkdir(parents=True,exist_ok=True)
        json_write(report_path,report)
    return report


if __name__=="__main__":
    main()
