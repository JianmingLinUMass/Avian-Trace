"""Small synthetic fixtures only; never scan the default production directory."""
import argparse
from contextlib import redirect_stdout
import io
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from scripts import extract_massachusetts as export
from scripts import validate_massachusetts as validation


class MassachusettsExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="avian-ma-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.output = self.root / "massachusetts"
        self.staging = self.root / "massachusetts.incomplete"
        self.args = argparse.Namespace(input=self.source, output=self.output,
            temp_directory=None, resume=False, max_files=None, batch_size=1,
            file_size_mib=1, memory_limit="256MB", threads=1)
        connection = duckdb.connect()
        try:
            connection.execute("""CREATE TABLE records (
                observation_id VARCHAR, state_code VARCHAR, observation_date VARCHAR,
                locality_name VARCHAR, metric DECIMAL(12,3), reviewed BOOLEAN)""")
            batches = [
                [("A", "US-MA", "1900-01-02", None, "3.125", True),
                 ("A", "US-MA", "1900-01-02", None, "3.125", True),
                 ("N", "US-MA", None, "Null date", None, None),
                 ("U", "US-MA", "unknown", "Unparseable date", "0", False),
                 ("NY", "US-NY", "2026-01-01", "Massachusetts", "5", True),
                 ("NULL", None, "2026-01-01", "Massachusetts", "1", False)],
                [("RI", "US-RI", "2020-01-01", "Massachusetts", "1", True)],
                [("Z", "US-MA", "2026-09-30", "Future", "7.250", False),
                 ("Q", "US-MA", "2010-05-01", "Earlier", "2.500", True)],
            ]
            for index, rows in enumerate(batches):
                connection.execute("DELETE FROM records")
                connection.executemany("INSERT INTO records VALUES (?,?,?,?,?,?)", rows)
                connection.execute("COPY records TO ? (FORMAT PARQUET)",
                                   [str(self.source / f"part_{index:05d}.parquet")])
                # Production uses nullable fields; tiny fixture normalization never touches production.
                path = self.source / f"part_{index:05d}.parquet"
                table = pq.read_table(path)
                nullable = pa.schema([field.with_nullable(True) for field in table.schema])
                pq.write_table(table.cast(nullable), path)
        finally:
            connection.close()

    def run_export(self):
        with redirect_stdout(io.StringIO()):
            return export.run_export(self.args)

    def validate(self, dataset=None):
        with redirect_stdout(io.StringIO()):
            return validation.validate_export(dataset or self.output, self.source,
                "256MB", 1, self.root / "validation-temp")

    def extracted_staging(self):
        with patch.object(validation, "validate_export", side_effect=ValueError("Forced validation failure")):
            with self.assertRaisesRegex(ValueError, "Forced validation"):
                self.run_export()
        self.assertFalse(self.output.exists())
        self.assertTrue(self.staging.exists())

    def rewrite_first_batch(self, statements):
        folder = self.staging / "batch_00000"
        path = next(folder.glob("*.parquet"))
        replacement = self.root / "replacement.parquet"
        connection = duckdb.connect()
        try:
            connection.execute("CREATE TABLE changed AS SELECT * FROM read_parquet(?)", [str(path)])
            for statement in statements:
                connection.execute(statement)
            connection.execute("SET disabled_optimizers='statistics_propagation'")
            connection.execute("COPY changed TO ? (FORMAT PARQUET)", [str(replacement)])
        finally:
            connection.close()
        os.replace(replacement, path)
        manifest = export.load_manifest(self.staging)
        manifest["batches"]["batch_00000"]["files"] = export.describe_batch(
            folder, export.schema_from_plan(manifest["plan"]))
        export.atomic_json(self.staging / "manifest.json", manifest)

    def test_lossless_export_dates_types_duplicates_and_independent_query(self):
        report = self.run_export()
        self.assertFalse(self.staging.exists())
        self.assertTrue(report["passed"])
        self.assertEqual(report["source_massachusetts_rows"], 6)
        self.assertEqual(report["output"]["rows"], 6)
        self.assertEqual(report["output"]["minimum_date"], "1900-01-02")
        self.assertEqual(report["output"]["maximum_date"], "2026-09-30")
        self.assertEqual(report["output"]["null_dates"], 1)
        self.assertEqual(report["output"]["unparseable_dates"], 1)
        self.assertEqual(report["output"]["non_massachusetts_rows"], 0)
        files = sorted(self.output.rglob("*.parquet"))
        schema = pq.read_schema(next(self.source.glob("*.parquet")))
        self.assertTrue(all(pq.read_schema(path).equals(schema) for path in files))
        self.assertEqual(report["parquet_bytes"], sum(path.stat().st_size for path in files))
        self.assertEqual(self.validate()["source_massachusetts_rows"], 6)
        self.source.rename(self.root / "source-unavailable")
        connection = duckdb.connect()
        try:
            self.assertEqual(connection.execute("SELECT count(*) FROM read_parquet(?)",
                [[str(path) for path in files]]).fetchone()[0], 6)
            self.assertEqual(connection.execute("SELECT count(*) FROM read_parquet(?) WHERE observation_id='A'",
                [[str(path) for path in files]]).fetchone()[0], 2)
        finally:
            connection.close()

    def test_interrupt_regenerates_pending_batch_and_reuses_completed_batch(self):
        original = export.extract_batch
        calls = 0
        def interrupted(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise KeyboardInterrupt()
            return original(*args)
        with patch.object(export, "extract_batch", side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.run_export()
        self.assertFalse(self.output.exists())
        first = next((self.staging / "batch_00000").glob("*.parquet"))
        before = (first.stat().st_mtime_ns, export.sha256(first))
        pending = self.staging / "batch_00001.pending"
        pending.mkdir()
        (pending / "part_0.parquet").write_bytes(b"interrupted writer")
        self.args.resume = True
        self.args.memory_limit = "384MB"  # Resource tuning does not change extraction semantics.
        with patch.object(export, "extract_batch", wraps=original) as writer:
            self.run_export()
        self.assertEqual(writer.call_count, 2)
        first = self.output / "batch_00000" / first.name
        self.assertEqual((first.stat().st_mtime_ns, export.sha256(first)), before)

    def test_validation_failure_never_publishes_and_resume_skips_all_extraction(self):
        self.extracted_staging()
        self.args.resume = True
        with patch.object(export, "extract_batch", side_effect=AssertionError("Unexpected re-extraction")):
            self.run_export()
        self.assertTrue(self.output.exists())

    def test_resume_recovers_corrupt_completed_output(self):
        self.extracted_staging()
        first = next((self.staging / "batch_00000").glob("*.parquet"))
        first.write_bytes(b"damaged")
        self.args.resume = True
        with patch.object(export, "extract_batch", wraps=export.extract_batch) as writer:
            self.run_export()
        self.assertEqual(writer.call_count, 1)
        self.assertEqual(self.validate()["output"]["rows"], 6)

    def test_changed_source_identity_prevents_resume_without_touching_staging(self):
        self.extracted_staging()
        before = (self.staging / "manifest.json").read_bytes()
        source = next(self.source.glob("*.parquet"))
        stat = source.stat()
        os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
        self.args.resume = True
        with self.assertRaisesRegex(ValueError, "snapshot|settings"):
            self.run_export()
        self.assertEqual((self.staging / "manifest.json").read_bytes(), before)
        self.assertFalse(self.output.exists())

    def test_changed_extraction_settings_prevent_resume(self):
        self.extracted_staging()
        self.args.resume = True
        self.args.batch_size = 2
        with self.assertRaisesRegex(ValueError, "snapshot|settings"):
            self.run_export()

    def test_exact_comparison_detects_changed_duplicate_multiplicities(self):
        self.extracted_staging()
        self.rewrite_first_batch([
            "DELETE FROM changed WHERE rowid=(SELECT MIN(rowid) FROM changed WHERE observation_id='A')",
            "INSERT INTO changed SELECT * FROM changed WHERE observation_id='N' LIMIT 1",
        ])
        with self.assertRaisesRegex(ValueError, "1 missing, 1 added"):
            self.validate(self.staging)
        self.assertFalse(self.output.exists())

    def test_validation_rejects_non_massachusetts_with_self_consistent_checkpoint(self):
        self.extracted_staging()
        self.rewrite_first_batch(["UPDATE changed SET state_code='US-NY' WHERE observation_id='A'"])
        with self.assertRaisesRegex(ValueError, "non-Massachusetts"):
            self.validate(self.staging)
        self.assertFalse(self.output.exists())

    def test_validation_interruption_resumes_verified_batches(self):
        original = validation.summarize
        calls = 0
        def interrupted(*args):
            nonlocal calls
            calls += 1
            if calls == 4:  # First batch verified; interrupt the second batch.
                raise KeyboardInterrupt()
            return original(*args)
        with patch.object(validation, "summarize", side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.run_export()
        manifest = export.load_manifest(self.staging)
        self.assertIn("validation", manifest["batches"]["batch_00000"])
        self.assertFalse(self.output.exists())
        self.args.resume = True
        with patch.object(validation, "summarize", wraps=original) as summary:
            self.run_export()
        self.assertEqual(summary.call_count, 5)  # Independent output + two remaining batch pairs.

    def test_existing_destination_and_invalid_paths_are_safe(self):
        self.output.mkdir()
        marker = self.output / "keep.txt"
        marker.write_text("untouched")
        with self.assertRaisesRegex(ValueError, "destination exists"):
            self.run_export()
        self.assertEqual(marker.read_text(), "untouched")
        self.assertFalse(self.staging.exists())
        self.args.output = self.source / "nested"
        with self.assertRaisesRegex(ValueError, "overlap"):
            self.run_export()
        self.args.output = self.root / "new-export"
        self.args.input = self.root / "missing"
        with self.assertRaisesRegex(ValueError, "not found"):
            self.run_export()
        self.args.input = self.source
        self.args.temp_directory = self.source / "scratch"
        with self.assertRaisesRegex(ValueError, "temporary storage"):
            self.run_export()

    def test_source_schema_drift_is_rejected_before_writing_data(self):
        connection = duckdb.connect()
        try:
            connection.execute("COPY (SELECT 'US-MA' AS state_code) TO ? (FORMAT PARQUET)",
                               [str(self.source / "part_00003.parquet")])
        finally:
            connection.close()
        with self.assertRaisesRegex(ValueError, "schema mismatch"):
            self.run_export()
        self.assertFalse(self.staging.exists())

    def test_failed_read_only_validation_leaves_completed_export_untouched(self):
        self.run_export()
        before = {str(path.relative_to(self.output)): export.sha256(path)
                  for path in self.output.rglob("*") if path.is_file()}
        extra = self.output / "unexpected.parquet"
        extra.write_bytes(b"unexpected")
        with self.assertRaisesRegex(ValueError, "Unexpected/missing"):
            self.validate()
        for name, checksum in before.items():
            self.assertEqual(export.sha256(self.output / name), checksum)

    def test_concurrent_export_lock_is_rejected(self):
        with export.export_lock(self.output):
            with self.assertRaisesRegex(RuntimeError, "Another extraction"):
                self.run_export()

    def test_entirely_empty_massachusetts_export_is_readable(self):
        empty_source = self.root / "no-massachusetts"
        empty_source.mkdir()
        shutil.copy2(self.source / "part_00001.parquet", empty_source / "part_00000.parquet")
        self.args.input = empty_source
        report = self.run_export()
        self.assertEqual(report["output"]["rows"], 0)
        self.assertIsNone(report["output"]["minimum_date"])
        self.assertGreaterEqual(report["parquet_files"], 1)
        connection = duckdb.connect()
        try:
            files = [str(path) for path in self.output.rglob("*.parquet")]
            self.assertEqual(connection.execute("SELECT count(*) FROM read_parquet(?)", [files]).fetchone()[0], 0)
        finally:
            connection.close()

    def test_added_source_file_prevents_resume(self):
        self.extracted_staging()
        shutil.copy2(self.source / "part_00000.parquet", self.source / "part_00003.parquet")
        self.args.resume = True
        with self.assertRaisesRegex(ValueError, "snapshot|settings"):
            self.run_export()
        self.assertFalse(self.output.exists())

    def test_destination_appearing_during_validation_is_not_replaced(self):
        original = validation.validate_export
        def destination_appears(*args, **kwargs):
            report = original(*args, **kwargs)
            self.output.mkdir()
            (self.output / "keep.txt").write_text("untouched")
            return report
        with patch.object(validation, "validate_export", side_effect=destination_appears):
            with self.assertRaisesRegex(ValueError, "Destination appeared"):
                self.run_export()
        self.assertEqual((self.output / "keep.txt").read_text(), "untouched")
        self.assertTrue(self.staging.exists())
        self.assertFalse(list(self.output.rglob("*.parquet")))

    def test_validated_checkpoint_is_invalidated_if_output_is_damaged(self):
        original_rename = Path.rename
        def interrupted_publish(path, target):
            if path == self.staging:
                raise OSError("Interrupted before publication")
            return original_rename(path, target)
        with patch.object(Path, "rename", interrupted_publish):
            with self.assertRaisesRegex(OSError, "Interrupted before"):
                self.run_export()
        self.assertFalse(self.output.exists())
        first = next((self.staging / "batch_00000").glob("*.parquet"))
        first.write_bytes(b"corrupt after validation")
        self.args.resume = True
        with patch.object(export, "extract_batch", wraps=export.extract_batch) as writer:
            with patch.object(validation, "summarize", wraps=validation.summarize) as summaries:
                self.run_export()
        self.assertEqual(writer.call_count, 1)
        self.assertEqual(summaries.call_count, 3)
        self.assertFalse((self.output / ".duckdb_tmp").exists())

    def test_failed_row_comparison_is_regenerated_on_next_resume(self):
        self.extracted_staging()
        self.rewrite_first_batch([
            "DELETE FROM changed WHERE rowid=(SELECT MIN(rowid) FROM changed WHERE observation_id='A')",
            "INSERT INTO changed SELECT * FROM changed WHERE observation_id='N' LIMIT 1",
        ])
        self.args.resume = True
        with self.assertRaisesRegex(ValueError, "1 missing, 1 added"):
            self.run_export()
        manifest = export.load_manifest(self.staging)
        self.assertTrue(manifest["batches"]["batch_00000"]["validation_failed"])
        self.assertFalse(self.output.exists())
        with patch.object(export, "extract_batch", wraps=export.extract_batch) as writer:
            self.run_export()
        self.assertEqual(writer.call_count, 1)
        self.assertEqual(self.validate()["output"]["rows"], 6)

    def test_cli_subset_and_fresh_validation(self):
        root = Path(__file__).resolve().parents[1]
        command = [sys.executable, str(root / "scripts" / "extract_massachusetts.py"),
            "--layout", "legacy", "--input", str(self.source), "--output", str(self.output), "--max-files", "1",
            "--memory-limit", "256MB", "--threads", "1"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SUBSET TEST", result.stdout)
        self.assertTrue(export.read_json(self.output / "manifest.json")["plan"]["subset"])
        command = [sys.executable, str(root / "scripts" / "validate_massachusetts.py"),
            "--input", str(self.source), "--dataset", str(self.output), "--memory-limit", "256MB", "--threads", "1"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"source_massachusetts_rows": 4', result.stdout)
        self.assertIn('"passed": true', result.stdout)


if __name__ == "__main__":
    unittest.main()
