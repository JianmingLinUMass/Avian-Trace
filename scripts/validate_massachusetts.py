"""Verify a Massachusetts export against its exact source snapshot, without publishing."""
import argparse
import json
from pathlib import Path
import sys

if __package__:
    from . import extract_massachusetts as export
else:
    import extract_massachusetts as export


def summarize(connection, relation):
    row = connection.execute(f"""
        SELECT COUNT(*),
               COUNT(*) FILTER (WHERE state_code IS DISTINCT FROM 'US-MA'),
               MIN(observation_date), MAX(observation_date),
               MIN(TRY_CAST(observation_date AS DATE)), MAX(TRY_CAST(observation_date AS DATE)),
               COUNT(*) FILTER (WHERE observation_date IS NULL),
               COUNT(*) FILTER (WHERE observation_date IS NOT NULL
                               AND TRY_CAST(observation_date AS DATE) IS NULL)
        FROM {relation}
    """).fetchone()
    keys = ["rows", "non_massachusetts_rows", "minimum_raw_date", "maximum_raw_date",
            "minimum_date", "maximum_date", "null_dates", "unparseable_dates"]
    return {key: value.isoformat() if hasattr(value, "isoformat") else value
            for key, value in zip(keys, row)}


def output_inventory(dataset, manifest, schema):
    expected = []
    if set(manifest["batches"]) != set(export.batch_names(manifest["plan"])):
        raise ValueError("Extraction has missing source-batch checkpoints")
    for name in export.batch_names(manifest["plan"]):
        record = manifest["batches"][name]
        files = export.describe_batch(dataset / name, schema)
        if files != record["files"] or sum(file["rows"] for file in files) != record["rows"]:
            raise ValueError(f"Output checkpoint mismatch: {name}; resume extraction to regenerate")
        expected.extend(dataset / name / file["name"] for file in files)
    actual = set(dataset.rglob("*.parquet"))
    if actual != set(expected) or any(export.is_link(path) for path in actual):
        raise ValueError("Unexpected/missing Parquet files outside recorded batches")
    return [str(path) for path in expected]


def validate_export(dataset, source, memory_limit, threads, temporary, checkpoint=False):
    """Only the extractor may checkpoint validation inside its .incomplete directory."""
    manifest = export.load_manifest(dataset)
    plan = manifest["plan"]
    export.verify_source(plan, source, check_schema=True)
    schema = export.schema_from_plan(plan)
    outputs = output_inventory(dataset, manifest, schema)
    connection = export.connect(memory_limit, threads, temporary)
    reports = []
    try:
        # First query uses only the exported paths: no original file or database attachment.
        connection.read_parquet(outputs, hive_partitioning=False).create_view("export_only")
        independent = summarize(connection, "export_only")
        if independent["non_massachusetts_rows"] and not checkpoint:
            raise ValueError("Output includes non-Massachusetts or null state codes")
        for index, name in enumerate(export.batch_names(plan)):
            record = manifest["batches"][name]
            if checkpoint and "validation" in record:
                report = record["validation"]
                if (report["source"] != report["output"] or report["missing_rows"]
                        or report["added_rows"] or report["source"]["rows"] != record["rows"]
                        or report["source"]["non_massachusetts_rows"]):
                    raise ValueError(f"Inconsistent validation checkpoint: {name}")
                print(f"Validation [{index + 1}] Reusing verified {name}", flush=True)
            else:
                # One additional filtered source scan per batch. DuckDB owns/spills these tables.
                connection.execute("""
                    CREATE OR REPLACE TEMP TABLE source_batch AS
                    SELECT * FROM read_parquet(?, hive_partitioning=false)
                    WHERE state_code = 'US-MA'
                """, [export.batch_sources(plan, index)])
                output_paths = [str(dataset / name / file["name"]) for file in record["files"]]
                connection.execute("""CREATE OR REPLACE TEMP TABLE output_batch AS
                    SELECT * FROM read_parquet(?, hive_partitioning=false)""", [output_paths])
                source_summary = summarize(connection, "source_batch")
                output_summary = summarize(connection, "output_batch")
                missing, added = connection.execute("""
                    SELECT
                      (SELECT COUNT(*) FROM (SELECT * FROM source_batch
                                             EXCEPT ALL SELECT * FROM output_batch)),
                      (SELECT COUNT(*) FROM (SELECT * FROM output_batch
                                             EXCEPT ALL SELECT * FROM source_batch))
                """).fetchone()
                if missing or added or source_summary != output_summary:
                    if checkpoint:
                        record.pop("validation", None)
                        record["validation_failed"] = True
                        export.atomic_json(dataset / "manifest.json", manifest)
                    raise ValueError(f"Validation failed for {name}: {missing} missing, {added} added/altered rows")
                report = {"source": source_summary, "output": output_summary,
                          "missing_rows": missing, "added_rows": added}
                connection.execute("DROP TABLE source_batch")
                connection.execute("DROP TABLE output_batch")
                if checkpoint:
                    record["validation"] = report
                    export.atomic_json(dataset / "manifest.json", manifest)
                print(f"Validation [{index + 1}] Passed {name}: {source_summary['rows']:,} rows", flush=True)
            reports.append(report)
    finally:
        connection.close()
    if independent["non_massachusetts_rows"]:
        raise ValueError("Output includes non-Massachusetts or null state codes")
    source_rows = sum(report["source"]["rows"] for report in reports)
    if source_rows != independent["rows"]:
        raise ValueError("Independent output count differs from the source count")
    # No successful result if source or output changed during verification.
    export.verify_source(plan, source)
    output_inventory(dataset, manifest, schema)
    parquet_bytes = sum(Path(path).stat().st_size for path in outputs)
    return {"passed": True, "subset": plan["subset"], "source_files": len(plan["sources"]),
            "source_massachusetts_rows": source_rows, "output": independent,
            "parquet_files": len(outputs), "parquet_bytes": parquet_bytes,
            "schema_columns": len(schema), "schema_matches": True,
            "exact_multiset_match": True, "independent_output_query": True,
            "source_fingerprint": manifest["fingerprint"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=export.DEFAULT_INPUT)
    parser.add_argument("--dataset", type=Path, default=export.DEFAULT_OUTPUT,
                        help="Completed export or its .incomplete staging directory")
    parser.add_argument("--memory-limit", default="4GB")
    parser.add_argument("--threads", type=export.positive, default=4)
    parser.add_argument("--temp-directory", type=Path)
    args = parser.parse_args()
    try:
        if export.is_link(args.dataset):
            raise ValueError("Dataset must not be a symbolic link or junction")
        dataset, source = args.dataset.resolve(), args.input.resolve()
        if export.overlaps(dataset, source):
            raise ValueError("Source and dataset must not overlap")
        temporary = (args.temp_directory or dataset.with_name("." + dataset.name + ".validation-tmp")).resolve()
        if export.overlaps(temporary, source) or export.overlaps(temporary, dataset):
            raise ValueError("Validation temporary storage must be outside source and dataset")
        name = dataset.name.removesuffix(".incomplete")
        with export.export_lock(dataset.with_name(name)):
            report = validate_export(dataset, source, args.memory_limit, args.threads, temporary)
        report.update(export.dataset_statistics(dataset))
        print(json.dumps(report, indent=2))
    except KeyboardInterrupt:
        print("Validation interrupted; no dataset files were changed.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Validation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
