"""Mirrored MA warehouse assembly; observation bytes stay unchanged."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

if __package__:
    from . import extract_massachusetts as export
    from .prototype_normalization import CATALOG_BATCH_SIZE, sqlite_integer, sqlite_float
else:
    import extract_massachusetts as export
    from prototype_normalization import CATALOG_BATCH_SIZE, sqlite_integer, sqlite_float

LAYOUT_VERSION = 2
TABLE_FIELDS = {
    "observations": [("observation_id", pa.string()), ("checklist_id", pa.string()),
        ("taxon_id", pa.string()), ("locality_id", pa.string()), ("observation_date", pa.string()),
        ("count_raw", pa.string()), ("observation_count", pa.int64())],
    "locations": [("locality_id", pa.string()), ("locality_name", pa.string()),
        ("latitude", pa.float64()), ("longitude", pa.float64()),
        ("state_code", pa.string()), ("county_code", pa.string())],
    "taxa": [("taxon_id", pa.string()), ("common_name", pa.string()),
        ("scientific_name", pa.string()), ("category", pa.string()), ("taxonomic_order", pa.int64())],
}
OBSERVATION_COLUMNS = ",".join(name for name, _ in TABLE_FIELDS["observations"])
RAW_COLUMNS = ["observation_id", "checklist_id", "taxon_id", "locality_id", "observation_date",
    "count_raw", "locality_name", "latitude", "longitude", "state_code", "county_code",
    "common_name", "scientific_name", "category", "taxonomic_order"]


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def prototype_schemas(folder):
    schemas, records = {}, {}
    for name, fields in TABLE_FIELDS.items():
        path = folder / (name + ".parquet")
        schema = pq.read_schema(path)
        if not schema.equals(pa.schema(fields), check_metadata=False):
            raise ValueError(f"Unexpected prototype schema: {path}")
        schemas[name] = base64.b64encode(schema.serialize().to_pybytes()).decode("ascii")
        records[name] = {"path": str(path.resolve()), "sha256": export.sha256(path)}
    return schemas, records


def schema_of(plan, table):
    return pa.ipc.read_schema(pa.BufferReader(base64.b64decode(plan["prototype_schemas"][table])))


def file_record(path, schema=None):
    if not path.is_file() or export.is_link(path):
        raise ValueError(f"Missing or linked output: {path}")
    metadata = pq.read_metadata(path)
    if schema is not None and not metadata.schema.to_arrow_schema().equals(schema, check_metadata=False):
        raise ValueError(f"Schema mismatch: {path}")
    return {"bytes": path.stat().st_size, "rows": metadata.num_rows, "sha256": export.sha256(path)}


def reference_info(folder):
    """Verify the old validated export, without opening its nationwide source files."""
    if export.is_link(folder):
        raise ValueError("Reference export must not be linked")
    folder = folder.resolve()
    manifest = export.load_manifest(folder)
    report = export.read_json(folder / "validation.json")
    if (manifest["status"] != "validated" or not report.get("passed")
            or not report.get("exact_multiset_match") or not report.get("schema_matches")
            or report["source_fingerprint"] != manifest["fingerprint"]
            or report["output"]["non_massachusetts_rows"]):
        raise ValueError("Reference export lacks matching successful full validation")
    schema = export.schema_from_plan(manifest["plan"])
    records = []
    for batch in export.batch_names(manifest["plan"]):
        checkpoint = manifest["batches"][batch]
        actual = export.describe_batch(folder / batch, schema)
        if actual != checkpoint["files"] or sum(item["rows"] for item in actual) != checkpoint["rows"]:
            raise ValueError(f"Reference checkpoint changed: {batch}")
        for item in actual:
            records.append({"relative_path": batch + "/" + item["name"],
                **{key: item[key] for key in ("bytes", "rows", "sha256")}})
    expected = {folder / item["relative_path"] for item in records}
    if set(folder.rglob("*.parquet")) != expected:
        raise ValueError("Unexpected Parquet files in reference export")
    if sum(item["rows"] for item in records) != report["output"]["rows"]:
        raise ValueError("Reference observation count differs from its validation report")
    return {"root": str(folder), "manifest_sha256": export.sha256(folder / "manifest.json"),
        "validation_sha256": export.sha256(folder / "validation.json"),
        "source_fingerprint": manifest["fingerprint"], "validation": report,
        "raw_schema": manifest["plan"]["schema"], "parts": records}


def verify_reference(plan, folder):
    current = reference_info(folder)
    recorded = plan["reference"]
    if any(current[key] != recorded[key] for key in current if key != "root"):
        raise ValueError("Validated reference export changed since assembly started")


def production_records(plan):
    return [{"name": f"part_{index:05d}.parquet", "source_relative_path": part["relative_path"],
             **{key: part[key] for key in ("bytes", "rows", "sha256")}}
            for index, part in enumerate(plan["reference"]["parts"])]


def check_inventory(dataset, manifest, allow_workspace=False):
    plan = manifest["plan"]
    production = production_records(plan)
    raw_schema = export.schema_from_plan({"schema": plan["reference"]["raw_schema"]})
    paths = []
    for item in production:
        path = dataset / "production" / item["name"]
        if file_record(path, raw_schema) != {key: item[key] for key in ("bytes", "rows", "sha256")}:
            raise ValueError(f"Production copy differs from validated reference: {path.name}")
        if export.read_json(path.with_suffix(".done.json")) != item:
            raise ValueError(f"Incorrect MA processing metadata: {path.name}")
        paths.append(path)
    if export.read_json(dataset / "production" / "plan.json") != {
            "format_version": LAYOUT_VERSION, "operation": "copy_validated_massachusetts_parts",
            "reference_fingerprint": plan["reference"]["source_fingerprint"], "parts": production}:
        raise ValueError("Production plan does not describe these MA copies")
    for name in TABLE_FIELDS:
        path = dataset / (name + ".parquet")
        if file_record(path, schema_of(plan, name)) != manifest["tables"][name]:
            raise ValueError(f"Root table checkpoint mismatch: {name}")
        paths.append(path)
    actual = set(dataset.rglob("*.parquet"))
    if allow_workspace:
        workspace = dataset / ".source_export"
        actual = {path for path in actual if not path.is_relative_to(workspace)}
    if actual != set(paths):
        raise ValueError("Unexpected/missing Parquet files in mirrored dataset")
    return [path.as_posix() for path in paths[:len(production)]]


def normalized_tables(connection, paths, records):
    """One MA-only scan; conversions run only on distinct numeric input strings."""
    connection.create_function("prototype_integer", sqlite_integer, ["VARCHAR"], "BIGINT", null_handling="special")
    connection.create_function("prototype_float", sqlite_float, ["VARCHAR"], "DOUBLE", null_handling="special")
    connection.execute("CREATE TEMP TABLE part_positions (filename VARCHAR, row_offset BIGINT)")
    offset = 0
    for path, record in zip(paths, records):
        connection.execute("INSERT INTO part_positions VALUES (?,?)", [path, offset])
        offset += record["rows"]
    columns = ",".join("p." + name for name in RAW_COLUMNS)
    print("Preparing normalized MA records (no nationwide scan)...", flush=True)
    connection.execute(f"""CREATE TEMP TABLE mirror_raw AS
        SELECT {columns}, positions.row_offset + p.file_row_number AS ordinal
        FROM read_parquet(?, hive_partitioning=false, filename=true, file_row_number=true) p
        JOIN part_positions positions ON positions.filename=p.filename""", [paths])
    raw_rows, raw_first, raw_last, bad_states = connection.execute("SELECT COUNT(*),MIN(observation_date),MAX(observation_date),COUNT(*) FILTER(WHERE state_code IS DISTINCT FROM 'US-MA') FROM mirror_raw").fetchone()
    if bad_states:
        raise ValueError("Production contains observations outside Massachusetts")
    connection.execute("CREATE TEMP TABLE integer_inputs AS SELECT count_raw AS value FROM mirror_raw UNION SELECT taxonomic_order FROM mirror_raw")
    connection.execute("ALTER TABLE integer_inputs ADD COLUMN parsed BIGINT")
    connection.execute("UPDATE integer_inputs SET parsed=prototype_integer(value)")
    connection.execute("CREATE TEMP TABLE float_inputs AS SELECT latitude AS value FROM mirror_raw UNION SELECT longitude FROM mirror_raw")
    connection.execute("ALTER TABLE float_inputs ADD COLUMN parsed DOUBLE")
    connection.execute("UPDATE float_inputs SET parsed=prototype_float(value)")
    connection.execute("""CREATE TEMP TABLE mirror_rows AS SELECT
        COALESCE(r.observation_id,'') AS observation_id,
        COALESCE(r.checklist_id,'') AS checklist_id,
        NULLIF(r.taxon_id,'') AS taxon_id, NULLIF(r.locality_id,'') AS locality_id,
        COALESCE(r.observation_date,'') AS observation_date, COALESCE(r.count_raw,'') AS count_raw,
        counts.parsed AS observation_count, r.ordinal,
        struct_pack(locality_name:=COALESCE(r.locality_name,''), latitude:=lat.parsed,
            longitude:=lon.parsed, state_code:=COALESCE(r.state_code,''), county_code:=COALESCE(r.county_code,'')) AS location_metadata,
        struct_pack(common_name:=COALESCE(r.common_name,''), scientific_name:=COALESCE(r.scientific_name,''),
            category:=COALESCE(r.category,''), taxonomic_order:=orders.parsed) AS taxon_metadata
        FROM mirror_raw r
        LEFT JOIN integer_inputs counts ON r.count_raw IS NOT DISTINCT FROM counts.value
        LEFT JOIN integer_inputs orders ON r.taxonomic_order IS NOT DISTINCT FROM orders.value
        LEFT JOIN float_inputs lat ON r.latitude IS NOT DISTINCT FROM lat.value
        LEFT JOIN float_inputs lon ON r.longitude IS NOT DISTINCT FROM lon.value""")
    connection.execute("DROP TABLE mirror_raw")
    for table, key, metadata in [("locations", "locality_id", "location_metadata"), ("taxa", "taxon_id", "taxon_metadata")]:
        names = [name for name, _ in TABLE_FIELDS[table]][1:]
        fields = ",".join("chosen." + name + " AS " + name for name in names)
        connection.execute(f"""CREATE TEMP TABLE expected_{table} AS
            SELECT {key},{fields} FROM (
                SELECT {key},arg_min({metadata},struct_pack(batch_no:=ordinal//{CATALOG_BATCH_SIZE}, reverse_row:=-ordinal)) AS chosen
                FROM mirror_rows WHERE {key} IS NOT NULL GROUP BY {key})""")
    connection.execute(f"CREATE TEMP VIEW expected_observations AS SELECT {OBSERVATION_COLUMNS} FROM mirror_rows")
    return raw_rows, raw_first, raw_last


def conflict_statistics(connection):
    result = {}
    for table, key, metadata in [("locations", "locality_id", "location_metadata"), ("taxa", "taxon_id", "taxon_metadata")]:
        ids, variants, extra = connection.execute(f"""SELECT
            COUNT(*) FILTER(WHERE variants>1), COALESCE(SUM(variants) FILTER(WHERE variants>1),0),
            COALESCE(SUM(variants-1),0)
            FROM (SELECT {key},COUNT(DISTINCT {metadata}) AS variants
                  FROM mirror_rows WHERE {key} IS NOT NULL GROUP BY {key})""").fetchone()
        names = [name for name, _ in TABLE_FIELDS[table]][1:]
        chosen = "struct_pack(" + ",".join(name + ":=c." + name for name in names) + ")"
        differing = connection.execute(f"""SELECT COUNT(*) FROM mirror_rows r
            JOIN expected_{table} c USING({key}) WHERE r.{metadata} IS DISTINCT FROM {chosen}""").fetchone()[0]
        result[table] = {"conflicting_ids": ids, "distinct_variants_at_conflicting_ids": int(variants),
                         "extra_distinct_variants": int(extra), "records_with_nonselected_metadata": differing}
    return result


def build_tables(staging, manifest, memory_limit, threads, temporary):
    records = production_records(manifest["plan"])
    paths = [(staging / "production" / item["name"]).as_posix() for item in records]
    connection = export.connect(memory_limit, threads, temporary)
    try:
        normalized_tables(connection, paths, records)
        conflicts = conflict_statistics(connection)
        connection.execute("SET disabled_optimizers='statistics_propagation'")
        tables = {}
        for name in TABLE_FIELDS:
            path = staging / (name + ".parquet")
            pending = staging / (name + ".parquet.tmp")
            if pending.exists():
                pending.unlink()
            print(f"Writing normalized {name}...", flush=True)
            connection.execute(f"COPY expected_{name} TO ? (FORMAT PARQUET, COMPRESSION ZSTD)", [str(pending)])
            record = file_record(pending, schema_of(manifest["plan"], name))
            pending.replace(path)
            tables[name] = record
        manifest["tables"], manifest["catalog_conflicts"] = tables, conflicts
        export.atomic_json(staging / "manifest.json", manifest)
    finally:
        connection.close()


def load_mirror(dataset):
    manifest = export.read_json(dataset / "manifest.json")
    if (manifest.get("layout") != "parquet_ma" or manifest["plan"]["format_version"] != LAYOUT_VERSION
            or fingerprint(manifest["plan"]) != manifest["fingerprint"]):
        raise ValueError("Unsupported/inconsistent mirrored dataset manifest")
    return manifest


def validate_mirror(dataset, memory_limit, threads, temporary, reference_export=None, allow_workspace=False):
    manifest = load_mirror(dataset)
    plan = manifest["plan"]
    if reference_export:
        verify_reference(plan, reference_export)
    paths = check_inventory(dataset, manifest, allow_workspace)
    records = production_records(plan)
    connection = export.connect(memory_limit, threads, temporary)
    try:
        raw_summary = normalized_tables(connection, paths, records)
        counts = {}
        for name in TABLE_FIELDS:
            print(f"Validating full-row multiplicities for {name}...", flush=True)
            path = str(dataset / (name + ".parquet"))
            literal = path.replace("\\", "/").replace("'", "''")
            connection.execute(f"CREATE TEMP VIEW actual_{name} AS SELECT * FROM read_parquet('{literal}')")
            for first, second in [("expected_", "actual_"), ("actual_", "expected_")]:
                mismatches = connection.execute(f"SELECT COUNT(*) FROM (SELECT * FROM {first}{name} EXCEPT ALL SELECT * FROM {second}{name})").fetchone()[0]
                if mismatches:
                    raise ValueError(f"{name}: {mismatches} missing/added/altered normalized rows")
            counts[name] = connection.execute(f"SELECT COUNT(*) FROM actual_{name}").fetchone()[0]
        relationships = {}
        for table, key in [("locations", "locality_id"), ("taxa", "taxon_id")]:
            missing = connection.execute(f"""SELECT COUNT(*) FROM actual_observations o LEFT JOIN actual_{table} c USING({key})
                WHERE o.{key} IS NOT NULL AND c.{key} IS NULL""").fetchone()[0]
            duplicates = connection.execute(f"SELECT COUNT(*)-COUNT(DISTINCT {key}) FROM actual_{table}").fetchone()[0]
            if missing or duplicates:
                raise ValueError(f"Broken {table} references or catalog key uniqueness")
            relationships[table] = {"missing_references": missing, "duplicate_keys": duplicates}
        conflicts = conflict_statistics(connection)
        if conflicts != manifest["catalog_conflicts"]:
            raise ValueError("Catalog conflict report differs from production records")
        rows, first_date, last_date = raw_summary
        source_summary = plan["reference"]["validation"]["output"]
        if ((first_date, last_date) != (source_summary["minimum_raw_date"], source_summary["maximum_raw_date"])):
            raise ValueError("Production date range differs from validated reference")
        if rows != source_summary["rows"] or counts["observations"] != rows:
            raise ValueError("Observation count differs from original validated MA export")
    finally:
        connection.close()
    check_inventory(dataset, manifest, allow_workspace)
    if reference_export:
        verify_reference(plan, reference_export)
    return {"passed": True, "layout": "parquet_ma", "format_version": LAYOUT_VERSION,
        "production_rows": rows, "production_files": len(paths),
        "production_bytes": sum(record["bytes"] for record in records),
        "minimum_date": first_date, "maximum_date": last_date,
        "root_tables": {name: {"rows": counts[name], **manifest["tables"][name]} for name in TABLE_FIELDS},
        "catalog_conflicts": conflicts, "relationships": relationships,
        "exact_normalized_multiset_match": True, "production_byte_identity": True,
        "original_source_fingerprint": plan["reference"]["source_fingerprint"],
        "subset": plan["reference"]["validation"]["subset"]}


def run_mirror(args):
    output = args.output.resolve()
    staging = output.with_name(output.name + ".incomplete")
    prototype_dir = args.prototype_dir.resolve()
    protected = [prototype_dir, args.input.resolve()]
    if args.reuse_export:
        protected.append(args.reuse_export.resolve())
    if output.name.endswith(".incomplete") or export.is_link(args.output) or export.is_link(staging):
        raise ValueError("Unsafe completed/staging path")
    if any(export.overlaps(path, output) or export.overlaps(path, staging) for path in protected):
        raise ValueError("Mirror output/staging must be separate from all original datasets")
    scratch = args.temp_directory or staging / ".duckdb_tmp"
    if export.is_link(scratch):
        raise ValueError("Mirror scratch must not be linked")
    temporary = scratch.resolve()
    if (any(export.overlaps(temporary, path) for path in protected)
            or (temporary != staging / ".duckdb_tmp" and (export.overlaps(temporary, output) or export.overlaps(temporary, staging)))):
        raise ValueError("Unsafe mirror scratch location")
    if args.max_files is not None and output == export.DEFAULT_OUTPUT.resolve():
        raise ValueError("Subset tests require a separate --output")
    if args.reuse_export and args.max_files is not None:
        raise ValueError("--max-files applies to new extraction, not a validated reference")
    with export.export_lock(output):
        if output.exists():
            raise ValueError("Completed mirror exists; refusing to overwrite")
        if staging.exists() and not args.resume:
            raise ValueError("Mirror staging exists; inspect it and use --resume")
        if not staging.exists() and args.resume:
            raise ValueError("No mirror staging to resume")
        if staging.exists() and any(export.is_link(path) for path in staging.rglob("*")):
            raise ValueError("Refusing linked staging contents")
        schemas, prototype_records = prototype_schemas(prototype_dir)
        staging.mkdir(exist_ok=True)
        saved = load_mirror(staging) if (staging / "manifest.json").exists() else None
        embedded_reference = None
        if args.reuse_export:
            reference_root = args.reuse_export.resolve()
            origin = "existing_validated_export"
        else:
            reference_root = staging / ".source_export"
            origin = "fresh_nationwide_extraction"
            if not reference_root.exists() and saved and saved["plan"]["origin"] == origin:
                embedded_reference = saved["plan"]["reference"]
                reference_root = None
            elif not reference_root.exists():
                inner = argparse.Namespace(**vars(args))
                inner.output = reference_root
                inner.temp_directory = None
                inner.resume = (staging / ".source_export.incomplete").exists()
                export.run_export(inner)
        reference = embedded_reference or reference_info(reference_root)
        if reference["validation"]["subset"] and output == export.DEFAULT_OUTPUT.resolve():
            raise ValueError("A subset reference requires a separate --output")
        plan = {"format_version": LAYOUT_VERSION, "origin": origin, "reference": reference,
            "prototype_schemas": schemas, "prototype_files": prototype_records,
            "normalization": "prototype_python_sqlite_v1", "catalog_batch_size": CATALOG_BATCH_SIZE,
            "catalog_policy": "last_record_in_first_batch",
            "catalog_input_order": "flat_part_name_then_file_row_number",
            "duckdb_version": duckdb.__version__,
            "fresh_extraction_settings": {"input": str(args.input.resolve()), "batch_size": args.batch_size,
                "file_size_mib": args.file_size_mib, "max_files": args.max_files} if origin == "fresh_nationwide_extraction" else None}
        if (staging / "manifest.json").exists():
            manifest = load_mirror(staging)
            if manifest["fingerprint"] != fingerprint(plan):
                raise ValueError("Reference snapshot/prototype/settings changed; cannot resume")
        else:
            manifest = {"layout": "parquet_ma", "plan": plan, "fingerprint": fingerprint(plan),
                        "status": "copying", "parts": {}}
            export.atomic_json(staging / "manifest.json", manifest)
        production = staging / "production"
        production.mkdir(exist_ok=True)
        records = production_records(plan)
        raw_schema = export.schema_from_plan({"schema": reference["raw_schema"]})
        for index, item in enumerate(records):
            path = production / item["name"]
            expected = {key: item[key] for key in ("bytes", "rows", "sha256")}
            good = False
            if path.exists():
                try:
                    good = file_record(path, raw_schema) == expected
                except (ValueError, OSError, pa.ArrowException):
                    pass
            if not good:
                if export.is_link(path):
                    raise ValueError("Refusing to replace linked production part")
                pending = path.with_suffix(".parquet.tmp")
                if export.is_link(pending):
                    raise ValueError("Refusing linked temporary part")
                if reference_root is None:
                    raise ValueError("Copied production is damaged and its temporary source is gone; start a new export")
                shutil.copyfile(reference_root / item["source_relative_path"], pending)
                if file_record(pending, raw_schema) != expected:
                    raise ValueError("Copied observation bytes differ from validated source")
                pending.replace(path)
            export.atomic_json(path.with_suffix(".done.json"), item)
            manifest["parts"][item["name"]] = expected
            export.atomic_json(staging / "manifest.json", manifest)
            print(f"[{index+1}/{len(records)}] {'Reused' if good else 'Copied'} {path.name} byte-for-byte", flush=True)
        export.atomic_json(production / "plan.json", {"format_version": LAYOUT_VERSION,
            "operation": "copy_validated_massachusetts_parts", "reference_fingerprint": reference["source_fingerprint"], "parts": records})
        for path in [production / (item["name"]+".tmp") for item in records] + [staging / (name+".parquet.tmp") for name in TABLE_FIELDS]:
            if path.exists():
                path.unlink()
        if temporary == staging / ".duckdb_tmp":
            export.remove_owned_directory(staging, temporary)
        reusable_tables = False
        if manifest.get("tables"):
            try:
                reusable_tables = all(file_record(staging / (name+".parquet"), schema_of(plan,name)) == manifest["tables"][name] for name in TABLE_FIELDS)
            except (ValueError, OSError, pa.ArrowException):
                pass
        if not reusable_tables:
            build_tables(staging, manifest, args.memory_limit, args.threads, temporary)
        manifest["status"] = "validating"
        export.atomic_json(staging / "manifest.json", manifest)
        report = validate_mirror(staging, args.memory_limit, args.threads, temporary,
                                 reference_root, allow_workspace=origin == "fresh_nationwide_extraction")
        if temporary == staging / ".duckdb_tmp":
            export.remove_owned_directory(staging, temporary)
        if origin == "fresh_nationwide_extraction" and reference_root is not None:
            # All source evidence is embedded in the new plan; keep no duplicate raw workspace.
            export.remove_owned_directory(staging, reference_root)
            lock = staging / "..source_export.lock"
            if lock.exists():
                lock.unlink()
        check_inventory(staging, manifest)
        export.atomic_json(staging / "validation.json", report)
        manifest["status"] = "validated"
        export.atomic_json(staging / "manifest.json", manifest)
        if output.exists():
            raise ValueError("Destination appeared; refusing to overwrite")
        staging.rename(output)
        report.update(export.dataset_statistics(output))
        print(f"Published validated MA mirror: {output}", flush=True)
        print(json.dumps(report, indent=2), flush=True)
        return report
