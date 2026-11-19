"""Lossless Massachusetts export with resumable batches and validation before publish."""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "parquet" / "production"
DEFAULT_OUTPUT = ROOT / "parquet_ma"
FORMAT_VERSION = 1
PATTERN = "part_*.parquet"
STATE_CODE = "US-MA"


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def read_json(path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def identity(path):
    stat = path.stat()
    return {"name": path.name, "bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def is_link(path):
    return path.is_symlink() or path.is_junction()


def overlaps(first, second):
    return first.is_relative_to(second) or second.is_relative_to(first)


def export_paths(source, output, temporary=None):
    if is_link(output):
        raise ValueError("Output must not be a symbolic link or junction")
    source, output = source.resolve(), output.resolve()
    if output.name.endswith(".incomplete"):
        raise ValueError("Choose a completed output name without the reserved .incomplete suffix")
    staging = output.with_name(output.name + ".incomplete")
    if not source.is_dir():
        raise ValueError(f"Input directory not found: {source}")
    if overlaps(source, output) or overlaps(source, staging):
        raise ValueError("Input, output and staging directories must not overlap")
    if is_link(staging):
        raise ValueError("Staging must not be a symbolic link or junction")
    temporary = temporary or staging / ".duckdb_tmp"
    if is_link(temporary):
        raise ValueError("DuckDB temporary storage must not be a link or junction")
    temporary = temporary.resolve()
    if overlaps(source, temporary):
        raise ValueError("DuckDB temporary storage must be separate from the source")
    return source, output, staging, temporary


def source_files(source, max_files=None):
    files = sorted(source.glob(PATTERN))
    if not files:
        raise ValueError(f"No {PATTERN} files found in {source}")
    if any(not path.is_file() or is_link(path) for path in files):
        raise ValueError("Source parts must be regular files, not links")
    return files[:max_files] if max_files is not None else files


def make_plan(source, batch_size, file_size_mib, max_files=None):
    files = source_files(source, max_files)
    before = [identity(path) for path in files]
    schema = pq.read_schema(files[0])
    if not {"state_code", "observation_date"}.issubset(schema.names):
        raise ValueError("Source needs state_code and observation_date columns")
    if any(not field.nullable for field in schema):
        raise ValueError("Source fields must be nullable, matching production; refusing to change nullability")
    for path in files:
        if not pq.read_schema(path).equals(schema, check_metadata=False):
            raise ValueError(f"Source schema mismatch: {path.name}")
    if before != [identity(path) for path in files]:
        raise ValueError("Source changed during schema inspection")
    plan = {
        "format_version": FORMAT_VERSION,
        "source": str(source),
        "pattern": PATTERN,
        "sources": before,
        "state_code": STATE_CODE,
        "schema": base64.b64encode(schema.serialize().to_pybytes()).decode("ascii"),
        "batch_size": batch_size,
        "file_size_mib": file_size_mib,
        "row_group_size": 122880,
        "compression": "zstd",
        "disabled_optimizers": "statistics_propagation",
        "max_files": max_files,
        "subset": max_files is not None,
        "duckdb_version": duckdb.__version__,
    }
    fingerprint = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()
    return plan, fingerprint


def schema_from_plan(plan):
    return pa.ipc.read_schema(pa.BufferReader(base64.b64decode(plan["schema"])))


def verify_source(plan, source=None, check_schema=False):
    source = (source or Path(plan["source"])).resolve()
    if str(source) != plan["source"]:
        raise ValueError("Source path differs from the recorded snapshot")
    files = source_files(source, plan["max_files"])
    if [identity(path) for path in files] != plan["sources"]:
        raise ValueError("Source snapshot changed; use a new output directory, not --resume")
    if check_schema:
        schema = schema_from_plan(plan)
        for path in files:
            if not pq.read_schema(path).equals(schema, check_metadata=False):
                raise ValueError(f"Source schema changed: {path.name}")
    return files


def batch_names(plan):
    return [f"batch_{index:05d}" for index in range(
        (len(plan["sources"]) + plan["batch_size"] - 1) // plan["batch_size"]
    )]


def batch_sources(plan, index):
    start = index * plan["batch_size"]
    return [str(Path(plan["source"]) / entry["name"])
            for entry in plan["sources"][start:start + plan["batch_size"]]]


def load_manifest(dataset):
    manifest = read_json(dataset / "manifest.json")
    plan = manifest["plan"]
    fingerprint = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()
    if plan["format_version"] != FORMAT_VERSION or manifest["fingerprint"] != fingerprint:
        raise ValueError("Unsupported or inconsistent export manifest")
    if plan["state_code"] != STATE_CODE or plan["pattern"] != PATTERN:
        raise ValueError("Manifest has incompatible extraction settings")
    if set(manifest["batches"]) - set(batch_names(plan)):
        raise ValueError("Manifest contains unexpected batches")
    return manifest


@contextmanager
def export_lock(output):
    """OS lock releases on interruption; a leftover lock file is harmless."""
    output.parent.mkdir(parents=True, exist_ok=True)
    path = output.with_name("." + output.name + ".lock")
    if is_link(path):
        raise ValueError("Lock file must not be a symbolic link")
    stream = path.open("a+b")
    try:
        if path.stat().st_size == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError("Another extraction/validation owns this export") from exc
        yield
    finally:
        stream.close()


def connect(memory_limit, threads, temporary):
    temporary.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(config={
        "memory_limit": memory_limit,
        "threads": str(threads),
        "temp_directory": str(temporary),
        "preserve_insertion_order": "false",
    })


def describe_batch(folder, schema):
    if not folder.is_dir() or is_link(folder):
        raise ValueError(f"Missing or linked batch directory: {folder.name}")
    files = sorted(folder.iterdir())
    if not files:
        raise ValueError(f"Empty batch directory: {folder.name}")
    records = []
    for path in files:
        if (not re.fullmatch(r"part_\d+\.parquet", path.name)
                or not path.is_file() or is_link(path)):
            raise ValueError(f"Unexpected batch entry: {path}")
        metadata = pq.read_metadata(path)
        if not metadata.schema.to_arrow_schema().equals(schema, check_metadata=False):
            raise ValueError(f"Output schema mismatch: {path}")
        records.append({"name": path.name, "bytes": path.stat().st_size,
                        "rows": metadata.num_rows, "sha256": sha256(path)})
    return records


def remove_owned_directory(staging, path):
    # Only computed, immediate batch/scratch directories inside this export may be removed.
    if (path.parent.resolve() != staging.resolve()
            or not re.fullmatch(r"(?:batch_\d{5}(?:\.pending)?|\.duckdb_tmp|\.source_export)", path.name)
            or is_link(path) or path.resolve().parent != staging.resolve()):
        raise ValueError(f"Unsafe batch cleanup target: {path}")
    if path.exists():
        if not path.is_dir():
            raise ValueError(f"Batch path is not a directory: {path}")
        if any(is_link(child) for child in path.rglob("*")):
            raise ValueError(f"Refusing cleanup of linked batch contents: {path}")
        shutil.rmtree(path)


def extract_batch(connection, inputs, folder, plan):
    target = folder.as_posix().replace("'", "''")
    result = connection.execute(f"""
        COPY (SELECT * FROM read_parquet(?, hive_partitioning=false)
              WHERE state_code = 'US-MA')
        TO '{target}' (FORMAT PARQUET, COMPRESSION ZSTD,
                      ROW_GROUP_SIZE {plan['row_group_size']},
                      FILE_SIZE_BYTES {plan['file_size_mib'] * 1024 * 1024},
                      FILENAME_PATTERN 'part_{{i}}')
    """, [inputs]).fetchone()
    # Keep even an entirely empty export independently readable.
    if not list(folder.glob("*.parquet")):
        folder.mkdir(exist_ok=True)
        empty = (folder / "part_0.parquet").as_posix().replace("'", "''")
        connection.execute(f"""COPY (SELECT * FROM read_parquet(?) LIMIT 0)
            TO '{empty}' (FORMAT PARQUET, COMPRESSION ZSTD)""", [inputs[0]])
    return result[0]


def run_export(args):
    source, output, staging, temporary = export_paths(args.input, args.output, args.temp_directory)
    if args.max_files is not None and output == DEFAULT_OUTPUT.resolve():
        raise ValueError("--max-files requires a separate --output for the subset test")
    if temporary != staging / ".duckdb_tmp" and (overlaps(output, temporary) or overlaps(staging, temporary)):
        raise ValueError("Custom temporary storage must be outside completed and staging directories")
    started = time.monotonic()
    with export_lock(output):
        if output.exists():
            raise ValueError(f"Completed destination exists; choose a new --output: {output}")
        plan, fingerprint = make_plan(source, args.batch_size, args.file_size_mib, args.max_files)
        schema = schema_from_plan(plan)
        if staging.exists():
            if not args.resume:
                raise ValueError(f"Staging exists; inspect it and use --resume: {staging}")
            manifest = load_manifest(staging)
            if manifest["fingerprint"] != fingerprint:
                raise ValueError("Source snapshot or extraction settings changed; cannot resume")
        else:
            if args.resume:
                raise ValueError("No staging manifest to resume; start without --resume")
            staging.mkdir()
            manifest = {"plan": plan, "fingerprint": fingerprint,
                        "status": "extracting", "batches": {}}
            atomic_json(staging / "manifest.json", manifest)
        manifest["resources"] = {"memory_limit": args.memory_limit, "threads": args.threads}
        manifest["status"] = "extracting"
        atomic_json(staging / "manifest.json", manifest)
        names = batch_names(plan)
        print(f"{'SUBSET TEST' if plan['subset'] else 'FULL EXPORT'}: {len(plan['sources'])} source files, "
              f"{len(names)} batches; staging: {staging}", flush=True)
        if temporary == staging / ".duckdb_tmp":
            remove_owned_directory(staging, temporary)
        connection = connect(args.memory_limit, args.threads, temporary)
        try:
            # Keep original nullable Parquet fields; retain filter pushdown and native writing.
            connection.execute("SET disabled_optimizers='statistics_propagation'")
            for index, name in enumerate(names):
                folder, pending = staging / name, staging / (name + ".pending")
                record = manifest["batches"].get(name)
                reusable = False
                if record:
                    try:
                        existing = describe_batch(folder, schema)
                        reusable = (not record.get("validation_failed") and existing == record["files"]
                                    and sum(file["rows"] for file in existing) == record["rows"])
                    except (OSError, ValueError, pa.ArrowException):
                        reusable = False
                remove_owned_directory(staging, pending)
                if reusable:
                    print(f"[{index + 1}/{len(names)}] Reusing {name}: {record['rows']:,} rows", flush=True)
                    continue
                if record:
                    print(f"Regenerating damaged/incomplete checkpoint: {name}", flush=True)
                    del manifest["batches"][name]
                    atomic_json(staging / "manifest.json", manifest)
                remove_owned_directory(staging, folder)
                rows = extract_batch(connection, batch_sources(plan, index), pending, plan)
                files = describe_batch(pending, schema)
                if sum(file["rows"] for file in files) != rows:
                    raise ValueError(f"Writer/metadata row-count mismatch: {name}")
                pending.rename(folder)
                manifest["batches"][name] = {"rows": rows, "files": files}
                atomic_json(staging / "manifest.json", manifest)
                print(f"[{index + 1}/{len(names)}] Wrote {name}: {rows:,} Massachusetts rows "
                      f"({time.monotonic() - started:.1f}s elapsed)", flush=True)
        finally:
            connection.close()
        verify_source(plan)
        manifest["status"] = "validating"
        atomic_json(staging / "manifest.json", manifest)
        if __package__:
            from .validate_massachusetts import validate_export
        else:
            from validate_massachusetts import validate_export
        report = validate_export(staging, source, args.memory_limit, args.threads,
                                 temporary, checkpoint=True)
        if temporary == staging / ".duckdb_tmp":
            remove_owned_directory(staging, temporary)
        # The validator rechecks all source identities and output checksums before returning.
        atomic_json(staging / "validation.json", report)
        manifest = load_manifest(staging)
        manifest["status"] = "validated"
        atomic_json(staging / "manifest.json", manifest)
        if output.exists():
            raise ValueError("Destination appeared during processing; refusing to replace it")
        staging.rename(output)
        report.update(dataset_statistics(output))
        print(f"Published validated dataset: {output}", flush=True)
        print(json.dumps(report, indent=2), flush=True)
        return report


def dataset_statistics(dataset):
    files = [path for path in dataset.rglob("*") if path.is_file() and not is_link(path)]
    return {"dataset_files": len(files), "dataset_bytes": sum(path.stat().st_size for path in files)}


def positive(value):
    value = int(value)
    if value < 1:
        raise argparse.ArgumentTypeError("Must be positive")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--layout", choices=["mirror", "legacy"], default="mirror")
    parser.add_argument("--reuse-export", type=Path, help="Copy an existing validated legacy MA export; no nationwide scan")
    parser.add_argument("--prototype-dir", type=Path, default=ROOT / "parquet")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--max-files", type=positive, help="Subset test only; needs a separate --output")
    parser.add_argument("--batch-size", type=positive, default=32)
    parser.add_argument("--file-size-mib", type=positive, default=256)
    parser.add_argument("--memory-limit", default="4GB")
    parser.add_argument("--threads", type=positive, default=4)
    parser.add_argument("--temp-directory", type=Path)
    args = parser.parse_args()
    try:
        if args.layout == "legacy":
            if args.reuse_export:
                raise ValueError("--reuse-export requires mirror layout")
            run_export(args)
        else:
            if __package__:
                from .massachusetts_layout import run_mirror
            else:
                from massachusetts_layout import run_mirror
            run_mirror(args)
    except KeyboardInterrupt:
        print("Interrupted. Staging/checkpoints retained; rerun with --resume.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Export failed: {exc}\nNo completed destination was published. "
              "Inspect staging before resuming.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
